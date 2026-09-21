/**
 * The claim end: the page text a citation supports, classified by the same
 * machinery as the source end and against the page as it is now.
 *
 * The claim's lines are body-relative, so editing the frontmatter never moves
 * them; every line a person reads is a file line, translated here. The pin
 * holds at the recorded lines: `current`. The same text is found verbatim
 * elsewhere in the body: `moved`, once, or `moved-ambiguous`. Nowhere:
 * `changed`, the sentence was edited. A marker-anchored claim pins what the
 * marker anchors, so its text never moves on the page; it is `current`,
 * `changed`, or, when the pin holds over a span the marker no longer anchors,
 * `moved`. `src/cite/core/reanchor.ts` reads those spans.
 */
import type {
  ClaimEnd,
  PageCitation,
  PageCitations,
  PageLines,
} from "../types.js";
import {
  findWindows,
  parseLines,
  pinOfLines,
  spellLines,
  toBodyLines,
  toFileLines,
} from "../../shared/pin.js";
import {
  markerClaimEnd,
  misplacedMarkerAt,
  type MisplacedMarker,
} from "./reanchor.js";
import {
  anchoredLines,
  fenceSpanAt,
  insideFence,
  isMarkerLine,
  isTableRow,
  isTableSeparator,
  lineAt,
  offsetOfLine,
  paragraphAfter,
} from "./statements.js";

// The line translation and the claim pin are the shared pin engine's; this path keeps cite's imports working.
export { pinOfLines, toBodyLines, toFileLines } from "../../shared/pin.js";

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The hashing rule's normalization for a whole quoted block: one BOM, CRLF →
 * LF, and one trailing LF dropped. It differs from the shared `normalizeText`
 * only in that last step, because a quote is compared as one joined block
 * rather than split into lines first.
 */
function normalizeBlock(text: string): string {
  let out = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  out = out.replace(/\r\n/g, "\n");
  return out.endsWith("\n") ? out.slice(0, -1) : out;
}

/** `true` when the block's normalized text equals the cited lines under the hashing rule. */
export function blockMatches(blockText: string, citedJoined: string): boolean {
  return normalizeBlock(blockText) === normalizeBlock(citedJoined);
}

/** The page lines a range covers, as far as the page reaches. */
function textAt(lines: readonly string[], range: PageLines): string[] {
  return lines.slice(range.start - 1, Math.min(range.end, lines.length));
}

/** The first file line of a classified claim: where its findings sit. */
export function claimLine(claim: ClaimEnd): number | undefined {
  const at = claim.fileLines === undefined ? undefined : parseLines(claim.fileLines);
  return at?.start;
}

/** Where the claim is now: the moved-to lines when it moved, else the recorded ones. */
export function claimLineNow(claim: ClaimEnd): number | undefined {
  const spec = claim.newFileLines ?? claim.candidateFileLines?.[0] ?? claim.fileLines;
  const at = spec === undefined ? undefined : parseLines(spec);
  return at?.start;
}

/** The file lines the claim occupies now, for the quote check. */
export function claimLinesNow(claim: ClaimEnd): PageLines | undefined {
  const spec = claim.newFileLines ?? claim.candidateFileLines?.[0] ?? claim.fileLines;
  return spec === undefined ? undefined : parseLines(spec);
}

/**
 * Classify one entry's claim end against the page. `lines` is the page under
 * the hashing rule (`splitLines`). `null` for an entry with no `claim`: a
 * bare pin, or a marker with no drift check on its sentence.
 */
export function claimEnd(
  page: PageCitations,
  entry: PageCitation,
  lines: readonly string[],
  misplaced?: MisplacedMarker,
): ClaimEnd | null {
  const { citation, marker } = entry;
  const claim = citation.claim;
  if (claim === undefined) return null;
  const body = page.bodyLine;

  if (claim.lines !== undefined) {
    const recorded = parseLines(claim.lines);
    // An unreadable range is `entry-invalid`, and that entry is never classified.
    if (recorded === undefined) return { status: "skipped" };
    const file = toFileLines(recorded, body);
    const end: ClaimEnd = {
      lines: spellLines(recorded),
      fileLines: spellLines(file),
      status: "changed",
    };
    // Lines and a marker both: `anchor-invalid`, and neither anchor is judged.
    if (marker !== undefined) return { ...end, status: "skipped" };
    if (pinOfLines(lines, file) === claim.integrity) return { ...end, status: "current" };

    const width = recorded.end - recorded.start + 1;
    const found = findWindows(lines.slice(body - 1), width, claim.integrity, undefined, {
      around: recorded.start,
    });
    const spans = found.starts.map((start) => ({ start, end: start + width - 1 }));
    const [only] = spans;
    if (spans.length === 1 && only !== undefined) {
      return {
        ...end,
        status: "moved",
        newLines: spellLines(only),
        newFileLines: spellLines(toFileLines(only, body)),
      };
    }
    if (spans.length > 1) {
      return {
        ...end,
        status: "moved-ambiguous",
        candidates: spans.map(spellLines),
        candidateFileLines: spans.map((span) => spellLines(toFileLines(span, body))),
      };
    }
    return { ...end, text: textAt(lines, file) };
  }

  if (marker !== undefined) {
    // The marker travels with its text, so what moves is the span the marker
    // anchors, not the text. `reanchor.ts` reads the three spans.
    return markerClaimEnd(
      page,
      entry,
      lines,
      misplaced ?? misplacedMarkerAt(page, lines, marker.line, entry),
    );
  }

  // A claim pin with neither lines nor a marker anchors nothing at all.
  return { status: "changed" };
}

