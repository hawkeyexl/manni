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
  lineAt,
  offsetOfLine,
  paragraphAfter,
  parseStatements,
  statementForms,
} from "../../src/cite/core/statements.js";
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
    expect(st.payload).toEqual({ kind: "ref", id: "retries" });
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
      id: "true",
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
      id: "fetch-timeout",
    });
  });

  it("parses the markdown link-reference form", () => {
    expect(
      parseStatements("[comment]: # (cite fetch-timeout)\nx\n", "markdown")[0]?.payload,
    ).toEqual({ kind: "ref", id: "fetch-timeout" });
  });

  it("parses the asciidoc and rst forms", () => {
    expect(parseStatements("// (cite fetch-timeout)\nx\n", "asciidoc")[0]?.payload).toEqual({
      kind: "ref",
      id: "fetch-timeout",
    });
    expect(parseStatements(".. (cite fetch-timeout)\nx\n", "rst")[0]?.payload).toEqual({
      kind: "ref",
      id: "fetch-timeout",
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
      payload: { kind: "ref", id: "fetch-timeout" },
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
    expect(parseStatements("<!-- cite Fetch Timeout -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "payload is not an id",
    });
    expect(parseStatements("<!-- cite -Leading -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "payload is not an id",
    });
  });

  it("returns statements in document order across forms", () => {
    const body = "[comment]: # (cite b)\nx\n\n<!-- cite a -->\ny\n\n{/* cite c */}\nz\n";
    expect(parseStatements(body, "markdown").map((s) => s.payload)).toEqual([
      { kind: "ref", id: "b" },
      { kind: "ref", id: "a" },
      { kind: "ref", id: "c" },
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
    expect(st?.payload).toEqual({ kind: "ref", id: "fetch-timeout" });
  });

  it("finds nothing for a format with no forms", () => {
    expect(parseStatements("<!-- cite x -->\n", "nope")).toEqual([]);
  });
});

describe("parseStatements does not read code", () => {
  const ids = (body: string, format: string): string[] =>
    parseStatements(body, format).map((s) =>
      s.payload.kind === "ref" ? s.payload.id : s.payload.kind,
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
    expect(st?.payload).toEqual({ kind: "ref", id: "real" });
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
    const ref = { kind: "ref", id: "fetch-timeout" } as const;
    expect(formatStatement("markdown", ref)).toBe("<!-- cite fetch-timeout -->");
    expect(formatStatement("mdx", ref)).toBe("{/* cite fetch-timeout */}");
    expect(formatStatement("html", ref)).toBe("<!-- cite fetch-timeout -->");
    expect(formatStatement("xml", ref)).toBe("<!-- cite fetch-timeout -->");
    expect(formatStatement("asciidoc", ref)).toBe("// (cite fetch-timeout)");
    expect(formatStatement("rst", ref)).toBe(".. (cite fetch-timeout)");
  });

  it("round-trips through the scanner in every format", () => {
    for (const format of ["markdown", "mdx", "html", "asciidoc", "rst"]) {
      const text = formatStatement(format, { kind: "ref", id: "fetch-timeout" });
      expect(parseStatements(`${text}\nThe claim.\n`, format)[0]?.payload).toEqual({
        kind: "ref",
        id: "fetch-timeout",
      });
    }
  });

  it("refuses a format with no marker syntax", () => {
    expect(() => formatStatement("nope", { kind: "ref", id: "x" })).toThrow(CiteError);
    expect(() => formatStatement("nope", { kind: "ref", id: "x" })).toThrow(
      'No marker syntax for format "nope".',
    );
  });
});
