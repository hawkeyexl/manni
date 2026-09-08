/**
 * Sidecar metadata (proposal 0037): a private manifest joined to public
 * documents.
 *
 * A sidecar is a YAML mapping from document path to a mapping of owned keys.
 * Its values are merged into each named document's extracted metadata before
 * schema resolution, so every command sees one object. The manifest itself
 * is never a document: it registers no extractor, appears in no `docs` row,
 * and is what 0031 called a join table rather than the standalone data file
 * it rejected.
 *
 * Three rules decide everything else here:
 *
 *  - **Keys are owned.** Each sidecar declares the top-level keys it supplies,
 *    ownership is disjoint across sidecars (asserted by the config parser), and
 *    a manifest entry supplying a key it does not own is an operational error.
 *    Ownership is what gives a write to an absent key somewhere to go, and it
 *    is what makes a document carrying a private key visible with or without
 *    a manifest entry.
 *  - **A document carrying an owned key is a collision, not a tiebreak.** 0020's
 *    rule across files: neither channel wins, because the discarded value is
 *    exactly the one nobody checked. The caller files the finding; the merge
 *    keeps the document's value so the report shows what the public site
 *    would publish.
 *  - **Manifest keys are exact paths, relative to the config's directory.** No
 *    globs and no cascade (0004 rejected partial merges of config for the
 *    reason that a silently merged result changes what the contract means).
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
import type { DocmetaConfig, SidecarConfig } from "./config.js";
import { FILE_SCHEMA_KEY } from "./resolve-schema.js";
import { classifyRef } from "./schema-registry.js";
import { fetchSidecar } from "./sidecar-fetch.js";
import { STDIN_LABEL } from "./load-files.js";
import { escapePointerSegment } from "../extractors/pointer.js";
import { DocmetaError, type ExtractedMetadata } from "../types.js";

/**
 * The `schema` ref a collision finding carries, and so its baseline and rule
 * identity: `sidecar:owned/sidecar`. Shaped like `check:<name>` so
 * `classifyRef` passes it through as a built-in id rather than resolving it
 * as a cwd-relative file path, and reserved in the registry for the same
 * reason `check` is.
 */
export const SIDECAR_OWNED_SCHEMA = "sidecar:owned";

/** The `keyword` a collision finding carries: no Ajv keyword produced it. */
export const SIDECAR_KEYWORD = "sidecar";

/** One value a sidecar supplied, and where it was written. */
export interface SidecarValue {
  value: unknown;
  /** Manifest path as the run reports it: relative to the run's base, posix. */
  file: string;
  /** 1-based line of the key in the manifest, when known. */
  line?: number;
}

/** One manifest entry, for the orphan check. */
export interface SidecarEntry {
  /** Absolute document path the entry names. */
  abs: string;
  /** The key exactly as written in the manifest. */
  spelled: string;
  /** Manifest path as the run reports it. */
  file: string;
  /** 1-based line of the entry in the manifest, when known. */
  line?: number;
}

/** Every sidecar of a run, loaded once and consulted per document. */
export interface SidecarIndex {
  /** Owned key -> manifest path as reported. */
  owners: ReadonlyMap<string, string>;
  /** Absolute document path -> owned key -> value. */
  byPath: ReadonlyMap<string, ReadonlyMap<string, SidecarValue>>;
  /** Every manifest entry, in manifest order. */
  entries: readonly SidecarEntry[];
}

