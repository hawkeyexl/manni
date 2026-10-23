/**
 * A claim that is a metadata value (proposal 0108). On a strategy record, a
 * claim's place can be a JSON Pointer into the page's own metadata, as
 * `meta get` reads one, and its pin is `valuePin` over the value.
 *
 * The classifier reads the metadata once, with `citations` left out, in four
 * steps. The value at the pointer holds the pin: `current`. The pin is found
 * at one other pointer: `moved`, or at several: `moved-ambiguous`. The
 * pointer names no value, or names the value another entry's pointer claim
 * pins, which is a deleted item whose neighbour shifted up: `missing`.
 * Anything else is `changed`.
 */
import type { ExtractedMetadata } from "../../meta/index.js";
import { descend, escapePointerSegment, parseJsonPointer } from "../../meta/internal.js";
import { canonicalValue, valuePin } from "../../shared/pin.js";
import type { ClaimEnd, PageCitation, PageCitations } from "../types.js";

/** An RFC 6901 pointer that names something below the root, with `~` escaped as `~0` or `~1`. */
const POINTER = /^(?:\/(?:[^~/]|~[01])*)+$/;

/** Whether a pointer is well formed and names something below the root. */
export function isPointer(pointer: string): boolean {
  return POINTER.test(pointer);
}

/** Whether a pointer names `citations` or anything under it, which is never a claim. */
export function underCitations(pointer: string): boolean {
  return pointer === "/citations" || pointer.startsWith("/citations/");
}

/** Whether `pointer` names a value in `data`, and which. */
export function valueAt(data: Record<string, unknown>, pointer: string): { value: unknown } | undefined {
  if (!isPointer(pointer) || underCitations(pointer)) return undefined;
  const segments = parseJsonPointer(pointer);
  const last = segments.at(-1);
  if (last === undefined) return undefined;
  const parent = segments.length === 1 ? data : descend(data, segments.slice(0, -1));
  if (Array.isArray(parent)) {
    return /^(?:0|[1-9][0-9]*)$/.test(last) && Number(last) < parent.length
      ? { value: parent[Number(last)] }
      : undefined;
  }
  if (typeof parent === "object" && parent !== null && Object.prototype.hasOwnProperty.call(parent, last)) {
    return { value: (parent as Record<string, unknown>)[last] };
  }
  return undefined;
}

/** Every value at every depth, in document order, as `[pointer, value]`, with `citations` left out. */
export function valuesOf(data: Record<string, unknown>): [string, unknown][] {
  const out: [string, unknown][] = [];
  const walk = (value: unknown, at: string): void => {
    if (at !== "") out.push([at, value]);
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        walk(item, `${at}/${String(i)}`);
      });
    } else if (typeof value === "object" && value !== null && !(value instanceof Date)) {
      for (const [key, item] of Object.entries(value)) {
        const child = `${at}/${escapePointerSegment(key)}`;
        if (!underCitations(child)) walk(item, child);
      }
    }
  };
  walk(data, "");
  return out;
}

/** A value as a report quotes it: a string as itself, anything else as its canonical JSON. */
export function valueText(value: unknown): string {
  return typeof value === "string" ? value : canonicalValue(value);
}

/**
 * The first value, in document order, whose own line is `line`: the pointer
 * a frontmatter line names. Undefined when no value starts there, as on a
 * fence or a blank line.
 */
export function pointerAtLine(metadata: ExtractedMetadata, line: number): string | undefined {
  return valuesOf(metadata.data).find(([pointer]) => metadata.lineFor(pointer) === line)?.[0];
}

/** `#/pains/0`, as a report spells a pointer claim's place. */
export function spellPointer(pointer: string): string {
  return `#${pointer}`;
}

/** Classify a pointer claim against the page's metadata now. */
export function pointerClaimEnd(page: PageCitations, entry: PageCitation): ClaimEnd {
  const claim = entry.citation.claim;
  const pointer = claim?.pointer ?? "";
  const pin = claim?.integrity;
  const { metadata } = page;
  const line = (at: string): string => String(metadata.lineFor(at) ?? 1);
  const end: ClaimEnd = { pointer, fileLines: line(pointer), status: "changed" };
  const here = valueAt(metadata.data, pointer);
  if (here !== undefined && valuePin(here.value) === pin) return { ...end, status: "current" };

  const found = valuesOf(metadata.data)
    .filter(([at, value]) => at !== pointer && valuePin(value) === pin)
    .map(([at]) => at);
  const [only] = found;
  if (found.length === 1 && only !== undefined) {
    return { ...end, status: "moved", newPointer: only, newFileLines: line(only) };
  }
  if (found.length > 1) {
    return { ...end, status: "moved-ambiguous", candidates: found, candidateFileLines: found.map(line) };
  }
  // A deleted item's neighbour shifts up into its index, and another entry
  // pins that neighbour: the claim is gone, not edited.
  if (here === undefined) return { ...end, status: "missing" };
  const held = valuePin(here.value);
  const another = page.citations.some(
    (other) => other !== entry && other.citation.claim?.pointer !== undefined && other.citation.claim.integrity === held,
  );
  if (another) return { ...end, status: "missing" };
  return { ...end, text: [valueText(here.value)] };
}
