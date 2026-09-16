/**
 * Markers: `cite <id>` inside the format's comment syntax.
 *
 * | Format        | Forms                                                        |
 * |---------------|--------------------------------------------------------------|
 * | markdown, mdx | `<!-- cite … -->`, `{/* cite … *\/}`, `[comment]: # (cite …)` |
 * | html, xml     | `<!-- cite … -->`                                            |
 * | asciidoc      | `// (cite …)`                                                |
 * | rst           | `.. (cite …)`                                                |
 *
 * A marker carries an id and nothing else (`cite true` names id `true`). A
 * payload starting with `{` was the inline entry of proposal 0044's first
 * draft; it is `marker-invalid` now, because an entry lives in frontmatter or
 * a manifest and a source is never written into the body. The scanner uses
 * `indexOf` for the delimiters, never a regex over the whole page, and is
 * handed the body only, so a `cite` inside frontmatter is never matched.
 *
 * It does not read code. An opener inside a fenced block or a backtick span,
 * as `src/shared/code-regions.ts` finds them, is skipped, so a page that
 * documents the syntax carries no statements.
 *
 * Every form parses in both markdown and mdx. The first form is what
 * `formatStatement` writes: the html comment for markdown, the jsx comment
 * for mdx, which rejects an html comment.
 */
import type { InlineStatement } from "../types.js";
import { codeEndAt, codeRegions } from "../../shared/code-regions.js";
import { CiteError } from "../errors.js";

export interface StatementForm {
  open: string;
  close: string;
}

const HTML_COMMENT: StatementForm = { open: "<!--", close: "-->" };
const JSX_COMMENT: StatementForm = { open: "{/*", close: "*/}" };
const LINK_REFERENCE: StatementForm = { open: "[comment]: # (", close: ")" };
const MARKDOWN_FORMS: readonly StatementForm[] = [HTML_COMMENT, JSX_COMMENT, LINK_REFERENCE];
const MDX_FORMS: readonly StatementForm[] = [JSX_COMMENT, HTML_COMMENT, LINK_REFERENCE];
const COMMENT_FORMS: readonly StatementForm[] = [{ open: "<!--", close: "-->" }];
const ASCIIDOC_FORMS: readonly StatementForm[] = [{ open: "// (", close: ")" }];
const RST_FORMS: readonly StatementForm[] = [{ open: ".. (", close: ")" }];

const ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A fence opener in any format. `paragraphAfter` and the claim search
 * (`claims.ts`) have no format parameter, so they treat every family's opener
 * as a fence; the per-format locators below are what `quote` anchoring uses.
 * A markdown fence keeps its meaning when indented, as inside a list item, so
 * it is read there too, matching the code skip in `src/shared/code-regions.ts`; the
 * asciidoc `----` stays at column 0.
 */
