/**
 * Reading both channels of a page. Each fixture under test/fixtures/cite/pages
 * exercises one rule or one format; the inline cases cover the shapes that
 * are small enough not to earn a file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  MAX_STATEMENTS_PER_PAGE,
  pageCommit,
  readPage,
  validateEntry,
} from "../../src/cite/core/page.js";
import { CiteError } from "../../src/cite/errors.js";
import type { CitationFinding } from "../../src/cite/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = `${here}/../fixtures/cite/pages`;
const readFixture = (name: string): string => readFileSync(`${pagesDir}/${name}`, "utf8");
const fixture = (name: string, format?: string) =>
  readPage(`${pagesDir}/${name}`, readFixture(name), format ? { format } : undefined);

const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const rules = (findings: CitationFinding[]): string[] => findings.map((f) => f.rule);

describe("readPage: formats", () => {
  it("reads every markdown form, both channels, with origins and anchors", () => {
    const page = fixture("inline.md");
    expect(page.format).toBe("markdown");
    expect(page.bodyOffset).toBe(readFixture("inline.md").indexOf("# Limits"));
    expect(page.findings).toEqual([]);
    expect(page.statements).toHaveLength(3);
    expect(page.citations).toEqual([
      {
        citation: { id: "fetch-timeout", src: "src/limits.ts:2", integrity: PIN, claim: "The fetch timeout is 10 seconds." },
        origin: { kind: "frontmatter", index: 0, line: 4, anchorLine: 15 },
      },
      {
        citation: {
          id: "retries",
          src: "src/limits.ts:3",
          integrity: "sha256-0000000000000000000000000000000000000000000000000000000000000003",
        },
        origin: { kind: "frontmatter", index: 1, line: 8, anchorLine: 19 },
      },
      {
        citation: {
          src: "src/limits.ts:1",
          integrity: "sha256-0000000000000000000000000000000000000000000000000000000000000001",
          claim: "MAX_FILES is ten thousand.",
        },
        origin: { kind: "inline", line: 21, anchorLine: 21 },
      },
    ]);
  });

  it("reads mdx through its expression form", () => {
    const page = fixture("inline.mdx");
    expect(page.format).toBe("mdx");
    expect(page.findings).toEqual([]);
    expect(page.citations.map((c) => c.origin)).toEqual([
      { kind: "frontmatter", index: 0, line: 4, anchorLine: 11 },
      { kind: "inline", line: 13, anchorLine: 14 },
    ]);
  });

  it("reads asciidoc and rst references", () => {
    const adoc = fixture("inline.adoc");
    expect(adoc.format).toBe("asciidoc");
    expect(adoc.findings).toEqual([]);
    expect(adoc.citations.map((c) => c.origin)).toEqual([
      { kind: "frontmatter", index: 0, line: 4, anchorLine: 11 },
    ]);
    const rst = fixture("inline.rst");
    expect(rst.format).toBe("rst");
    expect(rst.findings).toEqual([]);
    expect(rst.citations.map((c) => c.origin)).toEqual([
      { kind: "frontmatter", index: 0, line: 4, anchorLine: 12 },
    ]);
  });

  it("reads html with the body starting at offset 0", () => {
    const page = fixture("inline.html");
    expect(page.format).toBe("html");
    expect(page.bodyOffset).toBe(0);
    expect(page.findings).toEqual([]);
    expect(page.citations).toEqual([
      {
        citation: { src: "src/limits.ts:2", integrity: PIN },
        origin: { kind: "inline", line: 5, anchorLine: 6 },
      },
    ]);
  });

  it("honours an explicit format over the extension", () => {
    const page = readPage("page.txt", readFixture("inline.md"), { format: "markdown" });
    expect(page.format).toBe("markdown");
    expect(page.citations).toHaveLength(3);
  });

  it("refuses an unknown format or extension with meta's wording", () => {
    expect(() => readPage("page.md", "x", { format: "nope" })).toThrow(CiteError);
    expect(() => readPage("page.md", "x", { format: "nope" })).toThrow(/^Unknown format "nope"\. Supported extensions: /);
    expect(() => readPage("page.txt", "x")).toThrow(CiteError);
    expect(() => readPage("page.txt", "x")).toThrow(/^Unsupported file type "\.txt"/);
  });

  it("counts CRLF pages by line, once per line", () => {
    const content = readFixture("crlf.md");
    expect(content).toContain("\r\n");
    const page = readPage(`${pagesDir}/crlf.md`, content);
    expect(page.findings).toEqual([]);
    expect(page.statements[0]?.line).toBe(11);
    expect(page.citations[0]?.origin).toEqual({ kind: "frontmatter", index: 0, line: 4, anchorLine: 12 });
  });

  it("returns nothing for a page without citations, and the body offset past the frontmatter", () => {
    const page = fixture("no-citations.md");
    expect(page.citations).toEqual([]);
    expect(page.statements).toEqual([]);
    expect(page.findings).toEqual([]);
    expect(page.bodyOffset).toBe("---\ntitle: Limits\n---\n".length);
  });
});

describe("readPage: frontmatter channel", () => {
  it("anchors a claim without a reference, and applies the page commit as the default", () => {
    const page = fixture("frontmatter-only.md");
    expect(page.findings).toEqual([]);
    expect(page.statements).toEqual([]);
    expect(page.citations).toEqual([
      {
        citation: {
          id: "fetch-timeout",
          src: "src/limits.ts:2",
          integrity: PIN,
          claim: "The fetch timeout is 10 seconds.",
          commit: "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182",
        },
        origin: { kind: "frontmatter", index: 0, line: 5, anchorLine: 15 },
      },
      {
        citation: {
          src: "src/limits.ts",
          integrity: "sha256-aebba92f0000000000000000000000000000000000000000000000000086e023",
          commit: "0123456789abcdef0123456789abcdef01234567",
        },
        origin: { kind: "frontmatter", index: 1, line: 9 },
      },
    ]);
  });

  it("anchors a soft-wrapped claim", () => {
    const page = fixture("wrapped-claim.md");
    expect(page.findings).toEqual([]);
    expect(page.citations[0]?.origin).toEqual({ kind: "frontmatter", index: 0, line: 4, anchorLine: 12 });
  });

  it("reports claim-missing at the entry when the claim is nowhere in the body", () => {
    const content = `---\ncitations:\n  - src: a:1\n    integrity: ${PIN}\n    claim: Not here.\n---\nSomething else.\n`;
    const page = readPage("p.md", content);
    expect(page.findings).toMatchObject([
      { rule: "claim-missing", ruleId: "manni:cite/claim-missing", severity: "error", line: 3, index: 0, src: "a:1" },
    ]);
    expect(page.findings[0]?.message).toContain("Not here.");
  });

  it("warns claim-ambiguous with the lines when the claim occurs twice", () => {
    const page = fixture("claim-ambiguous.md");
    expect(page.findings).toMatchObject([
      { rule: "claim-ambiguous", severity: "warning", line: 4, index: 0 },
    ]);
    expect(page.findings[0]?.message).toMatch(/10.*14/);
    expect(page.citations[0]?.origin).toEqual({ kind: "frontmatter", index: 0, line: 4 });
  });

  it("resolves a repeated claim through a reference statement", () => {
    const page = fixture("marker.md");
    expect(page.findings).toEqual([]);
    expect(page.citations[0]?.origin).toEqual({ kind: "frontmatter", index: 0, line: 4, anchorLine: 16 });
  });

  it("reports an invalid entry with Ajv's text, and a duplicate id", () => {
    const page = fixture("entry-invalid.md");
    expect(page.findings).toMatchObject([
      { rule: "entry-invalid", line: 4, index: 0, id: "fetch-timeout" },
      { rule: "entry-invalid", line: 9, index: 2, id: "fetch-timeout" },
    ]);
    expect(page.findings[0]?.message).toContain("must have required property 'integrity'");
    expect(page.findings[1]?.message).toContain('duplicate id "fetch-timeout"');
    expect(page.citations.map((c) => c.origin.kind === "frontmatter" && c.origin.index)).toEqual([1, 2]);
  });

  it("reports citations that is not an array, and a malformed citation-commit", () => {
    const page = readPage("p.md", "---\ncitations: yes\ncitation-commit: nope\n---\nx\n");
    expect(page.citations).toEqual([]);
    expect(rules(page.findings)).toEqual(["entry-invalid", "entry-invalid"]);
    expect(page.findings.map((f) => f.line)).toEqual([2, 3]);
  });

  it("flags quote: true in a format with no fence locator", () => {
    const content = `---\ncitations:\n  - src: a:1\n    integrity: ${PIN}\n    quote: true\n---\nx\n`;
    const page = readPage("p.rst", content);
    expect(page.findings).toMatchObject([{ rule: "statement-invalid", line: 3, index: 0 }]);
    expect(page.findings[0]?.message).toContain("rst");
  });
});

describe("readPage: inline channel", () => {
  it("reports an orphan reference", () => {
    const page = fixture("statement-orphan.md");
    expect(page.citations).toHaveLength(1);
    expect(page.findings).toMatchObject([
      { rule: "statement-orphan", severity: "error", line: 10, id: "nope" },
    ]);
  });

  it("reports a bad statement and an invalid inline entry as statement-invalid", () => {
    const content = `x\n\n<!-- cite Fetch Timeout -->\ny\n\n<!-- cite {"src": "/abs/path", "integrity": "${PIN}"} -->\nz\n`;
    const page = readPage("p.md", content);
    expect(page.citations).toEqual([]);
    expect(page.findings).toMatchObject([
      { rule: "statement-invalid", line: 3 },
      { rule: "statement-invalid", line: 6, src: "/abs/path" },
    ]);
    expect(page.findings[0]?.message).toContain("neither an id nor json");
    expect(page.findings[1]?.message).toContain("/src");
  });

  it("requires an inline claim to sit in the anchored paragraph", () => {
    const ok = readPage("p.md", `<!-- cite {"src": "a:1", "integrity": "${PIN}", "claim": "The claim."} -->\nThe claim.\n`);
    expect(ok.findings).toEqual([]);
    const bad = readPage("p.md", `<!-- cite {"src": "a:1", "integrity": "${PIN}", "claim": "The claim."} -->\nAnother sentence.\n`);
    expect(bad.findings).toMatchObject([{ rule: "claim-missing", line: 1, src: "a:1" }]);
    const none = readPage("p.md", `<!-- cite {"src": "a:1", "integrity": "${PIN}", "claim": "The claim."} -->\n`);
    expect(none.findings).toMatchObject([{ rule: "claim-missing", line: 1 }]);
  });

  it("requires a referenced entry's claim to sit in the anchored paragraph", () => {
    const content = `---\ncitations:\n  - id: x\n    src: a:1\n    integrity: ${PIN}\n    claim: The claim.\n---\nThe claim.\n\n<!-- cite x -->\nAnother sentence.\n`;
    const page = readPage("p.md", content);
    expect(page.findings).toMatchObject([{ rule: "claim-missing", line: 10, id: "x" }]);
    expect(page.citations[0]?.origin).toEqual({ kind: "frontmatter", index: 0, line: 3, anchorLine: 11 });
  });

  it("reports claim-ambiguous when two statements name one id", () => {
    const content = `---\ncitations:\n  - id: x\n    src: a:1\n    integrity: ${PIN}\n---\n<!-- cite x -->\na\n\n<!-- cite x -->\nb\n`;
    const page = readPage("p.md", content);
    expect(page.findings).toMatchObject([{ rule: "claim-ambiguous", severity: "warning", id: "x", index: 0 }]);
    expect(page.findings[0]?.message).toMatch(/7.*10/);
    expect(page.citations[0]?.origin).toEqual({ kind: "frontmatter", index: 0, line: 3, anchorLine: 8 });
  });

  it("reports a duplicate id across the two channels", () => {
    const content = `---\ncitations:\n  - id: x\n    src: a:1\n    integrity: ${PIN}\n---\n<!-- cite {"id": "x", "src": "a:2", "integrity": "${PIN}"} -->\nb\n`;
    const page = readPage("p.md", content);
    expect(page.findings).toMatchObject([{ rule: "entry-invalid", line: 7, id: "x" }]);
  });

  it("anchors quote entries to the fenced block that follows", () => {
    const page = fixture("quote.md");
    expect(page.findings).toEqual([]);
    expect(page.citations.map((c) => c.origin)).toEqual([
      { kind: "frontmatter", index: 0, line: 4, anchorLine: 13 },
      { kind: "inline", line: 19, anchorLine: 20 },
    ]);
  });

  it("reports quote: true with no block, and quote in a format without a locator", () => {
    const noBlock = readPage("p.md", `<!-- cite {"src": "a:1", "integrity": "${PIN}", "quote": true} -->\nprose only\n`);
    expect(noBlock.findings).toMatchObject([{ rule: "quote-drift", line: 1, src: "a:1" }]);
    const html = readPage("p.html", `<!-- cite {"src": "a:1", "integrity": "${PIN}", "quote": true} -->\n<pre>x</pre>\n`);
    expect(html.findings).toMatchObject([{ rule: "statement-invalid", line: 1 }]);
    expect(html.findings[0]?.message).toContain("html");
  });

  it("caps statements per page with one statement-invalid", () => {
    const body = Array.from({ length: MAX_STATEMENTS_PER_PAGE + 1 }, (_, i) => `<!-- cite {"src": "a:${i + 1}", "integrity": "${PIN}"} -->\nx\n`).join("\n");
    const page = readPage("p.md", body);
    expect(page.statements).toHaveLength(MAX_STATEMENTS_PER_PAGE + 1);
    expect(page.citations).toHaveLength(MAX_STATEMENTS_PER_PAGE);
    expect(rules(page.findings)).toEqual(["statement-invalid"]);
    expect(page.findings[0]?.message).toContain(String(MAX_STATEMENTS_PER_PAGE));
  });

  it("never scans the frontmatter for statements", () => {
    const content = `---\ntitle: "<!-- cite x -->"\n---\nbody\n`;
    expect(readPage("p.md", content).statements).toEqual([]);
  });
});

describe("validateEntry and pageCommit", () => {
  it("accepts a valid entry and reports the first error as pointer and message", () => {
    expect(validateEntry({ src: "a:1", integrity: PIN })).toBeUndefined();
    expect(validateEntry({ src: "a:1" })).toBe("must have required property 'integrity'");
    expect(validateEntry({ src: "a:1", integrity: PIN, extra: 1 })).toContain("additional");
    expect(validateEntry({ src: "a:1", integrity: "nope" })).toMatch(/^\/integrity must match pattern/);
    expect(validateEntry("a string")).toBe("must be object");
  });

  it("reads a well-formed page commit and ignores a malformed one", () => {
    expect(pageCommit({ "citation-commit": "3f9c2a1" })).toBe("3f9c2a1");
    expect(pageCommit({ "citation-commit": "3F9C2A1" })).toBeUndefined();
    expect(pageCommit({ "citation-commit": 7 })).toBeUndefined();
    expect(pageCommit({})).toBeUndefined();
  });
});
