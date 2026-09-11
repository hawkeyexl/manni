/**
 * External metadata (proposal 0037): a private manifest joined to public
 * documents.
 *
 * A manifest is a YAML mapping from document to a mapping of owned keys. Its
 * values are merged into each named document's extracted metadata before
 * schema resolution, so every command sees one object. The manifest itself
 * is never a document: it registers no extractor, appears in no `docs` row,
 * and is what 0031 called a join table rather than the standalone data file
 * it rejected.
 *
 * Three rules decide everything else here:
 *
 *  - **Keys are owned.** Each manifest declares the top-level keys it supplies,
 *    ownership is disjoint across manifests (asserted by the config parser), and
 *    a manifest entry supplying a key it does not own is an operational error.
 *    Ownership is what gives a write to an absent key somewhere to go, and it
 *    is what makes a document carrying a private key visible with or without
 *    a manifest entry.
 *  - **A document carrying an owned key is a collision, not a tiebreak.** 0020's
 *    rule across files: neither channel wins, because the discarded value is
 *    exactly the one nobody checked. The caller files the finding; the merge
 *    keeps the document's value so the report shows what the public site
 *    would publish.
 *  - **A manifest names documents by exact path, or by one frontmatter field.**
 *    No globs and no cascade (0004 rejected partial merges of config for the
 *    reason that a silently merged result changes what the contract means).
 *    A path is relative to the config's directory. A field join (0039)
 *    matches the extracted value of that field, so a rename cannot orphan an
 *    entry; what can is two pages sharing one value, which is a finding on
 *    both.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  LineCounter,
  isMap,
  isNode,
  isScalar,
  parseDocument,
  type Node,
} from "yaml";
import type {
  CollectionConfig,
  ExternalMetadataConfig,
} from "../../shared/collections.js";
import { FILE_SCHEMA_KEY } from "./resolve-schema.js";
import { classifyRef } from "./schema-registry.js";
import { fetchExternalMetadata } from "./external-metadata-fetch.js";
import { STDIN_LABEL } from "./load-files.js";
import { escapePointerSegment } from "../extractors/pointer.js";
import { DocmetaError, type ExtractedMetadata } from "../types.js";

/**
 * The `schema` ref a collision finding carries, and so its baseline and rule
 * identity: `external:owned/external`. Shaped like `check:<name>` so
 * `classifyRef` passes it through as a built-in id rather than resolving it
 * as a cwd-relative file path, and reserved in the registry for the same
 * reason `check` is.
 */
export const EXTERNAL_OWNED_SCHEMA = "external:owned";

/**
 * The `schema` ref of a duplicate-join finding (0039): two documents carry
 * the same value of a join field, so one manifest entry matched both.
 */
export const EXTERNAL_DUPLICATE_SCHEMA = "external:duplicate";

/**
 * The `keyword` every external-metadata finding carries: no Ajv keyword
 * produced it.
 */
export const EXTERNAL_KEYWORD = "external";

/** The join that names documents by path, and the default. */
export const PATH_JOIN = "path";

/** One value a manifest supplied, and where it was written. */
export interface ExternalMetadataValue {
  value: unknown;
  /** The collection whose manifest supplied it (proposal 0041). */
  collection: string;
  /** Manifest path as the run reports it: relative to the run's base, posix — or the URL. */
  file: string;
  /** 1-based line of the key in the manifest, when known. */
  line?: number;
}

/** One manifest entry, for the orphan checks. */
export interface ExternalMetadataEntry {
  /** The collection whose manifest declared it (proposal 0041). */
  collection: string;
  /** `path`, or the frontmatter field this entry is keyed by. */
  join: string;
  /** Absolute document path, for a path entry. */
  abs?: string;
  /** The key exactly as written in the manifest. */
  spelled: string;
  /** Manifest path as the run reports it. */
  file: string;
  /** 1-based line of the entry in the manifest, when known. */
  line?: number;
}

type Values = Map<string, ExternalMetadataValue>;

