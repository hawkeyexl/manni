/**
 * Relocation (proposal 0047): put a page's values where their schema's
 * `x-manni-location` mark and the config's manifests say they belong, and
 * give a value that prefers external metadata a manifest when it has none.
 *
 * `manni meta relocate` is this module with a CLI in front of it, and the
 * writers' and validate's offers run the same plan. Three steps, kept apart
 * so a caller can stop after any of them:
 *
 *  - **Home selection** (`keyHome`, and inside `planRelocation`). A page in a
 *    collection uses the first one it belongs to. With no collections, one
 *    named `default` is created from the run's targets. With exactly one, the
 *    target that names the page is appended to its `paths:`. With several and
 *    the page in none, there is no home. The manifest is the collection's
 *    first local `file:` entry, or `<collection>.metadata.yaml` beside the
 *    config file. A collection that declares no `externalMetadata:` gets
 *    the metadata directory instead (proposal 0126), with no config edit,
 *    and a page with no id is minted one. A URL manifest is never a home.
 *  - **Planning** (`planRelocation`). Every move, every config edit and every
 *    new file text is computed, and nothing is written. A change to a
 *    manifest's `keys:` covers every member page of its collection, in both
 *    directions, because a key a manifest owns and a page still carries is an
 *    `external:owned` collision, and a key it stops owning is no longer read.
 *  - **Applying** (`applyRelocation`). The texts are written, manifests first,
 *    then the config, then the pages, and the caller's in-memory collections
 *    are brought up to date, so a writer can put a value into the manifest the
 *    plan just declared. A write that fails puts back the files already
 *    written, so a run lands whole or not at all.
 *
 * A value never moves by being re-read. The page's own extraction and the
 * manifest's parsed value are what move, so an encrypted value goes as its
 * ciphertext, verbatim.
 */