export interface LoadSidecarsOptions {
  /** Directory `sidecars[].file` and every manifest key resolve from. */
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

/** A key the document carries that a sidecar owns. */
export interface SidecarCollision {
  key: string;
  /** The owning manifest, as the run reports it. */
  file: string;
}

/** What `mergeSidecars` hands back. */
export interface MergedMetadata {
  /** The document's metadata with every owned key the manifest supplied. */
  extracted: ExtractedMetadata;
  /**
   * Owned keys the document itself also carried, in document order, each
   * with the manifest that owns it — so the finding names it without a
   * second lookup, and without a fallback for an index that is not there.
   */
  collisions: SidecarCollision[];
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

/**
 * Load every configured manifest. Resolves to `null` when the config declares
 * none, which is every setup that existed before this feature.
 *
 * Every refusal is a `DocmetaError`: the manifest is a config-supplied input,
 * and one that is missing or misshapen is the run's problem, not a
 * document's (0014).
 */
export async function loadSidecars(
  config: DocmetaConfig | null | undefined,
  opts: LoadSidecarsOptions,
): Promise<SidecarIndex | null> {
  const configured = config?.sidecars;
  if (!configured || configured.length === 0) return null;

  const owners = new Map<string, string>();
  const byPath = new Map<string, Map<string, SidecarValue>>();
  const entries: SidecarEntry[] = [];

  for (const sidecar of configured) {
    // A URL manifest (0038) is reported as the URL itself, and fetched every
    // run: it is data, and a stale copy would validate against the wrong
    // values. A path is reported relative to the run's base, like every
    // file label. Either way the manifest's *keys* resolve from the config
    // directory, so a remote manifest names documents the same way a local
    // one does.
    let text: string;
    let file: string;
    if (classifyRef(sidecar.file).kind === "url") {
      file = sidecar.file;
      text = await fetchSidecar(sidecar.file, {
        ...(sidecar.tokenEnv !== undefined ? { tokenEnv: sidecar.tokenEnv } : {}),
        ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.env !== undefined ? { env: opts.env } : {}),
      });
    } else {
      const abs = isAbsolute(sidecar.file)
        ? sidecar.file
        : resolve(opts.configDir, sidecar.file);
      file = reportedPath(abs, opts.base);
      text = await readManifest(abs, file);
    }
    for (const key of sidecar.keys) owners.set(key, file);
    parseManifest(sidecar, text, file, opts.configDir, byPath, entries);
  }
  return { owners, byPath, entries };
}

async function readManifest(abs: string, file: string): Promise<string> {
  try {
    return await readFile(abs, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new DocmetaError(
      `Sidecar manifest ${file} could not be read: ${reason}`,
    );
  }
}

function parseManifest(
  sidecar: SidecarConfig,
  text: string,
  file: string,
  configDir: string,
  byPath: Map<string, Map<string, SidecarValue>>,
  entries: SidecarEntry[],
): void {
  const lc = new LineCounter();
  // `uniqueKeys: false`, so a path named twice reaches the dedicated check
  // below and is reported by name and line, rather than as a generic
  // "map keys must be unique" parse error.
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  const problem = doc.errors[0];
  if (problem) {
    throw new DocmetaError(
      `Sidecar manifest ${file} is not valid YAML: ${problem.message}`,
    );
  }
  const root = doc.contents;
  // An empty manifest is a mapping with no entries: legal, and merges nothing.
  if (root === null || (isScalar(root) && root.value === null)) return;
  if (!isMap(root)) {
    throw new DocmetaError(
      `Sidecar manifest ${file}: the manifest must be a mapping from document path to owned keys.`,
    );
  }
  const owned = new Set(sidecar.keys);
  const lineAt = (node: unknown): number | undefined => {
    const range = isNode(node) ? node.range : undefined;
    return range ? lc.linePos(range[0]).line : undefined;
  };

  // A path named twice would otherwise resolve last-wins per key, with both
  // entries counted and no diagnostic: `yaml` files a duplicate mapping key
  // under `doc.warnings`, not `doc.errors`. It is almost always a typo, and
  // it is refused by name rather than merged.
  const seen = new Map<string, number | undefined>();
  for (const pair of root.items) {
    const spelled = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const entryLine = lineAt(pair.key);
    const where = entryLine === undefined ? file : `${file}:${entryLine}`;
    if (seen.has(spelled)) {
      const first = seen.get(spelled);
      throw new DocmetaError(
        `Sidecar manifest ${where}: "${spelled}" is named twice (first at line ${first ?? "?"}). Merge the two entries into one.`,
      );
    }
    seen.set(spelled, entryLine);
    if (!isMap(pair.value)) {
      throw new DocmetaError(
        `Sidecar manifest ${where}: "${spelled}" must be a mapping of owned keys to values.`,
      );
    }
    const docAbs = resolve(configDir, spelled);
    const values = byPath.get(docAbs) ?? new Map<string, SidecarValue>();
    for (const kv of pair.value.items) {
      const key = isScalar(kv.key) ? String(kv.key.value) : String(kv.key);
      if (key === FILE_SCHEMA_KEY) {
        throw new DocmetaError(
          `Sidecar manifest ${where}: "${spelled}" sets "${FILE_SCHEMA_KEY}" — a sidecar never chooses the schema a document is judged by; use "overrides" in the config.`,
        );
      }
      if (!owned.has(key)) {
        throw new DocmetaError(
          `Sidecar manifest ${where}: "${spelled}" sets "${key}", which this sidecar does not own. Add it to the sidecar's "keys", or remove it from the entry.`,
        );
      }
      const value: unknown =
        kv.value === null
          ? null
          : (kv.value as Node).toJS(doc, { maxAliasCount: 100 });
      const line = lineAt(kv.key);
      values.set(key, { value, file, ...(line === undefined ? {} : { line }) });
    }
    byPath.set(docAbs, values);
    entries.push({
      abs: docAbs,
      spelled,
      file,
      ...(entryLine === undefined ? {} : { line: entryLine }),
    });
  }
}

/**
 * Merge the sidecar values for one document into its extracted metadata.
 *
 * `label` is the document as the run spells it, relative to `base`; matching
 * is on the resolved absolute path, never on the spelling, so a positional
 * run from a subdirectory finds the same entry a config-corpus run does.
 * Stdin never has an entry: there is no file behind it.
 *
 * `present`, `format` and the document's own positions are untouched. A
 * sidecar key is not in the document, so `lineFor` keeps answering
 * `undefined` for it, and `locate` answers instead.
 */
export function mergeSidecars(
  label: string,
  extracted: ExtractedMetadata,
  index: SidecarIndex | null,
  base: string,
): MergedMetadata {
  const none = (): undefined => undefined;
  if (!index || label === STDIN_LABEL) {
    return { extracted, collisions: [], locate: none };
  }
  const collisions: SidecarCollision[] = [];
  for (const key of Object.keys(extracted.data)) {
    const file = index.owners.get(key);
    if (file !== undefined) collisions.push({ key, file });
  }
  const supplied = index.byPath.get(resolve(base, label));
  if (!supplied || supplied.size === 0) {
    return { extracted, collisions, locate: none };
  }

  const data: Record<string, unknown> = { ...extracted.data };
  const merged = new Map<string, SidecarValue>();
  for (const [key, sv] of supplied) {
    // The document's value stays: the collision is filed by the caller, and
    // the report should show what the public site would publish.
    if (key in extracted.data) continue;
    data[key] = sv.value;
    merged.set(key, sv);
  }
  const locate = (pointer: string): SourceLocation | undefined => {
    const top = topLevelKey(pointer);
    if (top === undefined) return undefined;
    const sv = merged.get(top);
    if (!sv) return undefined;
    return { file: sv.file, ...(sv.line === undefined ? {} : { line: sv.line }) };
  };
  return {
    extracted: { ...extracted, data },
    collisions,
    locate,
  };
}

/** The top-level key a pointer (or bare key) addresses; undefined for the root. */
function topLevelKey(pointer: string): string | undefined {
  if (pointer === "") return undefined;
  if (!pointer.startsWith("/")) return pointer;
  const seg = pointer.slice(1).split("/")[0] ?? "";
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** The `/key` pointer for a collision finding, RFC 6901 escaped. */
export function sidecarPointer(key: string): string {
  return `/${escapePointerSegment(key)}`;
}

/**
 * Manifest entries naming no loaded document.
 *
 * `loaded` are the run's file labels, relative to `base`. Checked only when
 * the run is the config corpus (the same invariant corpus checks use): a
 * positional path means the operator chose to look at part of the corpus,
 * and an entry for the rest is expected, not orphaned.
 */
export function orphanEntries(
  index: SidecarIndex | null,
  loaded: readonly string[],
  base: string,
): SidecarEntry[] {
  if (!index) return [];
  const have = new Set(loaded.map((l) => resolve(base, l)));
  return index.entries.filter((e) => !have.has(e.abs));
}

/** The operational error an orphan check raises, naming the first entry. */
export function orphanError(orphans: readonly SidecarEntry[]): DocmetaError {
  const first = orphans[0];
  if (!first) throw new Error("orphanError called with no orphans");
  const where = first.line === undefined ? first.file : `${first.file}:${first.line}`;
  const more = orphans.length > 1 ? ` (${orphans.length - 1} more)` : "";
  return new DocmetaError(
    `Sidecar manifest ${where} names "${first.spelled}", which this run did not load${more}. Fix the entry, or remove it.`,
  );
}