/** Every manifest of a run, loaded once and consulted per document. */
export interface ExternalMetadataIndex {
  /**
   * Owned key -> every collection that owns it, with the manifest that does.
   *
   * A list rather than one entry, because two collections may legitimately
   * each own the same key (0041 rule 5): `guides` and `blog` can both supply
   * `owner`. Ambiguity only exists for a file that is a member of both, which
   * is decided per file in `mergeExternalMetadata`.
   */
  owners: ReadonlyMap<string, readonly { collection: string; file: string }[]>;
  /** Path-joined manifests: absolute document path -> owned key -> value. */
  byPath: ReadonlyMap<string, ReadonlyMap<string, ExternalMetadataValue>>;
  /** Field-joined manifests: field -> value -> owned key -> value. */
  byField: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, ExternalMetadataValue>>>;
  /** Every manifest entry, in manifest order. */
  entries: readonly ExternalMetadataEntry[];
}

export interface LoadExternalMetadataOptions {
  /** Directory `externalMetadata[].file` and every manifest key resolve from. */
  configDir: string;
  /** Directory the run's file labels are relative to; manifests are reported the same way. */
  base: string;
  /** `--offline` / `offline:`: a URL manifest is refused rather than fetched (0038). */
  offline?: boolean;
  /** Network timeout for a URL manifest; the schema fetch's default otherwise. */
  timeoutMs?: number;
  /** For tests: the environment `tokenEnv` is read from. */
  env?: Record<string, string | undefined>;
}

/** A place a merged value lives, for a finding that must name it. */
export interface SourceLocation {
  file: string;
  line?: number;
  col?: number;
}

/** A key the document carries that a manifest owns. */
export interface ExternalMetadataCollision {
  key: string;
  /** The owning manifest, as the run reports it. */
  file: string;
  /** The collection that manifest belongs to (proposal 0041). */
  collection: string;
}

/** A field-joined entry a document matched (0039). */
export interface ExternalMetadataJoin {
  field: string;
  value: string;
  /** The manifest, as the run reports it. */
  file: string;
  /** The collection that manifest belongs to (proposal 0041). */
  collection: string;
}

/** What `mergeExternalMetadata` hands back. */
export interface MergedMetadata {
  /** The document's metadata with every owned key the manifest supplied. */
  extracted: ExtractedMetadata;
  /**
   * Owned keys the document itself also carried, in document order, each
   * with the manifest that owns it — so the finding names it without a
   * second lookup, and without a fallback for an index that is not there.
   */
  collisions: ExternalMetadataCollision[];
  /** Field-joined entries this document matched, one per manifest at most. */
  joins: ExternalMetadataJoin[];
  /**
   * Where a merged pointer's value lives. Answers only for a value the
   * manifest supplied — a bare key or its `/key` pointer, and anything
   * beneath it — and `undefined` for everything the document owns, which is
   * what `lineFor` is for.
   */
  locate: (pointer: string) => SourceLocation | undefined;
}

const posix = (p: string): string => p.split(sep).join("/");

/** How a run spells a manifest: relative to its base, like every file label. */
function reportedPath(abs: string, base: string): string {
  const rel = relative(base, abs);
  return rel === "" ? "." : posix(rel);
}

/** The join an external-metadata config asks for: `path` unless it names a field. */
export function externalMetadataJoin(
  manifest: Pick<ExternalMetadataConfig, "join">,
): string {
  return manifest.join ?? PATH_JOIN;
}

/**
 * Load every manifest of every collection the run covers. Resolves to `null`
 * when none of them declares one, which is every setup that existed before
 * this feature.
 *
 * Every refusal is a `DocmetaError`: the manifest is a config-supplied input,
 * and one that is missing or misshapen is the run's problem, not a
 * document's (0014).
 */
