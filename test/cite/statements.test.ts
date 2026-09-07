/**
 * Inline statement scanning. The cases mirror the ladder in
 * docs/proposals/0035/ladders/drift-examples.cjs, which is the behaviour the
 * scanner has to match, plus the file-relative mapping (`from`) the ladder
 * did not need because it never saw a frontmatter block.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  detectEol,
  fencedBlockAfter,
  fencedBlocks,
  formatStatement,
  lineAt,
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

const PIN =
  "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";

/** The statements `readPage` finds in a whole page, frontmatter and all. */
const readPageStatements = (content: string): InlineStatement[] =>
  parsePage("page.md", content).statements;

describe("statementForms", () => {
  it("markdown and mdx share three forms; json only in the comment forms", () => {
    expect(statementForms("markdown")).toEqual([
      { open: "<!--", close: "-->", json: true },
      { open: "{/*", close: "*/}", json: true },
      { open: "[comment]: # (", close: ")", json: false },
    ]);
    // MDX rejects an HTML comment, so its first form is the JSX comment.
    expect(statementForms("mdx")).toEqual([
      { open: "{/*", close: "*/}", json: true },
      { open: "<!--", close: "-->", json: true },
      { open: "[comment]: # (", close: ")", json: false },
    ]);
  });

  it("html and xml have the comment form only", () => {
    for (const format of ["html", "xml"]) {
      expect(statementForms(format)).toEqual([
        { open: "<!--", close: "-->", json: true },
      ]);
    }
  });

  it("asciidoc and rst carry ids only", () => {
    expect(statementForms("asciidoc")).toEqual([
      { open: "// (", close: ")", json: false },
    ]);
    expect(statementForms("rst")).toEqual([
      { open: ".. (", close: ")", json: false },
    ]);
  });

  it("an unknown format has no forms", () => {
    expect(statementForms("nope")).toEqual([]);
  });
});

