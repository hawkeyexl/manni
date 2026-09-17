/**
 * Misplaced markers, and what to do about them. Proposal 0054 is the record.
 *
 * A **marker run** is one or more consecutive lines that each hold one marker
 * and nothing else. A run is **misplaced** when the line directly above it and
 * the line directly below it are both unit text: deleting the run would join
 * them into one paragraph. Such a marker splits the paragraph for the renderer
 * and for the tool, and the lines above it are anchored by nothing.
 *
 * A misplaced marker belongs where `add --marker` writes one: above the first
 * line of the unit, or, for a `quote: true` entry, above the block it anchors.
 * A run moves in its own order, so two markers that were stacked stay stacked.
 *
 * The claim of a marker-anchored entry is read against three spans, in order:
 * the unit the marker belongs to, the span it anchors now, and the span it was
 * pinned over before PR #43 (marker lines included, down to the next blank
 * line or fence). The second or third holding means the pinned text is on the
 * page and the marker anchors a different span: `claim-moved`.
 */
import type { ClaimEnd, PageCitation, PageCitations, PageLines } from "../types.js";
import { hashLines } from "./hash.js";
import { MAX_MARKERS_PER_PAGE } from "./page.js";
import { spellLines } from "../../shared/pin.js";
import { ANY_FENCE, anchoredLines, isBoundLine, isMarkerLine } from "./statements.js";

/** Whether a line is text a paragraph is made of. */
export function isUnitText(line: string | undefined, format: string): boolean {
  if (line === undefined) return false;
  if (line.trim() === "") return false;
  if (ANY_FENCE.test(line)) return false;
  if (isMarkerLine(line, format)) return false;
  return !isBoundLine(line, format);
}

/** Whether the file line `n` holds one marker and nothing else. */
function markerAt(lines: readonly string[], n: number, format: string): boolean {
  const line = lines[n - 1];
  return line !== undefined && isMarkerLine(line, format);
}

/** The run of marker-only lines that holds `line`. */
export function markerRunAt(
  lines: readonly string[],
  line: number,
  format: string,
  bodyLine: number,
): PageLines {
  let start = line;
  while (start - 1 >= bodyLine && markerAt(lines, start - 1, format)) start--;
  let end = line;
  while (end + 1 <= lines.length && markerAt(lines, end + 1, format)) end++;
  return { start, end };
}

/**
 * The paragraph a run splits, in file lines, marker lines included.
 * `undefined` when the run sits where `add` writes markers: after a blank
 * line, a fence, a bound line, or the body's first line.
 */
export function splitUnit(
  lines: readonly string[],
  run: PageLines,
  format: string,
  bodyLine: number,
): PageLines | undefined {
  if (run.start - 1 < bodyLine) return undefined;
  if (!isUnitText(lines[run.start - 2], format)) return undefined;
  if (!isUnitText(lines[run.end], format)) return undefined;
  let start = run.start - 1;
  while (start - 1 >= bodyLine && isUnitText(lines[start - 2], format)) start--;
  let end = run.end + 1;
  while (end + 1 <= lines.length && isUnitText(lines[end], format)) end++;
  return { start, end };
}

/**
 * The span a marker was pinned over before PR #43: from the line below it
 * through the next blank line or fence, marker lines included. `undefined`
 * when the line below is blank or a fence, so the old reading covered nothing.
 */
export function pre43Span(
  lines: readonly string[],
  markerLine: number,
): PageLines | undefined {
  const start = markerLine + 1;
  const first = lines[start - 1];
  if (first === undefined || first.trim() === "" || ANY_FENCE.test(first)) return undefined;
  let end = start;
  while (end + 1 <= lines.length) {
    const next = lines[end];
    if (next === undefined || next.trim() === "" || ANY_FENCE.test(next)) break;
    end++;
  }
  return { start, end };
}