import { isMissing } from "../../shared/manifest-cas.js";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import {
  LineCounter,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parse as parseYaml,
  parseDocument,
  stringify,
  visit,
  type Document,
  type Pair,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import {
  colOf,
  colonEnd,
  contentEnd,
  detectEol,
  detectStyle,
  emptySource,
  flowText,
  indentLines,
  keyLines as cutLines,
  keyString,
  lineEnd,
  rangeOf,
  type Edit,
} from "./yaml-splice.js";
import {
  implicitExternalMetadata,
  isMember,
  ownsKey,
  parseCollections,
  type CollectionConfig,
  type ExternalMetadataConfig,
} from "../../shared/collections.js";
import { FAMILY_CONFIG_NAMES, type ConfigFile } from "../../shared/config-file.js";
import {
  applyMetadataDirectory,
  metadataDirState,
  missingDirMessage,
  resolveExternalMetadataDir,
  type MetadataDirState,
  type ResolvedMetadataDir,
} from "../../shared/external-metadata-dir.js";
import { findGitRoot } from "../../shared/git-root.js";
import {
  hasIdPlaceholder,
  hasPagePlaceholder,
  idManifestPath,
  normalizeManifestPattern,
  pageManifestPath,
} from "../../shared/page-manifest.js";
import { errorMessage } from "../../shared/errors.js";
import { decryptValue, isEncryptedValue } from "../../shared/encryption.js";
import { DocmetaError, type MetadataExtractor, type MetadataPatch } from "../types.js";
import { schemaTrustRoot, type DocmetaConfig, type RunConfig } from "./config.js";
import { memberOf } from "./collections.js";
import { EncryptionRefusal, META_CONTEXT, lazyKey } from "./encrypted.js";
import {
  ID_JOIN,
  PATH_JOIN,
  externalMetadataJoin,
  idManifestValues,
  loadExternalMetadata,
  manifestIdOf,
  mergeWithMarks,
  outsideRefusal as perPageOutsideRefusal,
  unsafeIdMessage,
  type ExternalMetadataIndex,
  type ExternalMetadataValue,
} from "./external-metadata.js";
import { removeManifestKey, spliceManifestValue } from "./external-metadata-write.js";
import { gitignoreOptions, resolveTargetSet, STDIN_TOKEN } from "./load-files.js";
import { FILE_SCHEMA_KEY, resolveElements, resolveSchemaSetWithSource } from "./resolve-schema.js";
import { classifyRef } from "./schema-registry.js";
import type { Validator } from "./validator.js";
import { writeFileAtomic } from "./write-file.js";
import { extractorByName, extractorForExtension } from "../extractors/index.js";
import { deepEqual } from "../extractors/patch-util.js";
import type { FieldLocation } from "./location.js";
import { pageMarks } from "./page-marks.js";
import { mintedText, mintId, type MintedId, type MintRequest } from "./mint-id.js";

// ---------------------------------------------------------------------------
// The result: what `manni meta relocate` reports.
// ---------------------------------------------------------------------------

/** Why a value was moved: its schema's mark, or a manifest that already owns the key. */
export type RelocateMoveReason = "preferred" | "owned";

/** Why a value stayed on the side it is on. */
export type RelocateStayReason =
  | "no-home"
  | "read-only-format"
  | "no-join-value"
  | "values-differ"
  | "url-manifest"
  | "unreadable";

/** One value that moved, or would under `dryRun`. */
export type RelocateMove =
  | { key: string; to: "page"; from: string; reason: RelocateMoveReason }
  | {
      key: string;
      to: "manifest";
      manifest: string;
      /** 1-based line of the key in the manifest afterwards. Absent under `dryRun`. */
      line?: number;
      reason: RelocateMoveReason;
      /** The `--from` manifest the value left (proposal 0126), for a move between manifests. */
      from?: string;
    };

/** One value that stayed on the wrong side. */
export interface RelocateStay {
  key: string;
  reason: RelocateStayReason;
  /** The sentence the pretty reporter prints after `stays: `. Not part of the JSON shape. */
  detail?: string;
}

export interface RelocateFileResult {
  /** The page, as the run labels it. */
  file: string;
  moved: RelocateMove[];
  stayed: RelocateStay[];
  /** A member page outside the paths the run named, reached through a `keys:` or `paths:` change. */
  beyond: boolean;
  /**
   * The id this run minted into the page (proposal 0126), for the `{id}`
   * manifest its values moved to. Present only when one was.
   */
  minted?: string;
}

export interface RelocateManifestResult {
  /** The manifest as the run reports it: relative to the run's base, or the URL. */
  file: string;
  collection: string;
  /** Its index in the collection's `externalMetadata:` before the run. */
  index: number;
  created: boolean;
  keysAdded: string[];
  keysRemoved: string[];
  /** The keys it owns afterwards. */
  keys: string[];
  /** Whether its last key went, so the config no longer declares it (R3). */
  undeclared: boolean;
  /** Pages beyond the named paths whose values a `keys:` change moves, or leaves. */
  beyond: number;
  /**
   * A `--from` manifest (proposal 0126) the run removed from the config.
   * `reads` is the metadata directory, as `metadata/`, when its collection is
   * left with no entries and so reads it. Not part of the JSON shape.
   */
  removed?: { reads?: string };
}

export interface RelocateConfigResult {
  /** The config file relative to the working directory, or null when there is none and none was needed. */
  file: string | null;
  created: boolean;
  collectionsCreated: { name: string; paths: string[] }[];
  pathsAdded: { collection: string; path: string }[];
}

export interface RelocateSummary {
  /** Pages with a value moved or stayed. */
  files: number;
  moved: number;
  stayed: number;
  manifestsCreated: number;
  /** Ids minted into pages (proposal 0126). Present only when some were. */
  minted?: number;
  /** `--from` manifests left with no entries and deleted (0126). Present only when some were. */
  deleted?: number;
}

export interface RelocateResult {
  dryRun: boolean;
  config: RelocateConfigResult;
  /** Every manifest the run creates, changes the keys of, or moves a value into or out of. */
  manifests: RelocateManifestResult[];
  files: RelocateFileResult[];
  /** `--from` manifests left with no entries, deleted (proposal 0126). Present only when some were. */
  deleted?: string[];
  summary: RelocateSummary;
}

/** Whether a relocate run exits 1: at least one value stayed on the wrong side. */
export function relocateFailed(result: Pick<RelocateResult, "summary">): boolean {
  return result.summary.stayed > 0;
}

// ---------------------------------------------------------------------------
// The context: what a run already settled, handed over once.
// ---------------------------------------------------------------------------

export interface RelocationContext {
  cwd: string;
  /** The directory the run's file labels are relative to. */
  base: string;
  /** `--no-config`: nothing may be written to a config, so no value has a home. */
  noConfig: boolean;
  config: DocmetaConfig | null;
  /** Set by `applyRelocation` when it creates the config file. */
  configDir?: string;
  configPath?: string;
  configFile?: ConfigFile;
  /**
   * The run's selected collections. `applyRelocation` edits these objects in
   * place and appends a created collection, so a caller holding the array
   * sees the new manifests.
   */
  collections: CollectionConfig[];
  /** Every declared collection, the same objects as `collections`, edited the same way. */
  declaredCollections: CollectionConfig[];
  /**
   * The run's targets as typed (positional paths and globs). A created
   * collection's `paths:`, and a path appended to the only collection, come
   * from here. `-` is never one.
   */
  targets: readonly string[];
  /** `-s/--schema`: the schema set every page is judged by, over config. */
  cliSchemas?: readonly string[];
  validator: Validator;
  /** `--as`: the extractor every page is read with. */
  as?: string;
  /** `--no-gitignore` (false), for the walk of a collection's member pages. */
  respectGitignore?: boolean;
  env?: NodeJS.ProcessEnv;
  onNotice?: (message: string) => void;
}

/** A context from what `resolveRunConfig` returned, plus the rest a plan needs. */
export function relocationContext(
  run: RunConfig,
  extras: {
    cwd: string;
    targets: readonly string[];
    validator: Validator;
    noConfig?: boolean;
    cliSchemas?: readonly string[];
    as?: string;
    respectGitignore?: boolean;
    env?: NodeJS.ProcessEnv;
    onNotice?: (message: string) => void;
  },
): RelocationContext {
  return {
    cwd: extras.cwd,
    base: run.base,
    noConfig: extras.noConfig ?? false,
    config: run.config,
    ...(run.configDir !== undefined ? { configDir: run.configDir } : {}),
    ...(run.configPath !== undefined ? { configPath: run.configPath } : {}),
    ...(run.configFile !== undefined ? { configFile: run.configFile } : {}),
    collections: run.collections,
    declaredCollections: run.declaredCollections,
    targets: extras.targets.filter((t) => t !== STDIN_TOKEN),
    ...(extras.cliSchemas !== undefined ? { cliSchemas: extras.cliSchemas } : {}),
    validator: extras.validator,
    ...(extras.as !== undefined ? { as: extras.as } : {}),
    ...(extras.respectGitignore !== undefined ? { respectGitignore: extras.respectGitignore } : {}),
    ...(extras.env !== undefined ? { env: extras.env } : {}),
    ...(extras.onNotice !== undefined ? { onNotice: extras.onNotice } : {}),
  };
}

// ---------------------------------------------------------------------------
// The model: the collections as the plan would leave them.
// ---------------------------------------------------------------------------

/** One manifest of the model, declared or about to be. */
interface ManifestRef {
  collection: string;
  index: number;
  /** `file:` as the config writes it. */
  written: string;
  url: boolean;
  /** Undefined for a URL, and for a `{page}` manifest, which names no one file. */
  absPath: string | undefined;
  /**
   * As the run reports it. A `{page}` manifest (proposal 0058) names one file
   * per page, so this is the pattern as written, and `Model.fileFor` answers
   * the file one page's values live in.
   */
  file: string;
  join: string;
  /** `file:` holds `{page}`: each page keeps its values in a manifest of its own. */
  perPage: boolean;
  /**
   * `file:` holds `{id}` (proposal 0126): each page keeps its values in a
   * manifest named by its id, which `Model.fileFor` answers once the page's
   * id is known. `file` is the pattern as the run reports it.
   */
  perId: boolean;
  /**
   * The metadata directory, read by a collection that declares no
   * `externalMetadata:`, while it holds no manifest and so nothing reads it
   * (0126). It is §3's created home for such a collection: writing a page's
   * file creates it, and no config edit declares it. `entry` is the
   * directory's entry, which a re-read of the config gives the collection.
   */
  latent: boolean;
  entry?: ExternalMetadataConfig;
  /** The keys a writer is about to set that a latent directory is the home of. */
  homed: string[];
  /** The key or the environment named the directory, and it is not there (0126). */
  missing: boolean;
  created: boolean;
  /**
   * The manifest names no `keys` (proposal 0068): it owns what each page's
   * schemas mark external, so the plan never adds or removes a key of its.
   */
  implied: boolean;
  keysBefore: string[];
  keysAdded: string[];
  keysRemoved: string[];
  /**
   * A `--from` manifest (proposal 0126) this plan empties: no key lives in
   * it, each value it holds moves to where the config without it says, and
   * the config no longer declares it.
   */
  from?: true;
  /** A `--from` file the config does not declare, read with a path join. Never a home. */
  loose?: true;
  /** The metadata directory as the home of a collection `--from` leaves with no entries. */
  emptiedHome?: true;
}

/** The collection a `--from` file the config does not declare is read under (0126). */
const LOOSE = "--from";

/** A `--from` manifest's identity across plans: its collection and its index there. */
const refId = (m: Pick<ManifestRef, "collection" | "index">): string => `${m.collection}\0${String(m.index)}`;

const toPosix = (p: string): string => p.split(sep).join("/");

function reported(abs: string, base: string): string {
  const rel = relative(base, abs);
  return rel === "" ? "." : toPosix(rel);
}

/** The config file relative to the working directory, as every message names it. */
function configSource(path: string, cwd: string): string {
  return toPosix(relative(cwd, path)) || basename(path);
}

function cloneCollection(c: CollectionConfig): CollectionConfig {
  return {
    ...c,
    paths: [...c.paths],
    exclude: [...c.exclude],
    externalMetadata: c.externalMetadata.map((m) => (m.keys === undefined ? { ...m } : { ...m, keys: [...m.keys] })),
  };
}

/** Where a page with no manifest for a key would get one. */
export type ProposedHome =
  | {
      kind: "collection";
      collection: string;
      /** The manifest the key would join, as the run reports it. */
      manifest: string;
      createsManifest: boolean;
      createsCollection: boolean;
      /** The run target appended to the collection's `paths:` (§3 case 3). */
      addsPath?: string;
    }
  | {
      kind: "none";
      /** `collections`: several are declared and the page is in none. `no-config`: `--no-config`. */
      reason: "collections" | "no-config";
      /** How many collections are declared. */
      collections: number;
    };

class Model {
  readonly collections: CollectionConfig[];
  readonly manifests: ManifestRef[] = [];
  readonly created: { name: string; paths: string[] }[] = [];
  readonly pathsAdded: { collection: string; path: string }[] = [];
  private targets: Promise<(string | undefined)[]> | undefined;
  /** The metadata directory (proposal 0126), as the key, the environment or the default names it. */
  readonly dir: ResolvedMetadataDir;
  /** A latent directory became this plan's home, so every collection that would read it now does. */
  dirActive = false;
  /** Each page's id, as an `{id}` manifest names its file: its own, or one this plan mints. */
  readonly ids = new Map<string, string>();

  constructor(
    private readonly ctx: RelocationContext,
    readonly configDir: string,
  ) {
    this.collections = ctx.declaredCollections.map(cloneCollection);
    this.dir = resolveExternalMetadataDir({
      configDir,
      ...(ctx.env !== undefined ? { env: ctx.env } : {}),
      ...(ctx.configFile?.externalMetadataDir !== undefined ? { configured: ctx.configFile.externalMetadataDir } : {}),
    });
    for (const c of this.collections) {
      c.externalMetadata.forEach((m, index) => {
        this.manifests.push(this.refOf(c.name, index, m));
      });
      // Nothing reads the directory yet (0126), or the collection would
      // carry its entry. It is still the collection's created home.
      if (!c.declaresExternalMetadata && c.externalMetadata.length === 0) this.addLatent(c);
    }
  }

  /** A declared entry as the model's manifest. */
  private refOf(
    collection: string,
    index: number,
    m: Pick<ExternalMetadataConfig, "file" | "keys" | "join" | "missing">,
  ): ManifestRef {
    const url = classifyRef(m.file).kind === "url";
    const perPage = !url && hasPagePlaceholder(m.file);
    const perId = !url && hasIdPlaceholder(m.file);
    const absPath =
      url || perPage || perId ? undefined : isAbsolute(m.file) ? m.file : resolve(this.configDir, m.file);
    return {
      collection,
      index,
      written: m.file,
      url,
      absPath,
      file: perId ? this.patternFile(m.file) : absPath === undefined ? m.file : reported(absPath, this.ctx.base),
      join: externalMetadataJoin(m),
      perPage,
      perId,
      latent: false,
      homed: [],
      missing: m.missing !== undefined,
      created: false,
      implied: m.keys === undefined,
      keysBefore: [...(m.keys ?? [])],
      keysAdded: [],
      keysRemoved: [],
    };
  }

  /** An `{id}` pattern as the run reports it: `metadata/{id}.yaml`. */
  private patternFile(pattern: string): string {
    return reported(resolve(this.configDir, normalizeManifestPattern(pattern)), this.ctx.base);
  }

  /** The config file as an entry's origin names it. */
  private source(): string {
    return this.ctx.configFile?.source ?? FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml";
  }

  /** The latent metadata directory as `c`'s created home (0126). */
  private addLatent(c: CollectionConfig): ManifestRef {
    const where = `collections[${String(this.collections.indexOf(c))}]`;
    const source = this.source();
    const ref: ManifestRef = {
      collection: c.name,
      index: 0,
      written: this.dir.pattern,
      url: false,
      absPath: undefined,
      file: this.patternFile(this.dir.pattern),
      join: ID_JOIN,
      perPage: false,
      perId: true,
      latent: true,
      entry: implicitExternalMetadata(this.dir.pattern, source, where),
      homed: [],
      missing: false,
      created: false,
      implied: true,
      keysBefore: [],
      keysAdded: [],
      keysRemoved: [],
    };
    this.manifests.push(ref);
    return ref;
  }

  /** The collections `--from` leaves with none of their entries (0126). */
  private readonly emptiedNames = new Set<string>();

  /**
   * Empty `refs`, the `--from` manifests (proposal 0126). A collection left
   * with none of its entries reads the metadata directory, which becomes its
   * home: latent while the directory holds no manifest, and created by this
   * plan when it is named and not there.
   */
  empty(refs: readonly ManifestRef[]): void {
    for (const r of refs) r.from = true;
    let state: MetadataDirState | undefined;
    for (const c of this.collections) {
      const own = this.manifestsOf(c.name);
      if (own.length === 0 || own.some((m) => m.from !== true)) continue;
      this.emptiedNames.add(c.name);
      state ??= metadataDirState(this.dir);
      const home = this.addLatent(c);
      home.emptiedHome = true;
      home.latent = state === "absent";
      home.missing = state === "missing";
    }
  }

  /** Does `--from` leave `collection` with none of its entries, so it reads the directory? */
  emptied(collection: string): boolean {
    return this.emptiedNames.has(collection);
  }

  /** A `--from` file the config does not declare (0126), emptied like a declared one. */
  addLoose(file: string): ManifestRef {
    const ref = this.refOf(LOOSE, -1, { file });
    ref.from = true;
    ref.loose = true;
    this.manifests.push(ref);
    return ref;
  }

  /** The file an `{id}` manifest names for `id`, and how the run reports it. */
  idFile(m: ManifestRef, id: string): { abs: string; file: string } {
    const { abs } = idManifestPath(m.written, this.configDir, id);
    return { abs, file: reported(abs, this.ctx.base) };
  }

  /** An `{id}` manifest's directory as the run reports it, for the unsafe-id refusal. */
  dirOf(m: ManifestRef): string {
    const cut = m.file.lastIndexOf("/");
    return cut < 0 ? "." : m.file.slice(0, cut);
  }

  /** What minting asks for a page an `{id}` manifest names: every collection that reads it is scanned. */
  mintRequest(m: ManifestRef, label: string): MintRequest {
    const key = (pattern: string): string => resolve(this.configDir, normalizeManifestPattern(pattern));
    const readers = new Set(
      this.manifests.filter((r) => r.perId && key(r.written) === key(m.written)).map((r) => r.collection),
    );
    return {
      label,
      pattern: m.written,
      configDir: this.configDir,
      readers: this.collections.filter((c) => readers.has(c.name)),
      collections: this.collections,
    };
  }

  members(label: string): string[] {
    return memberOf(this.collections, this.configDir, this.ctx.base, label);
  }

  /** The run's targets as `paths:` entries, in target order; resolved once, on first use. */
  private targetPaths(): Promise<(string | undefined)[]> {
    this.targets ??= Promise.all(this.ctx.targets.map((t) => collectionPath(t, this.ctx.cwd, this.configDir)));
    return this.targets;
  }

  manifestsOf(collection: string): ManifestRef[] {
    return this.manifests.filter((m) => m.collection === collection);
  }

  /**
   * The one file `m` keeps a page's values in, and how the run reports it:
   * the page's own for a `{page}` manifest (proposal 0058), the declared file
   * for any other. `abs` is undefined only for a URL manifest.
   */
  fileFor(m: ManifestRef, pageAbs: string): { abs: string | undefined; file: string } {
    // An `{id}` manifest (0126) is named by the page's id, once it is known.
    if (m.perId) {
      const id = this.ids.get(pageAbs);
      return id === undefined ? { abs: undefined, file: m.file } : this.idFile(m, id);
    }
    if (!m.perPage) return { abs: m.absPath, file: m.file };
    const resolved = pageManifestPath(m.written, this.configDir, pageAbs);
    if ("outside" in resolved) {
      // The loader refuses such a page first, whenever the run names it.
      const declared = this.ctx.declaredCollections.find((c) => c.name === m.collection)?.externalMetadata[m.index];
      throw new DocmetaError(
        perPageOutsideRefusal(declared ?? { file: m.written }, m.collection, resolved.pageRel),
      );
    }
    return { abs: resolved.abs, file: reported(resolved.abs, this.ctx.base) };
  }

  /**
   * The manifest of one of `members` that owns `key`, in declaration order.
   * `marked` is what the page's schemas mark external, which is what a
   * manifest with no `keys` owns (proposal 0068).
   */
  ownerOf(key: string, members: readonly string[], marked?: ReadonlySet<string>): ManifestRef | undefined {
    return this.manifests.find(
      (m) =>
        members.includes(m.collection) &&
        // A `--from` manifest (0126) is on its way out, so no key lives there.
        m.from !== true &&
        // A latent directory owns nothing until this plan creates it, unless
        // `--from` leaves a collection reading it.
        (!m.latent || this.dirActive || m.emptiedHome === true) &&
        (m.implied ? this.impliedOwns(m, key, marked) : m.keysBefore.includes(key) || m.keysAdded.includes(key)),
    );
  }

  /**
   * Does a keyless manifest own `key` for a page whose schemas mark `marked`?
   * Asked of the collection as the config declares it once the `--from`
   * manifests are gone (0126), so a key only one of them named is free.
   */
  impliedOwns(m: ManifestRef, key: string, marked: ReadonlySet<string> | undefined): boolean {
    const collection = this.collections.find((c) => c.name === m.collection);
    const declared = m.entry ?? collection?.externalMetadata[m.index];
    if (collection === undefined || declared === undefined) return false;
    const gone = (i: number): boolean =>
      this.manifests.some((r) => r.from === true && r.collection === m.collection && r.index === i);
    return ownsKey({ externalMetadata: collection.externalMetadata.filter((_, i) => !gone(i)) }, declared, key, marked);
  }

  /** Does one of `members` declare a manifest with no `keys`? */
  hasImplied(members: readonly string[]): boolean {
    return this.manifests.some((m) => m.implied && !m.latent && members.includes(m.collection));
  }

  /** The page's collection to home a new key in, first by the run's selection. */
  private pick(members: readonly string[]): string | undefined {
    const selected = new Set(this.ctx.collections.map((c) => c.name));
    return members.find((m) => selected.has(m)) ?? members[0];
  }

  /**
   * §3's four cases. `commit` makes the choice part of the model (a created
   * collection, an appended path, a new manifest), which planning wants and a
   * lookup does not.
   */
  async home(
    label: string,
    commit: boolean,
    owns: (m: ManifestRef) => boolean = () => false,
  ): Promise<{ manifest: ManifestRef; proposed: ProposedHome } | { proposed: ProposedHome }> {
    if (this.ctx.noConfig) {
      return { proposed: { kind: "none", reason: "no-config", collections: this.collections.length } };
    }
    const members = this.members(label);
    let collection = this.pick(members);
    let createsCollection = false;
    let addsPath: string | undefined;
    if (collection === undefined) {
      const rel = this.relative(label);
      if (this.collections.length === 0) {
        const paths = dedupe(
          (await this.targetPaths()).flatMap((p) => (p === undefined ? [] : [p])),
        );
        if (rel === undefined || !paths.some((p) => isMember(bare(p), rel))) {
          return { proposed: { kind: "none", reason: "collections", collections: 0 } };
        }
        collection = "default";
        createsCollection = true;
        if (commit) {
          this.collections.push({
            name: collection,
            paths,
            exclude: [],
            externalMetadata: [],
            declaresExternalMetadata: false,
          });
          this.created.push({ name: collection, paths: [...paths] });
        }
      } else if (this.collections.length === 1 && this.collections[0] !== undefined) {
        const only = this.collections[0];
        const target = (await this.targetPaths()).find(
          (p) => p !== undefined && rel !== undefined && isMember(bare(p), rel),
        );
        if (target === undefined) {
          return { proposed: { kind: "none", reason: "collections", collections: 1 } };
        }
        collection = only.name;
        addsPath = target;
        if (commit) {
          only.paths.push(target);
          this.pathsAdded.push({ collection: only.name, path: target });
        }
      } else {
        return { proposed: { kind: "none", reason: "collections", collections: this.collections.length } };
      }
    }
    const name = collection;
    // A keyless manifest (proposal 0068) is a home only for what it owns: a
    // key cannot be added to a list it does not have.
    const local = this.manifestsOf(name).find((m) => !m.url && !m.latent && m.from !== true && (!m.implied || owns(m)));
    const proposedOf = (m: { file: string; created: boolean }): ProposedHome => ({
      kind: "collection",
      collection: name,
      manifest: m.file,
      createsManifest: m.created,
      createsCollection,
      ...(addsPath !== undefined ? { addsPath } : {}),
    });
    if (local !== undefined) return { manifest: local, proposed: proposedOf(local) };

    // A collection that declares no `externalMetadata:` reads the metadata
    // directory (proposal 0126), so the directory is its created home, with
    // no config edit: writing a page's file there is what puts it in play.
    // So is one `--from` leaves with no entries.
    const declared = this.collections.find((c) => c.name === name);
    if (createsCollection || (declared !== undefined && (!declared.declaresExternalMetadata || this.emptied(name)))) {
      const dir =
        this.manifestsOf(name).find(
          (m) =>
            m.latent ||
            m.emptiedHome === true ||
            (m.perId && declared?.externalMetadata[m.index]?.implicit === true),
        ) ?? (commit && declared !== undefined ? this.addLatent(declared) : undefined);
      if (dir === undefined) return { proposed: proposedOf({ file: this.patternFile(this.dir.pattern), created: true }) };
      if (commit && dir.latent) this.dirActive = true;
      return { manifest: dir, proposed: proposedOf({ file: dir.file, created: dir.latent }) };
    }

    const fileName = `${name}.metadata.yaml`;
    const absPath = join(this.configDir, fileName);
    const file = reported(absPath, this.ctx.base);
    if (!commit) return { proposed: proposedOf({ file, created: true }) };
    if (await exists(absPath, file)) {
      throw new DocmetaError(
        `${file} already exists and is not a manifest of collection ${name}; declare it under externalMetadata, or move it.`,
      );
    }
    const owner = this.collections.find((c) => c.name === name);
    const ref: ManifestRef = {
      collection: name,
      index: owner?.externalMetadata.length ?? 0,
      written: `./${fileName}`,
      url: false,
      absPath,
      file,
      join: PATH_JOIN,
      perPage: false,
      perId: false,
      latent: false,
      homed: [],
      missing: false,
      created: true,
      implied: false,
      keysBefore: [],
      keysAdded: [],
      keysRemoved: [],
    };
    owner?.externalMetadata.push({ file: ref.written, keys: [] });
    this.manifests.push(ref);
    return { manifest: ref, proposed: proposedOf(ref) };
  }

  addKey(m: ManifestRef, key: string): void {
    if (m.implied || m.keysBefore.includes(key) || m.keysAdded.includes(key)) return;
    m.keysAdded.push(key);
    this.collections.find((c) => c.name === m.collection)?.externalMetadata[m.index]?.keys?.push(key);
  }

  removeKey(m: ManifestRef, key: string): void {
    if (!m.keysBefore.includes(key) || m.keysRemoved.includes(key)) return;
    m.keysRemoved.push(key);
  }

  /** The keys a manifest owns once the plan is applied. */
  finalKeys(m: ManifestRef): string[] {
    return [...m.keysBefore.filter((k) => !m.keysRemoved.includes(k)), ...m.keysAdded];
  }

  /**
   * The collections as the config will declare them, and as a re-read of it
   * says: removals applied, emptied manifests gone. The metadata directory's
   * entry (proposal 0126) is never in the file, so it stands only while the
   * collection declares nothing else.
   */
  final(): CollectionConfig[] {
    return this.collections.map((c, i) => {
      const externalMetadata = c.externalMetadata.flatMap((em, index) => {
        if (em.implicit === true) return [];
        const ref = this.manifests.find(
          (m) => m.collection === c.name && m.index === index && !m.latent && m.emptiedHome !== true,
        );
        // A `--from` manifest (0126) goes whole.
        if (ref?.from === true) return [];
        // A keyless manifest (proposal 0068) is declared as it was.
        if (ref?.implied === true || (ref === undefined && em.keys === undefined)) return [em];
        const keys = ref === undefined ? (em.keys ?? []) : this.finalKeys(ref);
        return keys.length === 0 ? [] : [{ ...em, keys }];
      });
      if (externalMetadata.length > 0) return { ...c, externalMetadata, declaresExternalMetadata: true };
      // `editConfig` keeps a list written empty, an opt-out, and removes one
      // it emptied.
      const optedOut = this.ctx.declaredCollections.some(
        (d) => d.name === c.name && d.declaresExternalMetadata && d.externalMetadata.length === 0,
      );
      if (optedOut) return { ...c, externalMetadata: [], declaresExternalMetadata: true };
      // A collection left with no list reads the directory whenever a re-read
      // of the config would: while it holds a manifest, and once this plan
      // fills it or creates the one the key or the environment names. A named
      // one that is still not there carries the loader's refusal.
      const state = this.dirActive || this.manifests.some((m) => m.missing) ? "read" : metadataDirState(this.dir);
      if (state === "absent") return { ...c, externalMetadata: [], declaresExternalMetadata: false };
      const entry = implicitExternalMetadata(this.dir.pattern, this.source(), `collections[${String(i)}]`);
      if (state === "missing") entry.missing = missingDirMessage(this.dir);
      return { ...c, externalMetadata: [entry], declaresExternalMetadata: false };
    });
  }

  /** A label relative to the config directory, posix; undefined outside it. */
  relative(label: string): string | undefined {
    if (label === "<stdin>") return undefined;
    const rel = toPosix(relative(this.configDir, resolve(this.ctx.base, label)));
    return isAbsolute(rel) || rel.startsWith("../") ? undefined : rel;
  }
}

function dedupe<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

/** A one-path collection, for asking whether a planned `paths:` entry covers a page. */
function bare(path: string): CollectionConfig {
  return { name: "", paths: [path], exclude: [], externalMetadata: [], declaresExternalMetadata: false };
}

/**
 * A run target as a collection `paths:` entry, relative to the config
 * directory: `docs/` and a directory named without the slash become
 * `docs/**`, a glob and a file stay themselves. Undefined for stdin and for a
 * target outside the config directory, which no collection can hold.
 */
async function collectionPath(target: string, cwd: string, configDir: string): Promise<string | undefined> {
  if (target === STDIN_TOKEN) return undefined;
  const posix = target.replace(/\\/g, "/");
  const scanned = picomatch.scan(posix);
  if (scanned.isGlob) {
    // The glob's literal base resolves like a file target; the magic part rides along.
    const rel = toPosix(relative(configDir, resolve(cwd, scanned.base === "" ? "." : scanned.base)));
    if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) return undefined;
    return rel === "" ? scanned.glob : `${rel}/${scanned.glob}`;
  }
  const abs = resolve(cwd, posix);
  const rel = toPosix(relative(configDir, abs));
  if (isAbsolute(rel) || rel.startsWith("..")) return undefined;
  let directory = posix.endsWith("/");
  if (!directory) {
    try {
      directory = (await stat(abs)).isDirectory();
    } catch {
      directory = false;
    }
  }
  if (!directory) return rel;
  return rel === "" ? "**" : `${rel}/**`;
}

