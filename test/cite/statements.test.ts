/**
 * Marker scanning, and the line geometry every other module reads through it:
 * paragraphs, fenced blocks, and what a marker anchors.
 *
 * A marker is `cite <id>` in the format's comment syntax and carries nothing
 * else. A JSON payload was the inline entry of proposal 0044's first draft; it
 * is a bad payload now, because an entry lives in frontmatter or a manifest.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  anchoredLines,
  detectEol,
  fenceSpanAt,
  fencedBlockAfter,
  fencedBlockAt,
  fencedBlocks,
  formatStatement,
  insideFence,
  isMarkerLine,
  isTableSeparator,
  lineAt,
  offsetOfLine,
  paragraphAfter,
  parseStatements,
  respellStatement,
  statementForms,
} from "../../src/cite/core/statements.js";
import { MAX_IDS_PER_MARKER } from "../../src/cite/core/page.js";
import { CiteError } from "../../src/cite/errors.js";
import { readPage as parsePage } from "../../src/cite/core/page.js";
import type { InlineStatement } from "../../src/cite/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const readPage = (name: string): string =>
  readFileSync(`${here}/../fixtures/cite/pages/${name}`, "utf8");

/** The statements `readPage` finds in a whole page, frontmatter and all. */
const readPageStatements = (content: string): InlineStatement[] =>
  parsePage("page.md", content).statements;

describe("statementForms", () => {
  it("markdown and mdx share three forms, and carry no json flag", () => {
    expect(statementForms("markdown")).toEqual([
      { open: "<!--", close: "-->" },
      { open: "{/*", close: "*/}" },
      { open: "[comment]: # (", close: ")" },
    ]);
    // MDX rejects an HTML comment, so its first form is the JSX comment.
    expect(statementForms("mdx")).toEqual([
      { open: "{/*", close: "*/}" },
      { open: "<!--", close: "-->" },
      { open: "[comment]: # (", close: ")" },
    ]);
  });

  it("html and xml have the comment form only", () => {
    for (const format of ["html", "xml"]) {
      expect(statementForms(format)).toEqual([{ open: "<!--", close: "-->" }]);
    }
  });

  it("asciidoc and rst have one form each", () => {
    expect(statementForms("asciidoc")).toEqual([{ open: "// (", close: ")" }]);
    expect(statementForms("rst")).toEqual([{ open: ".. (", close: ")" }]);
  });

  it("an unknown format has no forms", () => {
    expect(statementForms("nope")).toEqual([]);
  });
});