/** One marker line that splits a paragraph. */
export interface MisplacedMarker {
  /** File line of the marker. */
  line: number;
  /** The whole run of marker-only lines it belongs to. */
  run: PageLines;
  /** Its position in that run, counted from zero, so stacked markers keep their order. */
  order: number;
  /** The paragraph the run splits, in file lines as the page reads now. */
  unit: PageLines;
  /** The file line the marker belongs above. */
  place: number;
  /** Whether `place` is a fenced block the entry quotes rather than the unit's first line. */
  block: boolean;
  /** The file line the marker takes once the whole run has moved. */
  to: number;
  /** The entry the marker names, when one is anchored by it. */
  entry?: PageCitation;
}

/** The lines of a run, which is `end - start + 1` markers. */
function runLength(run: PageLines): number {
  return run.end - run.start + 1;
}

/** Whether a misplaced marker at `line` splits a paragraph, and where it belongs. */
export function misplacedMarkerAt(
  page: PageCitations,
  lines: readonly string[],
  line: number,
  entry?: PageCitation,
): MisplacedMarker | undefined {
  if (!markerAt(lines, line, page.format)) return undefined;
  const run = markerRunAt(lines, line, page.format, page.bodyLine);
  const unit = splitUnit(lines, run, page.format, page.bodyLine);
  if (unit === undefined) return undefined;
  const order = line - run.start;
  const quote = entry?.citation.quote === true;
  const marker = entry?.marker;
  const blockAt =
    quote && marker !== undefined
      ? anchoredLines(page.content, marker.end, page.format, true)?.start
      : undefined;
  const out: MisplacedMarker = blockAt === undefined
    ? { line, run, order, unit, place: unit.start, block: false, to: unit.start + order }
    : {
        line,
        run,
        order,
        unit,
        place: blockAt,
        block: true,
        to: blockAt - runLength(run) + order,
      };
  if (entry !== undefined) out.entry = entry;
  return out;
}

/**
 * Every misplaced marker on a page, in the order the page reads. An orphan,
 * repeated or invalid marker is reported like any other: it splits the
 * paragraph whether or not it names an entry.
 */
export function misplacedMarkers(
  page: PageCitations,
  lines: readonly string[],
): MisplacedMarker[] {
  const out: MisplacedMarker[] = [];
  for (const statement of page.statements.slice(0, MAX_MARKERS_PER_PAGE)) {
    const entry = page.citations.find((c) => c.marker?.line === statement.line);
    const found = misplacedMarkerAt(page, lines, statement.line, entry);
    if (found !== undefined) out.push(found);
  }
  return out;
}

/**
 * The span the pin covers once a misplaced run has moved: the joined unit,
 * pushed down by the markers now above it. A quote marker's pin covers its
 * block, which no move touches, so this is never asked of one.
 */
export function movedUnit(misplaced: MisplacedMarker): PageLines {
  return { start: misplaced.unit.start + runLength(misplaced.run), end: misplaced.unit.end };
}

/** The unit's text, the run's marker lines left out: what the pin covers after the move. */
export function unitText(lines: readonly string[], misplaced: MisplacedMarker): string[] {
  const { unit, run } = misplaced;
  const out: string[] = [];
  for (let n = unit.start; n <= unit.end; n++) {
    if (n >= run.start && n <= run.end) continue;
    const line = lines[n - 1];
    if (line !== undefined) out.push(line);
  }
  return out;
}

/** One marker line a rewrite moves, and the file line it goes above. */
export interface MarkerMove {
  from: number;
  place: number;
}

/** A page with its markers moved, and where its lines went. */
export interface MovedPage {
  content: string;
  /** The new file line of an old one. */
  line(old: number): number;
}

/** A page split into line texts and the terminator each position carries. */
function splitKeepingEol(content: string): { texts: string[]; eols: string[] } {
  const parts = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const texts: string[] = [];
  const eols: string[] = [];
  for (const part of parts) {
    const eol = /\r?\n$/.exec(part)?.[0] ?? "";
    texts.push(part.slice(0, part.length - eol.length));
    eols.push(eol);
  }
  return { texts, eols };
}