export async function loadExternalMetadata(
  collections: readonly CollectionConfig[],
  opts: LoadExternalMetadataOptions,
): Promise<ExternalMetadataIndex | null> {
  const configured = collections.flatMap((c) =>
    c.externalMetadata.map((m) => ({ collection: c.name, manifest: m })),
  );
  if (configured.length === 0) return null;

  const owners = new Map<string, { collection: string; file: string }[]>();
  const byPath = new Map<string, Values>();
  const byField = new Map<string, Map<string, Values>>();
  const entries: ExternalMetadataEntry[] = [];

  for (const { collection, manifest } of configured) {
    // A URL manifest (0038) is reported as the URL itself, and fetched every
    // run: it is data, and a stale copy would validate against the wrong
    // values. A path is reported relative to the run's base, like every
    // file label. Either way the manifest's *keys* resolve from the config
    // directory, so a remote manifest names documents the same way a local
    // one does.
    let text: string;
    let file: string;
    if (classifyRef(manifest.file).kind === "url") {
      file = manifest.file;
      text = await fetchExternalMetadata(manifest.file, {
        ...(manifest.tokenEnv !== undefined ? { tokenEnv: manifest.tokenEnv } : {}),
        ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.env !== undefined ? { env: opts.env } : {}),
      });
    } else {
      const abs = isAbsolute(manifest.file)
        ? manifest.file
        : resolve(opts.configDir, manifest.file);
      file = reportedPath(abs, opts.base);
      text = await readManifest(abs, file);
    }
    for (const key of manifest.keys) {
      const list = owners.get(key);
      if (list) list.push({ collection, file });
      else owners.set(key, [{ collection, file }]);
    }
    const join = externalMetadataJoin(manifest);
    let target: Map<string, Values>;
    if (join === PATH_JOIN) {
      target = byPath;
    } else {
      const existing = byField.get(join);
      if (existing) target = existing;
      else {
        target = new Map<string, Values>();
        byField.set(join, target);
      }
    }
    parseManifest(
      manifest,
      collection,
      text,
      file,
      opts.configDir,
      join,
      target,
      entries,
    );
  }
  return { owners, byPath, byField, entries };
}

async function readManifest(abs: string, file: string): Promise<string> {
  try {
    return await readFile(abs, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new DocmetaError(
      `Manifest ${file} could not be read: ${reason}`,
    );
  }
}

function parseManifest(
  manifest: ExternalMetadataConfig,
  collection: string,
  text: string,
  file: string,
  configDir: string,
  join: string,
  target: Map<string, Values>,
  entries: ExternalMetadataEntry[],
): void {
  const lc = new LineCounter();
  // `uniqueKeys: false`, so a document named twice reaches the dedicated
  // check below and is reported by name and line, rather than as a generic
  // "map keys must be unique" parse error.
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  const problem = doc.errors[0];
  if (problem) {
    throw new DocmetaError(
      `Manifest ${file} is not valid YAML: ${problem.message}`,
    );
  }
  const root = doc.contents;
  // An empty manifest is a mapping with no entries: legal, and merges nothing.
  if (root === null || (isScalar(root) && root.value === null)) return;
  if (!isMap(root)) {
    throw new DocmetaError(
      `Manifest ${file}: the manifest must be a mapping from document ${join === PATH_JOIN ? "path" : `"${join}"`} to owned keys.`,
    );
  }
  const owned = new Set(manifest.keys);
  const lineAt = (node: unknown): number | undefined => {
    const range = isNode(node) ? node.range : undefined;
    return range ? lc.linePos(range[0]).line : undefined;
  };

  // A document named twice would otherwise resolve last-wins per key, with
  // both entries counted and no diagnostic: `yaml` files a duplicate mapping
  // key under `doc.warnings`, not `doc.errors`. It is almost always a typo,
  // and it is refused by name rather than merged.
  const seen = new Map<string, number | undefined>();
  for (const pair of root.items) {
    const spelled = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const entryLine = lineAt(pair.key);
    const where = entryLine === undefined ? file : `${file}:${entryLine}`;
    if (seen.has(spelled)) {
      const first = seen.get(spelled);
      throw new DocmetaError(
        `Manifest ${where}: "${spelled}" is named twice (first at line ${first ?? "?"}). Merge the two entries into one.`,
      );
    }
    seen.set(spelled, entryLine);
    if (!isMap(pair.value)) {
      throw new DocmetaError(
        `Manifest ${where}: "${spelled}" must be a mapping of owned keys to values.`,
      );
    }
    // A path entry is indexed by its absolute path; a field entry by the
    // spelled value, which a document's field is compared to as a string.
    const indexKey = join === PATH_JOIN ? resolve(configDir, spelled) : spelled;
    const values = target.get(indexKey) ?? new Map<string, ExternalMetadataValue>();
    for (const kv of pair.value.items) {
      const key = isScalar(kv.key) ? String(kv.key.value) : String(kv.key);
      if (key === FILE_SCHEMA_KEY) {
        throw new DocmetaError(
          `Manifest ${where}: "${spelled}" sets "${FILE_SCHEMA_KEY}" — a manifest never chooses the schema a document is judged by; use "overrides" in the config.`,
        );
      }
      if (!owned.has(key)) {
        throw new DocmetaError(
          `Manifest ${where}: "${spelled}" sets "${key}", which this manifest does not own. Add it to the manifest's "keys", or remove it from the entry.`,
        );
      }
      const value: unknown =
        kv.value === null
          ? null
          : (kv.value as Node).toJS(doc, { maxAliasCount: 100 });
      const line = lineAt(kv.key);
      values.set(key, {
        value,
        collection,
        file,
        ...(line === undefined ? {} : { line }),
      });
    }
    target.set(indexKey, values);
    entries.push({
      collection,
      join,
      ...(join === PATH_JOIN ? { abs: indexKey } : {}),
      spelled,
      file,
      ...(entryLine === undefined ? {} : { line: entryLine }),
    });
  }
}

/** The string a document's join field compares as; undefined when it cannot. */
function joinValue(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "bigint") return String(raw);
  if (typeof raw === "boolean") return String(raw);
  return undefined;
}