describe("parseStatements", () => {
  it("parses a marker with its anchor, raw text and offsets", () => {
    const body =
      "Retries default to 3.\n\nSome other text.\n\n<!-- cite retries -->\nRetries default to 3. Really.\n";
    const [st, ...rest] = parseStatements(body, "markdown");
    expect(rest).toEqual([]);
    expect(st).toBeDefined();
    if (!st) return;
    expect(st.line).toBe(5);
    expect(st.anchorLine).toBe(6);
    expect(st.payload).toEqual({ kind: "ref", ids: ["retries"] });
    expect(st.raw).toBe("cite retries");
    expect(body.slice(st.start, st.end)).toBe("<!-- cite retries -->");
  });

  it("maps body offsets and lines to file offsets and lines through `from`", () => {
    const frontmatter = "---\ntitle: x\n---\n";
    const body = "# Title\n\n<!-- cite fetch-timeout -->\nThe claim.\n";
    const content = frontmatter + body;
    const [st] = parseStatements(body, "markdown", { offset: frontmatter.length, line: 4 });
    expect(st).toBeDefined();
    if (!st) return;
    expect(st.line).toBe(6);
    expect(st.anchorLine).toBe(7);
    expect(content.slice(st.start, st.end)).toBe("<!-- cite fetch-timeout -->");
  });

  it("`cite true` names the id `true`", () => {
    expect(parseStatements("<!-- cite true -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "ref",
      ids: ["true"],
    });
  });

  it("a JSON payload is a bad payload, flagged as json", () => {
    const body = '<!-- cite {"source": {"file": "src/limits.ts"}} -->\nx\n';
    expect(parseStatements(body, "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "a JSON payload",
      json: true,
    });
    // Every form says the same: there is no form an entry may be written in.
    expect(parseStatements('{/* cite {"a":1} */}\nx\n', "mdx")[0]?.payload).toMatchObject({
      kind: "bad",
      json: true,
    });
    expect(parseStatements('[comment]: # (cite {"a":1})\nx\n', "markdown")[0]?.payload).toMatchObject(
      { kind: "bad", json: true },
    );
  });

  it("parses the mdx expression form", () => {
    expect(parseStatements("{/* cite fetch-timeout */}\nx\n", "mdx")[0]?.payload).toEqual({
      kind: "ref",
      ids: ["fetch-timeout"],
    });
  });

  it("parses the markdown link-reference form", () => {
    expect(
      parseStatements("[comment]: # (cite fetch-timeout)\nx\n", "markdown")[0]?.payload,
    ).toEqual({ kind: "ref", ids: ["fetch-timeout"] });
  });

  it("parses the asciidoc and rst forms", () => {
    expect(parseStatements("// (cite fetch-timeout)\nx\n", "asciidoc")[0]?.payload).toEqual({
      kind: "ref",
      ids: ["fetch-timeout"],
    });
    expect(parseStatements(".. (cite fetch-timeout)\nx\n", "rst")[0]?.payload).toEqual({
      kind: "ref",
      ids: ["fetch-timeout"],
    });
  });

  it("parses the comment form in html with line and anchor", () => {
    const st = parseStatements(
      "<p>x</p>\n<!-- cite fetch-timeout -->\n<p>The claim.</p>\n",
      "html",
    )[0];
    expect(st).toMatchObject({
      line: 2,
      anchorLine: 3,
      payload: { kind: "ref", ids: ["fetch-timeout"] },
      raw: "cite fetch-timeout",
    });
  });

  it("anchors to the rest of the marker's own line when it is not blank", () => {
    expect(
      parseStatements("<!-- cite fetch-timeout --> The claim.\n", "markdown")[0]?.anchorLine,
    ).toBe(1);
  });

  it("skips blank lines to find the anchored paragraph", () => {
    expect(parseStatements("<!-- cite x -->\n\n\nThe claim.\n", "markdown")[0]?.anchorLine).toBe(4);
  });

  it("anchors the fenced block that sits where a paragraph would", () => {
    // `parseStatements` anchors without `quote`, and a fence where the
    // paragraph would be is still what the marker sits above.
    expect(
      parseStatements("<!-- cite x -->\n```ts\nconst a = 1;\n```\n", "markdown")[0]?.anchorLine,
    ).toBe(2);
  });

  it("has no anchor when nothing follows", () => {
    expect(parseStatements("<!-- cite x -->\n", "markdown")[0]?.anchorLine).toBeUndefined();
    expect(parseStatements("<!-- cite x -->\n\n\n", "markdown")[0]?.anchorLine).toBeUndefined();
  });

  it("anchors a list item and stops at the fence indented inside it", () => {
    const body = "<!-- cite x -->\n- Step one.\n  ```\n  Step two.\n  ```\n";
    expect(parseStatements(body, "markdown")[0]?.anchorLine).toBe(2);
    const paragraph = paragraphAfter(body, body.indexOf("- Step"));
    expect(paragraph).toMatchObject({ line: 2 });
    expect(paragraph === undefined ? undefined : body.slice(paragraph.start, paragraph.end)).toBe(
      "- Step one.",
    );
  });

  it("ignores comments that are not markers", () => {
    expect(
      parseStatements("<!-- citeable -->\n<!-- todo -->\n<!-- cite-x -->\nx\n", "markdown"),
    ).toEqual([]);
  });

  it("treats a bare `cite` with no whitespace after it as an empty payload", () => {
    expect(parseStatements("<!--cite-->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "empty payload",
    });
  });

  it("reports an empty payload and a payload that is not an id", () => {
    expect(parseStatements("<!-- cite -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "empty payload",
    });
    // A list has several words and only one of them is wrong, so the message
    // names the word that failed, leftmost first (proposal 0056).
    expect(parseStatements("<!-- cite Fetch Timeout -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: '"Fetch" is not an id',
    });
    expect(parseStatements("<!-- cite -Leading -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: '"-Leading" is not an id',
    });
  });

  it("returns statements in document order across forms", () => {
    const body = "[comment]: # (cite b)\nx\n\n<!-- cite a -->\ny\n\n{/* cite c */}\nz\n";
    expect(parseStatements(body, "markdown").map((s) => s.payload)).toEqual([
      { kind: "ref", ids: ["b"] },
      { kind: "ref", ids: ["a"] },
      { kind: "ref", ids: ["c"] },
    ]);
  });

  it("counts CRLF line endings once", () => {
    const body = "# T\r\n\r\n<!-- cite x -->\r\nThe claim.\r\n";
    const st = parseStatements(body, "markdown")[0];
    expect(st?.line).toBe(3);
    expect(st?.anchorLine).toBe(4);
  });

  it("reports a multi-line marker at its opening line and anchors after its close", () => {
    const body = "<!-- cite\n  fetch-timeout\n-->\nThe claim.\n";
    const st = parseStatements(body, "markdown")[0];
    expect(st?.line).toBe(1);
    expect(st?.anchorLine).toBe(4);
    expect(st?.payload).toEqual({ kind: "ref", ids: ["fetch-timeout"] });
  });

  it("finds nothing for a format with no forms", () => {
    expect(parseStatements("<!-- cite x -->\n", "nope")).toEqual([]);
  });
});

