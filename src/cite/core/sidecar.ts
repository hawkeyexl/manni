/**
 * Citations kept outside the page, in an external-metadata manifest a
 * collection declares (proposal 0037, and 0044's "the sidecar is external
 * metadata"). No `cite:` key turns this on: a collection whose
 * `externalMetadata:` owns `citations` keeps its pages' entries there.
 *
 * Reading is meta's merge, not a second loader. `loadCitationSidecars` loads
 * every manifest that owns `citations`, and `forPage` merges one page through
 * `mergeExternalMetadata`, so the join rules, the ownership rules and the
 * per-item lines are the ones `meta validate` already applies.
 *
 * Three things are cite's own, because cite *writes* manifests where meta
 * only reads them:
 *
 *  - **Membership is decided by every declared collection**, not by the ones
 *    `--collection` or the positional paths selected. A page named by path is
 *    still a member of the collection that contains it, and its citations are
 *    still in that collection's manifest; a run that read frontmatter instead
 *    would report every entry as missing and then write a second copy.
 *  - **A URL manifest may not own `citations`** (exit 2). cite writes them,
 *    and a URL is not somewhere to write; it would also put a private
 *    `source.file` in public CI output.
 *  - **A page whose collections own `citations` twice is refused** (exit 2),
 *    even before either manifest has an entry for it: a writer has to know
 *    which file to write to, and picking one would be the tiebreak 0020
 *    refuses.
 *
 * `--no-config` never reaches here: with no config there are no collections,
 * so a page's citations are its frontmatter's.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  classifyRef,
  externalMetadataJoin,
  loadExternalMetadata,
  memberOf,
  mergeExternalMetadata,
  orphanEntries,
  orphanError,
  orphanJoins,
  PATH_JOIN,
  type CollectionConfig,
  type ExternalMetadataConfig,
  type ExternalMetadataEntry,
  type ExternalMetadataIndex,
  type ExternalMetadataJoin,
  type ExtractedMetadata,
} from "../../meta/index.js";
import { CiteError } from "../errors.js";
import type { CitationInput, CiteRun } from "../types.js";
import { pickExtractor } from "./page.js";

/** The one key cite keeps in a manifest. */
export const CITATIONS_KEY = "citations";

const toPosix = (path: string): string => path.split(sep).join("/");

/** How a run spells a manifest: relative to its base, posix, like every file label. */
function reportedPath(abs: string, base: string): string {
  const rel = relative(base, abs);
  return rel === "" ? "." : toPosix(rel);
}

/** A manifest that owns `citations` for one collection. */
export interface CitationManifest {
  /** The collection that declares it. */
  collection: string;
  /** Absolute path of the manifest file. */
  path: string;
  /** The manifest as the run reports it. */
  file: string;
  /** `path`, or the page field the manifest joins on. */
  join: string;
}

/** Where one page's citations are kept, and what the manifest already holds. */
export interface PageSidecar {
  /** The manifest that owns this page's citations, when one does. */
  owner?: CitationManifest;
  /**
   * The key under which this page is written in the manifest: its path
   * relative to the config directory, or its value of the join field.
   * Undefined when the manifest joins on a field the page does not carry, so
   * a writer refuses rather than inventing a key.
   */
  entry?: string;
  /** The manifest's entries for this page, when it supplies any. */
  citations?: CitationInput[];
  /** Field-joined entries this page matched, for the duplicate-join check. */
  joins: readonly ExternalMetadataJoin[];
}