/**
 * Whether `absPath` exists. Only a missing file is `false`: any other failure
 * to look is refused, rather than read as room to create the file.
 */
async function exists(absPath: string, file: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new DocmetaError(`${file} could not be checked: ${errorMessage(err)}`);
  }
}

/** The directory a config is (or will be) in: the loaded one, else the git root, else cwd. */
function plannedConfigDir(ctx: RelocationContext): string {
  return ctx.configDir ?? findGitRoot(ctx.cwd) ?? resolve(ctx.cwd);
}

// ---------------------------------------------------------------------------
// Lookup: where a key lives, or where it would go.
// ---------------------------------------------------------------------------

/** Where key K of one page lives, or would. */
export type KeyHome =
  | {
      kind: "manifest";
      collection: string;
      /** As the run reports it. */
      file: string;
      absPath: string;
      /** `path`, or the page field the manifest joins on. */
      join: string;
      /** The page's entry: its path from the config directory, or its join value. Undefined when the page lacks the join field. */
      entry: string | undefined;
      /**
       * The manifest is the page's own, resolved from a `{page}` pattern
       * (proposal 0058). It may not exist yet: a writer holds it as empty
       * and creates it. True for an `{id}` manifest too.
       */
      perPage: boolean;
      /**
       * The manifest is the page's own in an `{id}` directory (proposal
       * 0126), named by its id, so it stays where it is when the page moves.
       */
      perId?: true;
      /**
       * The page carries no id, so the writer mints this one first (0126):
       * it puts `id` in the page as its own writer writes the page, or
       * writes `text`, the page with the id in it, when it writes nothing
       * else there. Once the page is written it prints `mintedNotice`.
       */
      mint?: MintedId;
    }
  | { kind: "url"; collection: string; file: string }
  | {
      /**
       * An `{id}` manifest owns the key, the page carries no id, and none
       * can be minted for it (0126), so the key stays in the page. The writer
       * prints `mintStayNotice` with `reason`.
       */
      kind: "stay";
      collection: string;
      /** The manifest's pattern, as the run reports it. */
      file: string;
      reason: string;
    }
  | { kind: "unowned"; home: ProposedHome };

/**
 * Where `key` of the page `label` lives in the context's current config: the
 * owning local manifest (with the page's entry in it), a URL manifest, or
 * nowhere, with the home §3 would choose. Reads no manifest and writes
 * nothing. `data` is the page's own metadata, for a field join; an encrypted
 * join value is decrypted with the run's key.
 *
 * An `{id}` manifest (proposal 0126) is the page's file by its id. A page
 * with none is minted one, which reads every page of the collections that
 * read the directory once a run; a page none can be minted for is `stay`.
 * An id that cannot name a file, or one held encrypted, is refused.
 */
export async function keyHome(
  ctx: RelocationContext,
  label: string,
  data: Readonly<Record<string, unknown>>,
  key: string,
): Promise<KeyHome> {
  const model = new Model(ctx, plannedConfigDir(ctx));
  const members = model.members(label);
  // A keyless manifest (proposal 0068) owns the key when the page's schemas
  // mark it external, read with the key in place: Ajv evaluates a mark only
  // where the property is present.
  const marked = model.hasImplied(members)
    ? await marksOf(ctx)(
        label,
        Object.hasOwn(data, key) ? data : { ...data, [key]: null },
        memberOf(ctx.declaredCollections, ctx.configDir ?? ctx.cwd, ctx.base, label),
      )
    : undefined;
  const owner = model.ownerOf(key, members, marked);
  if (owner?.perId === true) return idHome(ctx, model, owner, label, data, marked);
  if (owner !== undefined) {
    // A `{page}` manifest (proposal 0058) resolves to the page's own file.
    const at = model.fileFor(owner, resolve(ctx.base, label));
    if (owner.url || at.abs === undefined) {
      return { kind: "url", collection: owner.collection, file: owner.file };
    }
    return {
      kind: "manifest",
      collection: owner.collection,
      file: at.file,
      absPath: at.abs,
      join: owner.join,
      entry: entryFor(owner, label, data, model.configDir, ctx.base, lazyKey(ctx.configFile, ctx.env)),
      perPage: owner.perPage,
    };
  }
  const chosen = await model.home(label, false);
  // The metadata directory as the created home (0126) is no home for a page
  // with no id that none can be minted for: a key it would own stays there.
  if (
    "manifest" in chosen &&
    chosen.manifest.latent &&
    manifestIdOf(data[ID_JOIN]) === undefined &&
    model.impliedOwns(
      chosen.manifest,
      key,
      await marksOf(ctx)(
        label,
        Object.hasOwn(data, key) ? data : { ...data, [key]: null },
        memberOf(ctx.declaredCollections, ctx.configDir ?? ctx.cwd, ctx.base, label),
      ),
    )
  ) {
    const outcome = await mintId(ctx, model.mintRequest(chosen.manifest, label));
    if ("stay" in outcome) {
      return { kind: "stay", collection: chosen.manifest.collection, file: chosen.manifest.file, reason: outcome.stay };
    }
  }
  return { kind: "unowned", home: chosen.proposed };
}

/** The refusal for an id that cannot name a file in an `{id}` manifest's directory (0126). */
function unsafeIdRefusal(label: string, refused: { value: string; encrypted: boolean }, dir: string): DocmetaError {
  return new DocmetaError(`${label}: ${unsafeIdMessage(refused, dir)}`);
}

/**
 * `keyHome` for a key an `{id}` manifest owns (proposal 0126). A page that
 * carries no id is minted one, and every value it holds for a key that
 * manifest owns once the id exists goes with it (`MintedId.moved`).
 */
async function idHome(
  ctx: RelocationContext,
  model: Model,
  owner: ManifestRef,
  label: string,
  data: Readonly<Record<string, unknown>>,
  marked: ReadonlySet<string> | undefined,
): Promise<KeyHome> {
  const own = manifestIdOf(data[ID_JOIN]);
  if (own !== undefined && "refused" in own) throw unsafeIdRefusal(label, own.refused, model.dirOf(owner));
  let mint: MintedId | undefined;
  let id: string;
  if (own !== undefined) {
    id = own.id;
  } else {
    const outcome = await mintId(ctx, model.mintRequest(owner, label));
    if ("stay" in outcome) return { kind: "stay", collection: owner.collection, file: owner.file, reason: outcome.stay };
    id = outcome.minted;
    const members = model.members(label);
    const moved = Object.fromEntries(
      Object.entries(data).filter(
        ([k]) => k !== ID_JOIN && k !== FILE_SCHEMA_KEY && model.ownerOf(k, members, marked)?.file === owner.file,
      ),
    );
    const elements = resolveElements(label, ctx.config, memberOf(ctx.declaredCollections, ctx.configDir ?? ctx.cwd, ctx.base, label));
    // A writer that cannot take a moved value out would leave it in two places.
    const written = mintedText(label, outcome.text, { id, moved, elements }, ctx.as);
    if ("why" in written) {
      return { kind: "stay", collection: owner.collection, file: owner.file, reason: `the page cannot be written: ${written.why}` };
    }
    mint = { id, moved, elements, text: written.text };
  }
  const at = model.idFile(owner, id);
  return {
    kind: "manifest",
    collection: owner.collection,
    file: at.file,
    absPath: at.abs,
    join: ID_JOIN,
    entry: id,
    perPage: true,
    perId: true,
    ...(mint !== undefined ? { mint } : {}),
  };
}

/** What a page's schemas mark external, over the context's schemas (proposal 0068). */
function marksOf(ctx: RelocationContext): ReturnType<typeof pageMarks> {
  return pageMarks({
    validator: ctx.validator,
    config: ctx.config,
    cwd: ctx.cwd,
    trustRoot: schemaTrustRoot(ctx.cwd, ctx.configDir),
    ...(ctx.cliSchemas !== undefined ? { cliSchemas: ctx.cliSchemas } : {}),
  });
}

/** A page's entry in a manifest: its path from the config directory, or its join value. */
function entryFor(
  m: ManifestRef,
  label: string,
  data: Readonly<Record<string, unknown>>,
  configDir: string,
  base: string,
  key: () => string | undefined,
): string | undefined {
  if (m.join === PATH_JOIN) return toPosix(relative(configDir, resolve(base, label)));
  let raw = data[m.join];
  if (isEncryptedValue(raw)) {
    const k = key();
    if (k === undefined) {
      throw new EncryptionRefusal(
        `externalMetadata join field "${m.join}" is encrypted on these pages, and no encryption key is available to match them.`,
      );
    }
    const opened = decryptValue(raw, k, META_CONTEXT);
    if (!opened.ok) return undefined;
    raw = opened.value;
  }
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return undefined;
}

// ---------------------------------------------------------------------------
// Planning.
// ---------------------------------------------------------------------------

export interface RelocationRequest {
  /** The pages the run named, as labels relative to the context's base. */
  files: readonly string[];
  /** `--fields`: only these keys. Each must be marked, or manifest-owned, for some file. */
  fields?: readonly string[];
  /**
   * Keys a writer is about to set that need an external home for these
   * pages, whether or not the page holds them yet. Treated as preferring
   * external metadata; a key a manifest already owns needs nothing.
   */
  require?: ReadonlyMap<string, readonly string[]>;
  /**
   * A metadata directory the key or the environment names that is not there
   * (proposal 0126) is read as empty and created, rather than refused:
   * `relocate` without `--dry-run`.
   */
  createDirectory?: boolean;
  /**
   * `--from` (proposal 0126): manifests to empty, each a `file:` as the config
   * spells it or a file it does not declare. Every value one holds moves to
   * where the config without it says its key lives.
   */
  from?: readonly string[];
}

/** One value a `--from` manifest (0126) holds for a page, and the entry it sits under. */
interface FromSource {
  manifest: ManifestRef;
  key: string;
  entry: string;
  /** The page's file of it, as the run reports it. */
  file: string;
  value: unknown;
}

/** A value a kept `--from` manifest holds, and why it could not leave, for the plan that keeps it. */
interface KeptStay {
  label: string;
  key: string;
  reason: RelocateStayReason;
  detail: string;
}

type Intent =
  | {
      kind: "out";
      manifest: ManifestRef;
      reason: RelocateMoveReason;
      drop: boolean;
      entry: string;
      /** The `--from` manifest the value leaves (0126); absent, it leaves the page. */
      from?: FromSource;
      /** Equal copies other `--from` manifests hold (0126), which leave with it. */
      also?: FromSource[];
    }
  | {
      kind: "in";
      manifest: ManifestRef;
      drop: boolean;
      entry: string;
      value: unknown;
      /** The `--from` value this is (0126), whose manifest is `manifest`. */
      from?: FromSource;
      also?: FromSource[];
    }
  | {
      kind: "stay";
      reason: RelocateStayReason;
      detail: string;
      /** A manifest whose key removal this stay holds back. */
      blocks?: ManifestRef;
      /** The manifest the value was on its way out to. */
      toward?: ManifestRef;
    };

interface Page {
  label: string;
  absPath: string;
  format: string;
  content: string;
  elements: string[];
  extractor: MetadataExtractor;
  own: Record<string, unknown>;
  beyond: boolean;
  /** Why a page reached only beyond the named paths could not be read. Its `own` is empty. */
  unreadable?: string;
  intents: Map<string, Intent>;
  /** The page's text afterwards, when it changes. */
  text?: string;
  /** The id minted for the page (0126), written in with a value moving to its `{id}` manifest. */
  mint?: string;
}

/** One file the plan writes. */
export interface RelocationWrite {
  path: string;
  text: string;
  kind: "manifest" | "config" | "page";
  /** The file is deleted rather than written: a `--from` manifest left with no entries (0126). */
  remove?: true;
  /**
   * The file's text on disk when the plan was made, or null when it did not
   * exist. Applying refuses a file that no longer matches, and a failed run
   * puts this text back.
   */
  before: string | null;
}

/** How `applyRelocation` changes the disk. Tests replace it; the default is atomic writes and `unlink`. */
export interface RelocationIo {
  write?: (path: string, text: string) => Promise<void>;
  remove?: (path: string) => Promise<void>;
}

/** A complete, validated plan: every text computed, nothing written. */
export interface RelocationPlan {
  /** The report, as a dry run shows it: no manifest lines. */
  result: RelocateResult;
  /** Every file to write, in write order. */
  writes: RelocationWrite[];
  /** Manifest lines per (file, key), for the applied report. */
  lines: ReadonlyMap<string, number>;
  /** The collections as the config declares them afterwards. */
  collections: CollectionConfig[];
  configDir: string;
  configPath: string;
  /** The per-collection offers the writers' and validate's prompts put. */
  offers: RelocationOffer[];
  /**
   * Pages whose external-preferring keys have no possible home, for the
   * writers' W2 line: several collections and the page in none, or
   * `--no-config`.
   */
  homeless: { file: string; keys: string[]; reason: "collections" | "no-config"; collections: number }[];
  /**
   * The metadata directory becomes read (proposal 0126): the plan creates it,
   * or creates the one the key or the environment names, so every collection
   * with no `externalMetadata:` reads it afterwards. `missing` is a named
   * directory to create even when nothing moves into it.
   */
  directory?: { abs: string; missing: boolean };
  /**
   * `--from` manifests left with no entries that hold YAML comments, which
   * relocate does not carry (0126): written emptied rather than deleted, as
   * the run reports them. Present only when there is one.
   */
  commented?: string[];
}