/**
 * Proposal 0056: a marker's payload is one or more ids, separated by spaces.
 * A payload of one id is what 0044 shipped, byte for byte and meaning for
 * meaning, which is what every page written before this grammar relies on.
 */
describe("parseStatements reads a list of ids", () => {
  const payloadOf = (body: string, format = "markdown"): unknown =>
    parseStatements(body, format)[0]?.payload;

  it("reads several ids from one marker, in the order written", () => {
    expect(payloadOf("<!-- cite fetch-timeout retries backoff -->\nx\n")).toEqual({
      kind: "ref",
      ids: ["fetch-timeout", "retries", "backoff"],
    });
  });

  it("reads a list in every parenthesised form, which no id can close early", () => {
    expect(payloadOf("[comment]: # (cite fetch-timeout retries)\nx\n")).toEqual({
      kind: "ref",
      ids: ["fetch-timeout", "retries"],
    });
    expect(payloadOf("// (cite fetch-timeout retries)\nx\n", "asciidoc")).toEqual({
      kind: "ref",
      ids: ["fetch-timeout", "retries"],
    });
    expect(payloadOf(".. (cite fetch-timeout retries)\nx\n", "rst")).toEqual({
      kind: "ref",
      ids: ["fetch-timeout", "retries"],
    });
    expect(payloadOf("{/* cite fetch-timeout retries */}\nx\n", "mdx")).toEqual({
      kind: "ref",
      ids: ["fetch-timeout", "retries"],
    });
  });

  it("separates on a run of spaces as one, as an editor and a shell both do", () => {
    expect(payloadOf("<!-- cite   fetch-timeout    retries -->\nx\n")).toEqual({
      kind: "ref",
      ids: ["fetch-timeout", "retries"],
    });
  });

  it("anchors the same text for every id in the list", () => {
    const body = "<!-- cite fetch-timeout retries -->\nThe claim.\n";
    const st = parseStatements(body, "markdown")[0];
    expect(st?.line).toBe(1);
    expect(st?.anchorLine).toBe(2);
  });

  it("is a comma that is not a separator: the token is one word, and not an id", () => {
    expect(payloadOf("<!-- cite fetch-timeout,retries -->\nx\n")).toEqual({
      kind: "bad",
      reason: '"fetch-timeout,retries" is not an id',
    });
  });

  it("refuses a line break in the payload: a marker is one line", () => {
    expect(payloadOf("<!-- cite fetch-timeout\n  retries -->\nx\n")).toEqual({
      kind: "bad",
      reason: "a marker is one line; write two markers",
    });
  });

  it("refuses more than 25 ids, with the count", () => {
    const ids = Array.from({ length: 31 }, (_v, n) => `id-${String(n)}`).join(" ");
    expect(payloadOf(`<!-- cite ${ids} -->\nx\n`)).toEqual({
      kind: "bad",
      reason: "more than 25 ids in one marker (31); write a second marker",
    });
    const cap = Array.from({ length: 25 }, (_v, n) => `id-${String(n)}`);
    expect(payloadOf(`<!-- cite ${cap.join(" ")} -->\nx\n`)).toEqual({ kind: "ref", ids: cap });
    expect(MAX_IDS_PER_MARKER).toBe(25);
  });

  it("refuses an id named twice in one marker, naming the leftmost repeat", () => {
    expect(payloadOf("<!-- cite retries backoff retries -->\nx\n")).toEqual({
      kind: "bad",
      reason: '"retries" is named twice in one marker',
    });
  });

  it("names the leftmost word that is not an id", () => {
    expect(payloadOf("<!-- cite retries Backoff Jitter -->\nx\n")).toEqual({
      kind: "bad",
      reason: '"Backoff" is not an id',
    });
  });

  it("reads a word opening with a brace as a misplaced entry, wherever it sits", () => {
    expect(payloadOf('<!-- cite retries {"a":1} -->\nx\n')).toMatchObject({
      kind: "bad",
      json: true,
    });
  });
});

