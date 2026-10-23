/**
 * The stretches of a text that are code, so a scanner can skip them: a page
 * that documents a syntax is not an instance of it. cite skips code when it
 * looks for markers, and term's body readers skip it when they look for
 * glossary entries.
 *
 * - A fenced block in markdown and mdx: ``` or ~~~, indented or not, since a
 *   fence keeps its meaning inside a list item. It is closed by the same
 *   character, at least as many of it, and nothing else on the line.
 * - A verbatim delimited block in asciidoc: listing `----`, literal `....`,
 *   passthrough `++++` and comment `////`. It is closed only by an exact
 *   repeat of its opener line. The compound blocks, example `====`, sidebar
 *   `****` and quote `____`, hold prose and are not code.
 * - An unclosed block runs to the end, as a renderer reads it.
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

/**
 * A markdown fence opener: three or more backticks or tildes, after any
 * indent. With `closesFence` it is the one fence rule, which anchoring
 * (`src/shared/statements.ts`), the code skip below and meta's heading skip
 * all read.
 */
export const FENCE_OPENER = /^[ \t]*(`{3,}|~{3,})/;

/**
 * An asciidoc delimiter line: four or more of one block character from
 * column 0, alone on its line but for trailing whitespace.
 */
const ASCIIDOC_DELIMITER = /^([-.+/=*_])\1{3,}[ \t]*$/;
/** The delimiter characters of the blocks whose content is not prose. */
const VERBATIM = new Set(["-", ".", "+", "/"]);
/** A line a two-line title can be: not a comment, a block title or an attribute line. */
const TITLE_TEXT = /^[^\s./[]/;
/** Formats where a backtick span is inline code. */
const SPAN_FORMATS = new Set(["markdown", "mdx", "asciidoc", "rst"]);
const BACKTICK = 96;

/**
 * The kind of asciidoc block `line` delimits, or undefined when it delimits
 * none. A verbatim block holds code, and a compound one holds prose. Given the
 * line `above` it, a `=` line directly under title text, within two
 * characters of its length, is that title's underline instead.
 */
export function asciidocBlock(line: string, above?: string): "verbatim" | "compound" | undefined {
  const char = ASCIIDOC_DELIMITER.exec(line)?.[1];
  if (char === undefined) return undefined;
  if (char === "=" && above !== undefined && TITLE_TEXT.test(above)) {
    if (Math.abs(above.trimEnd().length - line.trimEnd().length) <= 2) return undefined;
  }
  return VERBATIM.has(char) ? "verbatim" : "compound";
}

/** What closes an open block. */
export type BlockCloser = (line: string) => boolean;

/**
 * What closes the block `line` opens in a format, or undefined when it opens
 * none: a fence in markdown and mdx, a delimited block in asciidoc, which
 * closes only on an exact repeat of its opener line. This is the one block
 * table. The code skip reads verbatim blocks only; anchoring passes
 * `compound` to read every block, and `above`, the line before, to tell a
 * title's `=` underline from an example block.
 */
export function blockCloser(
  line: string,
  format: string,
  options: { above?: string; compound?: boolean } = {},
): BlockCloser | undefined {
  switch (format) {
    case "markdown":
    case "mdx": {
      const run = FENCE_OPENER.exec(line)?.[1];
      return run === undefined ? undefined : (l) => closesFence(l, run);
    }
    case "asciidoc": {
      const kind = asciidocBlock(line, options.above);
      if (kind === undefined || (kind === "compound" && options.compound !== true)) return undefined;
      const open = line.trimEnd();
      return (l) => l.trimEnd() === open;
    }
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
 * Whether a line closes the fence whose opening run is `open`: the same
 * character, at least as many of it, and nothing else on the line, after any
 * indent. A shorter run does not close a longer one's block, which is how a
 * ```` block carries a ``` block inside it, and a fence line with an info
 * string never closes one.
 */
export function closesFence(line: string, open: string): boolean {
  const trimmed = line.trim();
  let n = 0;
  while (trimmed.charAt(n) === open.charAt(0)) n++;
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
  const spans = options.spans !== false && SPAN_FORMATS.has(format);
  const out: CodeRegion[] = [];
  let open: { closes: BlockCloser; start: number } | undefined;
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    const end = nl === -1 ? text.length : nl;
    const raw = text.slice(pos, end);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (open !== undefined) {
      if (open.closes(line)) {
        out.push({ start: open.start, end });
        open = undefined;
      }
    } else {
      const closes = blockCloser(line, format);
      if (closes !== undefined) {
        open = { closes, start: pos };
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