export interface CitationSidecars {
  /** The manifests that own `citations`, by collection. */
  manifests: readonly CitationManifest[];
  /** Directory manifest paths and manifest keys resolve from. */
  configDir: string;
  /** Directory the run's file labels are relative to. */
  base: string;
  forPage(label: string, content: string, format?: string): PageSidecar;
  /**
   * Manifest entries naming a page this run did not load, under meta's own
   * corpus invariant. `covered` names the collections a `--collection` run
   * narrowed to, or `undefined` for a whole-corpus run.
   */
  orphans(loaded: readonly string[], covered?: readonly string[]): ExternalMetadataEntry[];
  /** Field entries no loaded page matched, same invariant. */
  orphanJoins(
    matched: ReadonlyMap<string, ReadonlySet<string>>,
    covered?: readonly string[],
  ): ExternalMetadataEntry[];
}

export interface LoadSidecarOptions {
  /** Every collection the config declares, not only the ones the run selected. */
  collections: readonly CollectionConfig[];
  /** The config file's directory. */
  configDir: string;
  /** Directory the run's file labels are relative to. */
  base: string;
  /** The config file as the user would name it, for the URL refusal. */
  configSource: string;
  /** The family encryption key, for a join field a page holds encrypted. */
  key?: string;
  /** The tool's error class; `CiteError` unless a sibling command says otherwise. */
  toError?: (message: string) => Error;
}

/** `collection <name>: citations cannot come from a URL manifest, because cite writes them.` */
export function urlManifestRefusal(source: string, collection: string): string {
  return `${source}: collection ${collection}: ${CITATIONS_KEY} cannot come from a URL manifest, because cite writes them.`;
}

/** `<page> is in collections a and b, and both keep citations in a manifest.` */
export function twoManifestsRefusal(label: string, a: string, b: string): string {
  return `${label} is in collections ${a} and ${b}, and both keep citations in a manifest.`;
}

/** Does any declared collection keep `citations` in a manifest? */
function ownsCitations(manifest: ExternalMetadataConfig): boolean {
  return manifest.keys.includes(CITATIONS_KEY);
}

/**
 * Load every manifest that owns `citations`, or `null` when none does — which
 * is every setup that keeps its citations in frontmatter, and costs nothing.
 *
 * Only the citations-owning manifests are loaded. A sibling manifest of the
 * same collection, supplying meta's own keys from a URL, is none of cite's
 * business and is never fetched here.
 */
export async function loadCitationSidecars(
  opts: LoadSidecarOptions,
): Promise<CitationSidecars | null> {
  const toError = opts.toError ?? ((message: string): Error => new CiteError(message));
  const manifests: CitationManifest[] = [];
  const scoped: CollectionConfig[] = [];
  for (const collection of opts.collections) {
    const owning = collection.externalMetadata.filter(ownsCitations);
    if (owning.length === 0) continue;
    for (const manifest of owning) {
      if (classifyRef(manifest.file).kind === "url") {
        throw toError(urlManifestRefusal(opts.configSource, collection.name));
      }
      const path = isAbsolute(manifest.file)
        ? manifest.file
        : resolve(opts.configDir, manifest.file);
      manifests.push({
        collection: collection.name,
        path,
        file: reportedPath(path, opts.base),
        join: externalMetadataJoin(manifest),
      });
    }
    scoped.push({ ...collection, externalMetadata: owning });
  }
  if (manifests.length === 0) return null;

  const index = await loadExternalMetadata(scoped, {
    configDir: opts.configDir,
    base: opts.base,
  });
  if (index === null) return null;
  return sidecars(index, manifests, scoped, opts);
}

