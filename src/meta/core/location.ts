/**
 * `x-manni-location` (proposal 0047): where a schema would like a top-level
 * key's value stored, on the page or in external metadata.
 *
 * The keyword is registered on every Ajv meta builds (validator.ts), next to
 * `x-manni-encrypt`, and like it records where it was evaluated. Ajv's own
 * resolution is the walker, so a mark counts through `$ref`, `allOf` and a
 * referenced built-in, and inside the `anyOf`, `oneOf` and `if`/`then`
 * branches Ajv takes. Only top-level properties carry a preference; a nested
 * mark is accepted and ignored. `Validator.locationPreferences` is the one
 * question commands ask of it.
 */

/** The schema keyword. */
export const LOCATION_KEYWORD = "x-manni-location";

/** Where a top-level key prefers to live. */
export type FieldLocation = "page" | "external";

/** A key's preferred location, and the schema ref whose mark decided it. */
export interface LocationPreference {
  location: FieldLocation;
  /** The ref, as given to `locationPreferences`, whose mark won. */
  schema: string;
}

/**
 * validate's two findings about a misplaced value, both warnings. Builtin-shaped
 * refs like `external:owned`, so the rule ids are `location:external/location`
 * and `location:page/location`.
 */
export const LOCATION_EXTERNAL_SCHEMA = "location:external";
export const LOCATION_PAGE_SCHEMA = "location:page";
/** The `keyword` both findings carry. */
export const LOCATION_FINDING_KEYWORD = "location";

export function isFieldLocation(value: unknown): value is FieldLocation {
  return value === "page" || value === "external";
}
