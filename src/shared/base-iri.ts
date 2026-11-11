/**
 * `baseIri:`, the family-level prefix of every node IRI (proposal 0128 §1).
 *
 * It sits at the top of `manni.config.yaml`, beside `collections:` and
 * `tools:`, because more than one domain mints ids from it and the join
 * between their outputs is the point. There is no per-domain override: a
 * second value would mint a second set of ids.
 *
 * The value is kept as written and normalized on use by `resolveBaseIri`.
 */

/** The top-level key. */
export const BASE_IRI_KEY = "baseIri";

/** Default base when the config sets none: valid, deterministic, obviously placeholder. */
export const DEFAULT_BASE_IRI = "urn:manni:graph:";

/** Normalize a base IRI: a base not ending in `/` or `:` gets a trailing slash. */
export function resolveBaseIri(base: string | undefined): string {
  if (!base) return DEFAULT_BASE_IRI;
  if (base.endsWith("/") || base.endsWith(":")) return base;
  return `${base}/`;
}

/**
 * Validate the top-level value, in the calling tool's error class. Returned as
 * written; `resolveBaseIri` normalizes it.
 */
export function parseBaseIri(
  raw: unknown,
  source: string,
  toError: (message: string) => Error,
): string {
  if (typeof raw !== "string" || raw === "") {
    throw toError(`${source}: "${BASE_IRI_KEY}" must be a non-empty string.`);
  }
  return raw;
}