function sidecars(
  index: ExternalMetadataIndex,
  manifests: readonly CitationManifest[],
  collections: readonly CollectionConfig[],
  opts: LoadSidecarOptions,
): CitationSidecars {
  const toError = opts.toError ?? ((message: string): Error => new CiteError(message));
  const { configDir, base } = opts;

  const forPage = (label: string, content: string, format?: string): PageSidecar => {
    const members = memberOf(collections, configDir, base, label);
    if (members.length === 0) return { joins: [] };

    // The owning manifest is the page's, decided before anything is read:
    // two of them is a refusal even when only one has an entry today.
    const mine = manifests.filter((m) => members.includes(m.collection));
    const [owner, second] = mine;
    if (owner === undefined) return { joins: [] };
    if (second !== undefined) {
      throw toError(twoManifestsRefusal(label, owner.collection, second.collection));
    }

    const extractor = pickExtractor(label, format);
    const extracted: ExtractedMetadata = extractor.extract(content, label);
    const merged = mergeExternalMetadata(label, extracted, index, members, base, {
      encryptionKey: () => opts.key,
    });

    const out: PageSidecar = { owner, joins: merged.joins };
    if (owner.join === PATH_JOIN) {
      out.entry = toPosix(relative(configDir, resolve(base, label)));
    } else {
      const value = merged.joins.find((j) => j.field === owner.join)?.value;
      // No match: the page's own value of the join field still keys it, so a
      // first `add` can write an entry a later run will match.
      const raw = value ?? extracted.data[owner.join];
      if (typeof raw === "string" && raw !== "") out.entry = raw;
      else if (typeof raw === "number" || typeof raw === "boolean") out.entry = String(raw);
    }

    // The manifest supplied the key exactly when `locate` answers for it;
    // a page carrying its own `citations:` keeps them (the collision is a
    // finding, not a tiebreak), and `locate` then answers `undefined`.
    const where = merged.locate(`/${CITATIONS_KEY}`);
    if (where !== undefined) {
      const supplied: unknown = merged.extracted.data[CITATIONS_KEY];
      const list: unknown[] = Array.isArray(supplied) ? (supplied as unknown[]) : [supplied];
      out.citations = list.map((entry, i) => {
        const at = merged.locate(`/${CITATIONS_KEY}/${String(i)}`);
        const line = (Array.isArray(supplied) ? at?.line : undefined) ?? where.line;
        return {
          entry,
          origin: {
            kind: "manifest" as const,
            file: where.file,
            ...(line === undefined ? {} : { line }),
          },
        };
      });
    }
    return out;
  };

  return {
    manifests,
    configDir,
    base,
    forPage,
    orphans: (loaded, covered) => orphanEntries(index, loaded, base, covered),
    orphanJoins: (matched, covered) => orphanJoins(index, matched, covered),
  };
}

/** The refusal a whole-corpus run raises for a manifest entry naming nothing. */
export function orphanRefusal(
  orphans: readonly ExternalMetadataEntry[],
  toError: (message: string) => Error = (m) => new CiteError(m),
): Error {
  return toError(orphanError(orphans).message);
}

/**
 * Two pages carrying one `join:` value: the manifest cannot tell them apart,
 * and cite would write one page's entry over the other's. Meta files this as
 * a finding on each document; here it is the run's problem, because the run
 * writes.
 */
export function duplicateJoinRefusal(
  field: string,
  value: string,
  file: string,
  labels: readonly string[],
): string {
  return `${String(labels.length)} pages carry ${field} "${value}"; ${file} cannot tell them apart (${labels.join(", ")}).`;
}

/**
 * Load the sidecars a resolved run governs; `null` with no config, or no
 * citations manifest. `base` overrides the run's when a command labels its
 * pages from somewhere else — `add` takes one page from the command line and
 * labels it from the working directory, whatever the collections would.
 */
export function sidecarsFor(
  run: CiteRun,
  over: { base?: string; toError?: (message: string) => Error } = {},
): Promise<CitationSidecars | null> {
  const declared = run.configFile?.collections ?? [];
  if (run.configDir === undefined || declared.length === 0) return Promise.resolve(null);
  return loadCitationSidecars({
    // Every declared collection, whatever `--collection` or the paths chose.
    collections: declared,
    configDir: run.configDir,
    base: over.base ?? run.base,
    configSource: run.configSource ?? run.configPath ?? "the config",
    ...(run.key === undefined ? {} : { key: run.key }),
    ...(over.toError === undefined ? {} : { toError: over.toError }),
  });
}
