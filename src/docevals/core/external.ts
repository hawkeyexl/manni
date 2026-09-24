/**
 * A page's metadata as `manni meta validate` reads it: its frontmatter, plus
 * every key an external-metadata manifest of one of its collections owns
 * (proposal 0041).
 *
 * The evals vocabulary marks `evals`, `eval-suite` and `eval-skip`
 * `x-manni-location: external` from `1.0.0-proposal.4`, ai-context marks
 * `provenance` and `meta-provenance`, and stewardship marks `last-reviewed`.
 * A corpus that took `manni meta relocate` up on that keeps those values in a
 * manifest, and a tool that read frontmatter alone would report every page as
 * declaring nothing.
 *
 * Reading is meta's merge, not a second loader, exactly as `cite`'s sidecars
 * are. `loadExternalMetadata` reads each manifest once per run, behind the
 * shared per-process parse cache, and `mergeExternalMetadata` decides per page
 * what a manifest supplies. So the join rules, the ownership rules and the
 * per-item lines are the ones `meta validate` already applies, and the merged
 * result is handed back as the page's own `frontmatter`: every reader
 * downstream — resolution, the freshness grader, the self-preference check,
 * `target: frontmatter` — sees the values where their location puts them,
 * without knowing a manifest exists.
 *
 * Two things are docevals' own, because docevals *writes* eval keys where
 * meta only reads them:
 *
 *  - **Membership is decided by every declared collection**, not by the ones
 *    `--collection` or the positional paths selected. A page named by path is
 *    still a member of the collection that contains it, and its evals are
 *    still in that collection's manifest.
 *  - **A URL manifest may not own an eval key** (exit 2), and neither may two
 *    of one page's collections. Both are refusals rather than tiebreaks, for
 *    the reason 0020 gives: there is no right answer to pick.
 *
 * `--no-config` never reaches here: with no config there are no collections,
 * so a page's evals are its frontmatter's.
 */
import {
  classifyRef,
  loadExternalMetadata,
  memberOf,
  mergeExternalMetadata,
  type CollectionConfig,
  type ExternalMetadataCollision,
  type ExternalMetadataConfig,
  type ExternalMetadataIndex,
  type SourceLocation,
} from "../../meta/index.js";
import { DocevalsError } from "../types.js";
import type { DocevalsConfig } from "./config.js";
import type { PageFile } from "./discover.js";

/**
 * The three page keys the evals vocabulary claims, and the only ones these
 * refusals govern. A manifest owning `last-reviewed` or `provenance` is
 * nobody's problem here: docevals reads those and writes neither.
 */
export const EVAL_KEYS = ["evals", "eval-suite", "eval-skip"] as const;

/**
 * Every key docevals reads that a manifest may own, and so the only manifests
 * this tool loads: the evals vocabulary's three, ai-context's machine
 * attribution (proposal 0046), and stewardship's review date, which is the
 * freshness grader's default field.
 *
 * A manifest owning none of them is a sibling tool's business. Loading it
 * anyway would make a corpus fail on a manifest docevals has no use for, and
 * would fetch a URL manifest on every run to read nothing out of it. `cite`
 * scopes its own load the same way, to its one key.
 */
export const EXTERNAL_KEYS: readonly string[] = [
  ...EVAL_KEYS,
  "provenance",
  "meta-provenance",
  "last-reviewed",
];

/** Where a value a manifest supplied lives, and what the page duplicates. */
export interface PageExternal {
  /**
   * The manifest file and line behind a merged JSON Pointer, or `undefined`
   * for everything the page itself carries — which is what `lineFor` answers.
   */
  locate: (pointer: string) => SourceLocation | undefined;
  /** Eval keys the page carries that an owning manifest also holds. */
  collisions: readonly ExternalMetadataCollision[];
}

/** `manni.config.yaml: collection site: evals cannot come from a URL manifest, because docevals writes them.` */
export function urlManifestRefusal(
  source: string,
  collection: string,
  key: string,
): string {
  return `${source}: collection ${collection}: ${key} cannot come from a URL manifest, because docevals writes them.`;
}

/** `docs/install.md is in collections site and guides, and both keep evals in a manifest.` */
export function twoManifestsRefusal(
  label: string,
  a: string,
  b: string,
  key: string,
): string {
  return `${label} is in collections ${a} and ${b}, and both keep ${key} in a manifest.`;
}

