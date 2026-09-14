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
 *    config file. A URL manifest is never a home.
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
import { existsSync, statSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import {
  LineCounter,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parse as parseYaml,
  parseDocument,
  type Document,
} from "yaml";
import {
  isMember,
  parseCollections,
  type CollectionConfig,
} from "../../shared/collections.js";
import { FAMILY_CONFIG_NAMES, MOOSE_CONFIG_NAMES, type ConfigFile } from "../../shared/config-file.js";
import { findGitRoot } from "../../shared/git-root.js";
import { errorMessage } from "../../shared/errors.js";
import { decryptValue, isEncryptedValue } from "../../shared/encryption.js";
import { DocmetaError, type MetadataExtractor, type MetadataPatch } from "../types.js";
import { schemaTrustRoot, type DocmetaConfig, type RunConfig } from "./config.js";
import { memberOf } from "./collections.js";
import { EncryptionRefusal, META_CONTEXT, lazyKey } from "./encrypted.js";
import {
  PATH_JOIN,
  externalMetadataJoin,
  loadExternalMetadata,
  mergeExternalMetadata,
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
}

export interface RelocateResult {
  dryRun: boolean;
  config: RelocateConfigResult;
  /** Every manifest the run creates, changes the keys of, or moves a value into or out of. */
  manifests: RelocateManifestResult[];
  files: RelocateFileResult[];
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
  absPath: string | undefined;
  /** As the run reports it. */
  file: string;
  join: string;
  created: boolean;
  keysBefore: string[];
  keysAdded: string[];
  keysRemoved: string[];
}

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
    externalMetadata: c.externalMetadata.map((m) => ({ ...m, keys: [...m.keys] })),
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

  constructor(
    private readonly ctx: RelocationContext,
    readonly configDir: string,
  ) {
    this.collections = ctx.declaredCollections.map(cloneCollection);
    for (const c of this.collections) {
      c.externalMetadata.forEach((m, index) => {
        const url = classifyRef(m.file).kind === "url";
        const absPath = url ? undefined : isAbsolute(m.file) ? m.file : resolve(configDir, m.file);
        this.manifests.push({
          collection: c.name,
          index,
          written: m.file,
          url,
          absPath,
          file: absPath === undefined ? m.file : reported(absPath, ctx.base),
          join: externalMetadataJoin(m),
          created: false,
          keysBefore: [...m.keys],
          keysAdded: [],
          keysRemoved: [],
        });
      });
    }
  }

  members(label: string): string[] {
    return memberOf(this.collections, this.configDir, this.ctx.base, label);
  }

  manifestsOf(collection: string): ManifestRef[] {
    return this.manifests.filter((m) => m.collection === collection);
  }

  /** The manifest of one of `members` that owns `key`, in declaration order. */
  ownerOf(key: string, members: readonly string[]): ManifestRef | undefined {
    return this.manifests.find(
      (m) => members.includes(m.collection) && (m.keysBefore.includes(key) || m.keysAdded.includes(key)),
    );
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
  home(label: string, commit: boolean): { manifest: ManifestRef; proposed: ProposedHome } | { proposed: ProposedHome } {
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
          this.ctx.targets.flatMap((t) => {
            const p = collectionPath(t, this.ctx.cwd, this.configDir);
            return p === undefined ? [] : [p];
          }),
        );
        if (rel === undefined || !paths.some((p) => isMember(bare(p), rel))) {
          return { proposed: { kind: "none", reason: "collections", collections: 0 } };
        }
        collection = "default";
        createsCollection = true;
        if (commit) {
          this.collections.push({ name: collection, paths, exclude: [], externalMetadata: [] });
          this.created.push({ name: collection, paths: [...paths] });
        }
      } else if (this.collections.length === 1 && this.collections[0] !== undefined) {
        const only = this.collections[0];
        const target = this.ctx.targets
          .map((t) => collectionPath(t, this.ctx.cwd, this.configDir))
          .find((p) => p !== undefined && rel !== undefined && isMember(bare(p), rel));
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
    const local = this.manifestsOf(name).find((m) => !m.url);
    const proposedOf = (m: { file: string; created: boolean }): ProposedHome => ({
      kind: "collection",
      collection: name,
      manifest: m.file,
      createsManifest: m.created,
      createsCollection,
      ...(addsPath !== undefined ? { addsPath } : {}),
    });
    if (local !== undefined) return { manifest: local, proposed: proposedOf(local) };

    const fileName = `${name}.metadata.yaml`;
    const absPath = join(this.configDir, fileName);
    const file = reported(absPath, this.ctx.base);
    if (!commit) return { proposed: proposedOf({ file, created: true }) };
    if (existsSync(absPath)) {
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
      created: true,
      keysBefore: [],
      keysAdded: [],
      keysRemoved: [],
    };
    owner?.externalMetadata.push({ file: ref.written, keys: [] });
    this.manifests.push(ref);
    return { manifest: ref, proposed: proposedOf(ref) };
  }

  addKey(m: ManifestRef, key: string): void {
    if (m.keysBefore.includes(key) || m.keysAdded.includes(key)) return;
    m.keysAdded.push(key);
    this.collections.find((c) => c.name === m.collection)?.externalMetadata[m.index]?.keys.push(key);
  }

  removeKey(m: ManifestRef, key: string): void {
    if (!m.keysBefore.includes(key) || m.keysRemoved.includes(key)) return;
    m.keysRemoved.push(key);
  }

  /** The keys a manifest owns once the plan is applied. */
  finalKeys(m: ManifestRef): string[] {
    return [...m.keysBefore.filter((k) => !m.keysRemoved.includes(k)), ...m.keysAdded];
  }

  /** The collections as the config will declare them: removals applied, emptied manifests gone. */
  final(): CollectionConfig[] {
    return this.collections.map((c) => ({
      ...c,
      externalMetadata: c.externalMetadata.flatMap((em, index) => {
        const ref = this.manifests.find((m) => m.collection === c.name && m.index === index);
        const keys = ref === undefined ? em.keys : this.finalKeys(ref);
        return keys.length === 0 ? [] : [{ ...em, keys }];
      }),
    }));
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
  return { name: "", paths: [path], exclude: [], externalMetadata: [] };
}

/**
 * A run target as a collection `paths:` entry, relative to the config
 * directory: `docs/` and a directory named without the slash become
 * `docs/**`, a glob and a file stay themselves. Undefined for stdin and for a
 * target outside the config directory, which no collection can hold.
 */
function collectionPath(target: string, cwd: string, configDir: string): string | undefined {
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
      directory = statSync(abs).isDirectory();
    } catch {
      directory = false;
    }
  }
  if (!directory) return rel;
  return rel === "" ? "**" : `${rel}/**`;
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
    }
  | { kind: "url"; collection: string; file: string }
  | { kind: "unowned"; home: ProposedHome };