/**
 * Where else in the body the claim's text sits, as file lines. A claim whose
 * text repeats is `moved-ambiguous` the moment it moves, so `add` says so
 * while the pin is still being written, and `update --accept` says so before
 * it mints a pin that cannot tell two copies apart. The search is the
 * classifier's own.
 */
export function otherClaimSpans(
  lines: readonly string[],
  pageLines: PageLines,
  pin: string,
  bodyLine: number,
): PageLines[] {
  const width = pageLines.end - pageLines.start + 1;
  const found = findWindows(lines.slice(bodyLine - 1), width, pin, undefined, {
    around: toBodyLines(pageLines, bodyLine).start,
  });
  return found.starts
    .map((start) => toFileLines({ start, end: start + width - 1 }, bodyLine))
    .filter((span) => span.start !== pageLines.start);
}

/** How many other locations a notice names before it starts counting them. */
const NAMED_SPANS = 3;

/**
 * `line 17`, `lines 16 and 18`, `lines 16, 18, 20 and 2 more`.
 *
 * Called only with a non-empty list. `add`'s notice and `update`'s
 * uniqueness refusal both guard on one, so the empty case cannot be reached.
 * It would spell `lines ` with a trailing space, and no branch is added for
 * a caller that does not exist.
 */
export function spellElsewhere(spans: readonly PageLines[]): string {
  const first = spans[0];
  const noun = spans.length === 1 && first !== undefined && first.start === first.end ? "line" : "lines";
  const named = spans.slice(0, NAMED_SPANS).map((span) => spellLines(span));
  const rest = spans.length - named.length;
  if (rest > 0) return `${noun} ${named.join(", ")} and ${String(rest)} more`;
  const last = named.pop() ?? "";
  return named.length === 0 ? `${noun} ${last}` : `${noun} ${named.join(", ")} and ${last}`;
}

/** What `update --accept` re-pins over: the paragraph or fenced block at a line. */
export interface ClaimUnit {
  lines: PageLines;
  kind: "paragraph" | "block";
  text: string[];
}

/**
 * Why no unit sits at a file line. Each one is a different problem with a
 * different repair, so `update --accept` names which it hit rather than
 * leaving the entry skipped with no reason.
 */
export type NoUnit =
  | "outside"
  | "blank"
  | "fenced"
  | "marker"
  | "not-a-paragraph"
  | "table-short"
  | "table-rule";

/**
 * The rows a claim on a table re-pins over, or why there are none.
 *
 * A row is a statement, so a claim over N rows is a claim over N statements.
 * The extent is the author's, and re-pinning re-mints the hash over it rather
 * than redesigning it: one recorded line gives one row, and five give five.
 * Rows below a one-line claim are other statements, and a table that no longer
 * reaches the recorded end is a question only the author can answer.
 *
 * The unit comes back as `kind: "paragraph"`, since `ClaimUnit` distinguishes
 * prose from a fenced block and nothing else. A caller wanting to know whether
 * it holds rows has to ask `isTableRow` about the text, not read `kind`.
 *
 * A span of nothing but `|---|---|` rules is refused. Those lines carry no
 * words, so a pin over them says nothing about what the page claims, and a
 * claim that shifted onto one is a claim the page lost. A header, its rule and
 * a body row is three rows and keeps all three.
 */