describe("parseStatements does not read code", () => {
  const ids = (body: string, format: string): string[] =>
    parseStatements(body, format).map((s) =>
      s.payload.kind === "ref" ? s.payload.ids.join(" ") : s.payload.kind,
    );

  it("ignores a marker inside a fenced block, backtick or tilde", () => {
    expect(ids("```md\n<!-- cite fenced -->\nThe claim.\n```\n", "markdown")).toEqual([]);
    expect(ids("~~~\n{/* cite fenced */}\n~~~\n", "mdx")).toEqual([]);
    expect(ids("```\n[comment]: # (cite fenced)\n```\n", "markdown")).toEqual([]);
  });

  it("ignores a fence indented inside a list item, and a shorter fence nested in a longer one", () => {
    const list = "1. Step.\n\n   ```md\n   <!-- cite fenced -->\n   The claim.\n   ```\n\n2. Next.\n";
    expect(ids(list, "mdx")).toEqual([]);
    const nested = "````md\n<!-- cite outer -->\n```ts\ncode\n```\n<!-- cite still-inside -->\n````\n";
    expect(ids(nested, "markdown")).toEqual([]);
  });

  it("ignores a marker inside a backtick span, whatever the backtick count", () => {
    expect(ids("Write `<!-- cite id -->` above the paragraph.\n", "markdown")).toEqual([]);
    expect(ids("Write `` `<!-- cite x -->` `` to show it.\n", "markdown")).toEqual([]);
    const row = "| markdown | `<!-- cite ID -->`, `{/* cite ID */}`, `[comment]: # (cite ID)` |\n";
    expect(ids(row, "mdx")).toEqual([]);
  });

  it("an unclosed backtick is not a span, so the marker after it is read", () => {
    expect(ids("A stray ` here.\n<!-- cite real -->\nThe claim.\n", "markdown")).toEqual(["real"]);
  });

  it("still finds a real marker after a fence, and one between two fences", () => {
    const body =
      "```md\n<!-- cite fenced -->\n```\n\n<!-- cite real -->\nThe claim.\n\n```\n<!-- cite fenced-again -->\n```\n";
    const [st, ...rest] = parseStatements(body, "markdown");
    expect(rest).toEqual([]);
    expect(st?.payload).toEqual({ kind: "ref", ids: ["real"] });
    expect(st?.line).toBe(5);
    expect(st?.anchorLine).toBe(6);
  });

  it("an unclosed fence runs to the end of the body, as a renderer reads it", () => {
    expect(ids("```\n<!-- cite fenced -->\n\n<!-- cite also-fenced -->\n", "markdown")).toEqual([]);
  });

  it("a fence inside the frontmatter is irrelevant: the scanner sees the body only", () => {
    const content = '---\ntitle: x\ndescription: "```"\n---\n\n<!-- cite real -->\nThe claim.\n';
    expect(readPageStatements(content).map((s) => s.line)).toEqual([6]);
  });

  it("ignores a marker inside an asciidoc listing block", () => {
    expect(ids("----\n// (cite fenced)\n----\n\n// (cite real)\nThe claim.\n", "asciidoc")).toEqual([
      "real",
    ]);
  });

  it("html has no fences: a marker in a <pre> is still a marker", () => {
    expect(ids("<pre>\n<!-- cite in-pre -->\n</pre>\n", "html")).toEqual(["in-pre"]);
  });
});

