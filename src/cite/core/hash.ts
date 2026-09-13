/**
 * The hashing rule, as cite uses it. The engine is `src/shared/pin.ts`, shared
 * with meta; this module keeps cite's import path and its error contract: a
 * range past the end of the text throws `CiteError`.
 */
import {
  hashRange as sharedHashRange,
  sliceLines as sharedSliceLines,
  type LineRange,
} from "../../shared/pin.js";
import { asCiteError } from "../errors.js";

export { hashLines, isKeyedPin, normalizeText, splitLines } from "../../shared/pin.js";

/**
 * The cited lines joined by LF. Throws `CiteError` when the range runs past
 * the end of the text (`<path> has N lines; line M is out of range`).
 */
export function sliceLines(lines: readonly string[], range?: LineRange, label?: string): string {
  return asCiteError(() => sharedSliceLines(lines, range, label));
}

/** The pin of the cited lines: plain, or the keyed pin under `key` when one is given. Throws `CiteError` past the end. */
export function hashRange(text: string, range?: LineRange, key?: string): string {
  return asCiteError(() => sharedHashRange(text, range, key));
}