/**
 * Where `key` of the page `label` lives in the context's current config: the
 * owning local manifest (with the page's entry in it), a URL manifest, or
 * nowhere, with the home §3 would choose. Reads no manifest and writes
 * nothing. `data` is the page's own metadata, for a field join; an encrypted
 * join value is decrypted with the run's key.
 */
export function keyHome(
  ctx: RelocationContext,
  label: string,
  data: Readonly<Record<string, unknown>>,
  key: string,
): KeyHome {
  const model = new Model(ctx, plannedConfigDir(ctx));
  const owner = model.ownerOf(key, model.members(label));
  if (owner !== undefined) {
    if (owner.url || owner.absPath === undefined) {
      return { kind: "url", collection: owner.collection, file: owner.file };
    }
    return {
      kind: "manifest",
      collection: owner.collection,
      file: owner.file,
      absPath: owner.absPath,
      join: owner.join,
      entry: entryFor(owner, label, data, model.configDir, ctx.base, lazyKey(ctx.configFile, ctx.env)),
    };
  }
  return { kind: "unowned", home: model.home(label, false).proposed };
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
}

type Intent =
  | { kind: "out"; manifest: ManifestRef; reason: RelocateMoveReason; drop: boolean; entry: string }
  | { kind: "in"; manifest: ManifestRef; drop: boolean; entry: string; value: unknown }
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
}

/** One file the plan writes. */
export interface RelocationWrite {
  path: string;
  text: string;
  kind: "manifest" | "config" | "page";
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
}

/**
 * Plan every move for `request.files` and the member pages a `keys:` change
 * reaches, with every new file text computed and read back. Writes nothing.
 *
 * Throws `DocmetaError` for a page that will not load, a schema that will not
 * resolve, a `--fields` name nothing marks or owns (U3), a manifest path that
 * exists undeclared (U6), a single-tool config file, and an edit that does
 * not read back as planned.
 */
