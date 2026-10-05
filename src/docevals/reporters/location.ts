/**
 * Where a result points when nothing in the page does: the entry that
 * declares its eval (`EvalResult.location`). A finding with a content line
 * keeps its own file and line; everything else about an eval lands here.
 */
import type { EvalResult } from "../types.js";

/** A file, and the 1-based line in it when one is known. */
export type Location = NonNullable<EvalResult["location"]>;

/**
 * The declaring entry of a result. The engine stamps one on every result; a
 * result built elsewhere without one names its page.
 */
export function declaringEntry(r: EvalResult): Location {
  return r.location ?? { file: r.file };
}

/** `<file>:<line>`, or the file alone when no line declares the eval. */
export function locationLabel(location: Location): string {
  return location.line === undefined
    ? location.file
    : `${location.file}:${String(location.line)}`;
}
