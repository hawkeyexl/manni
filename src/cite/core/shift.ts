/**
 * Moving claim lines when a marker line comes or goes.
 *
 * `add --marker` inserts one line above a paragraph; `remove` deletes the
 * marker lines of the entries it takes out. Either way the claims below the
 * change have to move with the text they pin, in the same write, or the next
 * check reports a page nobody edited. One rule decides both directions, so
 * the two commands cannot disagree about which entries move.
 *
 * A change that lands *inside* a claim's own lines is not a move: it would
 * change what the pin covers. That is a refusal, and nothing is written.
 */
import { CiteError } from "../errors.js";
import type { LineSpec, PageCitation, PageLines } from "../types.js";
import { toFileLines } from "./claims.js";
import { lineSpec, parseLines } from "./range.js";

/** `line 9`, or `lines 9-12` for a range. */
export function spellAt(lines: PageLines): string {
  return lines.start === lines.end
    ? `line ${String(lines.start)}`
    : `lines ${String(lines.start)}-${String(lines.end)}`;
}

/** The new `claim.lines` of each entry the change moves, by where the entry lives. */
export interface Shifted {
  frontmatter: { index: number; lines: LineSpec }[];
  manifest: Map<number, LineSpec>;
}

export interface ShiftOptions {
  /** The entries to move: on a removal, the ones that survive it. */
  citations: readonly PageCitation[];
  /** File lines where a marker line is inserted, or where one is removed. */
  at: readonly number[];
  /** `1` for lines coming in, `-1` for lines going out. */
  delta: 1 | -1;
  /** File line of body line 1, since `claim.lines` count the body. */
  bodyLine: number;
  /** The page as the run reports it, for the refusal. */
  label: string;
}

/**
 * The entries whose claim lines move, each by however many of `at` sit above
 * them. An insertion at a claim's first line pushes the whole claim down; a
 * removal of that line is inside the claim instead, because the line is the
 * claim's own. Hence the two comparisons.
 */
export function shiftedEntries(opts: ShiftOptions): Shifted {
  const { citations, at, delta, bodyLine, label } = opts;
  const out: Shifted = { frontmatter: [], manifest: new Map() };
  if (at.length === 0) return out;
  for (const { citation, origin } of citations) {
    const spec = citation.claim?.lines;
    const recorded = spec === undefined ? undefined : parseLines(spec);
    if (recorded === undefined) continue;
    const file = toFileLines(recorded, bodyLine);
    const inside = at.find((line) =>
      delta === 1
        ? line > file.start && line <= file.end
        : line >= file.start && line <= file.end,
    );
    if (inside !== undefined) {
      const whose =
        citation.id === undefined
          ? `the claim at ${spellAt(file)}`
          : `the claim of ${citation.id} (${spellAt(file)})`;
      const why =
        delta === 1
          ? "A marker there would change its pin."
          : "Removing the marker there would change its pin.";
      throw new CiteError(`${label}:${String(inside)} is inside ${whose}. ${why}`);
    }
    const lines = at.filter((line) => (delta === 1 ? line <= file.start : line < file.start)).length;
    if (lines === 0) continue;
    const moved = lineSpec({
      start: recorded.start + lines * delta,
      end: recorded.end + lines * delta,
    });
    if (origin.kind === "manifest") out.manifest.set(origin.index, moved);
    else out.frontmatter.push({ index: origin.index, lines: moved });
  }
  return out;
}

/** A copy of a manifest entry with its `claim.lines` replaced. */
export function withClaimLines(entry: unknown, lines: LineSpec): unknown {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
  const claim: unknown = (entry as Record<string, unknown>).claim;
  if (typeof claim !== "object" || claim === null || Array.isArray(claim)) return entry;
  return { ...entry, claim: { ...claim, lines } };
}