describe("parseStatements", () => {
  it("parses a reference statement with its anchor, raw text and offsets", () => {
    const body = "Retries default to 3.\n\nSome other text.\n\n<!-- cite retries -->\nRetries default to 3. Really.\n";
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
    const [st] = parseStatements(body, "markdown", {
      offset: frontmatter.length,
      line: 4,
    });
    expect(st).toBeDefined();
    if (!st) return;
    expect(st.line).toBe(6);
    expect(st.anchorLine).toBe(7);
    expect(content.slice(st.start, st.end)).toBe("<!-- cite fetch-timeout -->");
  });

  it("`cite true` is a reference to id `true`, never json", () => {
    expect(parseStatements("<!-- cite true -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "ref",
      id: "true",
    });
  });

  it("parses a json payload in the html comment form", () => {
    expect(
      parseStatements(`<!-- cite {"src":"a:1","integrity":"${PIN}"} -->\nx\n`, "markdown")[0]
        ?.payload,
    ).toEqual({ kind: "entry", entry: { src: "a:1", integrity: PIN } });
  });

  it("parses the mdx expression form", () => {
    expect(parseStatements("{/* cite fetch-timeout */}\nx\n", "mdx")[0]?.payload).toEqual({
      kind: "ref",
      id: "fetch-timeout",
    });
    expect(
      parseStatements(`{/* cite {"src":"a:1","integrity":"${PIN}"} */}\nx\n`, "mdx")[0]?.payload,
    ).toEqual({ kind: "entry", entry: { src: "a:1", integrity: PIN } });
  });

  it("parses the markdown link-reference form, ids only", () => {
    expect(parseStatements("[comment]: # (cite fetch-timeout)\nx\n", "markdown")[0]?.payload).toEqual(
      { kind: "ref", id: "fetch-timeout" },
    );
    expect(parseStatements('[comment]: # (cite {"src":"a:1"})\nx\n', "markdown")[0]?.payload).toEqual(
      { kind: "bad", reason: "json payload not allowed in this form" },
    );
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
    const st = parseStatements("<p>x</p>\n<!-- cite fetch-timeout -->\n<p>The claim.</p>\n", "html")[0];
    expect(st).toMatchObject({
      line: 2,
      anchorLine: 3,
      payload: { kind: "ref", id: "fetch-timeout" },
      raw: "cite fetch-timeout",
    });
  });

  it("anchors to the rest of the statement's own line when it is not blank", () => {
    expect(parseStatements("<!-- cite fetch-timeout --> The claim.\n", "markdown")[0]?.anchorLine).toBe(1);
  });

  it("skips blank lines to find the anchored paragraph", () => {
    expect(parseStatements("<!-- cite x -->\n\n\nThe claim.\n", "markdown")[0]?.anchorLine).toBe(4);
  });

  it("has no anchor when nothing follows, or a fence follows", () => {
    expect(parseStatements("<!-- cite x -->\n", "markdown")[0]?.anchorLine).toBeUndefined();
    expect(parseStatements("<!-- cite x -->\n```ts\nconst a = 1;\n```\n", "markdown")[0]?.anchorLine).toBeUndefined();
  });

  it("ignores comments that are not statements", () => {
    expect(parseStatements("<!-- citeable -->\n<!-- todo -->\n<!-- cite-x -->\nx\n", "markdown")).toEqual([]);
  });

  it("treats a bare `cite` with no whitespace after it as an empty payload", () => {
    expect(parseStatements("<!--cite-->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "empty payload",
    });
  });

  it("reports malformed json, an empty payload, and a payload that is neither", () => {
    expect(parseStatements("<!-- cite {src: nope} -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "malformed json",
    });
    expect(parseStatements("<!-- cite -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "empty payload",
    });
    expect(parseStatements("<!-- cite Fetch Timeout -->\nx\n", "markdown")[0]?.payload).toEqual({
      kind: "bad",
      reason: "payload is neither an id nor json",
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

  it("reports a multi-line statement at its opening line and anchors after its close", () => {
    const body = `<!-- cite {\n  "src": "a:1",\n  "integrity": "${PIN}"\n} -->\nThe claim.\n`;
    const st = parseStatements(body, "markdown")[0];
    expect(st?.line).toBe(1);
    expect(st?.anchorLine).toBe(5);
    expect(st?.payload).toEqual({ kind: "entry", entry: { src: "a:1", integrity: PIN } });
  });

  it("finds nothing for a format with no forms", () => {
    expect(parseStatements("<!-- cite x -->\n", "nope")).toEqual([]);
  });
});

describe("parseStatements does not read code", () => {
  const ids = (body: string, format: string): string[] =>
    parseStatements(body, format).map((s) => (s.payload.kind === "ref" ? s.payload.id : s.payload.kind));

  it("ignores a statement inside a fenced block, backtick or tilde", () => {
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

  it("ignores a statement inside a backtick span, whatever the backtick count", () => {
    expect(ids("Write `<!-- cite <id> -->` above the paragraph.\n", "markdown")).toEqual([]);
    expect(ids("Write `` `<!-- cite x -->` `` to show it.\n", "markdown")).toEqual([]);
    const row = "| markdown, mdx | `<!-- cite PAYLOAD -->`, `{/* cite PAYLOAD */}`, `[comment]: # (cite PAYLOAD)` | id |\n";
    expect(ids(row, "mdx")).toEqual([]);
  });

  it("an unclosed backtick is not a span, so the statement after it is read", () => {
    expect(ids("A stray ` here.\n<!-- cite real -->\nThe claim.\n", "markdown")).toEqual(["real"]);
  });

  it("still finds a real statement after a fence, and one between two fences", () => {
    const body = "```md\n<!-- cite fenced -->\n```\n\n<!-- cite real -->\nThe claim.\n\n```\n<!-- cite fenced-again -->\n```\n";
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
    const content = "---\ntitle: x\ndescription: \"```\"\n---\n\n<!-- cite real -->\nThe claim.\n";
    expect(readPageStatements(content).map((s) => s.line)).toEqual([6]);
  });

  it("ignores a statement inside an asciidoc listing block", () => {
    expect(ids("----\n// (cite fenced)\n----\n\n// (cite real)\nThe claim.\n", "asciidoc")).toEqual(["real"]);
  });

  it("html has no fences: a statement in a <pre> is still a statement", () => {
    expect(ids("<pre>\n<!-- cite in-pre -->\n</pre>\n", "html")).toEqual(["in-pre"]);
  });
});

describe("detectEol and lineAt", () => {
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

describe("fencedBlockAfter and fencedBlocks", () => {
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

  it("lists every block after the body offset", () => {
    const content = readPage("quote.md");
    const bodyOffset = content.indexOf("# Limits");
    const blocks = fencedBlocks(content, bodyOffset, "markdown");
    expect(blocks.map((b) => b.line)).toEqual([13, 20]);
    expect(blocks[1]?.text).toBe("export const FETCH_TIMEOUT_MS = 10_000;\n");
    expect(fencedBlocks(content, bodyOffset, "rst")).toEqual([]);
  });
});

describe("formatStatement", () => {
  it("renders a reference in each format's first form", () => {
    const ref = { kind: "ref", id: "fetch-timeout" } as const;
    expect(formatStatement("markdown", ref)).toBe("<!-- cite fetch-timeout -->");
    expect(formatStatement("mdx", ref)).toBe("{/* cite fetch-timeout */}");
    expect(formatStatement("html", ref)).toBe("<!-- cite fetch-timeout -->");
    expect(formatStatement("asciidoc", ref)).toBe("// (cite fetch-timeout)");
    expect(formatStatement("rst", ref)).toBe(".. (cite fetch-timeout)");
  });

  it("renders an entry as compact json and round-trips through the scanner", () => {
    const entry = { src: "a:1", integrity: PIN, quote: true };
    const text = formatStatement("markdown", { kind: "entry", entry });
    expect(text).toBe(`<!-- cite ${JSON.stringify(entry)} -->`);
    expect(parseStatements(`${text}\n`, "markdown")[0]?.payload).toEqual({ kind: "entry", entry });
  });

  it("refuses an entry for an id-only format and an unknown format", () => {
    const entry = { kind: "entry", entry: { src: "a:1", integrity: PIN } } as const;
    expect(() => formatStatement("asciidoc", entry)).toThrow(CiteError);
    expect(() => formatStatement("rst", entry)).toThrow(/asciidoc|rst|id/);
    expect(() => formatStatement("nope", { kind: "ref", id: "x" })).toThrow(CiteError);
  });
});