/** The eval keys one manifest declaration owns, in vocabulary order. */
function evalKeysOf(manifest: ExternalMetadataConfig): string[] {
  return EVAL_KEYS.filter((k) => manifest.keys.includes(k));
}

/** The pages of a run, with every manifest-supplied key merged into each. */
export interface ExternalMetadataReader {
  /** The page as its metadata reads once the manifests are applied. */
  forPage(page: PageFile): PageFile;
}

/**
 * Load every manifest of every declared collection, or `null` when the run has
 * no config, no collections, or none of them declares a manifest — which is
 * every corpus that keeps its metadata in its pages, and costs nothing.
 *
 * The URL refusal is decided from the config alone, before a byte is fetched.
 *
 * `pages` are the run's documents as absolute paths. A collection that keeps
 * its evals in one manifest per page (proposal 0058) has one file to read per
 * page, and meta reads those only for the pages it is given.
 */
export async function loadExternalReader(
  config: DocevalsConfig,
  base: string,
  pages?: readonly string[],
): Promise<ExternalMetadataReader | null> {
  const collections: CollectionConfig[] = [];
  const source = config.configSource ?? config.configPath;
  for (const collection of config.collections) {
    const owning = collection.externalMetadata.filter((m) =>
      m.keys.some((k) => EXTERNAL_KEYS.includes(k)),
    );
    if (owning.length === 0) continue;
    for (const manifest of owning) {
      if (classifyRef(manifest.file).kind !== "url") continue;
      const [owned] = evalKeysOf(manifest);
      if (owned !== undefined) {
        throw new DocevalsError(
          urlManifestRefusal(source, collection.name, owned),
        );
      }
    }
    collections.push({ ...collection, externalMetadata: owning });
  }
  if (collections.length === 0) return null;

  const index = await loadExternalMetadata(collections, {
    configDir: config.configDir,
    base,
    // A `{page}` entry names one manifest per page (proposal 0058), so it
    // reads a file only for the pages it is handed. Without them it reads
    // nothing, and every value the corpus keeps beside its pages goes missing
    // while the ownership that hides the page's own copy stays.
    ...(pages === undefined ? {} : { pages }),
  });
  if (index === null) return null;
  return reader(index, collections, config.configDir, base);
}

/**
 * Which collections of `members` keep `key` in a manifest. Ownership, not
 * supply: a writer has to know which file to write to before either manifest
 * has an entry, so two owners is a refusal even while both are empty.
 */
function ownersOf(
  collections: readonly CollectionConfig[],
  members: readonly string[],
  key: string,
): string[] {
  return collections
    .filter(
      (c) =>
        members.includes(c.name) &&
        c.externalMetadata.some((m) => m.keys.includes(key)),
    )
    .map((c) => c.name);
}

function reader(
  index: ExternalMetadataIndex,
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
): ExternalMetadataReader {
  return {
    forPage(page: PageFile): PageFile {
      if (page.extractError !== undefined) return page;
      const members = memberOf(collections, configDir, base, page.file);
      if (members.length === 0) return page;

      for (const key of EVAL_KEYS) {
        const [a, b] = ownersOf(collections, members, key);
        if (a !== undefined && b !== undefined) {
          throw new DocevalsError(twoManifestsRefusal(page.file, a, b, key));
        }
      }

      const merged = mergeExternalMetadata(
        page.file,
        page.frontmatter,
        index,
        members,
        base,
      );
      return {
        ...page,
        frontmatter: merged.extracted,
        external: {
          locate: merged.locate,
          // Only the keys this tool reads and writes. A manifest owning a
          // sibling tool's key that the page also carries is `meta validate`'s
          // finding, and saying it twice would make the same fix look like two.
          collisions: merged.collisions.filter((c) =>
            (EVAL_KEYS as readonly string[]).includes(c.key),
          ),
        },
      };
    },
  };
}

/**
 * Every page of a run, read the way `meta validate` reads it. The manifests
 * are loaded once, whatever the corpus size, and a run with no manifest gets
 * its pages back untouched.
 *
 * `base` is the run's discovery root, so `page.file` and a manifest's reported
 * path are spelled against the same directory.
 */
export async function withExternalMetadata(
  pages: PageFile[],
  config: DocevalsConfig,
  base: string,
): Promise<PageFile[]> {
  const merge = await loadExternalReader(
    config,
    base,
    pages.map((p) => p.absPath),
  );
  if (merge === null) return pages;
  return pages.map((p) => merge.forPage(p));
}
