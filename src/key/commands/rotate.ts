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
 * Input resolution is `cite check`'s: positional paths from `cwd`, else the
 * selected collections' `paths:` from the config's directory, `--exclude`
 * added to a collection's own `exclude:`, and zero files an error unless
 * `--allow-empty`.
 *
 * Every page is re-encrypted in memory first. One skip and nothing is written
 * (exit 1). Otherwise a whole run whose key comes from the config writes in
 * three steps, so that an interruption at any point leaves every value
 * readable by the next run:
 *
 * 1. the config: `encryptionKey:` the new key, `encryptionKeyPrevious:` the
 *    old one, in one atomic write;
 * 2. the pages;
 * 3. the config again, without `encryptionKeyPrevious:`.
 *
 * A run that finds `encryptionKeyPrevious:` finishes that rotation: from the
 * previous key to the current one. A narrowed run (paths or `--collection`)
 * and a run whose key comes from `MANNI_ENCRYPTION_KEY` write pages and never
 * the config. `--dry-run` writes nothing at all.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_CITE_BASELINE_PATH,
  buildSourceIndex,
  gitClient,
  noGit,
  parseCiteConfig,
  parseSrc,
  readPage,
  reencryptCitations,
  type CiteConfig,
  type GitClient,
  type ReencryptCitationsResult,
  type SourceIndex,
} from "../../cite/index.js";
import { reencryptMetadata, supportedExtensions, writeFileAtomic } from "../../meta/index.js";
import {
  STDIN_TOKEN,
  assertNonEmpty,
  extractorByName,
  gitignoreOptions,
  resolveTargetSet,
} from "../../meta/internal.js";
import { selectCollections } from "../../shared/collections.js";
import type { ConfigFile } from "../../shared/config-file.js";
import { resolveEncryptionKey, writeEncryptionKey } from "../../shared/encryption-key.js";
import { generateEncryptionKey, isValidEncryptionKey } from "../../shared/encryption.js";
import { findGitRoot } from "../../shared/git-root.js";
import { readRotateConfig, toKeyError, unfinishedRotation } from "../core/config.js";
import { KeyError } from "../errors.js";
import type {
  KeyRotateOptions,
  KeyRotateResult,
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

async function indexFor(root: string, client: GitClient, git: boolean): Promise<SourceIndex> {
  try {
    return await buildSourceIndex(root, { gitClient: client, git });
  } catch (error) {
    if (isEnoent(error)) throw new KeyError(`Root directory not found: ${root}.`);
    throw error;
  }
}

/** Whether the page carries a citation whose source is encrypted: only then are sources read. */
function citesEncrypted(file: string, content: string, format: string | undefined): boolean {
  const read = readPage(file, content, format === undefined ? undefined : { format });
  return read.citations.some(({ citation }) => {
    try {
      return parseSrc(citation.src).encrypted;
    } catch {
      return false;
    }
  });
}

interface Planned {
  page: RotatePage;
  path: string;
  content: string;
  changed: boolean;
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
  const useGit = opts.git ?? true;
  const client = opts.gitClient ?? (useGit ? gitClient(root) : noGit());
  // Built once, and only when a page cites an encrypted source.
  let index: Promise<SourceIndex> | undefined;
  const sourceIndex = (): Promise<SourceIndex> => {
    if (index === undefined) {
      if (fellBack) opts.onNotice?.(`No git root found; resolving src: paths from ${cwd}`);
      index = indexFor(root, client, useGit);
    }
    return index;
  };

  const planned: Planned[] = [];
  for (const rel of files) {
    const path = resolve(base, rel);
    const before = await readFile(path, "utf8");
    if (!ANY_CIPHERTEXT.test(before)) continue;
    const page = { file: rel, content: before, ...(format === undefined ? {} : { format }) };
    const meta = reencryptMetadata(page, { fromKey, toKey });
    const cited: ReencryptCitationsResult = citesEncrypted(rel, meta.content, format)
      ? await reencryptCitations(
          { ...page, content: meta.content },
          { root, fromKey, toKey, git: useGit, gitClient: client, sourceIndex: await sourceIndex() },
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

  const reencrypted = planned.reduce((n, p) => n + p.page.rewritten.length, 0);
  const skipped = planned.reduce((n, p) => n + p.page.skipped.length, 0);
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
    // (2) The pages.
    for (const p of planned) {
      if (!p.changed) continue;
      await writePage(p.path, p.content);
      p.page.written = true;
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
    reencrypted,
    skipped,
    keyWritten: outcome === "written" || outcome === "finished",
    outcome,
    ...(keyFile === null ? {} : { configSource: keyFile.source }),
    baselineStale: wrote && existsSync(baseline),
    exitCode: skipped > 0 ? 1 : 0,
  };
}