/**
 * The pages a `{page}` manifest (proposal 0058) is read for: the run's own,
 * and every member of a collection that declares one. A `keys:` change
 * reaches every member page, so a narrowed run still has to know what each
 * member's manifest holds. With no placeholder declared, nothing is walked.
 */
async function relocationPages(
  ctx: RelocationContext,
  request: RelocationRequest,
): Promise<string[]> {
  const pages = new Set(request.files.map((label) => resolve(ctx.base, label)));
  const root = ctx.configDir ?? ctx.cwd;
  for (const collection of ctx.declaredCollections) {
    const perPage = collection.externalMetadata.some(
      (m) => classifyRef(m.file).kind !== "url" && hasPagePlaceholder(m.file),
    );
    if (!perPage) continue;
    const walked = await resolveTargetSet({
      inputs: [...collection.paths],
      cwd: root,
      allowEmpty: true,
      ...gitignoreOptions({
        ...(ctx.respectGitignore !== undefined ? { flag: ctx.respectGitignore } : {}),
        ...(ctx.config?.respectGitignore !== undefined ? { configured: ctx.config.respectGitignore } : {}),
      }),
    });
    for (const file of walked.files) pages.add(resolve(root, file));
  }
  return [...pages];
}

/**
 * Plan every move for `request.files` and the member pages a `keys:` change
 * reaches, with every new file text computed and read back. Writes nothing.
 *
 * Throws `DocmetaError` for a page that will not load, a schema that will not
 * resolve, a `--fields` name nothing marks or owns (U3), a manifest path that
 * exists undeclared (U6), a single-tool config file, and an edit that does
 * not read back as planned. `--from` refuses a URL, the metadata directory,
 * and a file neither declared nor on disk.
 */
export async function planRelocation(
  ctx: RelocationContext,
  request: RelocationRequest,
): Promise<RelocationPlan> {
  // A `--from` manifest (0126) holding a value that cannot leave it stays
  // declared, so the config without it is not the one to plan against. The
  // plan is made again with it kept, until every one still emptied empties.
  const kept = new Map<string, KeptStay[]>();
  // It ends: each pass returns a plan or keeps at least one more of the finitely many `--from` manifests.
  for (;;) {
    const planned = await planOnce(ctx, request, kept);
    if ("plan" in planned) return planned.plan;
    for (const [id, stays] of planned.blocked) kept.set(id, stays);
  }
}

/**
 * The manifests `--from` names (proposal 0126), emptied in `model`: each
 * entry of the run's collections whose `file:` it spells after 0058's
 * normalization, save those `kept` holds, or else the file itself, read
 * with a path join. Each file the config does not declare is loaded here,
 * for the pages `pages` names.
 */
async function fromManifests(
  ctx: RelocationContext,
  model: Model,
  from: readonly string[],
  kept: ReadonlyMap<string, unknown>,
  pages: readonly string[],
): Promise<{ refs: ManifestRef[]; loose: Map<ManifestRef, ExternalMetadataIndex | null> }> {
  const at = (file: string): string => resolve(model.configDir, normalizeManifestPattern(file));
  const selected = new Set(ctx.collections.map((c) => c.name));
  const notThere = (file: string): DocmetaError => new DocmetaError(`--from ${file} is not declared and does not exist.`);
  const refs: ManifestRef[] = [];
  const loose = new Map<ManifestRef, ExternalMetadataIndex | null>();
  for (const spelled of from) {
    if (classifyRef(spelled).kind === "url") {
      throw new DocmetaError(`--from ${spelled} is fetched and cannot be emptied; move its values in that repository.`);
    }
    if (at(spelled) === at(model.dir.pattern)) {
      throw new DocmetaError(`--from ${spelled} is where values would move to; name the manifest to empty.`);
    }
    const declared = model.manifests.filter(
      (m) => selected.has(m.collection) && !m.url && !m.latent && at(m.written) === at(spelled),
    );
    if (declared.length > 0) {
      refs.push(...declared.filter((m) => !kept.has(refId(m))));
      continue;
    }
    const pattern = hasPagePlaceholder(spelled) || hasIdPlaceholder(spelled);
    if (!pattern && !existsSync(at(spelled))) throw notThere(spelled);
    const ref = model.addLoose(spelled);
    const index = await loadExternalMetadata(
      [
        {
          name: LOOSE,
          paths: ctx.collections.flatMap((c) => c.paths),
          exclude: [],
          externalMetadata: [{ file: spelled }],
          declaresExternalMetadata: true,
        },
      ],
      { configDir: model.configDir, base: ctx.base, offline: ctx.config?.offline ?? false, pages },
    );
    // A pattern names a file per page: one that names none for the run's pages is not there.
    if (pattern && (index === null || index.entries.length === 0)) throw notThere(spelled);
    loose.set(ref, index);
    refs.push(ref);
  }
  model.empty(refs.filter((m) => m.loose !== true));
  return { refs, loose };
}

