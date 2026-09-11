/**
 * `manni key rotate [paths...]`: re-encrypt every encrypted value under a new
 * key, then write the key (proposal 0045).
 *
 * Values are found by their ciphertext, never through schema marks: meta's
 * `reencryptMetadata` takes every string of the ciphertext shape in a page's
 * metadata, and cite's `reencryptCitations` every encrypted `src` with its
 * keyed pin. A value already under the new key counts as done, so a run can
 * always be repeated.
 *
 * A value does not have to sit in a page. An external-metadata manifest
 * (proposal 0037) holds the private half of the same documents, which is
 * where an encrypted value most often lives, so the local manifests of the
 * collections a run covers are re-encrypted with the pages. See
 * `planManifests`.
 *
 * Input resolution is `cite check`'s: positional paths from `cwd`, else the
 * selected collections' `paths:` from the config's directory, `--exclude`
 * added to a collection's own `exclude:`, and zero files an error unless
 * `--allow-empty`.
 *
 * Every page and manifest is re-encrypted in memory first. One skip and
 * nothing is written (exit 1). Otherwise a whole run whose key comes from the
 * config writes in three steps, so that an interruption at any point leaves
 * every value readable by the next run:
 *
 * 1. the config: `encryptionKey:` the new key, `encryptionKeyPrevious:` the
 *    old one, in one atomic write;
 * 2. the pages, then the manifests;
 * 3. the config again, without `encryptionKeyPrevious:`.
 *
 * A run that finds `encryptionKeyPrevious:` finishes that rotation: from the
 * previous key to the current one. A narrowed run (paths or `--collection`)
 * and a run whose key comes from `MANNI_ENCRYPTION_KEY` write pages and
 * manifests and never the config. `--dry-run` writes nothing at all.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_CITE_BASELINE_PATH,
  GIT_UNAVAILABLE_HISTORY,
  buildSourceIndex,
  gitClient,
  parseCiteConfig,
  parseSrc,
  readPage,
  reencryptCitations,
  type CiteConfig,
  type GitClient,
  type ReencryptCitationsResult,
  type SourceIndex,
} from "../../cite/index.js";
import {
  PATH_JOIN,
  classifyRef,
  externalMetadataJoin,
  loadExternalMetadata,
  reencryptMetadata,
  supportedExtensions,
  writeFileAtomic,
  type ExternalMetadataEntry,
  type ExternalMetadataIndex,
  type ExternalMetadataValue,
} from "../../meta/index.js";
import {
  STDIN_TOKEN,
  assertNonEmpty,
  extractorByName,
  gitignoreOptions,
  reencryptData,
  resolveTargetSet,
  spliceManifestValue,
} from "../../meta/internal.js";
import { isMember, selectCollections, type CollectionConfig } from "../../shared/collections.js";
import type { ConfigFile } from "../../shared/config-file.js";
import { resolveEncryptionKey, writeEncryptionKey } from "../../shared/encryption-key.js";
import { generateEncryptionKey, isValidEncryptionKey } from "../../shared/encryption.js";
import { findGitRoot } from "../../shared/git-root.js";
import { readRotateConfig, toKeyError, unfinishedRotation } from "../core/config.js";
import { KeyError } from "../errors.js";
import type {
  KeyRotateOptions,
  KeyRotateResult,
  RotateManifest,
  RotateOutcome,
  RotatePage,
  RotatedValue,
  SkippedValue,
} from "../types.js";

const BAD_TO = "--to must be at least 32 hex or base64url characters.";
const NO_STDIN =
  "key rotate reads and writes files, so it takes no stdin (`-`). Name the files instead.";
const WITH_PATHS =
  "--collection selects a configured collection; it cannot be combined with paths.";
const NEEDS_CONFIG = "--collection needs a config file to select from.";
const NO_KEY =
  "No encryption key is available, so nothing can be re-encrypted. Run `manni key set` first.";
const ENV_NEEDS_TO =
  "The key comes from MANNI_ENCRYPTION_KEY; pass --to <value>, re-encrypt with it, then update the secret. Nothing is written to config.";
const NARROWED_NEEDS_TO = "A run over part of the family needs --to, and never writes the key.";
const NO_FILES =
  "No files to re-encrypt. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.";

/**
 * Any ciphertext at all. A page without one has nothing to rotate, so it costs
 * no parse; with one, the page is parsed and the tag decides.
 */