export async function planRelocation(
  ctx: RelocationContext,
  request: RelocationRequest,
): Promise<RelocationPlan> {
  const configDir = plannedConfigDir(ctx);
  const model = new Model(ctx, configDir);
  const encryptionKey = lazyKey(ctx.configFile, ctx.env);
  const index = await loadExternalMetadata(ctx.declaredCollections, {
    configDir: ctx.configDir ?? ctx.cwd,
    base: ctx.base,
    offline: ctx.config?.offline ?? false,
  });
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
    if (m.join === PATH_JOIN) {
      sv = index.byPath.get(page.absPath)?.get(key);
    } else {
      const entry = entryFor(m, page.label, page.own, configDir, ctx.base, encryptionKey);
      sv = entry === undefined ? undefined : index.byField.get(m.join)?.get(entry)?.get(key);
    }
    return sv !== undefined && sv.collection === m.collection && sv.file === m.file ? sv : undefined;
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

  /** Out of the page, into `m`. */
  const planOut = (page: Page, m: ManifestRef, key: string, reason: RelocateMoveReason): void => {
    if (page.intents.has(key)) return;
    if (m.url) {
      stay(page, key, "url-manifest", urlDetail(m), { toward: m });
      return;
    }
    const entry = entryFor(m, page.label, page.own, configDir, ctx.base, encryptionKey);
    if (entry === undefined) {
      stay(page, key, "no-join-value", `this document has no ${m.join}, which ${m.file} joins on`, { toward: m });
      return;
    }
    const held = supplied(m, page, key);
    if (held !== undefined && !deepEqual(held.value, page.own[key])) {
      stay(page, key, "values-differ", `the page and ${m.file} hold different values`, { toward: m });
      return;
    }
    page.intents.set(key, { kind: "out", manifest: m, reason, drop: held !== undefined, entry });
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
        stay(page, key, "values-differ", `the page and ${m.file} hold different values`, { blocks: m });
        return;
      }
      page.intents.set(key, { kind: "in", manifest: m, drop: true, entry, value: held.value });
      return;
    }
    page.intents.set(key, { kind: "in", manifest: m, drop: false, entry, value: held.value });
  };

  // ---- The named pages: what their schemas and the config say ---------------
  const preferencesOf = new Map<string, Map<string, FieldLocation>>();
  const homeless = new Map<string, { keys: string[]; reason: "collections" | "no-config"; collections: number }>();
  const marked = new Set<string>();
  for (const label of request.files) {
    const page = await load(label, false);
    /* c8 ignore next -- a named page always has an extractor, or `load` threw. */
    if (page === undefined) continue;
    const members = currentMembers(label);
    const merged = mergeExternalMetadata(
      label,
      { data: page.own, present: true, format: page.format, lineFor: () => undefined },
      index,
      members,
      ctx.base,
      { encryptionKey },
    );
    const data = merged.extracted.data;
    const required = request.require?.get(label) ?? [];
    const resolved = resolveSchemaSetWithSource({
      filePath: label,
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
    const prefs = new Map<string, FieldLocation>();
    for (const [key, p] of await ctx.validator.locationPreferences(probe, resolved.schemas)) {
      prefs.set(key, p.location);
      marked.add(key);
    }
    for (const key of required) if (!prefs.has(key)) prefs.set(key, "external");
    preferencesOf.set(label, prefs);

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
      const owner = model.ownerOf(key, model.members(label));
      if (owner !== undefined) {
        if (pref === "page") {
          if (owner.url) {
            if (supplied(owner, page, key) !== undefined) stay(page, key, "url-manifest", urlDetail(owner));
          } else if (owner.keysBefore.includes(key)) {
            model.removeKey(owner, key);
          }
        } else if (inPage) {
          planOut(page, owner, key, pref === "external" ? "preferred" : "owned");
        }
        continue;
      }
      if (pref !== "external" || !(inPage || required.includes(key))) continue;
      const chosen = model.home(label, true);
      if ("manifest" in chosen) {
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
  if (fields !== undefined) {
    for (const f of fields) {
      if (!marked.has(f) && !(request.require !== undefined && [...request.require.values()].some((ks) => ks.includes(f)))) {
        throw new DocmetaError(
          `"${f}" has no x-manni-location mark and no owning manifest for any file in this run.`,
        );
      }
    }
  }

  // ---- A key leaving keys: is headed for the page ---------------------------
  // A page planned before (or after) another page's mark removed the key would
  // otherwise send its copy to a manifest that no longer owns it. The move is
  // set aside, and put back if a page blocks the removal below.
  const suspended: { page: Page; manifest: ManifestRef; key: string; reason: RelocateMoveReason }[] = [];
  for (const page of pages.values()) {
    for (const [key, intent] of [...page.intents]) {
      const m = intent.kind === "out" ? intent.manifest : intent.kind === "stay" ? intent.toward : undefined;
      if (m === undefined || !m.keysRemoved.includes(key)) continue;
      page.intents.delete(key);
      const prefs = preferencesOf.get(page.label);
      suspended.push({
        page,
        manifest: m,
        key,
        reason: intent.kind === "out" ? intent.reason : prefs?.get(key) === "external" ? "preferred" : "owned",
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
    const walked = await resolveTargetSet({
      inputs: [...collection.paths],
      cwd: configDir,
      allowEmpty: true,
      ...gitignoreOptions({
        ...(ctx.respectGitignore !== undefined ? { flag: ctx.respectGitignore } : {}),
        ...(ctx.config?.respectGitignore !== undefined ? { configured: ctx.config.respectGitignore } : {}),
      }),
    });
    const labels = dedupe([
      ...request.files,
      ...walked.files.map((f) => reported(resolve(configDir, f), ctx.base)),
    ]).filter((label) => model.members(label).includes(name));
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
              (!m.created && index?.byPath.get(page.absPath)?.get(key)?.file === m.file);
            if (held && !page.intents.has(key)) stay(page, key, "unreadable", detail, { blocks: m });
          }
          continue;
        }
        for (const key of out) {
          if (!Object.hasOwn(page.own, key)) continue;
          const reason = m.keysAdded.includes(key) || prefs?.get(key) === "external" ? "preferred" : "owned";
          planOut(page, m, key, reason);
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
  for (;;) {
    for (const page of pages.values()) planPageText(page);
    let changed = false;
    for (const page of pages.values()) {
      for (const [key, intent] of page.intents) {
        if (intent.kind !== "stay" || intent.blocks === undefined) continue;
        const m = intent.blocks;
        if (!m.keysRemoved.includes(key)) continue;
        m.keysRemoved.splice(m.keysRemoved.indexOf(key), 1);
        for (const other of pages.values()) {
          const i = other.intents.get(key);
          if (i?.kind === "in" && i.manifest === m) other.intents.delete(key);
        }
        // The manifest keeps the key, so a copy set aside for the page goes to it after all.
        for (const s of suspended) {
          if (s.manifest === m && s.key === key) planOut(s.page, m, key, s.reason);
        }
        changed = true;
      }
    }
    if (!changed) break;
  }

  // ---- Manifest texts --------------------------------------------------------
  const writes: RelocationWrite[] = [];
  const lines = new Map<string, number>();
  for (const m of model.manifests) {
    if (m.url || m.absPath === undefined) continue;
    const undeclared = model.finalKeys(m).length === 0 && !m.created;
    const outs: { page: string; entry: string; key: string; value: unknown; drop: boolean }[] = [];
    const ins: { entry: string; key: string }[] = [];
    for (const page of orderedPages()) {
      for (const [key, intent] of orderedIntents(page)) {
        if (intent.kind === "out" && intent.manifest === m) {
          outs.push({ page: page.label, entry: intent.entry, key, value: page.own[key], drop: intent.drop });
        } else if (intent.kind === "in" && intent.manifest === m) {
          ins.push({ entry: intent.entry, key });
        }
      }
    }
    if (!undeclared) assertNoStrandedEntries(m, index, pages, configDir);
    if (undeclared || (!m.created && outs.length === 0 && ins.length === 0)) continue;
    let text = m.created ? "" : await readManifestText(m);
    const before = text;
    const where = { join: m.join, file: m.file };
    for (const o of outs) {
      if (!o.drop) text = spliceManifestValue(text, { ...where, entry: o.entry, key: o.key, value: o.value }).text;
    }
    for (const i of ins) text = removeManifestKey(text, { ...where, entry: i.entry, key: i.key }).text;
    const found = keyLines(text, m.join);
    for (const o of outs) {
      const line = found.get(entryId(o.entry, m.join))?.get(o.key);
      if (line !== undefined) lines.set(lineId(o.page, m.file, o.key), line);
    }
    if (m.created || text !== before) {
      // A created manifest's path does not exist: planning refuses one that does (U6).
      writes.push({ path: m.absPath, text, kind: "manifest", before: m.created ? null : before });
    }
  }

  // ---- Config text ---------------------------------------------------------------
  const finalCollections = model.final();
  const needsConfig =
    model.created.length > 0 ||
    model.pathsAdded.length > 0 ||
    model.manifests.some((m) => m.created || m.keysAdded.length > 0 || m.keysRemoved.length > 0);
  const target = await configTarget(ctx, configDir);
  let configCreated = false;
  if (needsConfig) {
    if (ctx.configFile !== undefined && (ctx.configFile.kind === "legacy" || !ctx.configFile.wrapped)) {
      throw new DocmetaError(
        `${ctx.configFile.source} is a single-tool config file, which cannot hold collections:. Move its keys under meta: in ${FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml"}.`,
      );
    }
    const text = editConfig(target.text, model, configSource(target.path, ctx.cwd));
    verifyConfig(target.text, text, finalCollections, configSource(target.path, ctx.cwd));
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
  });
  return {
    result,
    writes,
    lines,
    collections: finalCollections,
    configDir,
    configPath: target.path,
    offers: buildOffers(model, orderedPages(), result, needsConfig ? configSource(target.path, ctx.cwd) : undefined),
    homeless: [...homeless].map(([file, h]) => ({ file, ...h })),
  };
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

/**
 * The page's new text for its intents, read back. A format with no writer,
 * or a document its writer refuses, turns every intent that needs the page
 * written into a stay; one moving a value in blocks that key's removal.
 */
function planPageText(page: Page): void {
  const patch: MetadataPatch = {};
  const deletions: string[] = [];
  for (const [key, intent] of page.intents) {
    if (intent.kind === "out") deletions.push(key);
    else if (intent.kind === "in" && !intent.drop) patch[key] = intent.value;
  }
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
            .filter(([, values]) => {
              const sv = values.get(key);
              return sv !== undefined && sv.file === m.file && sv.collection === m.collection;
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

async function readManifestText(m: ManifestRef): Promise<string> {
  /* c8 ignore next -- only local manifests are read. */
  if (m.absPath === undefined) return "";
  try {
    return await readFile(m.absPath, "utf8");
  } catch (err) {
    throw new DocmetaError(`Manifest ${m.file} could not be read: ${errorMessage(err)}`);
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
  for (const name of [...FAMILY_CONFIG_NAMES, ...MOOSE_CONFIG_NAMES]) {
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

/** The config text with the model's changes, comments and key order kept. */
function editConfig(text: string | null, model: Model, source: string): string {
  const doc = parseDocument(text ?? "");
  const [problem] = doc.errors;
  if (problem !== undefined) throw new DocmetaError(`${source}: invalid YAML: ${problem.message}`);
  if (doc.contents !== null && !isMap(doc.contents)) {
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

  const declared = model.collections.length - model.created.length;
  const existing = doc.get("collections", true);
  if (declared > 0 && !isSeq(existing)) fail();
  for (let i = 0; i < declared; i++) {
    const c = model.collections[i];
    const node = isSeq(existing) ? existing.items[i] : undefined;
    if (c === undefined || !isMap(node)) return fail();
    for (const added of model.pathsAdded.filter((p) => p.collection === c.name)) {
      const paths = node.get("paths", true);
      if (!isSeq(paths)) return fail();
      const scalar = doc.createNode(added.path);
      const first = paths.items[0];
      if (isScalar(first) && first.type !== undefined) scalar.type = first.type;
      paths.add(scalar);
    }
    const refs = model.manifestsOf(c.name);
    for (const m of refs) {
      if (m.created) {
        let list = node.get("externalMetadata", true);
        if (!isSeq(list)) {
          node.set("externalMetadata", doc.createNode([]));
          list = node.get("externalMetadata", true);
        }
        if (!isSeq(list)) return fail();
        list.add(manifestNode(doc, m.written, m.keysAdded));
        continue;
      }
      if (m.keysAdded.length === 0) continue;
      const entry = node.getIn(["externalMetadata", m.index], true);
      const keys = isMap(entry) ? entry.get("keys", true) : undefined;
      if (!isSeq(keys)) return fail();
      for (const key of m.keysAdded) keys.add(doc.createNode(key));
    }
    // Removals last, highest index first, so earlier indices stay valid.
    const list = node.get("externalMetadata", true);
    for (const m of [...refs].filter((r) => !r.created).sort((a, b) => b.index - a.index)) {
      if (m.keysRemoved.length === 0) continue;
      if (!isSeq(list)) return fail();
      const entry = list.items[m.index];
      const keys = isMap(entry) ? entry.get("keys", true) : undefined;
      if (!isSeq(keys)) return fail();
      for (const key of m.keysRemoved) {
        const at = keys.items.findIndex((item) => (isScalar(item) ? String(item.value) : String(item)) === key);
        if (at >= 0) keys.delete(at);
      }
      if (keys.items.length === 0) list.delete(m.index);
    }
    if (isSeq(list) && list.items.length === 0) node.delete("externalMetadata");
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
    if (isSeq(seq)) seq.add(node);
    else doc.set("collections", doc.createNode([node]));
  }
  return doc.toString({ flowCollectionPadding: false });
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
  source: string,
): void {
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
  const parsed = parseCollections(nowMap["collections"], source, (m) => new DocmetaError(m));
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
}): RelocateResult {
  const { model, pages, dryRun, lines } = input;
  const files: RelocateFileResult[] = [];
  for (const page of pages) {
    const moved: RelocateMove[] = [];
    const stayed: RelocateStay[] = [];
    const intents = orderedIntents(page);
    for (const [key, intent] of intents) {
      if (intent.kind === "in") moved.push({ key, to: "page", from: intent.manifest.file, reason: "preferred" });
    }
    for (const [key, intent] of intents) {
      if (intent.kind !== "out") continue;
      const line = dryRun ? undefined : lines.get(lineId(page.label, intent.manifest.file, key));
      moved.push({
        key,
        to: "manifest",
        manifest: intent.manifest.file,
        ...(line !== undefined ? { line } : {}),
        reason: intent.reason,
      });
    }
    for (const [key, intent] of intents) {
      if (intent.kind === "stay") stayed.push({ key, reason: intent.reason, detail: intent.detail });
    }
    if (moved.length > 0 || stayed.length > 0) files.push({ file: page.label, moved, stayed, beyond: page.beyond });
  }
  const touches = (m: ManifestRef, page: Page): boolean =>
    [...page.intents.values()].some((i) => (i.kind === "in" || i.kind === "out") && i.manifest === m);
  const manifests: RelocateManifestResult[] = model.manifests
    .filter(
      (m) =>
        m.created || m.keysAdded.length > 0 || m.keysRemoved.length > 0 || pages.some((p) => touches(m, p)),
    )
    .map((m) => {
      const keys = model.finalKeys(m);
      return {
        file: m.file,
        collection: m.collection,
        index: m.index,
        created: m.created,
        keysAdded: [...m.keysAdded],
        keysRemoved: [...m.keysRemoved],
        keys,
        undeclared: keys.length === 0 && !m.created,
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
  return {
    dryRun,
    config: input.config,
    manifests,
    files,
    summary: {
      files: files.length,
      moved: files.reduce((n, f) => n + f.moved.length, 0),
      stayed: files.reduce((n, f) => n + f.stayed.length, 0),
      manifestsCreated: manifests.filter((m) => m.created).length,
    },
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
  const write = io.write ?? ((path: string, text: string) => writeFileAtomic(path, text));
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

  const written: RelocationWrite[] = [];
  for (const w of plan.writes) {
    try {
      await write(w.path, w.text);
    } catch (err) {
      throw await rollBack(written, `Could not write ${label(w)}: ${errorMessage(err)}.`);
    }
    written.push(w);
  }

  if (plan.writes.some((w) => w.kind === "config")) {
    const narrowed = ctx.collections.length < ctx.declaredCollections.length;
    for (const next of plan.collections) {
      const have = ctx.declaredCollections.find((c) => c.name === next.name);
      if (have !== undefined) {
        have.paths = next.paths;
        have.externalMetadata = next.externalMetadata;
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
      [...p.intents].filter(([, i]) => i.kind === "out" && i.manifest.collection === name).map(([k]) => ({ page: p.label, key: k })),
    );
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
      keysOut: dedupe(manifests.flatMap((m) => m.keysAdded)),
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
      if (m.created) changes.push(`create ${m.file}`);
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
    const make = `Create collection ${offer.collection} (paths: ${list(offer.createsCollection.paths)}), with ${created?.file ?? `${offer.collection}.metadata.yaml`}, in ${config}`;
    return {
      notice: `no collection has a manifest for ${keys}, ${prefer} in external metadata.`,
      question: move === undefined ? `${make}? ` : `${make}, and ${move}? `,
    };
  }
  const steps: string[] = offer.pathsAdded.map((p) => `add ${p} to collection ${offer.collection}'s paths`);
  if (created !== undefined) steps.push(`create ${created.file}`, `add it to ${config}`);
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