/** One plan, with the `--from` manifests `kept` names kept, or the ones that turn out blocked. */
async function planOnce(
  ctx: RelocationContext,
  request: RelocationRequest,
  kept: ReadonlyMap<string, readonly KeptStay[]>,
): Promise<{ plan: RelocationPlan } | { blocked: ReadonlyMap<string, KeptStay[]> }> {
  const configDir = plannedConfigDir(ctx);
  const model = new Model(ctx, configDir);
  const encryptionKey = lazyKey(ctx.configFile, ctx.env);
  const marks = marksOf(ctx);
  const loaded = await relocationPages(ctx, request);
  const index = await loadExternalMetadata(ctx.declaredCollections, {
    configDir: ctx.configDir ?? ctx.cwd,
    base: ctx.base,
    offline: ctx.config?.offline ?? false,
    pages: loaded,
    ...(request.createDirectory === true ? { missingDirectory: "empty" as const } : {}),
  });
  const from = await fromManifests(ctx, model, request.from ?? [], kept, loaded);
  // What the metadata directory already holds, for a collection `--from`
  // leaves reading it, which nothing above may have loaded (0126).
  const home = model.manifests.find((m) => m.emptiedHome === true);
  const dirIndex =
    home?.entry === undefined
      ? null
      : await loadExternalMetadata(
          [{ name: home.collection, paths: [], exclude: [], externalMetadata: [home.entry], declaresExternalMetadata: false }],
          { configDir, base: ctx.base, missingDirectory: "empty" },
        );
  const trustRoot = schemaTrustRoot(ctx.cwd, ctx.configDir);
  const forced = ctx.as !== undefined ? extractorByName(ctx.as) : undefined;
  const fields = request.fields === undefined ? undefined : new Set(request.fields);
  const wanted = (key: string): boolean => key !== FILE_SCHEMA_KEY && (fields === undefined || fields.has(key));
  const currentMembers = (label: string): string[] =>
    memberOf(ctx.declaredCollections, ctx.configDir ?? ctx.cwd, ctx.base, label);

  const pages = new Map<string, Page>();
  const runSet = new Set(request.files);
  const load = async (label: string, beyond: boolean): Promise<Page | undefined> => {
    const have = pages.get(label);
    if (have !== undefined) return have;
    // `--as` names how the run's own files are read; a sibling reached through a
    // keys: or paths: change is read by its extension, like any walk.
    const extractor = (beyond ? undefined : forced) ?? extractorForExtension(extname(label));
    if (extractor === undefined) {
      if (beyond) return undefined;
      throw new DocmetaError(`Unsupported file type "${extname(label)}" for "${label}". Use --as to override.`);
    }
    const absPath = resolve(ctx.base, label);
    const elements = resolveElements(label, ctx.config, currentMembers(label));
    let content = "";
    let own: Record<string, unknown> = {};
    let unreadable: string | undefined;
    // A named page that will not load refuses the run. A sibling is one page
    // among many the change reaches, so its values stay, with the reason.
    if (beyond) {
      try {
        content = await readFile(absPath, "utf8");
        own = extractor.extract(content, label, { elements }).data;
      } catch (err) {
        // The first line: a parser's excerpt of the source would break the report's one line per value.
        unreadable = (errorMessage(err).split("\n")[0] ?? "").replace(/:\s*$/, "");
      }
    } else {
      content = await readFile(absPath, "utf8");
      try {
        own = extractor.extract(content, label, { elements }).data;
      } catch (err) {
        throw new DocmetaError(`${label}: ${errorMessage(err)}`);
      }
    }
    const page: Page = {
      label,
      absPath,
      format: extractor.name,
      content,
      elements,
      extractor,
      own,
      beyond,
      ...(unreadable !== undefined ? { unreadable } : {}),
      intents: new Map(),
    };
    pages.set(label, page);
    return page;
  };

  /** The value manifest `m` holds for `key` of `page` today. */
  const supplied = (m: ManifestRef, page: Page, key: string): ExternalMetadataValue | undefined => {
    if (m.created || index === null) return undefined;
    let sv: ExternalMetadataValue | undefined;
    if (m.perId) {
      // One directory is one manifest for every collection that reads it
      // (0126), so its values carry no collection to compare.
      const id = model.ids.get(page.absPath);
      const at = id === undefined ? undefined : { pattern: m.file, id };
      sv = at === undefined ? undefined : (idManifestValues(index, at) ?? idManifestValues(dirIndex, at))?.get(key);
      return sv !== undefined && sv.file === model.fileFor(m, page.absPath).file ? sv : undefined;
    }
    if (m.join === PATH_JOIN) {
      sv = index.byPath.get(page.absPath)?.get(key);
    } else {
      const entry = entryFor(m, page.label, page.own, configDir, ctx.base, encryptionKey);
      sv = entry === undefined ? undefined : index.byField.get(m.join)?.get(entry)?.get(key);
    }
    // A `{page}` manifest's values carry the page's own file (proposal 0058).
    return sv !== undefined && sv.collection === m.collection && sv.file === model.fileFor(m, page.absPath).file
      ? sv
      : undefined;
  };

  const stay = (
    page: Page,
    key: string,
    reason: RelocateStayReason,
    detail: string,
    links: { blocks?: ManifestRef; toward?: ManifestRef } = {},
  ): void => {
    page.intents.set(key, { kind: "stay", reason, detail, ...links });
  };
  const urlDetail = (m: ManifestRef): string => `${m.file} is fetched and cannot be written`;
  const unreadableDetail = (page: Page): string => `this document could not be parsed: ${page.unreadable ?? ""}`;

  /**
   * The entry an `{id}` manifest (0126) names `page` by: its id, or one
   * minted for it, which goes into the page with the move. An id that
   * cannot name a file refuses the run, and no id that can be minted is the
   * reason the value stays.
   */
  const idEntry = async (page: Page, m: ManifestRef): Promise<{ entry: string } | { stay: string }> => {
    const own = manifestIdOf(page.own[ID_JOIN]);
    if (own !== undefined && "refused" in own) throw unsafeIdRefusal(page.label, own.refused, model.dirOf(m));
    let id = own?.id ?? page.mint;
    if (id === undefined) {
      const outcome = await mintId(ctx, model.mintRequest(m, page.label));
      if ("stay" in outcome) return outcome;
      id = outcome.minted;
      page.mint = id;
    }
    model.ids.set(page.absPath, id);
    return { entry: id };
  };

  /** Can an `{id}` manifest name `page`: by its own safe id, or one minted for it? */
  const names = async (page: Page, m: ManifestRef): Promise<boolean> => {
    const own = manifestIdOf(page.own[ID_JOIN]);
    if (own !== undefined) return "id" in own;
    return "minted" in (await mintId(ctx, model.mintRequest(m, page.label)));
  };

  /**
   * Out of the page, into `m`. With `source`, out of a `--from` manifest
   * (0126) instead, and a page that holds the key holds the same value.
   */
  const planOut = async (
    page: Page,
    m: ManifestRef,
    key: string,
    reason: RelocateMoveReason,
    source?: FromSource,
  ): Promise<void> => {
    if (page.intents.has(key)) return;
    // A value set aside for a key leaving keys: is the page's, so a `--from` one is not.
    const toward = source === undefined ? { toward: m } : {};
    if (m.url) {
      stay(page, key, "url-manifest", urlDetail(m), toward);
      return;
    }
    let entry: string | undefined;
    if (m.perId) {
      const named = await idEntry(page, m);
      if ("stay" in named) {
        stay(page, key, "no-join-value", `no id could be minted (${named.stay})`, toward);
        return;
      }
      entry = named.entry;
    } else {
      entry = entryFor(m, page.label, page.own, configDir, ctx.base, encryptionKey);
    }
    if (entry === undefined) {
      stay(page, key, "no-join-value", `this document has no ${m.join}, which ${m.file} joins on`, toward);
      return;
    }
    const value = source === undefined ? page.own[key] : source.value;
    const held = supplied(m, page, key);
    if (held !== undefined && !deepEqual(held.value, value)) {
      stay(page, key, "values-differ", `${source?.file ?? "the page"} and ${held.file} hold different values`, toward);
      return;
    }
    if (source !== undefined && Object.hasOwn(page.own, key) && !deepEqual(page.own[key], value)) {
      stay(page, key, "values-differ", `the page and ${source.file} hold different values`);
      return;
    }
    // A latent directory a value moves into is one this plan creates (0126).
    if (m.latent) model.dirActive = true;
    page.intents.set(key, {
      kind: "out",
      manifest: m,
      reason,
      drop: held !== undefined,
      entry,
      ...(source !== undefined ? { from: source } : {}),
    });
  };

  /**
   * Every value `m`, a `--from` manifest (0126), holds for `page`, with the
   * entry that names the page there.
   */
  const fromValues = (m: ManifestRef, page: Page): FromSource[] => {
    const held = m.loose === true ? (from.loose.get(m) ?? null) : index;
    if (held === null) return [];
    let entry: string | undefined;
    let values: ReadonlyMap<string, ExternalMetadataValue> | undefined;
    let file: string;
    if (m.perId) {
      const own = manifestIdOf(page.own[ID_JOIN]);
      if (own === undefined || "refused" in own) return [];
      entry = own.id;
      model.ids.set(page.absPath, entry);
      values = idManifestValues(held, { pattern: m.file, id: entry });
      file = model.idFile(m, entry).file;
    } else {
      entry = entryFor(m, page.label, page.own, configDir, ctx.base, encryptionKey);
      if (entry === undefined) return [];
      values = m.join === PATH_JOIN ? held.byPath.get(page.absPath) : held.byField.get(m.join)?.get(entry);
      file = model.fileFor(m, page.absPath).file;
    }
    const named = entry;
    // One directory serves every collection that reads it, so its values carry none.
    return [...(values ?? [])].flatMap(([key, sv]) =>
      sv.file === file && (m.perId || sv.collection === m.collection)
        ? [{ manifest: m, key, entry: named, file, value: sv.value }]
        : [],
    );
  };

  /**
   * One value of a `--from` manifest (0126) to where the config, without
   * that manifest, says its key lives: the manifest that owns it, else the
   * page. An equal value already there drops the copy, and a different one
   * leaves it where it is. So does another `--from` manifest's value for the
   * key: an equal one leaves with it, and a different one keeps both.
   */
  const planFrom = async (
    page: Page,
    source: FromSource,
    external: ReadonlySet<string>,
    prefs: ReadonlyMap<string, FieldLocation>,
  ): Promise<void> => {
    const { key } = source;
    const have = page.intents.get(key);
    if (have !== undefined) {
      if (have.kind !== "stay" && have.from !== undefined && have.from.manifest !== source.manifest) {
        if (deepEqual(have.from.value, source.value)) (have.also ??= []).push(source);
        else stay(page, key, "values-differ", `${have.from.file} and ${source.file} hold different values`);
      }
      return;
    }
    const pref = prefs.get(key);
    const owner = pref === "page" ? undefined : model.ownerOf(key, model.members(page.label), external);
    if (owner !== undefined) {
      await planOut(page, owner, key, pref === "external" ? "preferred" : "owned", source);
      return;
    }
    const inPage = Object.hasOwn(page.own, key);
    if (inPage && !deepEqual(page.own[key], source.value)) {
      stay(page, key, "values-differ", `the page and ${source.file} hold different values`);
      return;
    }
    page.intents.set(key, {
      kind: "in",
      manifest: source.manifest,
      drop: inPage,
      entry: source.entry,
      value: source.value,
      from: source,
    });
  };

  /** Out of `m`, into the page. */
  const planIn = (page: Page, m: ManifestRef, key: string): void => {
    if (page.intents.has(key)) return;
    const held = supplied(m, page, key);
    if (held === undefined) return;
    const entry = entryFor(m, page.label, page.own, configDir, ctx.base, encryptionKey);
    /* c8 ignore next -- a supplied value was found through its entry. */
    if (entry === undefined) return;
    if (Object.hasOwn(page.own, key)) {
      if (!deepEqual(held.value, page.own[key])) {
        stay(page, key, "values-differ", `the page and ${held.file} hold different values`, { blocks: m });
        return;
      }
      page.intents.set(key, { kind: "in", manifest: m, drop: true, entry, value: held.value });
      return;
    }
    page.intents.set(key, { kind: "in", manifest: m, drop: false, entry, value: held.value });
  };

  // ---- The named pages: what their schemas and the config say ---------------
  const preferencesOf = new Map<string, Map<string, FieldLocation>>();
  /**
   * What `page`'s schemas mark external: a named page's from its planning,
   * any other's read over its own metadata here. `undefined` for a page
   * beyond the named paths whose schemas will not resolve, which is left.
   */
  const externalOf = async (page: Page): Promise<Set<string> | undefined> => {
    const planned = preferencesOf.get(page.label);
    const out = new Set<string>();
    if (planned !== undefined) {
      for (const [key, location] of planned) if (location === "external") out.add(key);
      return out;
    }
    try {
      const resolved = resolveSchemaSetWithSource({
        filePath: page.label,
        fileSchema: page.own[FILE_SCHEMA_KEY],
        ...(ctx.cliSchemas !== undefined ? { cliSchemas: [...ctx.cliSchemas] } : {}),
        config: ctx.config,
        memberOf: currentMembers(page.label),
        fileBase: ctx.cwd,
        trustRoot,
        ...(ctx.onNotice !== undefined ? { onNotice: ctx.onNotice } : {}),
      });
      for (const [key, p] of await ctx.validator.locationPreferences(page.own, resolved.schemas)) {
        if (p.location === "external") out.add(key);
      }
      return out;
    } catch (err) {
      if (page.beyond && err instanceof DocmetaError) return undefined;
      throw err;
    }
  };
  const homeless = new Map<string, { keys: string[]; reason: "collections" | "no-config"; collections: number }>();
  const marked = new Set<string>();
  /**
   * A page's metadata merged with its manifests', and what its schemas prefer
   * for each key. Read with every key a writer is about to set, and every
   * value a `--from` manifest (0126) holds for it, in place: a mark is
   * evaluated only where its key is present.
   */
  const prepare = async (page: Page, held: readonly FromSource[]) => {
    const members = currentMembers(page.label);
    const merged = await mergeWithMarks(
      page.label,
      { data: page.own, present: true, format: page.format, lineFor: () => undefined },
      index,
      members,
      ctx.base,
      { encryptionKey, marks },
    );
    const data = merged.extracted.data;
    const required = request.require?.get(page.label) ?? [];
    const resolved = resolveSchemaSetWithSource({
      filePath: page.label,
      fileSchema: data[FILE_SCHEMA_KEY],
      ...(ctx.cliSchemas !== undefined ? { cliSchemas: [...ctx.cliSchemas] } : {}),
      config: ctx.config,
      memberOf: members,
      fileBase: ctx.cwd,
      trustRoot,
      ...(ctx.onNotice !== undefined ? { onNotice: ctx.onNotice } : {}),
    });
    const probe: Record<string, unknown> = { ...data };
    for (const key of required) if (!(key in probe)) probe[key] = null;
    for (const s of held) if (!(s.key in probe)) probe[s.key] = s.value;
    const prefs = new Map<string, FieldLocation>();
    /** What the schemas mark external, and so what a keyless manifest owns (0068). */
    const external = new Set<string>();
    for (const [key, p] of await ctx.validator.locationPreferences(probe, resolved.schemas)) {
      prefs.set(key, p.location);
      marked.add(key);
      if (p.location === "external") external.add(key);
    }
    for (const key of required) if (!prefs.has(key)) prefs.set(key, "external");
    preferencesOf.set(page.label, prefs);
    return { data, required, prefs, external };
  };
  /** Every value a `--from` manifest holds for a page, to check that each left (0126). */
  const fromHeld: { page: Page; source: FromSource }[] = [];
  /** What those of `refs` that reach `page` hold for it, noted in `fromHeld`. */
  const heldFor = (page: Page, refs: readonly ManifestRef[]): FromSource[] => {
    const members = currentMembers(page.label);
    const held = refs.flatMap((m) => (m.loose === true || members.includes(m.collection) ? fromValues(m, page) : []));
    for (const source of held) fromHeld.push({ page, source });
    return held;
  };
  for (const label of request.files) {
    const page = await load(label, false);
    /* c8 ignore next -- a named page always has an extractor, or `load` threw. */
    if (page === undefined) continue;
    const held = heldFor(page, from.refs);
    const { data, required, prefs, external } = await prepare(page, held);
    // A `--from` value first: the slot its key takes is where that value goes.
    for (const source of held) await planFrom(page, source, external, prefs);

    const planned = model.members(label);
    const joins = new Set(
      model.manifests.filter((m) => planned.includes(m.collection) && m.join !== PATH_JOIN).map((m) => m.join),
    );
    for (const m of model.manifests) {
      if (planned.includes(m.collection)) for (const k of [...m.keysBefore, ...m.keysAdded]) marked.add(k);
    }
    const keys = dedupe([...Object.keys(data), ...required]).filter(wanted);
    for (const key of keys) {
      if (joins.has(key)) continue;
      const pref = prefs.get(key);
      const inPage = Object.hasOwn(page.own, key);
      const owner = model.ownerOf(key, model.members(label), external);
      if (owner !== undefined) {
        if (pref === "page") {
          if (owner.url) {
            if (supplied(owner, page, key) !== undefined) stay(page, key, "url-manifest", urlDetail(owner));
          } else if (owner.keysBefore.includes(key)) {
            model.removeKey(owner, key);
          }
        } else if (inPage) {
          await planOut(page, owner, key, pref === "external" ? "preferred" : "owned");
        }
        continue;
      }
      if (pref !== "external" || !(inPage || required.includes(key))) continue;
      const chosen = await model.home(label, true, (m) => model.impliedOwns(m, key, external));
      if ("manifest" in chosen) {
        // A keyless manifest owns the key already, so only this page's value moves.
        if (chosen.manifest.implied) {
          // A key a writer is about to set is what a directory this plan
          // creates is created for (0126), as a page's value moving in is.
          if (chosen.manifest.latent && !inPage && !chosen.manifest.homed.includes(key) && (await names(page, chosen.manifest))) {
            chosen.manifest.homed.push(key);
          }
          if (inPage) await planOut(page, chosen.manifest, key, "preferred");
          continue;
        }
        model.addKey(chosen.manifest, key);
        continue;
      }
      if (chosen.proposed.kind !== "none") continue;
      if (inPage) {
        stay(
          page,
          key,
          "no-home",
          chosen.proposed.reason === "no-config"
            ? "--no-config leaves this document no manifest"
            : `this document is in none of the ${chosen.proposed.collections} collections, so it has no manifest`,
        );
      }
      const entry = homeless.get(label) ?? {
        keys: [],
        reason: chosen.proposed.reason,
        collections: chosen.proposed.collections,
      };
      entry.keys.push(key);
      homeless.set(label, entry);
    }
  }

  /** Every member page of `collection` on disk, labelled as the run labels its pages. */
  const walk = async (collection: CollectionConfig): Promise<string[]> => {
    const walked = await resolveTargetSet({
      inputs: [...collection.paths],
      cwd: configDir,
      allowEmpty: true,
      ...gitignoreOptions({
        ...(ctx.respectGitignore !== undefined ? { flag: ctx.respectGitignore } : {}),
        ...(ctx.config?.respectGitignore !== undefined ? { configured: ctx.config.respectGitignore } : {}),
      }),
    });
    return walked.files.map((f) => reported(resolve(configDir, f), ctx.base));
  };

  // ---- A page the run's filters left out of an emptied manifest --------------
  // The manifest leaves the config, so a value it held for such a page would be
  // read by nothing (0126). It moves too.
  const emptiedOf = model.collections.filter((c) => from.refs.some((m) => m.collection === c.name));
  for (const label of dedupe((await Promise.all(emptiedOf.map(walk))).flat())) {
    if (runSet.has(label)) continue;
    const page = await load(label, true);
    if (page === undefined) continue;
    const held = heldFor(page, from.refs.filter((m) => m.loose !== true));
    if (held.length === 0) continue;
    if (page.unreadable !== undefined) {
      for (const s of held) stay(page, s.key, "unreadable", unreadableDetail(page));
      continue;
    }
    const { prefs, external } = await prepare(page, held);
    for (const source of held) await planFrom(page, source, external, prefs);
  }

  // ---- A `--from` manifest kept, and the value that keeps it -----------------
  for (const stays of kept.values()) {
    for (const s of stays) {
      const page = await load(s.label, !runSet.has(s.label));
      if (page !== undefined && !page.intents.has(s.key)) stay(page, s.key, s.reason, s.detail);
    }
  }

  if (fields !== undefined) {
    for (const f of fields) {
      if (!marked.has(f) && !(request.require !== undefined && [...request.require.values()].some((ks) => ks.includes(f)))) {
        throw new DocmetaError(
          `"${f}" has no x-manni-location mark and no owning manifest for any file in this run.`,
        );
      }
    }
  }

  // ---- A metadata directory this plan creates reaches every page that reads it --
  // Once it holds a manifest, every collection that declares no
  // externalMetadata: reads it, and it owns what each page's schemas mark
  // external (0126). A page with an id that still carried such a value would
  // collide with it, so the value goes too, whatever --fields named. A page
  // beyond the named paths with no usable id reads nothing from it, so it is
  // left as it is, and no id is minted into it.
  if (model.dirActive) {
    for (const ref of model.manifests.filter((m) => m.latent)) {
      const collection = model.collections.find((c) => c.name === ref.collection);
      /* c8 ignore next -- a latent directory is one of the model's collections'. */
      if (collection === undefined) continue;
      const labels = dedupe([...request.files, ...(await walk(collection))]).filter((label) =>
        model.members(label).includes(ref.collection),
      );
      for (const label of labels) {
        const page = await load(label, !runSet.has(label));
        if (page === undefined || page.unreadable !== undefined) continue;
        const own = manifestIdOf(page.own[ID_JOIN]);
        if (page.beyond && (own === undefined || "refused" in own)) continue;
        const external = await externalOf(page);
        if (external === undefined) continue;
        for (const key of Object.keys(page.own)) {
          if (key === FILE_SCHEMA_KEY || model.ownerOf(key, model.members(label), external) !== ref) continue;
          await planOut(page, ref, key, "preferred");
        }
      }
    }
  }

  // ---- A page this plan mints an id for reads its `{id}` manifest after -----
  // So every value it holds that the manifest owns goes there too, whatever
  // --fields named, or the next read would find each in both places (0126).
  for (const page of pages.values()) {
    if (page.mint === undefined) continue;
    const external = await externalOf(page);
    if (external === undefined) continue;
    const members = model.members(page.label);
    // The `{id}` manifests a value of the page is already on its way out to.
    const into = new Set(
      [...page.intents.values()].flatMap((i) => (i.kind === "out" && i.manifest.perId ? [i.manifest.file] : [])),
    );
    for (const key of Object.keys(page.own)) {
      if (key === FILE_SCHEMA_KEY || key === ID_JOIN) continue;
      const owner = model.ownerOf(key, members, external);
      if (owner !== undefined && into.has(owner.file)) await planOut(page, owner, key, "preferred");
    }
  }

  // ---- A key leaving keys: is headed for the page ---------------------------
  // A page planned before (or after) another page's mark removed the key would
  // otherwise send its copy to a manifest that no longer owns it. The move is
  // set aside, and put back if a page blocks the removal below.
  const suspended: {
    page: Page;
    manifest: ManifestRef;
    key: string;
    reason: RelocateMoveReason;
    source?: FromSource;
  }[] = [];
  for (const page of pages.values()) {
    for (const [key, intent] of [...page.intents]) {
      const m = intent.kind === "out" ? intent.manifest : intent.kind === "stay" ? intent.toward : undefined;
      if (m === undefined || !m.keysRemoved.includes(key)) continue;
      page.intents.delete(key);
      const prefs = preferencesOf.get(page.label);
      const source = intent.kind === "out" ? intent.from : undefined;
      suspended.push({
        page,
        manifest: m,
        key,
        reason: intent.kind === "out" ? intent.reason : prefs?.get(key) === "external" ? "preferred" : "owned",
        ...(source !== undefined ? { source } : {}),
      });
    }
  }

  // ---- A keys: or paths: change reaches every member page -------------------
  const grown = new Set(model.pathsAdded.map((p) => p.collection));
  const affected = new Set<string>(grown);
  for (const m of model.manifests) {
    if (m.keysAdded.length > 0 || m.keysRemoved.length > 0) affected.add(m.collection);
  }
  for (const name of affected) {
    const collection = model.collections.find((c) => c.name === name);
    /* c8 ignore next -- an affected collection is one of the model's. */
    if (collection === undefined) continue;
    const labels = dedupe([...request.files, ...(await walk(collection))]).filter((label) =>
      model.members(label).includes(name),
    );
    for (const label of labels) {
      const page = await load(label, !runSet.has(label));
      if (page === undefined) continue;
      const prefs = preferencesOf.get(label);
      // A page the paths: change brings in is covered for every key the
      // manifest owns, as a keys: change covers every page: --fields cannot
      // leave an owned key behind on it.
      const covered = grown.has(name) && !currentMembers(label).includes(name);
      for (const m of model.manifestsOf(name)) {
        const out = dedupe([
          ...m.keysAdded,
          ...(grown.has(name) ? m.keysBefore.filter((k) => !m.keysRemoved.includes(k)) : []),
        ]).filter((k) => (covered ? k !== FILE_SCHEMA_KEY : wanted(k)));
        if (page.unreadable !== undefined) {
          const detail = unreadableDetail(page);
          // The keys whose home this run changes for the page: added ones, and
          // every owned one when the page is newly covered.
          const changing = covered ? out : out.filter((k) => m.keysAdded.includes(k));
          for (const key of changing) if (!page.intents.has(key)) stay(page, key, "unreadable", detail);
          for (const key of m.keysRemoved) {
            // Whether the manifest sets the key for this page is known only
            // for a path join; a field join needs the page's own value.
            const held =
              m.join !== PATH_JOIN ||
              (!m.created && index?.byPath.get(page.absPath)?.get(key)?.file === model.fileFor(m, page.absPath).file);
            if (held && !page.intents.has(key)) stay(page, key, "unreadable", detail, { blocks: m });
          }
          continue;
        }
        for (const key of out) {
          if (!Object.hasOwn(page.own, key)) continue;
          const reason = m.keysAdded.includes(key) || prefs?.get(key) === "external" ? "preferred" : "owned";
          await planOut(page, m, key, reason);
        }
        for (const key of m.keysRemoved) planIn(page, m, key);
      }
    }
  }

  // ---- Page texts, and removals a page blocks --------------------------------
  const orderedPages = (): Page[] => {
    const all = [...pages.values()];
    const run = all.filter((p) => !p.beyond).sort((a, b) => compare(a.label, b.label));
    const beyond = all.filter((p) => p.beyond).sort((a, b) => compare(a.label, b.label));
    return [...run, ...beyond];
  };
  // A worklist. Planning a page's text reads only that page's intents, so a
  // page whose intents did not change since its last planning would plan the
  // same text. The first pass plans every page; each later pass re-plans only
  // the pages the previous pass's unblocked removals touched, and looks among
  // them for new blocks. A block found earlier is settled: keysRemoved only
  // shrinks, so it cannot fire twice.
  let dirty = new Set<Page>(pages.values());
  while (dirty.size > 0) {
    // In the pages' own order, as every page was planned before.
    const pass = [...pages.values()].filter((p) => dirty.has(p));
    for (const page of pass) planPageText(page);
    const touched = new Set<Page>();
    for (const page of pass) {
      for (const [key, intent] of page.intents) {
        if (intent.kind !== "stay" || intent.blocks === undefined) continue;
        const m = intent.blocks;
        if (!m.keysRemoved.includes(key)) continue;
        m.keysRemoved.splice(m.keysRemoved.indexOf(key), 1);
        for (const other of pages.values()) {
          const i = other.intents.get(key);
          if (i?.kind === "in" && i.manifest === m) {
            other.intents.delete(key);
            touched.add(other);
          }
        }
        // The manifest keeps the key, so a copy set aside for the page goes to it after all.
        for (const s of suspended) {
          if (s.manifest === m && s.key === key) {
            await planOut(s.page, m, key, s.reason, s.source);
            touched.add(s.page);
          }
        }
      }
    }
    dirty = touched;
  }

  // ---- A `--from` manifest a value cannot leave stays declared ---------------
  // Its collection then keeps an entry, so the plan is made again with it
  // kept, and each value that held it back reported where it stays (0126).
  const blocked = new Map<string, KeptStay[]>();
  for (const { page, source } of fromHeld) {
    const m = source.manifest;
    const intent = page.intents.get(source.key);
    const left =
      (intent?.kind === "in" && intent.manifest === m) ||
      (intent?.kind === "out" && intent.from?.manifest === m) ||
      (intent !== undefined && intent.kind !== "stay" && intent.also?.some((s) => s.manifest === m) === true);
    if (left) continue;
    // A manifest is never kept for nothing: a value that does not leave it stays, with its reason.
    if (intent?.kind !== "stay") {
      throw new Error(`relocate: ${source.file} holds ${source.key} for ${page.label}, which neither leaves nor stays.`);
    }
    // A file the config does not declare keeps what stays, and nothing reads it.
    if (m.loose === true) continue;
    const stays = blocked.get(refId(m)) ?? [];
    stays.push({ label: page.label, key: source.key, reason: intent.reason, detail: intent.detail });
    blocked.set(refId(m), stays);
  }
  if (blocked.size > 0) return { blocked };

  // ---- Manifest texts --------------------------------------------------------
  const writes: RelocationWrite[] = [];
  const lines = new Map<string, number>();
  /** The files of the `--from` manifests, and those deleted or kept for their comments (0126). */
  const emptied = new Set<string>();
  const deleted: string[] = [];
  const commented: string[] = [];
  /**
   * The edits, by the file they land in. One file for a concrete manifest;
   * one per page for a `{page}` manifest (proposal 0058), so each page's
   * values go to, and come from, the page's own file.
   */
  type Edits = {
    file: string;
    outs: { page: string; entry: string; key: string; value: unknown; drop: boolean }[];
    ins: { entry: string; key: string }[];
  };
  /** One manifest's edits as one write, its moves' lines noted for the applied report. */
  const emit = async (
    path: string,
    { file, outs, ins }: Edits,
    m: Pick<ManifestRef, "created" | "perPage" | "join">,
  ): Promise<void> => {
    if (!m.created && outs.length === 0 && ins.length === 0) return;
    // A created manifest's path does not exist: planning refuses one that
    // does (U6). A `{page}` or `{id}` manifest that does not exist yet reads
    // as empty and is created, `before: null`, like one.
    const disk = m.created ? null : await readManifestText(path, file, m.perPage);
    let text = disk ?? "";
    const before = text;
    const where = { join: m.join, file };
    for (const o of outs) {
      if (!o.drop) text = spliceManifestValue(text, { ...where, entry: o.entry, key: o.key, value: o.value }).text;
    }
    for (const i of ins) text = removeManifestKey(text, { ...where, entry: i.entry, key: i.key }).text;
    const found = keyLines(text, m.join);
    for (const o of outs) {
      const line = found.get(entryId(o.entry, m.join))?.get(o.key);
      if (line !== undefined) lines.set(lineId(o.page, file, o.key), line);
    }
    // A `--from` manifest (0126) left with no entries is deleted, unless it
    // held comments anywhere, which relocate does not carry: then it is kept, emptied.
    if (emptied.has(path) && holdsNoEntries(text)) {
      if (!holdsComments(before)) {
        writes.push({ path, text: "", kind: "manifest", before: disk, remove: true });
        deleted.push(file);
        return;
      }
      commented.push(file);
    }
    if (m.created || text !== before) {
      writes.push({ path, text, kind: "manifest", before: disk });
    }
  };
  // Every `{id}` manifest's edits (0126), whichever collection's entry made
  // them: collections reading one directory write one file per page.
  const idFiles = new Map<string, Edits>();
  for (const m of model.manifests) {
    if (m.url) continue;
    const undeclared = !m.implied && model.finalKeys(m).length === 0 && !m.created;
    const files = m.perId ? idFiles : new Map<string, Edits>();
    const group = (at: { abs: string | undefined; file: string }): Edits | undefined => {
      /* c8 ignore next -- only a URL manifest has no path, and it was skipped. */
      if (at.abs === undefined) return undefined;
      if (m.from === true) emptied.add(at.abs);
      const have = files.get(at.abs);
      if (have !== undefined) return have;
      const made: Edits = { file: at.file, outs: [], ins: [] };
      files.set(at.abs, made);
      return made;
    };
    // A created manifest is written even when nothing moves into it.
    if (m.created) group({ abs: m.absPath, file: m.file });
    for (const page of orderedPages()) {
      for (const [key, intent] of orderedIntents(page)) {
        if ((intent.kind === "out" || intent.kind === "in") && intent.manifest === m) {
          const into = group(model.fileFor(m, page.absPath));
          if (intent.kind === "out") {
            const value = intent.from === undefined ? page.own[key] : intent.from.value;
            into?.outs.push({ page: page.label, entry: intent.entry, key, value, drop: intent.drop });
          } else {
            into?.ins.push({ entry: intent.entry, key });
          }
        } else if (intent.kind === "out" && intent.from?.manifest === m) {
          // The copy a value moving between manifests leaves behind (0126).
          group(model.fileFor(m, page.absPath))?.ins.push({ entry: intent.from.entry, key });
        }
        // An equal copy another `--from` manifest held, which leaves with the value (0126).
        for (const s of intent.kind === "stay" ? [] : (intent.also ?? [])) {
          if (s.manifest === m) group(model.fileFor(m, page.absPath))?.ins.push({ entry: s.entry, key });
        }
      }
    }
    if (!undeclared) assertNoStrandedEntries(m, index, pages, configDir, (abs) => model.fileFor(m, abs).file);
    if (undeclared || m.perId) continue;
    for (const [path, edits] of files) await emit(path, edits, m);
  }
  for (const [path, edits] of idFiles) await emit(path, edits, { created: false, perPage: true, join: ID_JOIN });

  // ---- Config text ---------------------------------------------------------------
  const finalCollections = model.final();
  const needsConfig =
    model.created.length > 0 ||
    model.pathsAdded.length > 0 ||
    model.manifests.some(
      (m) =>
        m.created || m.keysAdded.length > 0 || m.keysRemoved.length > 0 || (m.from === true && m.loose !== true),
    );
  const target = await configTarget(ctx, configDir);
  // A directory the key or the environment names is created however little
  // moves into it; a latent one, by the first page's file written there.
  const missing = model.manifests.some((m) => m.missing);
  const directory = model.dirActive || missing ? { abs: model.dir.abs, missing } : undefined;
  let configCreated = false;
  if (needsConfig) {
    if (ctx.configFile !== undefined && (ctx.configFile.kind === "legacy" || !ctx.configFile.wrapped)) {
      throw new DocmetaError(
        `${ctx.configFile.source} is a single-tool config file, which cannot hold collections:. Move its keys under meta: in ${FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml"}.`,
      );
    }
    const text = editConfig(target.text, model, configSource(target.path, ctx.cwd));
    verifyConfig(target.text, text, finalCollections, {
      source: configSource(target.path, ctx.cwd),
      configDir: dirname(target.path),
      ...(ctx.env !== undefined ? { env: ctx.env } : {}),
      // The directory this plan creates is read once it is written (0126).
      ...(directory !== undefined ? { state: "read" as const } : {}),
    });
    writes.push({ path: target.path, text, kind: "config", before: target.disk });
    configCreated = target.text === null;
  }

  for (const page of orderedPages()) {
    if (page.text !== undefined && page.text !== page.content) {
      writes.push({ path: page.absPath, text: page.text, kind: "page", before: page.content });
    }
  }

  const result = buildResult({
    model,
    pages: orderedPages(),
    dryRun: true,
    lines: new Map(),
    config: {
      file: needsConfig || ctx.configPath !== undefined ? configSource(target.path, ctx.cwd) : null,
      created: configCreated,
      collectionsCreated: model.created,
      pathsAdded: model.pathsAdded,
    },
    deleted,
  });
  const plan: RelocationPlan = {
    result,
    writes,
    lines,
    collections: finalCollections,
    configDir,
    configPath: target.path,
    offers: buildOffers(model, orderedPages(), result, needsConfig ? configSource(target.path, ctx.cwd) : undefined),
    homeless: [...homeless].map(([file, h]) => ({ file, ...h })),
    ...(directory !== undefined ? { directory } : {}),
    ...(commented.length > 0 ? { commented } : {}),
  };
  return { plan };
}

