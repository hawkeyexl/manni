/**
 * Bound lines, marker runs and the three spans a marker-anchored claim is read
 * against. Proposal 0054 is the record.
 *
 * A run is misplaced when the lines directly above and below it are both unit
 * text, because deleting the run would join them into one paragraph. A bound
 * line is one the format makes a block on its own: a heading, a section title,
 * an adornment, or a line that is nothing but one tag.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitLines } from "../../src/cite/core/hash.js";
import { readPage } from "../../src/cite/core/page.js";
import {
  isUnitText,
  markerRunAt,
  misplacedMarkers,
  movedUnit,
  pre43Span,
  splitUnit,
  unitText,
} from "../../src/cite/core/reanchor.js";
import { isBoundLine } from "../../src/cite/core/statements.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(`${here}/../fixtures/cite/misplaced/${name}`, "utf8");

/** A page read as the tool reads it, plus its lines under the hashing rule. */
function read(name: string): { page: ReturnType<typeof readPage>; lines: string[] } {
  const content = fixture(name);
  const page = readPage(name, content);
  return { page, lines: splitLines(content) };
}

describe("isBoundLine", () => {
  it("reads an ATX heading in markdown and mdx", () => {
    for (const format of ["markdown", "mdx"]) {
      expect(isBoundLine("# Limits", format)).toBe(true);
      expect(isBoundLine("###### Deep", format)).toBe(true);
      expect(isBoundLine("  ## Indented", format)).toBe(true);
      expect(isBoundLine("#", format)).toBe(true);
      expect(isBoundLine("#hashtag", format)).toBe(false);
      expect(isBoundLine("####### Seven", format)).toBe(false);
    }
  });

  it("reads an asciidoc section title, and not a markdown heading there", () => {
    expect(isBoundLine("== Crawl scope", "asciidoc")).toBe(true);
    expect(isBoundLine("# Limits", "asciidoc")).toBe(false);
  });

  it("reads an adornment in every format", () => {
    for (const format of ["markdown", "mdx", "html", "xml", "asciidoc", "rst"]) {
      expect(isBoundLine("===", format)).toBe(true);
      expect(isBoundLine("---", format)).toBe(true);
      expect(isBoundLine("* * *", format)).toBe(true);
      expect(isBoundLine("^^^^^^", format)).toBe(true);
      expect(isBoundLine("--", format)).toBe(false);
      expect(isBoundLine("-=-", format)).toBe(false);
    }
  });

  it("reads a line that is nothing but one tag, and not one with text beside it", () => {
    for (const format of ["markdown", "mdx", "html", "xml"]) {
      expect(isBoundLine('<Aside type="note">', format)).toBe(true);
      expect(isBoundLine("</Aside>", format)).toBe(true);
      expect(isBoundLine("  <body>", format)).toBe(true);
      expect(isBoundLine("<p>The fetch timeout is 10 seconds.</p>", format)).toBe(false);
      expect(isBoundLine("A sentence about <code>.", format)).toBe(false);
    }
    expect(isBoundLine("<Aside>", "rst")).toBe(false);
  });
});

describe("isUnitText", () => {
  it("is false for a blank line, a fence, a marker and a bound line", () => {
    expect(isUnitText("Pages are checked one at a time.", "mdx")).toBe(true);
    expect(isUnitText("", "mdx")).toBe(false);
    expect(isUnitText("   ", "mdx")).toBe(false);
    expect(isUnitText("```ts", "mdx")).toBe(false);
    expect(isUnitText("{/* cite a */}", "mdx")).toBe(false);
    expect(isUnitText("## Scope", "mdx")).toBe(false);
    expect(isUnitText(undefined, "mdx")).toBe(false);
  });
});

describe("markerRunAt and splitUnit", () => {
  it("gathers the whole run and the paragraph it splits", () => {
    const { page, lines } = read("stacked-run.mdx");
    expect(markerRunAt(lines, 22, page.format, page.bodyLine)).toEqual({ start: 22, end: 23 });
    expect(markerRunAt(lines, 23, page.format, page.bodyLine)).toEqual({ start: 22, end: 23 });
    expect(splitUnit(lines, { start: 22, end: 23 }, page.format, page.bodyLine)).toEqual({
      start: 21,
      end: 24,
    });
  });

  it("finds no split unit where a bound line or a blank line is directly above", () => {
    const heading = read("under-heading.md");
    expect(
      splitUnit(heading.lines, { start: 15, end: 15 }, heading.page.format, heading.page.bodyLine),
    ).toBeUndefined();
    const jsx = read("jsx-tag.mdx");
    expect(splitUnit(jsx.lines, { start: 15, end: 15 }, jsx.page.format, jsx.page.bodyLine)).toBeUndefined();
    const sibling = read("pre-43-sibling-pin.mdx");
    expect(
      splitUnit(sibling.lines, { start: 21, end: 22 }, sibling.page.format, sibling.page.bodyLine),
    ).toBeUndefined();
  });
});

describe("pre43Span", () => {
  it("runs from the line below the marker to the next blank line, marker lines included", () => {
    const { lines } = read("pre-43-sibling-pin.mdx");
    expect(pre43Span(lines, 21)).toEqual({ start: 22, end: 23 });
    expect(pre43Span(lines, 22)).toEqual({ start: 23, end: 23 });
  });

  it("is undefined when the line below is blank or a fence", () => {
    expect(pre43Span(["<!-- cite a -->", "", "Text."], 1)).toBeUndefined();
    expect(pre43Span(["<!-- cite a -->", "```ts", "code", "```"], 1)).toBeUndefined();
  });
});

describe("misplacedMarkers", () => {
  it("reports one finding per marker of a run, each with its own place", () => {
    const { page, lines } = read("stacked-run.mdx");
    expect(
      misplacedMarkers(page, lines).map((m) => [m.line, m.order, m.place, m.to, m.block]),
    ).toEqual([
      [22, 0, 21, 21, false],
      [23, 1, 21, 22, false],
    ]);
  });

  it("places a quote marker above the block it anchors", () => {
    const { page, lines } = read("quote-mid.md");
    expect(misplacedMarkers(page, lines).map((m) => [m.line, m.place, m.to, m.block])).toEqual([
      [16, 19, 18, true],
    ]);
  });

  it("reports nothing for a marker under a heading, a tag line or a blank line", () => {
    for (const name of ["under-heading.md", "jsx-tag.mdx", "pre-43-sibling-pin.mdx"]) {
      const { page, lines } = read(name);
      expect(misplacedMarkers(page, lines)).toEqual([]);
    }
  });

  it("reports a marker between two list items", () => {
    const { page, lines } = read("list-items.md");
    expect(misplacedMarkers(page, lines).map((m) => [m.line, m.unit, m.to])).toEqual([
      [15, { start: 14, end: 16 }, 14],
    ]);
  });
});

describe("movedUnit and unitText", () => {
  it("push the unit down by the run and leave the run's lines out of the pin", () => {
    const { page, lines } = read("stacked-run.mdx");
    const [first] = misplacedMarkers(page, lines);
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(movedUnit(first)).toEqual({ start: 23, end: 24 });
    expect(unitText(lines, first)).toEqual([
      "Pages are checked one at a time, in the order the crawl found them.",
      "Each URL is loaded in a fresh browser context.",
    ]);
  });
});
