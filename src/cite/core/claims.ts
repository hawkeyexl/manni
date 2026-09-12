/**
 * The claim end: the page text a citation supports, classified by the same
 * machinery as the source end and against the page as it is now.
 *
 * The claim's lines are body-relative, so editing the frontmatter never moves
 * them; every line a person reads is a file line, translated here. The pin
 * holds at the recorded lines: `current`. The same text is found verbatim
 * elsewhere in the body: `moved`, once, or `moved-ambiguous`. Nowhere:
 * `changed`, the sentence was edited. A marker-anchored claim pins what the
 * marker anchors, so it never moves; it is `current` or `changed`.
 */
import type {
  ClaimEnd,
  PageCitation,
  PageCitations,
  PageLines,
} from "../types.js";
import { findWindows } from "./classify.js";
import { hashLines } from "./hash.js";
import { parseLines, spellLines } from "./range.js";
import {
  anchoredLines,
  fenceSpanAt,
  insideFence,
  lineAt,
  offsetOfLine,
  paragraphAfter,
} from "./statements.js";

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The hashing rule's normalization: one BOM, CRLF → LF, one trailing LF. */
function normalizeBlock(text: string): string {
  let out = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  out = out.replace(/\r\n/g, "\n");
  return out.endsWith("\n") ? out.slice(0, -1) : out;
}

/** `true` when the block's normalized text equals the cited lines under the hashing rule. */
export function blockMatches(blockText: string, citedJoined: string): boolean {
  return normalizeBlock(blockText) === normalizeBlock(citedJoined);
}

/** Body lines as file lines: body line 1 is the first line after the frontmatter. */
export function toFileLines(lines: PageLines, bodyLine: number): PageLines {
  return { start: bodyLine + lines.start - 1, end: bodyLine + lines.end - 1 };
}

/** File lines as body lines. */
export function toBodyLines(lines: PageLines, bodyLine: number): PageLines {
  return { start: lines.start - bodyLine + 1, end: lines.end - bodyLine + 1 };
}

/** The page lines a range covers, as far as the page reaches. */
function textAt(lines: readonly string[], range: PageLines): string[] {
  return lines.slice(range.start - 1, Math.min(range.end, lines.length));
}

/** The pin of a page range, under the claim rule: always plain. */
export function pinOfLines(lines: readonly string[], range: PageLines): string | undefined {
  if (range.start < 1 || range.end > lines.length) return undefined;
  return hashLines(lines.slice(range.start - 1, range.end).join("\n"));
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
): ClaimEnd | null {
  const { citation, marker } = entry;
  const claim = citation.claim;
  if (claim === undefined) return null;
  const quote = citation.quote === true;
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
    // The marker moves with its text, so a marker-anchored claim never moves.
    const unit = anchoredLines(page.content, marker.end, page.format, quote);
    if (unit === undefined) return { status: "changed" };
    const end: ClaimEnd = { fileLines: spellLines(unit), status: "changed" };
    if (pinOfLines(lines, unit) === claim.integrity) return { ...end, status: "current" };
    return { ...end, text: textAt(lines, unit) };
  }

  // A claim pin with neither lines nor a marker anchors nothing at all.
  return { status: "changed" };
}

/** What `update --accept` re-pins over: the paragraph or fenced block at a line. */
export interface ClaimUnit {
  lines: PageLines;
  kind: "paragraph" | "block";
  text: string[];
}

/**
 * The paragraph or fenced block at a file line. Undefined when the line is
 * blank, outside the body, or inside a fenced block rather than opening one:
 * those are the claims `update --accept` skips.
 *
 * A paragraph runs from this line to its end, not from the paragraph's own
 * first line. The line asked about is the claim's first line, and re-pinning
 * has to leave that where it is, so a claim that started mid-paragraph keeps
 * starting there.
 */
export function unitAt(
  page: PageCitations,
  line: number,
  lines: readonly string[],
): ClaimUnit | undefined {
  if (line < page.bodyLine || line > lines.length) return undefined;
  if ((lines[line - 1] ?? "").trim() === "") return undefined;
  const block = fenceSpanAt(page.content, line, page.format);
  if (block !== undefined) {
    return { lines: block, kind: "block", text: lines.slice(block.start - 1, block.end) };
  }
  if (insideFence(page.content, page.bodyOffset, line, page.format)) return undefined;
  const paragraph = paragraphAfter(page.content, offsetOfLine(page.content, line));
  if (paragraph === undefined || paragraph.line !== line) return undefined;
  const span: PageLines = { start: line, end: lineAt(page.content, paragraph.end) };
  return { lines: span, kind: "paragraph", text: lines.slice(span.start - 1, span.end) };
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