/** Does YAML text hold a comment anywhere: above, below or inside any value? */
function holdsComments(text: string): boolean {
  const doc = parseDocument(text);
  if (doc.commentBefore || doc.comment) return true;
  let found = false;
  visit(doc, (_, node) => {
    if (!isNode(node) || !(node.commentBefore || node.comment)) return undefined;
    found = true;
    return visit.BREAK;
  });
  return found;
}

/** Does a manifest's text hold no entry: nothing, or an empty mapping? */
function holdsNoEntries(text: string): boolean {
  const root = parseDocument(text).contents;
  return root === null || (isScalar(root) && root.value === null) || (isMap(root) && root.items.length === 0);
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A page's intents in the page's own key order, then the rest (values coming
 * in from a manifest) as they were planned. Planning reaches a page's keys in
 * two passes, so insertion order alone would not follow the page.
 */
function orderedIntents(page: Page): [string, Intent][] {
  const order = Object.keys(page.own);
  const rank = (key: string): number => {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  return [...page.intents].sort(([a], [b]) => rank(a) - rank(b));
}

/** Does a value move out of `page` to an `{id}` manifest by the id minted for it (0126)? */
function mintedInto(page: Page): page is Page & { mint: string } {
  return page.mint !== undefined && [...page.intents.values()].some((i) => i.kind === "out" && i.manifest.perId);
}

/**
 * The page's new text for its intents, read back. A format with no writer,
 * or a document its writer refuses, turns every intent that needs the page
 * written into a stay; one moving a value in blocks that key's removal.
 */
function planPageText(page: Page): void {
  const patch: MetadataPatch = {};
  const deletions: string[] = [];
  for (const [key, intent] of page.intents) {
    // A value leaving a `--from` manifest (0126) takes the page's equal copy, when it has one.
    if (intent.kind === "out" && Object.hasOwn(page.own, key)) deletions.push(key);
    else if (intent.kind === "in" && !intent.drop) patch[key] = intent.value;
  }
  // A value moving to an `{id}` manifest takes the id minted for it (0126).
  if (mintedInto(page)) patch[ID_JOIN] = page.mint;
  delete page.text;
  if (deletions.length === 0 && Object.keys(patch).length === 0) return;
  const refuse = (): void => {
    for (const [key, intent] of page.intents) {
      if (intent.kind === "out" || (intent.kind === "in" && !intent.drop)) {
        page.intents.set(key, {
          kind: "stay",
          reason: "read-only-format",
          detail: `the ${page.format} format cannot write this document's metadata`,
          ...(intent.kind === "in" ? { blocks: intent.manifest } : {}),
        });
      }
    }
  };
  const apply = page.extractor.apply;
  if (typeof apply !== "function") {
    refuse();
    return;
  }
  try {
    const next = apply(page.content, patch, {
      filePath: page.label,
      elements: page.elements,
      ...(deletions.length > 0 ? { deletions } : {}),
    });
    const after = page.extractor.extract(next, page.label, { elements: page.elements }).data;
    const wrote =
      deletions.every((k) => !Object.hasOwn(after, k)) &&
      Object.entries(patch).every(([k, v]) => deepEqual(after[k], v));
    if (!wrote) {
      refuse();
      return;
    }
    page.text = next;
  } catch (err) {
    if (!(err instanceof DocmetaError)) throw err;
    refuse();
  }
}

/**
 * A key leaving a manifest's `keys:` while an entry no member page matched
 * still sets it would make the manifest unloadable ("sets a key it does not
 * own"). Refused, naming the entry, rather than written.
 */
function assertNoStrandedEntries(
  m: ManifestRef,
  index: ExternalMetadataIndex | null,
  pages: ReadonlyMap<string, Page>,
  configDir: string,
  /** The file `m` keeps one page's values in: the page's own for a `{page}` manifest. */
  fileOf: (pageAbs: string) => string,
): void {
  if (index === null || m.keysRemoved.length === 0) return;
  for (const key of m.keysRemoved) {
    const moved = new Set<string>();
    for (const page of pages.values()) {
      const i = page.intents.get(key);
      if (i?.kind === "in" && i.manifest === m) moved.add(entryId(i.entry, m.join));
    }
    const stranded =
      m.join === PATH_JOIN
        ? [...index.byPath]
            .filter(([abs, values]) => {
              const sv = values.get(key);
              return sv !== undefined && sv.collection === m.collection && sv.file === fileOf(abs);
            })
            .map(([abs]) => toPosix(relative(configDir, abs)))
        : [...(index.byField.get(m.join) ?? new Map<string, ReadonlyMap<string, ExternalMetadataValue>>())]
            .filter(([, values]) => {
              const sv = values.get(key);
              return sv !== undefined && sv.file === m.file && sv.collection === m.collection;
            })
            .map(([value]) => value);
    const first = stranded.find((e) => !moved.has(entryId(e, m.join)));
    if (first !== undefined) {
      throw new DocmetaError(
        `Manifest ${m.file} names "${first}", which is not a page of collection ${m.collection}, so ${key} cannot leave its keys while that entry sets it. Fix the entry, or remove it.`,
      );
    }
  }
}

/**
 * A manifest's text, or null for a `{page}` manifest (proposal 0058) that
 * does not exist yet: a page with nothing kept there. A missing concrete
 * manifest is refused.
 */
async function readManifestText(path: string, file: string, perPage: boolean): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (perPage && isMissing(err)) return null;
    throw new DocmetaError(`Manifest ${file} could not be read: ${errorMessage(err)}`);
  }
}