/**
 * Merge the external metadata for one document into its extracted metadata.
 *
 * `label` is the document as the run spells it, relative to `base`; a path
 * entry matches on the resolved absolute path, never on the spelling, so a
 * positional run from a subdirectory finds the same entry a config-corpus
 * run does. A field entry matches on the document's own value of the join
 * field, wherever the document lives. Stdin never matches a path entry:
 * there is no file behind it.
 *
 * `memberOf` names the collections this document belongs to, and only their
 * manifests are consulted (0041 rule 4). It is the caller's `memberOf(...)`
 * result, computed once per file.
 *
 * `present`, `format` and the document's own positions are untouched. A
 * manifest key is not in the document, so `lineFor` keeps answering
 * `undefined` for it, and `locate` answers instead.
 */
export function mergeExternalMetadata(
  label: string,
  extracted: ExtractedMetadata,
  index: ExternalMetadataIndex | null,
  memberOf: readonly string[],
  base: string,
): MergedMetadata {
  const none = (): undefined => undefined;
  // A file that belongs to no collection gets nothing merged, and carries no
  // collision either: a key only counts as owned by a manifest that applies to
  // this file (0041 rule 4). A positional `README.md` is the case.
  if (!index || memberOf.length === 0) {
    return { extracted, collisions: [], joins: [], locate: none };
  }
  const mine = (collection: string): boolean => memberOf.includes(collection);

  const collisions: ExternalMetadataCollision[] = [];
  for (const key of Object.keys(extracted.data)) {
    for (const owner of index.owners.get(key) ?? []) {
      if (mine(owner.collection)) {
        collisions.push({ key, file: owner.file, collection: owner.collection });
      }
    }
  }

  const sources: ReadonlyMap<string, ExternalMetadataValue>[] = [];
  const joins: ExternalMetadataJoin[] = [];
  if (label !== STDIN_LABEL) {
    const byPath = index.byPath.get(resolve(base, label));
    if (byPath) sources.push(byPath);
  }
  for (const [field, byValue] of index.byField) {
    const value = joinValue(extracted.data[field]);
    if (value === undefined) continue;
    const hit = byValue.get(value);
    if (!hit) continue;
    sources.push(hit);
    // Exactly one join per (field, value), whatever the collections behind it.
    // The duplicate-join finding (0039) counts *documents* per value, so a
    // second entry for one document would read as a second document.
    const first = [...hit.values()].find((sv) => mine(sv.collection));
    if (first) {
      joins.push({ field, value, file: first.file, collection: first.collection });
    }
  }

  // Two of this file's collections owning one key the manifests actually
  // supply for it is an operational error, not a finding: there is nothing
  // about the document to fix, and picking a winner would be the tiebreak
  // 0020 and 0037 both refuse (0041 rule 5). The legitimate case — two
  // collections each owning `owner`, with no file in both — is untouched,
  // which is why this is decided per file rather than at parse time.
  for (const supplied of sources) {
    for (const key of supplied.keys()) {
      const owners = (index.owners.get(key) ?? []).filter((o) =>
        mine(o.collection),
      );
      const [a, b] = owners;
      if (a && b) {
        throw new DocmetaError(
          `${label}: "${key}" is owned by manifests in two of its collections, ${a.collection} (${a.file}) and ${b.collection} (${b.file}); a key has one manifest per file. Narrow one collection's paths or exclude.`,
        );
      }
    }
  }

  if (sources.length === 0) {
    return { extracted, collisions, joins, locate: none };
  }

  const data: Record<string, unknown> = { ...extracted.data };
  const merged = new Map<string, ExternalMetadataValue>();
  for (const supplied of sources) {
    for (const [key, sv] of supplied) {
      // Only the manifests of collections this file belongs to.
      if (!mine(sv.collection)) continue;
      // The document's value stays: the collision is filed by the caller,
      // and the report should show what the public site would publish.
      if (key in extracted.data) continue;
      data[key] = sv.value;
      merged.set(key, sv);
    }
  }
  const locate = (pointer: string): SourceLocation | undefined => {
    const top = topLevelKey(pointer);
    if (top === undefined) return undefined;
    const sv = merged.get(top);
    if (!sv) return undefined;
    return { file: sv.file, ...(sv.line === undefined ? {} : { line: sv.line }) };
  };
  return { extracted: { ...extracted, data }, collisions, joins, locate };
}

