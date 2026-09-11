/**
 * Where a check starts from.
 *
 * A collection may declare `url:`, the site root its documents are published
 * at (proposal 0041, rule 12), which makes "check the guides" something a
 * person can mean. Four sources can therefore name a seed, and this module is
 * the one place that decides between them: first non-empty wins, in the order
 * positional URLs, the collections named by `--collection`, `a11y.urls`, then
 * every declared collection that has a `url`.
 *
 * `a11y.urls` keeps its place ahead of the collections because a site has
 * entry points no documentation collection covers, and because nothing that
 * ships today should have to move.
 *
 * It is separate from the CLI, and pure, because the interesting part is the
 * order and the three refusals, and neither is worth a spawned bin with a
 * browser behind it to test.
 */
import { selectCollections, type CollectionConfig } from "../../shared/collections.js";
import { A11yError } from "../types.js";

/**
 * Nothing to check. Also thrown by `runCheck` for a programmatic caller that
 * resolved its own seeds, which is why the text lives here and not there.
 */
export const NO_SEEDS_MESSAGE =
  "No URLs to check. Pass one or more, set url: on a collection, or set a11y.urls in manni.config.yaml.";

/** The family file's name, for a message about a config that was never found. */
const CONFIG_NAME = "manni.config.yaml";

export interface SeedSources {
  /** Positional `[urls...]`, as typed. Validated and normalized by `runCheck`. */
  urls: readonly string[];
  /** `--collection` names, one per occurrence. Empty means none were named. */
  collections: readonly string[];
  /** `a11y.urls`, when the key is set. An empty list counts as unset. */
  configUrls?: readonly string[];
  /** Every collection the family file declares, in declaration order. */
  declared: readonly CollectionConfig[];
  /**
   * The config file as the user would name it, for the unknown-name message.
   * `null` or absent (no file found) names the canonical family file, since
   * that is where the missing `collections:` would go.
   */
  source?: string | null;
}

/**
 * The seeds a run checks, or an `A11yError` explaining why there are none.
 *
 * 1. `urls` when non-empty.
 * 2. The `url` of each collection named by `collections`, in **declaration**
 *    order, repeats and shared urls collapsed. A named collection with no
 *    `url` is an error, and so is a name that is not declared.
 * 3. `configUrls` when non-empty, exactly as configured.
 * 4. The `url` of every declared collection that has one, in declaration
 *    order, shared urls collapsed. One without a `url` contributes nothing.
 *
 * Naming a url-less collection fails where leaving it out of the default set
 * does not: `--collection blog` asked for something specific and has to be
 * told it cannot be done, while a bare `manni a11y check` gets whatever is
 * publishable.
 */
export function resolveSeeds(sources: SeedSources): string[] {
  const { urls, collections: names, declared } = sources;

  if (names.length > 0) {
    // The shape of the invocation, before anything about the config: a run
    // that named both a collection and a URL has no reading to pick between.
    if (urls.length > 0) {
      throw new A11yError(
        "--collection selects a configured collection; it cannot be combined with URLs.",
      );
    }
    // No config at all — nothing was found, or `--no-config` refused it. The
    // flag selects from a config file, so say that rather than reporting the
    // name as unknown: "Configured: (none)." blames the name for the absence
    // of the file. `manni meta` refuses the same combination with the same
    // sentence, which is the parity CLAUDE.md asks for on a shared flag. A
    // real config always carries a source, so this cannot mistake a
    // programmatic caller that passed collections without one.
    if (sources.source == null && declared.length === 0) {
      throw new A11yError("--collection needs a config file to select from.");
    }
    const selected = selectCollections(
      declared,
      names,
      sources.source ?? CONFIG_NAME,
      (message) => new A11yError(message),
    );
    const seeds: string[] = [];
    for (const collection of selected) {
      if (collection.url === undefined) {
        throw new A11yError(`collection "${collection.name}" has no url: to check.`);
      }
      seeds.push(collection.url);
    }
    return unique(seeds);
  }

  if (urls.length > 0) return [...urls];

  const configUrls = sources.configUrls ?? [];
  if (configUrls.length > 0) return [...configUrls];

  const published = unique(
    declared.flatMap((collection) => (collection.url === undefined ? [] : [collection.url])),
  );
  if (published.length > 0) return published;

  throw new A11yError(NO_SEEDS_MESSAGE);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