const entryId = (entry: string, join: string): string =>
  join === PATH_JOIN ? toPosix(entry).replace(/^\.\//, "").replace(/\/+/g, "/") : entry;
/** A move's line, keyed by page label, manifest and key. */
// NUL separates the parts, which assumes none of them holds a NUL. No supported OS allows one
// in a page label or manifest path, and YAML frontmatter does not produce one in a key in practice.
const lineId = (page: string, manifest: string, key: string): string => `${page}\0${manifest}\0${key}`;

/** Entry -> key -> 1-based line of the key, in a manifest's text. */
function keyLines(text: string, join: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  const root = doc.contents;
  if (!isMap(root)) return out;
  for (const pair of root.items) {
    const spelled = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    if (!isMap(pair.value)) continue;
    const keys = new Map<string, number>();
    for (const kv of pair.value.items) {
      const name = isScalar(kv.key) ? String(kv.key.value) : String(kv.key);
      const range = isNode(kv.key) ? kv.key.range : undefined;
      if (range) keys.set(name, lc.linePos(range[0]).line);
    }
    out.set(entryId(spelled, join), keys);
  }
  return out;
}

/**
 * The config file a plan edits: the run's, else the family file at the git
 * root or cwd. `text` is what the edit starts from; `disk` is what the file
 * holds now, or null when there is no file.
 */
async function configTarget(
  ctx: RelocationContext,
  configDir: string,
): Promise<{ path: string; text: string | null; disk: string | null }> {
  if (ctx.configPath !== undefined) {
    // Re-read rather than trust discovery's copy: an edit made since must not be written over.
    // Only a file removed since falls back to that copy; any other failure is refused.
    try {
      const text = await readFile(ctx.configPath, "utf8");
      return { path: ctx.configPath, text, disk: text };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new DocmetaError(
          `Config file ${configSource(ctx.configPath, ctx.cwd)} could not be read: ${errorMessage(err)}`,
        );
      }
      return { path: ctx.configPath, text: ctx.configFile?.text ?? null, disk: null };
    }
  }
  for (const name of FAMILY_CONFIG_NAMES) {
    const path = join(configDir, name);
    try {
      const text = await readFile(path, "utf8");
      return { path, text, disk: text };
    } catch {
      // Not this one.
    }
  }
  return { path: join(configDir, FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml"), text: null, disk: null };
}

/**
 * The config text with the model's changes. Each change is spliced into the
 * text, so every byte outside the nodes it edits stays as it was: comments,
 * quoting, folded scalars and flow padding. A change no splice can place,
 * such as one in a flow-style `collections:`, writes the document whole,
 * with comments and key order kept.
 */
function editConfig(text: string | null, model: Model, source: string): string {
  const doc = parseDocument(text ?? "");
  const [problem] = doc.errors;
  if (problem !== undefined) throw new DocmetaError(`${source}: invalid YAML: ${problem.message}`);
  const root = doc.contents;
  if (root !== null && !isMap(root)) {
    throw new DocmetaError(`${source}: top level must be a mapping.`);
  }
  const fail = (): never => {
    throw new DocmetaError(`Could not edit collections: in ${source}; make the change by hand.`);
  };
  const flowSeq = (node: unknown, quoted: boolean): void => {
    if (!isSeq(node)) return;
    node.flow = true;
    if (quoted) for (const item of node.items) if (isScalar(item)) item.type = "QUOTE_DOUBLE";
  };
  const manifestNode = (d: Document, file: string, keys: string[]): unknown => {
    const node = d.createNode({ file, keys });
    flowSeq(node.get("keys", true), false);
    return node;
  };

  // The splices, against the original text. Each node is edited in the
  // document too, which is what a whole write prints.
  const src = text ?? "";
  const eol = detectEol(src);
  const style = isMap(root) ? detectStyle(src, root, eol) : { step: 2, indentSeq: true, eol };
  let whole = text === null || root?.flow === true;
  /** Flow lists written again once edited, and the items each block list gains. */
  const flows = new Set<YAMLSeq>();
  const appends = new Map<YAMLSeq, unknown[]>();
  /** Nodes whose lines go: from the node's start through its content's end. */
  const cuts: { from: number; to: number }[] = [];
  /** A key's value replaced from the key on, or a key added after a mapping's last line. */
  const refills: { start: number; end: number; col: number; key: string; value: unknown }[] = [];
  const adds: { map: YAMLMap | null; key: string; value: unknown }[] = [];
  const pairOf = (map: YAMLMap | null, key: string): Pair | undefined =>
    map?.items.find((p) => keyString(p.key) === key);
  const grow = (seq: YAMLSeq, item: unknown): void => {
    seq.add(item);
    // A list this edit made is written with its key.
    if (rangeOf(seq) === undefined) return;
    if (seq.flow === true) flows.add(seq);
    else appends.set(seq, [...(appends.get(seq) ?? []), item]);
  };
  const cut = (node: unknown, to: unknown = node): void => {
    const r = rangeOf(node);
    const end = contentEnd(src, to);
    if (r === undefined || end === undefined) whole = true;
    else cuts.push({ from: r[0], to: end });
  };
  const shrink = (seq: YAMLSeq, item: unknown): void => {
    seq.delete(seq.items.indexOf(item));
    if (seq.flow === true) flows.add(seq);
    else cut(item);
  };
  /** `key: value` in place of `pair`, whose value is empty or not a list. */
  const refill = (pair: Pair, value: unknown): void => {
    const k = rangeOf(pair.key);
    const old = pair.value;
    const end = isScalar(old) && old.value === null && emptySource(src, old) ? colonEnd(src, pair) : contentEnd(src, old);
    if (k === undefined || end === undefined) whole = true;
    else refills.push({ start: k[0], end, col: colOf(src, k[0]), key: keyString(pair.key), value });
  };
  /** A new list under `key` of `map`: in place of an empty value, else after the mapping. */
  const fresh = (map: YAMLMap | null, key: string, value: unknown): void => {
    const pair = pairOf(map, key);
    if (pair === undefined) adds.push({ map, key, value });
    else refill(pair, value);
  };

  const declared = model.collections.length - model.created.length;
  const existing = doc.get("collections", true);
  if (declared > 0 && !isSeq(existing)) fail();
  if (isSeq(existing) && existing.flow === true) whole = true;
  for (let i = 0; i < declared; i++) {
    const c = model.collections[i];
    const node = isSeq(existing) ? existing.items[i] : undefined;
    if (c === undefined || !isMap(node)) return fail();
    if (node.flow === true) whole = true;
    for (const added of model.pathsAdded.filter((p) => p.collection === c.name)) {
      const paths = node.get("paths", true);
      if (!isSeq(paths)) return fail();
      const scalar = doc.createNode(added.path);
      const first = paths.items[0];
      if (isScalar(first) && first.type !== undefined) scalar.type = first.type;
      grow(paths, scalar);
    }
    const refs = model.manifestsOf(c.name);
    for (const m of refs) {
      if (m.created) {
        const list = node.get("externalMetadata", true);
        const made = manifestNode(doc, m.written, m.keysAdded);
        if (isSeq(list) && (list.items.length > 0 || rangeOf(list) === undefined)) {
          grow(list, made);
          continue;
        }
        // A list written empty, the opt-out from the metadata directory
        // (0126), is written afresh as a block list.
        const written = doc.createNode([made]);
        fresh(node, "externalMetadata", written);
        node.set("externalMetadata", written);
        continue;
      }
      if (m.keysAdded.length === 0) continue;
      const entry = node.getIn(["externalMetadata", m.index], true);
      const keys = isMap(entry) ? entry.get("keys", true) : undefined;
      if (!isSeq(keys)) return fail();
      for (const key of m.keysAdded) grow(keys, doc.createNode(key));
    }
    // Removals last, highest index first, so earlier indices stay valid.
    const list = node.get("externalMetadata", true);
    const dropped: unknown[] = [];
    for (const m of [...refs].filter((r) => !r.created).sort((a, b) => b.index - a.index)) {
      // A `--from` manifest (0126) goes whole.
      if (m.from === true) {
        if (!isSeq(list)) return fail();
        dropped.push(list.items[m.index]);
        list.delete(m.index);
        continue;
      }
      if (m.keysRemoved.length === 0) continue;
      if (!isSeq(list)) return fail();
      const entry: unknown = list.items[m.index];
      const keys = isMap(entry) ? entry.get("keys", true) : undefined;
      if (!isSeq(keys)) return fail();
      const gone = keys.items.filter((item) => m.keysRemoved.includes(isScalar(item) ? String(item.value) : String(item)));
      if (gone.length < keys.items.length) {
        for (const item of gone) shrink(keys, item);
        continue;
      }
      dropped.push(entry);
      list.delete(m.index);
    }
    if (!isSeq(list) || dropped.length === 0) continue;
    // Only a list this edit emptied goes. One written empty is an opt-out
    // from the metadata directory (proposal 0126), and stays.
    if (list.items.length === 0) {
      const pair = pairOf(node, "externalMetadata");
      node.delete("externalMetadata");
      if (pair === undefined) whole = true;
      else cut(pair.key, pair.value);
    } else if (list.flow === true) {
      flows.add(list);
    } else {
      for (const item of dropped) cut(item);
    }
  }
  for (const created of model.created) {
    const c = model.collections.find((x) => x.name === created.name);
    /* c8 ignore next -- a created collection is in the model. */
    if (c === undefined) continue;
    const refs = model.manifestsOf(c.name).filter((m) => m.created);
    const node = doc.createNode({
      name: c.name,
      paths: c.paths,
      ...(refs.length > 0
        ? { externalMetadata: refs.map((m) => ({ file: m.written, keys: m.keysAdded })) }
        : {}),
    });
    flowSeq(node.get("paths", true), true);
    const made = node.get("externalMetadata", true);
    if (isSeq(made)) {
      for (const item of made.items) if (isMap(item)) flowSeq(item.get("keys", true), false);
    }
    const seq = doc.get("collections", true);
    if (isSeq(seq) && (seq.items.length > 0 || rangeOf(seq) === undefined)) {
      grow(seq, node);
      continue;
    }
    const written = doc.createNode([node]);
    fresh(isMap(root) ? root : null, "collections", written);
    doc.set("collections", written);
  }
  if (whole) return doc.toString({ flowCollectionPadding: false });

  // ---- The splices, applied from the end of the text back -------------------
  const opts = { lineWidth: 0, indent: style.step, indentSeq: style.indentSeq, flowCollectionPadding: false };
  /** `node` as YAML lines: the first where the splice starts, the rest at column `col`. */
  const lines = (node: unknown, col: number): string =>
    indentLines(stringify(node, opts).replace(/\n$/, "").split("\n"), col, 1).join(eol);
  const edits: Edit[] = [];
  for (const { from, to } of cuts) {
    // The comment lines just above a node, as deep as it or deeper, describe it, and go with it.
    let start = src.lastIndexOf("\n", from - 1) + 1;
    // The node's line's indentation: a list item's dash, or the key.
    const depth = src.slice(start, from).search(/\S|$/);
    while (start > 0) {
      const prev = src.lastIndexOf("\n", start - 2) + 1;
      const above = src.slice(prev, start);
      const at = above.search(/\S/);
      if (at < depth || above.charAt(at) !== "#") break;
      start = prev;
    }
    edits.push({ ...cutLines(src, start, to, eol), insert: "" });
  }
  for (const seq of flows) {
    const r = rangeOf(seq);
    const end = contentEnd(src, seq);
    /* c8 ignore next -- a list in `flows` has a range. */
    if (r === undefined || end === undefined) return doc.toString({ flowCollectionPadding: false });
    // The list's own comments stay in the text, so the copy written carries none.
    const copy = seq.clone();
    delete copy.comment;
    delete copy.commentBefore;
    edits.push({ start: r[0], end, insert: flowText(copy, src.charAt(r[0] + 1) === " ") });
  }
  for (const [seq, items] of appends) {
    const r = rangeOf(seq);
    const end = contentEnd(src, seq);
    /* c8 ignore next -- a list in `appends` has a range. */
    if (r === undefined || end === undefined) return doc.toString({ flowCollectionPadding: false });
    const col = colOf(src, r[0]);
    const at = lineEnd(src, end);
    edits.push({ start: at, end: at, insert: items.map((item) => `${eol}${" ".repeat(col)}- ${lines(item, col + 2)}`).join("") });
  }
  for (const { start, end, col, key, value } of refills) {
    edits.push({ start, end, insert: lines({ [key]: value }, col) });
  }
  for (const { map, key, value } of adds) {
    const first = rangeOf(map?.items[0]?.key);
    const end = map === null ? undefined : contentEnd(src, map);
    if (first === undefined || end === undefined) {
      const lead = src === "" || src.endsWith("\n") ? "" : eol;
      edits.push({ start: src.length, end: src.length, insert: `${lead}${lines({ [key]: value }, 0)}${eol}` });
      continue;
    }
    const col = colOf(src, first[0]);
    const at = lineEnd(src, end);
    edits.push({ start: at, end: at, insert: `${eol}${" ".repeat(col)}${lines({ [key]: value }, col)}` });
  }
  // From the end back, each before the last one applied; two that overlap write the document whole.
  const order = edits.map((e, i) => ({ e, i })).sort((a, b) => b.e.start - a.e.start || b.i - a.i);
  let out = src;
  let floor = src.length;
  for (const { e } of order) {
    if (e.end > floor) return doc.toString({ flowCollectionPadding: false });
    out = out.slice(0, e.start) + e.insert + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

/**
 * Read back the edited config the way discovery would: it parses, it
 * declares exactly the planned collections, and every other top-level key is
 * as it was. A config the tools cannot read is worse than a refused run.
 */
function verifyConfig(
  before: string | null,
  after: string,
  expected: CollectionConfig[],
  read: {
    source: string;
    configDir: string;
    env?: NodeJS.ProcessEnv;
    /** The metadata directory's state to read with: `read` for one the plan creates. */
    state?: MetadataDirState;
  },
): void {
  const { source, configDir } = read;
  const fail = (why: string): never => {
    throw new DocmetaError(`Could not edit collections: in ${source}, so nothing was written. ${why}`);
  };
  let old: unknown;
  let now: unknown;
  try {
    old = before === null ? null : parseYaml(before);
    now = parseYaml(after);
  } catch (err) {
    return fail(errorMessage(err));
  }
  if (typeof now !== "object" || now === null || Array.isArray(now)) return fail("The result is not a mapping.");
  const nowMap = now as Record<string, unknown>;
  const oldMap = typeof old === "object" && old !== null && !Array.isArray(old) ? (old as Record<string, unknown>) : {};
  const toError = (m: string): Error => new DocmetaError(m);
  // As discovery reads it, the metadata directory's entry (0126) included,
  // since `expected` carries the one the run was loaded with. That entry is
  // never in the text: `editConfig` writes only what a manifest ref changed.
  const parsed = applyMetadataDirectory(parseCollections(nowMap["collections"], source, toError), nowMap, {
    source,
    configDir,
    toError,
    ...(read.env !== undefined ? { env: read.env } : {}),
    ...(read.state !== undefined ? { state: read.state } : {}),
  });
  if (!deepEqual(parsed, expected)) return fail("The collections read back differently.");
  const rest = (m: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(m).filter(([k]) => k !== "collections"));
  if (!deepEqual(rest(nowMap), rest(oldMap))) return fail("Another key would have changed.");
}

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

function buildResult(input: {
  model: Model;
  pages: Page[];
  dryRun: boolean;
  lines: ReadonlyMap<string, number>;
  config: RelocateConfigResult;
  /** `--from` manifests left with no entries, deleted (0126). */
  deleted: readonly string[];
}): RelocateResult {
  const { model, pages, dryRun, lines, deleted } = input;
  const files: RelocateFileResult[] = [];
  for (const page of pages) {
    const moved: RelocateMove[] = [];
    const stayed: RelocateStay[] = [];
    const intents = orderedIntents(page);
    // A `{page}` manifest (proposal 0058) is named by the page's own file.
    const fileOf = (m: ManifestRef): string => model.fileFor(m, page.absPath).file;
    for (const [key, intent] of intents) {
      if (intent.kind === "in") moved.push({ key, to: "page", from: fileOf(intent.manifest), reason: "preferred" });
    }
    for (const [key, intent] of intents) {
      if (intent.kind !== "out") continue;
      const manifest = fileOf(intent.manifest);
      const line = dryRun ? undefined : lines.get(lineId(page.label, manifest, key));
      moved.push({
        key,
        to: "manifest",
        manifest,
        ...(line !== undefined ? { line } : {}),
        reason: intent.reason,
        ...(intent.from !== undefined ? { from: intent.from.file } : {}),
      });
    }
    for (const [key, intent] of intents) {
      if (intent.kind === "stay") stayed.push({ key, reason: intent.reason, detail: intent.detail });
    }
    if (moved.length > 0 || stayed.length > 0) {
      files.push({
        file: page.label,
        moved,
        stayed,
        beyond: page.beyond,
        ...(mintedInto(page) ? { minted: page.mint } : {}),
      });
    }
  }
  const touches = (m: ManifestRef, page: Page): boolean =>
    [...page.intents.values()].some(
      (i) => (i.kind === "in" || i.kind === "out") && (i.manifest === m || (i.kind === "out" && i.from?.manifest === m)),
    );
  // A metadata directory (0126) is created when this plan homes a key in it,
  // or when it is one the key or the environment names that is not there.
  const creates = (m: ManifestRef): boolean =>
    m.created || m.missing || (m.latent && (m.homed.length > 0 || pages.some((p) => touches(m, p))));
  // A file `--from` names that the config does not declare is no manifest of the config's.
  const manifests: RelocateManifestResult[] = model.manifests
    .filter(
      (m) =>
        m.loose !== true &&
        (m.from === true ||
          creates(m) ||
          m.keysAdded.length > 0 ||
          m.keysRemoved.length > 0 ||
          pages.some((p) => touches(m, p))),
    )
    .map((m) => {
      const keys = model.finalKeys(m);
      const home = model.manifests.find((r) => r.emptiedHome === true && r.collection === m.collection);
      return {
        file: m.file,
        collection: m.collection,
        index: m.index,
        created: creates(m),
        keysAdded: [...m.keysAdded],
        keysRemoved: [...m.keysRemoved],
        keys,
        undeclared: m.from === true || (!m.implied && keys.length === 0 && !m.created),
        ...(m.from === true ? { removed: home === undefined ? {} : { reads: `${model.dirOf(home)}/` } } : {}),
        beyond: pages.filter(
          (p) =>
            p.beyond &&
            [...p.intents].some(
              ([k, i]) =>
                ((i.kind === "in" || i.kind === "out") && i.manifest === m) ||
                (i.kind === "stay" && (m.keysAdded.includes(k) || m.keysRemoved.includes(k))),
            ),
        ).length,
      };
    });
  const minted = files.filter((f) => f.minted !== undefined).length;
  return {
    dryRun,
    config: input.config,
    manifests,
    files,
    summary: {
      files: files.length,
      moved: files.reduce((n, f) => n + f.moved.length, 0),
      stayed: files.reduce((n, f) => n + f.stayed.length, 0),
      // Collections reading one directory list it once each, and it is one manifest.
      manifestsCreated: new Set(manifests.filter((m) => m.created).map((m) => m.file)).size,
      ...(minted > 0 ? { minted } : {}),
      ...(deleted.length > 0 ? { deleted: deleted.length } : {}),
    },
    ...(deleted.length > 0 ? { deleted: [...deleted] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Applying.
// ---------------------------------------------------------------------------

/**
 * Write a plan: manifests, then the config, then the pages, each atomically.
 * Afterwards the context's collections (the same objects the caller's run
 * holds) declare what the config now declares, a created collection is
 * appended to both lists, and a created config sets `configDir` and
 * `configPath`. Returns the report with each manifest line.
 *
 * The run is all or nothing, as far as the disk allows. A file that changed
 * since planning is refused before anything is written. A write that fails
 * puts every file already written back as planning found it, removing the
 * ones this run created, and the context is left untouched. Without that, a
 * value leaving a manifest could be in neither the manifest nor the page.
 *
 * Throws `DocmetaError` for a changed or unreadable file and for a failed
 * write, naming any file that could not be put back.
 */
export async function applyRelocation(
  ctx: RelocationContext,
  plan: RelocationPlan,
  io: RelocationIo = {},
): Promise<RelocateResult> {
  // A per-page manifest (proposal 0058) may be the first file in its
  // directory. A page and the config already have theirs.
  const write = io.write ?? ((path: string, text: string) => writeFileAtomic(path, text, { createParents: true }));
  const remove = io.remove ?? ((path: string) => unlink(path));
  const label = (w: RelocationWrite): string =>
    w.kind === "config" ? configSource(w.path, ctx.cwd) : reported(w.path, ctx.base);

  for (const w of plan.writes) {
    let now: string | null;
    try {
      now = await readFile(w.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new DocmetaError(`${label(w)} could not be read: ${errorMessage(err)}`);
      }
      now = null;
    }
    if (now !== w.before) {
      throw new DocmetaError(
        `${label(w)} changed after the relocation was planned, so nothing was written. Run the command again.`,
      );
    }
  }

  // Put back what `done` wrote, last first, and word the error the run throws.
  const rollBack = async (done: RelocationWrite[], head: string): Promise<DocmetaError> => {
    const failed: { file: string; reason: string }[] = [];
    for (const w of [...done].reverse()) {
      try {
        if (w.before === null) await remove(w.path);
        else await write(w.path, w.before);
      } catch (err) {
        failed.push({ file: label(w), reason: errorMessage(err) });
      }
    }
    const [first] = failed;
    if (first === undefined) {
      if (done.length === 0) return new DocmetaError(`${head} Nothing was changed.`);
      const files = done.length === 1 ? "the file already written was" : `the ${String(done.length)} files already written were`;
      return new DocmetaError(`${head} Nothing was changed: ${files} restored.`);
    }
    const one = failed.length === 1;
    return new DocmetaError(
      `${head} The run was rolled back, but ${list(failed.map((f) => f.file))} could not be restored: ${first.reason}. Restore ${one ? "it" : "them"} from version control.`,
    );
  };

  // A directory the key or the environment names, created however little
  // moves into it (0126). Nothing to put back on a failure: it is empty.
  if (plan.directory?.missing === true) {
    try {
      await mkdir(plan.directory.abs, { recursive: true });
    } catch (err) {
      throw new DocmetaError(`Could not create ${reported(plan.directory.abs, ctx.base)}: ${errorMessage(err)}. Nothing was changed.`);
    }
  }
  const written: RelocationWrite[] = [];
  for (const w of plan.writes) {
    try {
      if (w.remove === true) await remove(w.path);
      else await write(w.path, w.text);
    } catch (err) {
      throw await rollBack(written, `Could not write ${label(w)}: ${errorMessage(err)}.`);
    }
    written.push(w);
  }

  // A metadata directory the plan put in play is read by every collection
  // that declares no externalMetadata:, as a re-read of the config says.
  if (plan.writes.some((w) => w.kind === "config") || plan.directory !== undefined) {
    const narrowed = ctx.collections.length < ctx.declaredCollections.length;
    for (const next of plan.collections) {
      const have = ctx.declaredCollections.find((c) => c.name === next.name);
      if (have !== undefined) {
        have.paths = next.paths;
        have.externalMetadata = next.externalMetadata;
        have.declaresExternalMetadata = next.declaresExternalMetadata;
        continue;
      }
      ctx.declaredCollections.push(next);
      if (!narrowed) ctx.collections.push(next);
    }
    ctx.configDir ??= plan.configDir;
    ctx.configPath ??= plan.configPath;
  }
  return {
    ...plan.result,
    dryRun: false,
    files: plan.result.files.map((f) => ({
      ...f,
      moved: f.moved.map((mv) => {
        if (mv.to !== "manifest") return mv;
        const line = plan.lines.get(lineId(f.file, mv.manifest, mv.key));
        return line === undefined ? mv : { ...mv, line };
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Offers: what the writers' (P1) and validate's (P2) prompts say.
// ---------------------------------------------------------------------------

/** One collection's share of a plan, as a prompt words it. */
export interface RelocationOffer {
  collection: string;
  /** The collection is created, with these paths (§3 case 2). */
  createsCollection?: { paths: string[] };
  /** Run targets appended to the collection's `paths:` (§3 case 3). */
  pathsAdded: string[];
  /** The config file the changes go to, as the run names it. */
  config: string | undefined;
  manifests: { file: string; created: boolean; keysAdded: string[]; keysRemoved: string[] }[];
  /** Keys leaving pages for a manifest, and how many values and pages that is. */
  keysOut: string[];
  valuesOut: number;
  pagesOut: number;
  /** Values leaving a manifest for pages, and which manifests give them up. */
  valuesIn: number;
  manifestsIn: string[];
}

function buildOffers(model: Model, pages: Page[], result: RelocateResult, config: string | undefined): RelocationOffer[] {
  const names = dedupe(result.manifests.map((m) => m.collection));
  return names.map((name) => {
    const manifests = result.manifests.filter((m) => m.collection === name);
    const outs = pages.flatMap((p) =>
      [...p.intents].flatMap(([k, i]) =>
        i.kind === "out" && i.manifest.collection === name ? [{ page: p.label, key: k, latent: i.manifest.latent }] : [],
      ),
    );
    // A metadata directory this plan creates (0126) owns by the pages' marks,
    // so the keys it is created for are those it homes and those moving in.
    const directory = [
      ...model.manifests.filter((m) => m.collection === name && m.latent).flatMap((m) => m.homed),
      ...outs.filter((o) => o.latent).map((o) => o.key),
    ];
    const ins = pages.flatMap((p) =>
      [...p.intents]
        .filter(([, i]) => i.kind === "in" && i.manifest.collection === name)
        .map(([, i]) => (i.kind === "in" ? i.manifest.file : "")),
    );
    const created = model.created.find((c) => c.name === name);
    return {
      collection: name,
      ...(created !== undefined ? { createsCollection: { paths: [...created.paths] } } : {}),
      pathsAdded: model.pathsAdded.filter((p) => p.collection === name).map((p) => p.path),
      config,
      manifests: manifests.map((m) => ({
        file: m.file,
        created: m.created,
        keysAdded: [...m.keysAdded],
        keysRemoved: [...m.keysRemoved],
      })),
      keysOut: dedupe([...manifests.flatMap((m) => m.keysAdded), ...directory]),
      valuesOut: outs.length,
      pagesOut: new Set(outs.map((o) => o.page)).size,
      valuesIn: ins.length,
      manifestsIn: dedupe(ins),
    };
  });
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
const list = (xs: readonly string[]): string => xs.join(", ");

/**
 * The two lines a prompt puts for one offer: `notice` is a diagnostic (the
 * caller adds the `manni: ` prefix) and `question` goes to `Confirm`, which
 * appends `[y/N] `.
 *
 * `write` is P1, asked by `derive`, `fill` and `query` before a value that
 * prefers external metadata is written. `validate` is P2, asked after the
 * report.
 */
export function offerPrompt(offer: RelocationOffer, kind: "write" | "validate"): { notice: string; question: string } {
  const config = offer.config ?? FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml";
  // A metadata directory (0126) is named by the file each page gets in it,
  // and no config edit declares it.
  const directory = (file: string): boolean => file.includes("{id}");
  const named = (file: string): string => file.replace("{id}", "<id>");
  if (kind === "validate") {
    const parts: string[] = [];
    if (offer.valuesOut > 0) {
      parts.push(
        `${count(offer.valuesOut, "value")} in ${count(offer.pagesOut, "page")} ${offer.valuesOut === 1 ? "prefers" : "prefer"} external metadata`,
      );
    }
    if (offer.valuesIn > 0) {
      parts.push(
        `${count(offer.valuesIn, "value")} in ${list(offer.manifestsIn)} ${offer.valuesIn === 1 ? "prefers" : "prefer"} the page`,
      );
    }
    const changes: string[] = [];
    if (offer.createsCollection !== undefined) {
      changes.push(`create collection ${offer.collection} (paths: ${list(offer.createsCollection.paths)})`);
    }
    for (const p of offer.pathsAdded) changes.push(`add ${p} to collection ${offer.collection}'s paths`);
    for (const m of offer.manifests) {
      if (m.created) changes.push(`create ${named(m.file)}`);
      if (m.keysRemoved.length > 0) changes.push(`remove ${list(m.keysRemoved)} from ${m.file}'s keys`);
      if (!m.created && m.keysAdded.length > 0) changes.push(`add ${list(m.keysAdded)} to ${m.file}'s keys`);
    }
    return {
      notice: `in collection ${offer.collection}, ${parts.join(" and ")}.`,
      question: changes.length === 0 ? "Move them? " : `Move them (${changes.join(", ")})? `,
    };
  }
  const keys = list(offer.keysOut);
  const prefer = offer.keysOut.length === 1 ? "which the schema prefers" : "which their schemas prefer";
  const move = offer.pagesOut > 0 ? `move them out of ${count(offer.pagesOut, "page")}` : undefined;
  const tail = (steps: string[]): string => {
    const all = move === undefined ? steps : [...steps, move];
    if (all.length === 1) return `${capital(all[0] ?? "")}? `;
    if (all.length === 2) return `${capital(all[0] ?? "")} and ${all[1] ?? ""}? `;
    return `${capital(all.slice(0, -1).join(", "))}, and ${all.at(-1) ?? ""}? `;
  };
  const created = offer.manifests.find((m) => m.created);
  if (offer.createsCollection !== undefined) {
    const paths = list(offer.createsCollection.paths);
    const make =
      created !== undefined && directory(created.file)
        ? `Create collection ${offer.collection} (paths: ${paths}) in ${config}, with ${named(created.file)}`
        : `Create collection ${offer.collection} (paths: ${paths}), with ${created?.file ?? `${offer.collection}.metadata.yaml`}, in ${config}`;
    return {
      notice: `no collection has a manifest for ${keys}, ${prefer} in external metadata.`,
      question: move === undefined ? `${make}? ` : `${make}, and ${move}? `,
    };
  }
  const steps: string[] = offer.pathsAdded.map((p) => `add ${p} to collection ${offer.collection}'s paths`);
  if (created !== undefined && directory(created.file)) steps.push(`create ${named(created.file)}`);
  else if (created !== undefined) steps.push(`create ${created.file}`, `add it to ${config}`);
  for (const m of offer.manifests) {
    if (!m.created && m.keysAdded.length > 0) steps.push(`add ${list(m.keysAdded)} to ${m.file}'s keys`);
  }
  return {
    notice: `collection ${offer.collection} has no manifest for ${keys}, ${prefer} in external metadata.`,
    question: tail(steps),
  };
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The plan's offers, one per collection whose manifests the plan changes. */
export function relocationOffers(plan: RelocationPlan): RelocationOffer[] {
  return plan.offers;
}