const ANY_CIPHERTEXT = /~[A-Za-z0-9_-]{82,}/;

/** The `cite:` section of the file, for `root:` and `baseline:`; `{}` without one. */
function citeSection(file: ConfigFile | null): CiteConfig {
  if (file === null) return {};
  const doc: unknown = parseYaml(file.text);
  if (typeof doc !== "object" || doc === null || !("cite" in doc)) return {};
  return parseCiteConfig(doc.cite, file.source);
}

/**
 * Where cited sources resolve from, as `cite` resolves it: `--root` (cwd
 * relative) > `cite.root` (config relative) > the git root > `cwd`.
 */
function rootFor(
  flag: string | undefined,
  cite: CiteConfig,
  file: ConfigFile | null,
  cwd: string,
): { root: string; fellBack: boolean } {
  if (flag !== undefined) return { root: resolve(cwd, flag), fellBack: false };
  if (file !== null && cite.root !== undefined) {
    return { root: resolve(file.dir, cite.root), fellBack: false };
  }
  const gitRoot = findGitRoot(cwd);
  return gitRoot === null ? { root: cwd, fellBack: true } : { root: gitRoot, fellBack: false };
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function indexFor(root: string, client: GitClient): Promise<SourceIndex> {
  try {
    return await buildSourceIndex(root, { gitClient: client });
  } catch (error) {
    if (isEnoent(error)) throw new KeyError(`Root directory not found: ${root}.`);
    throw error;
  }
}

/**
 * The page's encrypted citations, the only ones a rotation reads sources
 * for: whether it has any, and whether one carries a commit (its own or the
 * page's), which is when history would be read.
 */
function encryptedCitations(
  file: string,
  content: string,
  format: string | undefined,
): { any: boolean; withCommit: boolean } {
  const read = readPage(file, content, format === undefined ? undefined : { format });
  const encrypted = read.citations.filter(({ citation }) => {
    try {
      return parseSrc(citation.src).encrypted;
    } catch {
      return false;
    }
  });
  return {
    any: encrypted.length > 0,
    withCommit: encrypted.some(({ citation }) => (citation.commit ?? read.commit) !== undefined),
  };
}

interface Planned {
  page: RotatePage;
  path: string;
  content: string;
  changed: boolean;
}

interface PlannedManifest {
  manifest: RotateManifest;
  path: string;
  /** The manifest's text, with every rewritten value spliced into it. */
  text: string;
  changed: boolean;
}

/** How a run spells a manifest: relative to its base, like every file label. */
function reportedPath(abs: string, base: string): string {
  const rel = relative(base, abs);
  return rel === "" ? "." : rel.split(sep).join("/");
}

/**
 * The collections whose manifests this run covers. A run over every
 * collection, and one narrowed by `--collection`, covers the collections it
 * selected. A run over positional paths covers the collections those files
 * belong to, so the private half of a page a run re-encrypts moves with it.
 */
function manifestCollections(
  collections: readonly CollectionConfig[],
  opts: {
    fromCollections: boolean;
    files: readonly string[];
    base: string;
    configDir: string;
  },
): CollectionConfig[] {
  if (opts.fromCollections) return [...collections];
  const rels = opts.files.map((rel) =>
    reportedPath(resolve(opts.base, rel), opts.configDir),
  );
  return collections.filter((c) => rels.some((rel) => isMember(c, rel)));
}

/** The owned values one manifest entry supplies, or an empty map. */
function valuesOf(
  index: ExternalMetadataIndex,
  entry: ExternalMetadataEntry,
): ReadonlyMap<string, ExternalMetadataValue> {
  const empty = new Map<string, ExternalMetadataValue>();
  if (entry.join === PATH_JOIN) {
    return entry.abs === undefined ? empty : (index.byPath.get(entry.abs) ?? empty);
  }
  return index.byField.get(entry.join)?.get(entry.spelled) ?? empty;
}

/**
 * Re-encrypt the metadata values that live in the selected collections' local
 * manifests (proposals 0037, 0039 and 0041).
 *
 * A manifest is private by construction, so it is where an encrypted value is
 * most likely to sit. Rotation would otherwise leave it under the old key and
 * `meta validate` would report `encrypted:unreadable` on every page the
 * manifest feeds.
 *
 * Two things are left alone. A URL manifest is somebody else's file and
 * read-only (0038), so it is never loaded, and a rotation reaches no network.
 * The `citations` key is cite's: it re-keys a citation's source together with
 * its pin, under its own context, and re-encrypting the source alone would
 * break the pin. `reencryptData` skips it for the same reason
 * `reencryptMetadata` does on a page.
 *
 * Text in, text out. Each value is spliced into the manifest by
 * `spliceManifestValue`, which replaces that value's range and keeps every
 * other byte: the comments, the key order, the quoting and the line endings.
 * Nothing is written here; the caller writes when every value could be
 * re-encrypted.
 */
async function planManifests(opts: {
  collections: readonly CollectionConfig[];
  configDir: string;
  base: string;
  fromKey: string;
  toKey: string;
}): Promise<PlannedManifest[]> {
  const local = opts.collections
    .map((c) => ({
      ...c,
      externalMetadata: c.externalMetadata.filter(
        (m) => classifyRef(m.file).kind !== "url",
      ),
    }))
    .filter((c) => c.externalMetadata.length > 0);
  if (local.length === 0) return [];

  const index = await loadExternalMetadata(local, {
    configDir: opts.configDir,
    base: opts.base,
  });
  if (index === null) return [];

  // One plan per manifest file, so a manifest two collections declare is read
  // once and spliced once. Its reported path and collection identify it the
  // way `index.entries` does.
  const plans = new Map<string, PlannedManifest>();
  const located = new Map<string, string>();
  for (const c of local) {
    for (const m of c.externalMetadata) {
      const join = externalMetadataJoin(m);
      const abs = isAbsolute(m.file) ? m.file : resolve(opts.configDir, m.file);
      const file = reportedPath(abs, opts.base);
      located.set(`${c.name} ${file} ${join}`, abs);
      if (plans.has(abs)) continue;
      plans.set(abs, {
        manifest: { file, collection: c.name, rewritten: [], skipped: [], written: false },
        path: abs,
        text: await readFile(abs, "utf8"),
        changed: false,
      });
    }
  }

  for (const entry of index.entries) {
    const abs = located.get(`${entry.collection} ${entry.file} ${entry.join}`);
    const plan = abs === undefined ? undefined : plans.get(abs);
    if (plan === undefined) continue;
    const data: Record<string, unknown> = {};
    for (const [key, supplied] of valuesOf(index, entry)) {
      if (supplied.file === entry.file && supplied.collection === entry.collection) {
        data[key] = supplied.value;
      }
    }
    const done = reencryptData(data, { fromKey: opts.fromKey, toKey: opts.toKey });
    for (const r of done.rewritten) {
      plan.manifest.rewritten.push({ entry: entry.spelled, ...r });
    }
    for (const s of done.skipped) {
      plan.manifest.skipped.push({ entry: entry.spelled, ...s });
    }
    for (const key of done.keys) {
      plan.text = spliceManifestValue(plan.text, {
        entry: entry.spelled,
        key,
        value: done.data[key],
        join: entry.join,
        file: plan.manifest.file,
      }).text;
      plan.changed = true;
    }
  }

  return [...plans.values()].filter(
    (p) => p.manifest.rewritten.length > 0 || p.manifest.skipped.length > 0,
  );
}

export async function runKeyRotate(opts: KeyRotateOptions): Promise<KeyRotateResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const env = opts.env ?? process.env;
  if (opts.to !== undefined && !isValidEncryptionKey(opts.to)) throw new KeyError(BAD_TO);
  if (opts.inputs.includes(STDIN_TOKEN)) throw new KeyError(NO_STDIN);
  const wanted = opts.collection ?? [];
  if (wanted.length > 0 && opts.inputs.length > 0) throw new KeyError(WITH_PATHS);

  const file = await readRotateConfig(opts.configPath, cwd);
  if (wanted.length > 0 && file === null) throw new KeyError(NEEDS_CONFIG);
  const { key: current, source: keySource } = resolveEncryptionKey({
    env,
    file,
    toError: toKeyError,
  });
  if (current === undefined) throw new KeyError(NO_KEY);
  const narrowed = opts.inputs.length > 0 || wanted.length > 0;

  // Only a key from the config has a config a rotation can be finished in.
  const keyFile = keySource === "config" ? file : null;
  const previous = keyFile?.encryptionKeyPrevious;
  if (
    keyFile !== null &&
    previous !== undefined &&
    (narrowed || (opts.to !== undefined && opts.to !== current))
  ) {
    throw new KeyError(unfinishedRotation(keyFile.source));
  }
  if (keySource === "env" && opts.to === undefined) throw new KeyError(ENV_NEEDS_TO);
  if (narrowed && opts.to === undefined) throw new KeyError(NARROWED_NEEDS_TO);

  // Finishing an interrupted rotation goes from the key it replaced to the one
  // the config already holds; otherwise from the current key to the new one.
  const fromKey = previous ?? current;
  const toKey = previous === undefined ? (opts.to ?? generateEncryptionKey()) : current;

  const collections =
    file === null ? [] : selectCollections(file.collections, wanted, file.source, toKeyError);
  const fromCollections = opts.inputs.length === 0;
  const inputs = fromCollections ? collections.flatMap((c) => c.paths) : opts.inputs;
  if (inputs.length === 0) throw new KeyError(NO_FILES);
  // One base per run, as in cite and meta: typed paths from cwd, a
  // collection's `paths:` from the config's directory.
  const base = fromCollections && file !== null ? file.dir : cwd;

  const forced = opts.as === undefined ? undefined : extractorByName(opts.as);
  if (opts.as !== undefined && forced?.implemented !== true) {
    throw new KeyError(
      `Unknown format "${opts.as}". Supported extensions: ${supportedExtensions().join(", ")}.`,
    );
  }
  const format = forced?.name;
  const exts = opts.exts ?? forced?.extensions;
  const exclude = [
    ...new Set([
      ...(opts.exclude ?? []),
      ...(fromCollections ? collections.flatMap((c) => c.exclude) : []),
    ]),
  ];
  const { files, gitignoreSkipped } = await resolveTargetSet({
    inputs,
    exts,
    exclude,
    cwd: base,
    allowEmpty: opts.allowEmpty,
    ...gitignoreOptions({ flag: opts.respectGitignore, onNotice: opts.onNotice }),
  });
  assertNonEmpty({
    files,
    inputs,
    usingStdin: false,
    allowEmpty: opts.allowEmpty,
    exclude,
    exts,
    gitignoreSkipped,
    action: "re-encrypted",
  });

  const cite = citeSection(file);
  const { root, fellBack } = rootFor(opts.root, cite, file, cwd);
  const client = opts.gitClient ?? gitClient(root);
  // Built once, and only when a page cites an encrypted source.
  let index: Promise<SourceIndex> | undefined;
  const sourceIndex = (): Promise<SourceIndex> => {
    if (index === undefined) {
      if (fellBack) opts.onNotice?.(`No git root found; resolving src: paths from ${cwd}`);
      index = indexFor(root, client);
    }
    return index;
  };

  const planned: Planned[] = [];
  let wantsHistory = false;
  for (const rel of files) {
    const path = resolve(base, rel);
    const before = await readFile(path, "utf8");
    if (!ANY_CIPHERTEXT.test(before)) continue;
    const page = { file: rel, content: before, ...(format === undefined ? {} : { format }) };
    const meta = reencryptMetadata(page, { fromKey, toKey });
    const encrypted = encryptedCitations(rel, meta.content, format);
    if (encrypted.withCommit) wantsHistory = true;
    const cited: ReencryptCitationsResult = encrypted.any
      ? await reencryptCitations(
          { ...page, content: meta.content },
          { root, fromKey, toKey, gitClient: client, sourceIndex: await sourceIndex() },
        )
      : { content: meta.content, rewritten: [], skipped: [] };
    const rewritten: RotatedValue[] = [
      ...meta.rewritten.map((r) => ({ kind: "metadata" as const, ...r })),
      ...cited.rewritten.map((r) => ({ kind: "citation" as const, ...r })),
    ];
    const skipped: SkippedValue[] = [
      ...meta.skipped.map((s) => ({ kind: "metadata" as const, ...s })),
      ...cited.skipped.map((s) => ({ kind: "citation" as const, ...s })),
    ];
    if (rewritten.length === 0 && skipped.length === 0) continue;
    planned.push({
      page: { file: rel, rewritten, skipped, written: false },
      path,
      content: cited.content,
      changed: cited.content !== before,
    });
  }

  // A pin that no longer holds is re-keyed from the lines at its commit, so a
  // citation with one wants git. Where git is not there, said once.
  if (wantsHistory && !(await client.available())) opts.onNotice?.(GIT_UNAVAILABLE_HISTORY);

  // The private half of the same documents: every local manifest of the
  // collections this run covers. Planned in memory like the pages, and
  // counted with them, so one unreadable value anywhere stops the whole run.
  const manifests =
    file === null
      ? []
      : await planManifests({
          collections: manifestCollections(collections, {
            fromCollections,
            files,
            base,
            configDir: file.dir,
          }),
          configDir: file.dir,
          base,
          fromKey,
          toKey,
        });

  const reencrypted =
    planned.reduce((n, p) => n + p.page.rewritten.length, 0) +
    manifests.reduce((n, m) => n + m.manifest.rewritten.length, 0);
  const skipped =
    planned.reduce((n, p) => n + p.page.skipped.length, 0) +
    manifests.reduce((n, m) => n + m.manifest.skipped.length, 0);
  const writePage = opts.writePage ?? ((path: string, content: string) => writeFileAtomic(path, content));

  let outcome: RotateOutcome;
  if (skipped > 0) {
    // The new key is never written beside a value it cannot decrypt, and no
    // page is written without the key: nothing at all.
    outcome = "skipped";
  } else if (opts.dryRun === true) {
    outcome = "dry-run";
  } else {
    const writesKey = !narrowed && keyFile !== null;
    // (1) The new key, with the old one beside it. A rotation being finished
    // already has both.
    if (!narrowed && keyFile !== null && previous === undefined) {
      await writeEncryptionKey({ file: keyFile, key: toKey, previous: fromKey, cwd, toError: toKeyError });
    }
    // (2) The pages, then the manifests that hold the private half.
    for (const p of planned) {
      if (!p.changed) continue;
      await writePage(p.path, p.content);
      p.page.written = true;
    }
    for (const m of manifests) {
      if (!m.changed) continue;
      await writePage(m.path, m.text);
      m.manifest.written = true;
    }
    // (3) The old key goes, now that nothing is under it.
    if (!narrowed && keyFile !== null) {
      await writeEncryptionKey({ file: keyFile, key: toKey, previous: null, cwd, toError: toKeyError });
    }
    if (narrowed) outcome = "narrowed";
    else if (!writesKey) outcome = "env";
    else outcome = previous === undefined ? "written" : "finished";
  }

  const wrote = outcome !== "skipped" && outcome !== "dry-run";
  const baseline =
    file !== null && cite.baseline !== undefined
      ? resolve(file.dir, cite.baseline)
      : join(file?.dir ?? cwd, DEFAULT_CITE_BASELINE_PATH);

  return {
    pages: planned.map((p) => p.page),
    manifests: manifests.map((m) => m.manifest),
    reencrypted,
    skipped,
    keyWritten: outcome === "written" || outcome === "finished",
    outcome,
    ...(keyFile === null ? {} : { configSource: keyFile.source }),
    baselineStale: wrote && existsSync(baseline),
    exitCode: skipped > 0 ? 1 : 0,
  };
}