describe("detectEol, lineAt and offsetOfLine", () => {
  it("detects the first line break's flavour", () => {
    expect(detectEol("a\nb\r\n")).toBe("\n");
    expect(detectEol("a\r\nb\n")).toBe("\r\n");
    expect(detectEol("no break")).toBe("\n");
  });

  it("gives the 1-based line of an offset, counting CRLF once", () => {
    expect(lineAt("a\nb\nc", 0)).toBe(1);
    expect(lineAt("a\nb\nc", 2)).toBe(2);
    expect(lineAt("a\r\nb\r\nc", 6)).toBe(3);
    expect(lineAt("a\nb\n", 4)).toBe(3);
  });

  it("gives the offset a line starts at, and the length past the end", () => {
    const text = "a\nbb\nccc\n";
    expect(offsetOfLine(text, 1)).toBe(0);
    expect(offsetOfLine(text, 3)).toBe(5);
    expect(offsetOfLine(text, 99)).toBe(text.length);
    expect(lineAt(text, offsetOfLine(text, 3))).toBe(3);
  });
});

describe("paragraphAfter", () => {
  it("skips blank lines and spans the run of non-blank lines", () => {
    const content = "x\n\n\nFirst line\nsecond line\n\nnext\n";
    const p = paragraphAfter(content, 1);
    expect(p).toBeDefined();
    if (!p) return;
    expect(content.slice(p.start, p.end)).toBe("First line\nsecond line");
    expect(p.line).toBe(4);
  });

  it("excludes the CR of a CRLF terminator from the paragraph", () => {
    const content = "x\r\n\r\nFirst\r\nsecond\r\n\r\n";
    const p = paragraphAfter(content, 1);
    expect(p).toBeDefined();
    if (!p) return;
    expect(content.slice(p.start, p.end)).toBe("First\r\nsecond");
    expect(p.line).toBe(3);
  });

  it("is undefined when a fence opener comes first, or nothing follows", () => {
    expect(paragraphAfter("x\n\n```ts\ncode\n```\n", 1)).toBeUndefined();
    expect(paragraphAfter("x\n\n~~~\ncode\n~~~\n", 1)).toBeUndefined();
    expect(paragraphAfter("x\n\n\n", 1)).toBeUndefined();
  });

  it("stops the paragraph at a fence opener", () => {
    const content = "Para\n```\ncode\n```\n";
    const p = paragraphAfter(content, 0);
    expect(p && content.slice(p.start, p.end)).toBe("Para");
  });
});

