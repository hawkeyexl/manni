/**
 * Claim anchoring. A claim is matched whitespace-normalized (runs of
 * whitespace collapse to one space on both sides) against paragraphs, so
 * soft-wrapped prose matches. Punctuation is verbatim.
 */
import { ANY_FENCE, fencedBlockAt, lineAt, paragraphAfter } from "./statements.js";

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface ClaimHit {
  /** File offset where the paragraph containing the claim starts. */
  paragraphStart: number;
  /** File line the claim starts on. */
  line: number;
}

interface Paragraph {
  start: number;
  line: number;
  /** Lines without terminators. */
  lines: string[];
}

/**
 * Paragraphs from `bodyOffset`: runs of non-blank lines, with fenced blocks
 * skipped (a fence line toggles, as the ladder's `paragraphs` does). The
 * opener is `ANY_FENCE`: the search has no format to narrow it, and an
 * indented markdown fence counts, as it does for `paragraphAfter`.
 */
function paragraphsFrom(content: string, bodyOffset: number): Paragraph[] {
  const out: Paragraph[] = [];
  let current: Paragraph | undefined;
  let inFence = false;
  const flush = (): void => {
    if (current) out.push(current);
    current = undefined;
  };
  let pos = bodyOffset;
  while (pos < content.length) {
    const nl = content.indexOf("\n", pos);
    const end = nl === -1 ? content.length : nl;
    let text = content.slice(pos, end);
    if (text.endsWith("\r")) text = text.slice(0, -1);
    if (ANY_FENCE.test(text)) {
      flush();
      inFence = !inFence;
    } else if (inFence) {
      // Code, not prose.
    } else if (text.trim() === "") {
      flush();
    } else if (current) {
      current.lines.push(text);
    } else {
      current = { start: pos, line: lineAt(content, pos), lines: [text] };
    }
    pos = end + 1;
  }
  flush();
  return out;
}

/** Every paragraph in the body (from `bodyOffset`) that contains the claim. */
export function findClaim(
  content: string,
  bodyOffset: number,
  claim: string,
): ClaimHit[] {
  const want = normalizeWhitespace(claim);
  if (want === "") return [];
  const hits: ClaimHit[] = [];
  for (const paragraph of paragraphsFrom(content, bodyOffset)) {
    if (!normalizeWhitespace(paragraph.lines.join("\n")).includes(want)) continue;
    // Report the line the claim starts on, not the paragraph's first line: a
    // statement sitting directly above the sentence is part of the same
    // paragraph in markdown terms, and the finding should point at the
    // sentence.
    let at = 0;
    for (let i = 1; i < paragraph.lines.length; i++) {
      if (normalizeWhitespace(paragraph.lines.slice(i).join("\n")).includes(want)) at = i;
      else break;
    }
    hits.push({ paragraphStart: paragraph.start, line: paragraph.line + at });
  }
  return hits;
}

/** Whether a paragraph or block at `offset` contains the claim. */
export function paragraphContains(
  content: string,
  offset: number,
  claim: string,
): boolean {
  const want = normalizeWhitespace(claim);
  if (want === "") return false;
  const paragraph = paragraphAfter(content, offset);
  if (paragraph) {
    return normalizeWhitespace(content.slice(paragraph.start, paragraph.end)).includes(want);
  }
  const block = fencedBlockAt(content, offset);
  return block ? normalizeWhitespace(block.text).includes(want) : false;
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
