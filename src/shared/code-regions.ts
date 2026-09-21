/**
 * The stretches of a text that are code, so a scanner can skip them: a page
 * that documents a syntax is not an instance of it. cite skips code when it
 * looks for markers, and term's body readers skip it when they look for
 * glossary entries.
 *
 * - A fenced block: ``` or ~~~ in markdown and mdx, indented or not, since a
 *   fence keeps its meaning inside a list item; `----` at column 0 in
 *   asciidoc. It is closed by the same character, at least as many of it, and
 *   nothing else on the line. An unclosed fence runs to the end, as a renderer
 *   reads it.
 * - A backtick span, in markdown, mdx, asciidoc and rst: a run of backticks
 *   closed by a run of the same length on the same line. A run with no closer
 *   is literal text.
 *
 * html and xml have neither; a `<pre>` is not code here.
 */

/** A stretch of code, as `[start, end)` offsets of the text it was found in. */
export interface CodeRegion {
  start: number;
  end: number;
}

export interface CodeRegionOptions {
  /** Include backtick spans. Default `true`; `false` returns fenced blocks only. */
  spans?: boolean;
}

const SKIP_MARKDOWN_FENCE = /^[ \t]*(`{3,}|~{3,})/;
const SKIP_ASCIIDOC_FENCE = /^(-{4,})/;
/** Formats where a backtick span is inline code. */
const SPAN_FORMATS = new Set(["markdown", "mdx", "asciidoc", "rst"]);
const BACKTICK = 96;

/** The fence-opener pattern for a format, or undefined when it has no fences. */
function fenceFor(format: string): RegExp | undefined {
  switch (format) {
    case "markdown":
    case "mdx":
      return SKIP_MARKDOWN_FENCE;
    case "asciidoc":
      return SKIP_ASCIIDOC_FENCE;
    default:
      return undefined;
  }
}

/** Length of the run of backticks starting at `i` in `text` (0 when none). */
function backtickRun(text: string, i: number): number {
  let n = 0;
  while (text.charCodeAt(i + n) === BACKTICK) n++;
  return n;
}

/** The backtick spans on one line, appended to `out` as offsets of the whole text. */
function spanRegions(line: string, lineStart: number, out: CodeRegion[]): void {
  let i = 0;
  while (i < line.length) {
    const n = backtickRun(line, i);
    if (n === 0) {
      i++;
      continue;
    }
    let j = i + n;
    let closer = -1;
    while (j < line.length) {
      const m = backtickRun(line, j);
      if (m === 0) {
        j++;
        continue;
      }
      if (m === n) {
        closer = j;
        break;
      }
      j += m;
    }
    if (closer === -1) {
      i += n;
      continue;
    }
    out.push({ start: lineStart + i, end: lineStart + closer + n });
    i = closer + n;
  }
}

/**
 * Whether a line closes the fence `open`. A longer run does not close a
 * shorter one's block, which is how a ```` block carries a ``` block inside it.
 */
function closesFence(line: string, open: { char: string; length: number }): boolean {
  const trimmed = line.trim();
  let n = 0;
  while (trimmed.charAt(n) === open.char) n++;
  return n >= open.length && n === trimmed.length;
}

/**
 * Every fenced block and backtick span in `text`, in order, for a format that
 * has them. A closed fence's region ends at its closing line's terminator; an
 * unclosed one ends at the end of the text. Spans are not looked for inside a
 * fence.
 */
export function codeRegions(
  text: string,
  format: string,
  options: CodeRegionOptions = {},
): CodeRegion[] {
  const fence = fenceFor(format);
  const spans = options.spans !== false && SPAN_FORMATS.has(format);
  const out: CodeRegion[] = [];
  if (fence === undefined && !spans) return out;
  let open: { char: string; length: number; start: number } | undefined;
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    const end = nl === -1 ? text.length : nl;
    const raw = text.slice(pos, end);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (open !== undefined) {
      if (closesFence(line, open)) {
        out.push({ start: open.start, end });
        open = undefined;
      }
    } else {
      const opener = fence?.exec(line)?.[1];
      if (opener !== undefined) {
        open = { char: opener.charAt(0), length: opener.length, start: pos };
      } else if (spans) {
        spanRegions(line, pos, out);
      }
    }
    pos = end + 1;
  }
  if (open !== undefined) out.push({ start: open.start, end: text.length });
  return out;
}

/** The end of the region `offset` falls in, or undefined when it falls in none. */
export function codeEndAt(regions: readonly CodeRegion[], offset: number): number | undefined {
  return regions.find((r) => offset >= r.start && offset < r.end)?.end;
}