describe("fencedBlockAfter, fencedBlockAt and fencedBlocks", () => {
  it("finds a backtick block in markdown with content offsets, line and text", () => {
    const content = "<!-- cite x -->\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n";
    const b = fencedBlockAfter(content, "<!-- cite x -->".length, "markdown");
    expect(b).toBeDefined();
    if (!b) return;
    expect(b.line).toBe(3);
    expect(b.text).toBe("const a = 1;\nconst b = 2;\n");
    expect(content.slice(b.start, b.end)).toBe(b.text);
  });

  it("finds a tilde block in mdx and a ---- block in asciidoc", () => {
    const md = "x\n~~~\ncode\n~~~\n";
    expect(fencedBlockAfter(md, 1, "mdx")?.text).toBe("code\n");
    const adoc = "x\n[source,ts]\n----\ncode\n----\n";
    const b = fencedBlockAfter(adoc, 1, "asciidoc");
    expect(b?.text).toBe("code\n");
    expect(b?.line).toBe(3);
  });

  it("has no locator for html, xml and rst", () => {
    const content = "x\n```\ncode\n```\n";
    for (const format of ["html", "xml", "rst"]) {
      expect(fencedBlockAfter(content, 1, format)).toBeUndefined();
    }
  });

  it("is undefined for an unclosed fence or no fence at all", () => {
    expect(fencedBlockAfter("x\n```\ncode\n", 1, "markdown")).toBeUndefined();
    expect(fencedBlockAfter("x\nprose\n", 1, "markdown")).toBeUndefined();
  });

  it("fencedBlockAt reads the block only when the offset's line opens one", () => {
    const content = "prose\n```ts\ncode\n```\n";
    expect(fencedBlockAt(content, content.indexOf("```"))?.text).toBe("code\n");
    expect(fencedBlockAt(content, 0)).toBeUndefined();
  });

  it("lists every block after the body offset", () => {
    const content = readPage("quote.md");
    const bodyOffset = content.indexOf("# Limits");
    const blocks = fencedBlocks(content, bodyOffset, "markdown");
    expect(blocks.map((b) => b.line)).toEqual([16]);
    expect(blocks[0]?.text).toBe(
      "export const MAX_FILES = 10_000;\nexport const FETCH_TIMEOUT_MS = 10_000;\nexport const RETRIES = 3;\n",
    );
    expect(fencedBlocks(content, bodyOffset, "rst")).toEqual([]);
  });
});

describe("fenceSpanAt and insideFence", () => {
  it("spans the block opening on a line, fences included", () => {
    const content = "# T\n\n```ts\nconst a = 1;\n```\n\nprose\n";
    expect(fenceSpanAt(content, 3, "markdown")).toEqual({ start: 3, end: 5 });
  });

  it("is undefined when the line does not open a block, or the format has no locator", () => {
    const content = "# T\n\n```ts\nconst a = 1;\n```\n";
    expect(fenceSpanAt(content, 4, "markdown")).toBeUndefined();
    expect(fenceSpanAt(content, 1, "markdown")).toBeUndefined();
    expect(fenceSpanAt(content, 3, "rst")).toBeUndefined();
    expect(fenceSpanAt("```ts\nnever closed\n", 1, "markdown")).toBeUndefined();
  });

  it("insideFence is true between the fences and false on either of them", () => {
    const content = "# T\n\n```ts\nconst a = 1;\n```\n\nprose\n";
    expect(insideFence(content, 0, 3, "markdown")).toBe(false);
    expect(insideFence(content, 0, 4, "markdown")).toBe(true);
    expect(insideFence(content, 0, 5, "markdown")).toBe(true);
    expect(insideFence(content, 0, 7, "markdown")).toBe(false);
    // rst has no locator, so nothing is ever inside a fence there.
    expect(insideFence(content, 0, 4, "rst")).toBe(false);
  });
});

