/**
 * A Flare TOC read as a map (proposal 0125, decision 17): each titled
 * `TocEntry` is a section, a LinkedTitle entry is transparent, every `Link` is
 * a link, and an entry the target excludes leaves the structure while its link
 * stays.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { xmlParser } from "../../../src/lint/parsers/xml.js";
import { flareRun } from "../../../src/shared/flare/index.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import type { DocumentTree, SectionNode } from "../../../src/lint/types.js";

const TOCS = join(import.meta.dirname, "..", "fixtures", "flare", "widget", "Project", "TOCs");

beforeEach(() => {
  resetWarnings();
  // The two-target notice goes to stderr; keep the run quiet.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Parse a TOC fixture with no context, or under `target` when one is named. */
function read(name: string, target?: string | null): DocumentTree {
  const file = join(TOCS, name);
  const content = readFileSync(file, "utf8");
  if (target === undefined) return xmlParser.parse(content, name);
  const flare = flareRun(target === null ? undefined : { flare: { target } });
  return xmlParser.parse(content, name, { absPath: file, flare });
}

/** `title@level`, depth-first. */
function outline(sections: SectionNode[]): string[] {
  return sections.flatMap((s) => [`${s.title}@${String(s.level)}`, ...outline(s.sections)]);
}

describe("xml parser: Flare TOC", () => {
  it("reads titled entries as sections, nested and in order, LinkedTitle entries transparent", () => {
    const tree = read("Main.fltoc");
    expect(outline(tree.sections)).toEqual([
      "Getting started@1",
      // The LinkedTitle entry adds no level, so its child sits directly under the book.
      "Snippets@2",
      "Reference@1",
      "Nested@2",
      "Print guide@1",
      "More@1",
      "Website@1",
    ]);
  });

  it("collects every Link, to a topic, another TOC and the web", () => {
    expect(read("Main.fltoc").links.map((l) => l.target)).toEqual([
      "/Content/Topics/Install.htm",
      "/Content/Topics/Snippets.htm",
      "/Content/Topics/Cycle.htm",
      "/Content/Topics/Install.htm#nested",
      "/Content/Topics/PrintGuide.htm",
      "/Project/TOCs/Other.fltoc",
      "https://example.com/widget",
    ]);
  });

  it("drops an entry the target excludes from the structure, and keeps its link", () => {
    const tree = read("Main.fltoc", "HTML5");
    expect(outline(tree.sections)).not.toContain("Print guide@1");
    expect(outline(tree.sections)).toContain("More@1");
    expect(tree.links.map((l) => l.target)).toContain("/Content/Topics/PrintGuide.htm");
  });

  it("keeps a conditioned entry when the run names no target", () => {
    // Widget has two targets and none is configured, so every condition is included.
    expect(outline(read("Main.fltoc", null).sections)).toContain("Print guide@1");
  });

  it("parses a TOC of only LinkedTitle entries to no sections", () => {
    const tree = read("LinkedOnly.fltoc");
    expect(tree.sections).toEqual([]);
    expect(tree.links).toHaveLength(2);
  });

  it("reads a browse sequence, which shares the TOC's root", () => {
    expect(outline(read("Tour.flbrs").sections)).toEqual(["Tour@1", "Install@2", "Snippets@2"]);
  });

  it("is registered for .fltoc and .flbrs, named and walked", () => {
    expect(xmlParser.extensions).toEqual(expect.arrayContaining([".fltoc", ".flbrs"]));
    expect(xmlParser.walkExtensions).toEqual(expect.arrayContaining([".fltoc", ".flbrs"]));
  });
});