/**
 * The page with each named marker line lifted out and written above its place,
 * in the order the moves are given, so a run that was stacked stays stacked.
 * A moved marker takes the indentation `add` would write it at, and the file's
 * terminators stay where they are: the lines are permuted, never re-joined.
 */
export function applyMarkerMoves(
  content: string,
  moves: readonly MarkerMove[],
  indentAt: (line: number) => string,
): MovedPage {
  const { texts, eols } = splitKeepingEol(content);
  const moving = new Set(moves.map((move) => move.from));
  const inserts = new Map<number, number[]>();
  for (const move of moves) {
    const list = inserts.get(move.place) ?? [];
    list.push(move.from);
    inserts.set(move.place, list);
  }
  const order: number[] = [];
  for (let n = 1; n <= texts.length; n++) {
    for (const from of inserts.get(n) ?? []) order.push(from);
    if (!moving.has(n)) order.push(n);
  }
  const moved = new Map<number, string>();
  for (const move of moves) {
    moved.set(move.from, indentAt(move.place) + (texts[move.from - 1] ?? "").trim());
  }
  const at = new Map<number, number>();
  order.forEach((old, index) => at.set(old, index + 1));
  const out = order
    .map((old, index) => (moved.get(old) ?? texts[old - 1] ?? "") + (eols[index] ?? ""))
    .join("");
  return { content: out, line: (old) => at.get(old) ?? old };
}

/** The plain pin of a span of lines, or of an explicit list of them. */
function pinOf(lines: readonly string[], span: PageLines): string | undefined {
  if (span.start < 1 || span.end > lines.length || span.end < span.start) return undefined;
  return hashLines(lines.slice(span.start - 1, span.end).join("\n"));
}

/**
 * The claim end of a marker-anchored entry, read against proposal 0054's
 * three spans. `misplaced` is the marker's misplacement, when it has one.
 *
 * For a misplaced marker at `moved`, `fileLines` is the span that held and
 * `newLines` the span the pin will cover once the marker moves. Both are file
 * lines: a marker-anchored claim has no body lines of its own.
 */
export function markerClaimEnd(
  page: PageCitations,
  entry: PageCitation,
  lines: readonly string[],
  misplaced: MisplacedMarker | undefined,
): ClaimEnd {
  const { citation, marker } = entry;
  const pin = citation.claim?.integrity;
  const quote = citation.quote === true;
  if (marker === undefined || pin === undefined) return { status: "changed" };
  const current = anchoredLines(page.content, marker.end, page.format, quote);
  if (current === undefined) return { status: "changed" };

  /** The claim end this span reads as, and where the move will take it. */
  const claimAt = (span: PageLines, status: ClaimEnd["status"], to?: PageLines): ClaimEnd => {
    const end: ClaimEnd = { fileLines: spellLines(span), status };
    if (to !== undefined) {
      end.newLines = spellLines(to);
      end.newFileLines = end.newLines;
    }
    if (status === "changed") end.text = lines.slice(span.start - 1, Math.min(span.end, lines.length));
    return end;
  };

  // A quote marker's pin covers its block, which no move touches, and the
  // block reading never changed, so there is one span to read it against.
  if (quote) {
    return claimAt(current, pinOf(lines, current) === pin ? "current" : "changed");
  }

  if (misplaced !== undefined) {
    const to = movedUnit(misplaced);
    if (hashLines(unitText(lines, misplaced).join("\n")) === pin) return claimAt(to, "current");
    if (pinOf(lines, current) === pin) return claimAt(current, "moved", to);
    const pre43 = pre43Span(lines, marker.line);
    if (pre43 !== undefined && pinOf(lines, pre43) === pin) return claimAt(pre43, "moved", to);
    return claimAt(current, "changed");
  }

  if (pinOf(lines, current) === pin) return claimAt(current, "current");
  // Stacked markers written before PR #43 were pinned over a sibling marker
  // line and the paragraph. That renders fine, so only the pin is repaired.
  const pre43 = pre43Span(lines, marker.line);
  if (pre43 !== undefined && pinOf(lines, pre43) === pin) return claimAt(pre43, "moved", current);
  return claimAt(current, "changed");
}