describe("anchoredLines", () => {
  it("takes the rest of the marker's own line when it carries text", () => {
    const content = "# T\n\n<!-- cite x --> The claim.\n\nmore\n";
    const after = content.indexOf("-->") + 3;
    expect(anchoredLines(content, after, "markdown")).toEqual({ start: 3, end: 3 });
  });

  it("takes the paragraph that follows, to its last line", () => {
    const content = "<!-- cite x -->\nThe claim. It is\nnot configurable.\n\nnext\n";
    const after = content.indexOf("-->") + 3;
    expect(anchoredLines(content, after, "markdown")).toEqual({ start: 2, end: 3 });
  });

  it("skips markers stacked below it, in every form, and never pins them", () => {
    const content = [
      "<!-- cite a -->",
      "{/* cite b */}",
      "[comment]: # (cite c)",
      "The claim. It is",
      "not configurable.",
      "<!-- cite d -->",
      "Next.",
    ].join("\n");
    for (const format of ["markdown", "mdx"]) {
      const after = content.indexOf("-->") + 3;
      expect(anchoredLines(content, after, format)).toEqual({ start: 4, end: 5 });
    }
    const adoc = "// (cite a)\n// (cite b)\n----\ncode\n----\n";
    expect(anchoredLines(adoc, adoc.indexOf(")") + 1, "asciidoc")).toEqual({ start: 3, end: 5 });
    // A line with text beside the marker is not a marker-only line.
    const beside = "<!-- cite a -->\n<!-- cite b --> The claim.\n";
    expect(anchoredLines(beside, beside.indexOf("-->") + 3, "markdown")).toEqual({ start: 2, end: 2 });
  });

  it("skips indented markers stacked in a list item, spaces or tabs", () => {
    const content = [
      "1. Step.",
      "",
      "   {/* cite a */}",
      "   {/* cite b */}",
      "   The claim, in the item.",
      "",
      "2. Next.",
    ].join("\n");
    expect(anchoredLines(content, content.indexOf("*/}") + 3, "mdx")).toEqual({ start: 5, end: 5 });
    const tabbed = "\t<!-- cite a -->\n\t<!-- cite b -->\n\tThe claim.\n";
    expect(anchoredLines(tabbed, tabbed.indexOf("-->") + 3, "markdown")).toEqual({ start: 3, end: 3 });
  });

  it("takes the fenced block when one sits where the paragraph would", () => {
    const content = "<!-- cite x -->\n```ts\nconst a = 1;\n```\n";
    const after = content.indexOf("-->") + 3;
    expect(anchoredLines(content, after, "markdown")).toEqual({ start: 2, end: 4 });
  });

  it("under quote, takes the next fenced block wherever it is", () => {
    const content = "<!-- cite x -->\nsome prose first\n\n```ts\nconst a = 1;\n```\n";
    const after = content.indexOf("-->") + 3;
    expect(anchoredLines(content, after, "markdown", true)).toEqual({ start: 4, end: 6 });
    // Without quote the prose is what it anchors.
    expect(anchoredLines(content, after, "markdown")).toEqual({ start: 2, end: 2 });
  });

  it("is undefined when nothing follows, and when quote finds no block", () => {
    expect(anchoredLines("<!-- cite x -->\n", 15, "markdown")).toBeUndefined();
    expect(anchoredLines("<!-- cite x -->\nprose only\n", 15, "markdown", true)).toBeUndefined();
    // rst has no fence locator, so quote can never anchor there.
    expect(anchoredLines("<!-- cite x -->\n```\nc\n```\n", 15, "rst", true)).toBeUndefined();
  });
});

describe("formatStatement", () => {
  it("renders a marker in each format's first form", () => {
    const ref = { kind: "ref", ids: ["fetch-timeout"] } as const;
    expect(formatStatement("markdown", ref)).toBe("<!-- cite fetch-timeout -->");
    expect(formatStatement("mdx", ref)).toBe("{/* cite fetch-timeout */}");
    expect(formatStatement("html", ref)).toBe("<!-- cite fetch-timeout -->");
    expect(formatStatement("xml", ref)).toBe("<!-- cite fetch-timeout -->");
    expect(formatStatement("asciidoc", ref)).toBe("// (cite fetch-timeout)");
    expect(formatStatement("rst", ref)).toBe(".. (cite fetch-timeout)");
  });

  it("round-trips through the scanner in every format", () => {
    for (const format of ["markdown", "mdx", "html", "asciidoc", "rst"]) {
      const text = formatStatement(format, { kind: "ref", ids: ["fetch-timeout"] });
      expect(parseStatements(`${text}\nThe claim.\n`, format)[0]?.payload).toEqual({
        kind: "ref",
        ids: ["fetch-timeout"],
      });
    }
  });

  it("writes several ids, one space between words", () => {
    const ref = { kind: "ref", ids: ["fetch-timeout", "retries"] } as const;
    expect(formatStatement("markdown", ref)).toBe("<!-- cite fetch-timeout retries -->");
    expect(formatStatement("mdx", ref)).toBe("{/* cite fetch-timeout retries */}");
    expect(formatStatement("asciidoc", ref)).toBe("// (cite fetch-timeout retries)");
    expect(parseStatements(`${formatStatement("mdx", ref)}\nThe claim.\n`, "mdx")[0]?.payload).toEqual(
      { kind: "ref", ids: ["fetch-timeout", "retries"] },
    );
  });

  it("will not take an empty list, which would write a marker with no id", () => {
    const empty: string[] = [];
    // @ts-expect-error a ref carries at least one id, so `[]` is a type error
    // rather than a `<!-- cite  -->` the scanner then calls malformed.
    formatStatement("markdown", { kind: "ref", ids: empty });
    const content = "<!-- cite retries -->\nThe claim.\n";
    const [statement] = parseStatements(content, "markdown");
    if (statement === undefined) throw new Error("no statement");
    // @ts-expect-error the same guarantee on the respelling side.
    respellStatement(content, statement, empty);
  });

  it("refuses a format with no marker syntax", () => {
    expect(() => formatStatement("nope", { kind: "ref", ids: ["x"] })).toThrow(CiteError);
    expect(() => formatStatement("nope", { kind: "ref", ids: ["x"] })).toThrow(
      'No marker syntax for format "nope".',
    );
  });
});