export const ANY_FENCE = /^(?:[ \t]*(?:`{3,}|~{3,})|-{4,})/;
const MARKDOWN_FENCE = /^(`{3,}|~{3,})/;
const ASCIIDOC_FENCE = /^(-{4,})/;
/** The forms per extractor name. Unknown formats have none. */
export function statementForms(format: string): readonly StatementForm[] {
  switch (format) {
    case "markdown":
      return MARKDOWN_FORMS;
    case "mdx":
      return MDX_FORMS;
    case "html":
    case "xml":
      return COMMENT_FORMS;
    case "asciidoc":
      return ASCIIDOC_FORMS;
    case "rst":
      return RST_FORMS;
    default:
      return [];
  }
}

/** The fence-opener pattern for a format, or undefined when it has no locator. */
function fenceFor(format: string): RegExp | undefined {
  switch (format) {
    case "markdown":
    case "mdx":
      return MARKDOWN_FENCE;
    case "asciidoc":
      return ASCIIDOC_FENCE;
    default:
      return undefined;
  }
}

/** Offset of the terminator of the line containing `pos` (or the text length). */
function lineEnd(content: string, pos: number): number {
  const nl = content.indexOf("\n", pos);
  return nl === -1 ? content.length : nl;
}

/** The text of the line `[pos, end)`, without a trailing CR. */
function lineText(content: string, pos: number, end: number): string {
  const text = content.slice(pos, end);
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

/** `end` pulled back over a CR so a CRLF terminator is excluded whole. */
function beforeCr(content: string, end: number): number {
  return end > 0 && content.charCodeAt(end - 1) === 13 ? end - 1 : end;
}

/**
 * Where a forward scan of whole lines starts from `offset`: the next line when
 * `offset` sits inside one (the rest of a statement's own line), the line
 * itself when `offset` is already at its start.
 */
function nextLineStart(content: string, offset: number): number {
  if (offset === 0 || content.charCodeAt(offset - 1) === 10) return offset;
  return lineEnd(content, offset) + 1;
}

function payloadOf(payload: string): InlineStatement["payload"] {
  if (payload === "") return { kind: "bad", reason: "empty payload" };
  // An entry lives in frontmatter or a manifest; the body carries a name.
  if (payload.startsWith("{")) return { kind: "bad", reason: "a JSON payload", json: true };
  if (ID.test(payload)) return { kind: "ref", id: payload };
  return { kind: "bad", reason: "payload is not an id" };
}

/** Scan a body for statements. `from` maps body offsets/lines to file offsets/lines. */
export function parseStatements(
  body: string,
  format: string,
  from: { offset: number; line: number } = { offset: 0, line: 1 },
): InlineStatement[] {
  const out: InlineStatement[] = [];
  const fileLine = (bodyOffset: number): number =>
    from.line + lineAt(body, bodyOffset) - 1;
  const code = codeRegions(body, format);

  for (const form of statementForms(format)) {
    let cursor = 0;
    for (;;) {
      const at = body.indexOf(form.open, cursor);
      if (at === -1) break;
      const codeEnd = codeEndAt(code, at);
      if (codeEnd !== undefined) {
        cursor = codeEnd;
        continue;
      }
      const closeAt = body.indexOf(form.close, at + form.open.length);
      if (closeAt === -1) break;
      const end = closeAt + form.close.length;
      cursor = end;
      const inner = body.slice(at + form.open.length, closeAt).trim();
      if (!(inner === "cite" || (inner.startsWith("cite") && /\s/.test(inner.charAt(4))))) {
        continue;
      }
      const payload = inner.slice(4).trim();

      // Anchor: the rest of the close delimiter's line when it carries text,
      // else the paragraph or fenced block that follows.
      const unit = anchoredLines(body, end, format);
      const anchorLine = unit === undefined ? undefined : from.line + unit.start - 1;

      const statement: InlineStatement = {
        line: fileLine(at),
        payload: payloadOf(payload),
        raw: inner,
        start: from.offset + at,
        end: from.offset + end,
      };
      if (anchorLine !== undefined) statement.anchorLine = anchorLine;
      out.push(statement);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** `"\r\n"` when the text's first line break is CRLF, else `"\n"`. */
export function detectEol(text: string): "\n" | "\r\n" {
  const nl = text.indexOf("\n");
  return nl > 0 && text.charCodeAt(nl - 1) === 13 ? "\r\n" : "\n";
}

/**
 * The paragraph starting at or after `offset` (skipping blank lines), as
 * `{ start, end, line }` file offsets and the file line it starts on. A fence
 * opener ends the search with no paragraph.
 */
export function paragraphAfter(
  content: string,
  offset: number,
): { start: number; end: number; line: number } | undefined {
  let pos = offset;
  // The rest of the line `offset` sits in counts when it carries text; when
  // it is blank the paragraph can only start on a later line.
  const firstEnd = lineEnd(content, pos);
  if (lineText(content, pos, firstEnd).trim() === "") pos = firstEnd + 1;

  while (pos < content.length) {
    const end = lineEnd(content, pos);
    const text = lineText(content, pos, end);
    if (text.trim() === "") {
      pos = end + 1;
      continue;
    }
    if (ANY_FENCE.test(text)) return undefined;
    const start = pos;
    let last = end;
    let cursor = end + 1;
    while (cursor < content.length) {
      const e = lineEnd(content, cursor);
      const t = lineText(content, cursor, e);
      if (t.trim() === "" || ANY_FENCE.test(t)) break;
      last = e;
      cursor = e + 1;
    }
    return { start, end: beforeCr(content, last), line: lineAt(content, start) };
  }
  return undefined;
}

interface FencedBlock {
  start: number;
  end: number;
  line: number;
  text: string;
}

/**
 * The next fenced block whose opener matches `fence`, scanning whole lines
 * from `offset`, plus the offset just past its closing fence line so a caller
 * can continue.
 */
function scanFence(
  content: string,
  offset: number,
  fence: RegExp,
): (FencedBlock & { next: number }) | undefined {
  let pos = nextLineStart(content, offset);
  while (pos < content.length) {
    const end = lineEnd(content, pos);
    const text = lineText(content, pos, end);
    const opener = fence.exec(text)?.[1];
    if (opener === undefined) {
      pos = end + 1;
      continue;
    }
    const line = lineAt(content, pos);
    const start = Math.min(end + 1, content.length);
    let cursor = start;
    while (cursor < content.length) {
      const e = lineEnd(content, cursor);
      if (lineText(content, cursor, e).startsWith(opener)) {
        return {
          start,
          end: cursor,
          line,
          text: content.slice(start, cursor),
          next: e + 1,
        };
      }
      cursor = e + 1;
    }
    return undefined;
  }
  return undefined;
}

/**
 * The fenced code block starting at or after `offset` (``` or ~~~; asciidoc
 * `----`), as file offsets of its content lines and the file line of the
 * opening fence. `undefined` for formats with no locator (html, xml, rst).
 */
export function fencedBlockAfter(
  content: string,
  offset: number,
  format: string,
): { start: number; end: number; line: number; text: string } | undefined {
  const fence = fenceFor(format);
  if (!fence) return undefined;
  const block = scanFence(content, offset, fence);
  if (!block) return undefined;
  const { start, end, line, text } = block;
  return { start, end, line, text };
}

/**
 * The fenced block at `offset` in any fence family, for callers that have no
 * format at hand (the claim search). Undefined when the line at `offset` is
 * not an opener.
 */
export function fencedBlockAt(
  content: string,
  offset: number,
): { start: number; end: number; line: number; text: string } | undefined {
  const pos = nextLineStart(content, offset);
  if (!ANY_FENCE.test(lineText(content, pos, lineEnd(content, pos)))) {
    return undefined;
  }
  const block =
    scanFence(content, pos, MARKDOWN_FENCE) ?? scanFence(content, pos, ASCIIDOC_FENCE);
  if (!block || block.line !== lineAt(content, pos)) return undefined;
  const { start, end, line, text } = block;
  return { start, end, line, text };
}

/** Every fenced block in the body, for `--quote` without `--claim`. */
export function fencedBlocks(
  content: string,
  bodyOffset: number,
  format: string,
): { start: number; end: number; line: number; text: string }[] {
  const fence = fenceFor(format);
  if (!fence) return [];
  const out: FencedBlock[] = [];
  let pos = bodyOffset;
  for (;;) {
    const block = scanFence(content, pos, fence);
    if (!block) return out;
    const { start, end, line, text } = block;
    out.push({ start, end, line, text });
    pos = block.next;
  }
}

/** The form `formatStatement` writes for a format, or a refusal naming the format. */
function writtenForm(format: string): StatementForm {
  const form = statementForms(format)[0];
  if (!form) {
    throw new CiteError(`No marker syntax for format "${format}".`);
  }
  return form;
}

/** Render a marker in the format's first form, e.g. `<!-- cite fetch-timeout -->`. */
export function formatStatement(format: string, payload: { kind: "ref"; id: string }): string {
  const form = writtenForm(format);
  // `[comment]: # (`, `// (` and `.. (` hug their parentheses; the comment
  // forms take a space inside each delimiter.
  const pad = form.open.endsWith("(") ? "" : " ";
  return `${form.open}${pad}cite ${payload.id}${pad}${form.close}`;
}

/** The first non-blank line at or after `offset`, as a 1-based line of `text`. */
function nextNonBlankLine(text: string, offset: number): number | undefined {
  let pos = nextLineStart(text, offset);
  while (pos < text.length) {
    const end = lineEnd(text, pos);
    if (lineText(text, pos, end).trim() !== "") return lineAt(text, pos);
    pos = end + 1;
  }
  return undefined;
}

/**
 * The fenced block opening on `line`, as the lines it spans, fences included.
 * Undefined when that line is not an opener the format knows, or the block is
 * never closed.
 */
export function fenceSpanAt(
  text: string,
  line: number,
  format: string,
): { start: number; end: number } | undefined {
  const fence = fenceFor(format);
  if (!fence) return undefined;
  const block = scanFence(text, offsetOfLine(text, line), fence);
  if (!block || block.line !== line) return undefined;
  return { start: line, end: lineAt(text, block.end) };
}

/** Whether `line` sits inside a fenced block rather than opening one. */
export function insideFence(
  text: string,
  bodyOffset: number,
  line: number,
  format: string,
): boolean {
  return fencedBlocks(text, bodyOffset, format).some(
    (block) => line > block.line && line <= lineAt(text, block.end),
  );
}

/**
 * The lines a marker anchors, as 1-based lines of `text`: the rest of its own
 * line when that carries text, else the paragraph or fenced block that
 * follows. With `quote`, the next fenced block after it, wherever that is.
 * Undefined when nothing follows to anchor.
 */
export function anchoredLines(
  text: string,
  after: number,
  format: string,
  quote = false,
): { start: number; end: number } | undefined {
  if (quote) {
    const block = fencedBlockAfter(text, after, format);
    return block === undefined ? undefined : { start: block.line, end: lineAt(text, block.end) };
  }
  const restEnd = lineEnd(text, after);
  if (text.slice(after, restEnd).trim() !== "") {
    const line = lineAt(text, after);
    return { start: line, end: line };
  }
  const paragraph = paragraphAfter(text, after);
  if (paragraph !== undefined) {
    return { start: paragraph.line, end: lineAt(text, paragraph.end) };
  }
  // A fence where a paragraph would be: the block is what the marker anchors.
  const line = nextNonBlankLine(text, after);
  return line === undefined ? undefined : fenceSpanAt(text, line, format);
}

/** 1-based file line of a file offset, counting CRLF once. */
export function lineAt(content: string, offset: number): number {
  const stop = Math.min(offset, content.length);
  let line = 1;
  for (let i = 0; i < stop; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** File offset of the first character of a 1-based line (the length when past the end). */
export function offsetOfLine(content: string, line: number): number {
  let pos = 0;
  for (let n = 1; n < line; n++) {
    const nl = content.indexOf("\n", pos);
    if (nl === -1) return content.length;
    pos = nl + 1;
  }
  return pos;
}
