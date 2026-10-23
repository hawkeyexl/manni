/**
 * One block rule for statements and cite markers: the fence rule in Markdown
 * and MDX, and the AsciiDoc delimited blocks. Anchoring, the code skip and
 * meta's heading skip read the same blocks.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { anchoredLines, fenceSpanAt, insideFence, parseStatements } from "../../src/shared/statements.js";
import { readStatements } from "../../src/meta/core/statements.js";
import { splitLines } from "../../src/shared/pin.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const read = (name: string): string => readFileSync(resolve(root, name), "utf8");

/** The 1-based line of the first line holding `needle`. */
function lineOf(text: string, needle: string): number {
  const at = splitLines(text).findIndex((l) => l.includes(needle));
  if (at === -1) throw new Error(`no "${needle}"`);
  return at + 1;
}

/** Two lines as `start-end`. */
const span = (start: number, end: number): string => `${String(start)}-${String(end)}`;

/** Each marker's first id and the lines it anchors, as `start-end`. */
function anchors(content: string, format: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of parseStatements(content, format)) {
    const id = s.payload.kind === "ref" ? s.payload.ids[0] : s.raw;
    const unit = anchoredLines(content, s.end, format);
    out[id] = unit === undefined ? "none" : `${String(unit.start)}-${String(unit.end)}`;
  }
  return out;
}

describe("fences in markdown", () => {
  const content = read("cite/blocks/fences.md");

  it("anchors an indented fence, runs past an info-string line, and closes on an indented closer", () => {
    expect(anchors(content, "markdown")).toEqual({
      indented: `${String(lineOf(content, "```js"))}-${String(lineOf(content, "more();") + 1)}`,
      after: String(lineOf(content, "The last paragraph.")).repeat(2).replace(/^(\d+)\1$/, "$1-$1"),
    });
  });

  it("reads a fence indented four or seven spaces in a list item as code", () => {
    const ids = parseStatements(content, "markdown").map((s) => s.raw);
    expect(ids).not.toContain("cite four-spaces");
    expect(ids).not.toContain("cite seven-spaces");
    expect(insideFence(content, 0, lineOf(content, "four-spaces"), "markdown")).toBe(true);
    expect(insideFence(content, 0, lineOf(content, "seven-spaces"), "markdown")).toBe(true);
  });

  it("skips a heading inside a fence whose info-string line does not close it", () => {
    const page = read("statements/blocks/fence-heading.md");
    const [statement] = readStatements(page, "markdown").statements;
    expect(statement?.section).toBe("real-section");
  });
});

describe("asciidoc delimited blocks", () => {
  const content = read("statements/blocks/delimiters.adoc");
  /**
   * The block under `marker`'s stacked statements, opener to closer: a
   * verbatim block holds two statements, a compound one a paragraph too.
   */
  const blockUnder = (marker: string): string => {
    const open = lineOf(content, marker) + 2;
    const compound = ["example", "sidebar", "quote"].some((k) => marker.endsWith(k));
    return span(open, open + (compound ? 4 : 3));
  };
  const kinds = ["listing", "literal", "passthrough", "comment", "example", "sidebar", "quote"];

  it("anchors a marker above each of the seven delimiters to the whole block", () => {
    const found = anchors(content, "asciidoc");
    for (const kind of kinds) {
      expect(found[`above-${kind}`], kind).toBe(blockUnder(`cite above-${kind}`));
      expect(found[`above-${kind}`], kind).not.toBe("none");
    }
  });

  it("anchors a meta statement above each of the seven delimiters to the whole block", () => {
    const statements = readStatements(content, "asciidoc").statements;
    for (const kind of kinds) {
      const s = statements.find((t) => JSON.stringify(t.data) === JSON.stringify({ concepts: [kind] }));
      const anchor = s?.anchor === undefined ? "none" : span(s.anchor.start, s.anchor.end);
      expect(anchor, kind).toBe(blockUnder(`cite above-${kind}`));
    }
  });

  it("skips what sits inside a verbatim block and reads what sits inside a compound one", () => {
    const ids = parseStatements(content, "asciidoc").map((s) => s.raw.slice(5));
    for (const kind of ["listing", "literal", "passthrough", "comment"]) {
      expect(ids, kind).not.toContain(`in-${kind}`);
    }
    for (const kind of ["example", "sidebar", "quote"]) {
      expect(ids, kind).toContain(`in-${kind}`);
    }
    const concepts = readStatements(content, "asciidoc").statements.map((s) => JSON.stringify(s.data));
    expect(concepts).not.toContain('{"concepts":["in-comment"]}');
    expect(concepts).toContain('{"concepts":["in-example"]}');
  });

  it("anchors a marker inside a compound block to its own paragraph", () => {
    const text = lineOf(content, "Example text.");
    expect(anchors(content, "asciidoc")["in-example"]).toBe(span(text, text));
  });

  it("closes a block only on an exact repeat of its opener", () => {
    const ids = parseStatements(content, "asciidoc").map((s) => s.raw.slice(5));
    expect(ids).not.toContain("past-a-shorter-delimiter");
    expect(ids).not.toContain("past-a-longer-delimiter");
    expect(anchors(content, "asciidoc")["listing-with-a-longer-line"]).toBe(
      span(lineOf(content, "listing-with-a-longer-line") + 1, lineOf(content, "past-a-longer-delimiter") + 1),
    );
  });

  it("keeps a ==== line under a title as the title's underline", () => {
    const underline = lineOf(content, "First title") + 1;
    expect(fenceSpanAt(content, underline, "asciidoc")).toBeUndefined();
    const text = lineOf(content, "A paragraph between");
    expect(anchors(content, "asciidoc")["between-the-titles"]).toBe(span(text, text));
  });
});