describe("respellStatement", () => {
  const only = (content: string, format: string): InlineStatement => {
    const [st] = parseStatements(content, format);
    if (st === undefined) throw new Error("no statement");
    return st;
  };

  it("appends an id, keeping the marker's own form and spacing", () => {
    const content = "{/* cite fetch-timeout retries */}\nThe claim.\n";
    const st = only(content, "mdx");
    expect(respellStatement(content, st, ["fetch-timeout", "retries", "backoff"])).toBe(
      "{/* cite fetch-timeout retries backoff */}\nThe claim.\n",
    );
  });

  it("keeps a form the writer would not have chosen, and the indentation", () => {
    const content = "   <!-- cite retries -->\nThe claim.\n";
    const st = only(content, "mdx");
    expect(respellStatement(content, st, ["retries", "backoff"])).toBe(
      "   <!-- cite retries backoff -->\nThe claim.\n",
    );
  });

  it("drops an id, leaving the rest of the list where it was", () => {
    const content = "[comment]: # (cite a b c)\nThe claim.\n";
    const st = only(content, "markdown");
    expect(respellStatement(content, st, ["a", "c"])).toBe(
      "[comment]: # (cite a c)\nThe claim.\n",
    );
  });
});

describe("isMarkerLine", () => {
  it("is true for a marker alone on its line, whatever its indentation", () => {
    for (const line of ["<!-- cite x -->", "   <!-- cite x -->", "\t<!-- cite x -->", "  <!-- cite x -->  "]) {
      expect(isMarkerLine(line, "markdown")).toBe(true);
    }
    expect(isMarkerLine("     {/* cite x */}", "mdx")).toBe(true);
    expect(isMarkerLine("  .. (cite x)", "rst")).toBe(true);
  });

  it("is false for text beside a marker, or a comment that is not a cite", () => {
    expect(isMarkerLine("   <!-- cite x --> The claim.", "markdown")).toBe(false);
    expect(isMarkerLine("   <!-- a note -->", "markdown")).toBe(false);
    expect(isMarkerLine("   The claim.", "markdown")).toBe(false);
  });
});

describe("isTableSeparator", () => {
  it("reads a rule with outer pipes, alignment markers or indentation", () => {
    expect(isTableSeparator("|---|---|")).toBe(true);
    expect(isTableSeparator("| --- | --- |")).toBe(true);
    expect(isTableSeparator("| :--- | ---: | :---: |")).toBe(true);
    expect(isTableSeparator("---|---")).toBe(true);
    expect(isTableSeparator("  |---|---|")).toBe(true);
    expect(isTableSeparator("|---|")).toBe(true);
  });

  it("reads a header row, a body row and a bare pipe as something else", () => {
    expect(isTableSeparator("| Flag | Default |")).toBe(false);
    expect(isTableSeparator("| `--retries` | 5 |")).toBe(false);
    expect(isTableSeparator("|")).toBe(false);
    expect(isTableSeparator("")).toBe(false);
  });

  it("reads a bare rule as something else, because it carries no pipe", () => {
    // `---` is a thematic break, or the underline of a setext heading.
    expect(isTableSeparator("---")).toBe(false);
    expect(isTableSeparator("  ---  ")).toBe(false);
  });
});