/** The top-level key a pointer (or bare key) addresses; undefined for the root. */
function topLevelKey(pointer: string): string | undefined {
  if (pointer === "") return undefined;
  if (!pointer.startsWith("/")) return pointer;
  const seg = pointer.slice(1).split("/")[0] ?? "";
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** The `/key` pointer for an external-metadata finding, RFC 6901 escaped. */
export function externalMetadataPointer(key: string): string {
  return `/${escapePointerSegment(key)}`;
}

/**
 * Path entries naming no loaded document.
 *
 * `loaded` are the run's file labels, relative to `base`. Checked only when
 * the run is the config corpus (the same invariant corpus checks use): a
 * positional path means the operator chose to look at part of the corpus,
 * and an entry for the rest is expected, not orphaned.
 */
export function orphanEntries(
  index: ExternalMetadataIndex | null,
  loaded: readonly string[],
  base: string,
  collections?: readonly string[],
): ExternalMetadataEntry[] {
  if (!index) return [];
  const have = new Set(loaded.map((l) => resolve(base, l)));
  return index.entries.filter(
    (e) =>
      inCollections(e, collections) &&
      e.join === PATH_JOIN &&
      e.abs !== undefined &&
      !have.has(e.abs),
  );
}

/**
 * Is this entry's collection one the run covers whole?
 *
 * `undefined` means every collection, which is a run with no `--collection`.
 * Naming collections makes each named one its own corpus (proposal 0041 rule
 * 6): the run loaded all of it, so an entry of that collection pointing at a
 * document that is not there is as orphaned as it would be in a full run. An
 * entry belonging to a collection nobody selected is not — the run never
 * claimed to cover it.
 */
function inCollections(
  entry: ExternalMetadataEntry,
  collections: readonly string[] | undefined,
): boolean {
  return collections === undefined || collections.includes(entry.collection);
}

/**
 * Field entries no loaded document matched (0039). `matched` is field -> the
 * values documents in the run carried, which the caller collects from each
 * document's `joins` — so this runs after the per-file loop, under the same
 * corpus invariant as `orphanEntries`.
 */
export function orphanJoins(
  index: ExternalMetadataIndex | null,
  matched: ReadonlyMap<string, ReadonlySet<string>>,
  collections?: readonly string[],
): ExternalMetadataEntry[] {
  if (!index) return [];
  return index.entries.filter(
    (e) =>
      inCollections(e, collections) &&
      e.join !== PATH_JOIN &&
      !(matched.get(e.join)?.has(e.spelled) ?? false),
  );
}

/** The operational error an orphan check raises, naming the first entry. */
export function orphanError(orphans: readonly ExternalMetadataEntry[]): DocmetaError {
  const first = orphans[0];
  if (!first) throw new Error("orphanError called with no orphans");
  const where = first.line === undefined ? first.file : `${first.file}:${first.line}`;
  const more = orphans.length > 1 ? ` (${orphans.length - 1} more)` : "";
  const what =
    first.join === PATH_JOIN
      ? `names "${first.spelled}", which this run did not load`
      : `names ${first.join} "${first.spelled}", which no loaded document carries`;
  return new DocmetaError(
    `Manifest ${where} ${what}${more}. Fix the entry, or remove it.`,
  );
}