function rowsAt(
  line: number,
  lines: readonly string[],
  recorded: PageLines | undefined,
  named: boolean,
): ClaimUnit | NoUnit {
  const width = recorded === undefined ? 1 : Math.max(1, recorded.end - recorded.start + 1);
  const end = line + width - 1;
  if (end > lines.length) return "table-short";
  for (let n = line; n <= end; n++) {
    if (!isTableRow(lines[n - 1] ?? "")) return "table-short";
  }
  const text = lines.slice(line - 1, end);
  if (!named && text.every((row) => isTableSeparator(row))) return "table-rule";
  return { lines: { start: line, end }, kind: "paragraph", text };
}

/**
 * The unit at a file line, or why there is none. `unitAt` and `noUnitAt` are
 * the two halves a caller reads, so the guards are written once. `recorded` is
 * the span the claim holds now, which only a table reads. `named` is the
 * operator having named the entry with `--only`: the structural refusals a
 * blanket accept would hit are the ones they have looked at, so they stand
 * down and the line is read as the text it is.
 */
function unitOrWhy(
  page: PageCitations,
  line: number,
  lines: readonly string[],
  recorded?: PageLines,
  named = false,
): ClaimUnit | NoUnit {
  if (line < page.bodyLine || line > lines.length) return "outside";
  const own = lines[line - 1] ?? "";
  if (own.trim() === "") return "blank";
  // A line that is one marker and nothing else is another entry's anchor, not
  // claim text. Reading it as text is how a shifted claim gets a confident pin
  // over a comment.
  const marker = isMarkerLine(own, page.format);
  if (marker && !named) return "marker";
  const block = fenceSpanAt(page.content, line, page.format);
  if (block !== undefined) {
    return { lines: block, kind: "block", text: lines.slice(block.start - 1, block.end) };
  }
  if (insideFence(page.content, page.bodyOffset, line, page.format)) return "fenced";
  // A table row is a statement of its own, and nothing between two rows ends a
  // paragraph, so the walk below would read the rest of the table as one.
  if (isTableRow(own)) return rowsAt(line, lines, recorded, named);
  // The format ends the paragraph at a marker under it, so a re-pin never
  // swallows another entry's anchor. A named entry sitting on a marker is read
  // without it, because there the marker is the line being accepted.
  const paragraph = paragraphAfter(
    page.content,
    offsetOfLine(page.content, line),
    marker ? undefined : page.format,
  );
  if (paragraph === undefined || paragraph.line !== line) return "not-a-paragraph";
  const span: PageLines = { start: line, end: lineAt(page.content, paragraph.end) };
  return { lines: span, kind: "paragraph", text: lines.slice(span.start - 1, span.end) };
}

/**
 * The paragraph, fenced block or table rows at a file line. Undefined when the
 * line holds no claim at all: it is blank, outside the body, inside a fenced
 * block rather than opening one, another entry's marker, or a table rule.
 * Those are the claims `update --accept` skips, and `noUnitAt` says which of
 * them it is.
 *
 * A paragraph runs from this line to its end, not from the paragraph's own
 * first line. The line asked about is the claim's first line, and re-pinning
 * has to leave that where it is, so a claim that started mid-paragraph keeps
 * starting there. A paragraph that gained a sentence gained it as part of the
 * same statement, which is why a claim grows with it.
 *
 * A table does not work that way. Each row is a statement, so a claim keeps
 * the number of rows `recorded` gives it, and refuses when the table no longer
 * reaches that far. Callers that know the claim's current span pass it.
 */
export function unitAt(
  page: PageCitations,
  line: number,
  lines: readonly string[],
  recorded?: PageLines,
  named = false,
): ClaimUnit | undefined {
  const found = unitOrWhy(page, line, lines, recorded, named);
  return typeof found === "string" ? undefined : found;
}

/** Why `unitAt` found nothing at a file line, or undefined when it found a unit. */
export function noUnitAt(
  page: PageCitations,
  line: number,
  lines: readonly string[],
  recorded?: PageLines,
  named = false,
): NoUnit | undefined {
  const found = unitOrWhy(page, line, lines, recorded, named);
  return typeof found === "string" ? found : undefined;
}

/** The lines a marker anchors now, for `update --accept` on a marker-anchored claim. */
export function markerUnit(
  page: PageCitations,
  entry: PageCitation,
  lines: readonly string[],
): ClaimUnit | undefined {
  const { marker, citation } = entry;
  if (marker === undefined) return undefined;
  const span = anchoredLines(page.content, marker.end, page.format, citation.quote === true);
  if (span === undefined || span.end > lines.length) return undefined;
  return {
    lines: span,
    kind: citation.quote === true ? "block" : "paragraph",
    text: lines.slice(span.start - 1, span.end),
  };
}
