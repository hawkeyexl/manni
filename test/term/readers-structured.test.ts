/**
 * The structured readers: a term page's metadata, a manifest, DITA glossentry
 * and glossgroup, DocBook glossary, and HTML `<dl>` and `<dfn>` (proposal 0052
 * §§ 3–4). Each reader is offered a real extracted input, so what it sees is
 * what the loader hands it.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractorByName } from "../../src/meta/internal.js";
import { loadTermSet, MANIFEST_FORMAT } from "../../src/term/core/load-set.js";
import { readerForConstruct, TERM_READERS } from "../../src/term/core/readers/index.js";
import { TermError } from "../../src/term/errors.js";
import type { Term, TermConstruct, TermInput, TermReader } from "../../src/term/types.js";

const FIXTURES = resolve(__dirname, "../fixtures/term/readers");

function reader(construct: TermConstruct): TermReader {
  const found = readerForConstruct(construct);
  if (found === undefined) throw new Error(`no reader for ${construct}`);
  return found;
}

function fixture(rel: string): { content: string; path: string; file: string } {
  const path = join(FIXTURES, rel);
  return { content: readFileSync(path, "utf8"), path, file: rel };
}

function inputFor(rel: string, format: string): TermInput {
  const { content, path, file } = fixture(rel);
  const extractor = extractorByName(format);
  if (extractor === undefined) throw new Error(`no extractor ${format}`);
  const extracted = extractor.extract(content, path);
  return { content, file, path, format, metadata: extracted.data, lineFor: extracted.lineFor };
}

function manifestInput(rel: string): TermInput {
  const { content, path, file } = fixture(rel);
  return { content, file, path, format: MANIFEST_FORMAT, metadata: {}, lineFor: () => undefined };
}

/** The `[start, end)` span of the `nth` occurrence of `open` through the `close` that follows it. */
function spanOf(content: string, open: string, close: string, nth = 0): { start: number; end: number } {
  let start = -1;
  for (let i = 0; i <= nth; i++) start = content.indexOf(open, start + 1);
  if (start === -1) throw new Error(`no ${open}`);
  const end = content.indexOf(close, start) + close.length;
  return { start, end };
}

const EMPTY = { terms: [], notices: [] };

describe("readers are registered", () => {
  it("has one reader per structured construct, with the labels term formats prints", () => {
    const labels = (
      ["page", "manifest", "dita-glossentry", "dita-glossgroup", "docbook-glossary", "html-dl", "html-dfn"] as const
    ).map((construct) => reader(construct).label);
    expect(labels).toEqual(["page", "manifest", "DITA glossentry", "DITA glossgroup", "DocBook glossary", "dl", "dfn"]);
    expect(reader("page").formats).toEqual(["markdown", "mdx", "asciidoc", "rst", "html", "xml"]);
    expect(reader("manifest").formats).toEqual([MANIFEST_FORMAT]);
    expect(reader("html-dl").formats).toEqual(["html"]);
    expect(reader("docbook-glossary").formats).toEqual(["xml"]);
  });
});

describe("page", () => {
  it("reads every field from a page declaring type: term", () => {
    const input = inputFor("page/term.md", "markdown");
    const expected: Term = {
      id: "progressive-lens",
      record: {
        label: "progressive lens",
        definition: "Corrective lenses whose power increases from top to bottom.",
        abstract: "Lenses that correct presbyopia without a visible line.",
        "alt-labels": ["PAL", "graduated lens"],
        "hidden-labels": ["no-line bifocal"],
        broader: ["corrective lens"],
        narrower: ["short-corridor lens"],
        "related-terms": ["bifocal"],
        see: "varifocal",
        "scope-note": "Spectacles only.",
      },
      language: "en",
      location: {
        file: "page/term.md",
        path: input.path,
        construct: "page",
        line: 1,
        fieldLines: {
          label: 6,
          "alt-labels": 7,
          "hidden-labels": 8,
          broader: 9,
          narrower: 10,
          "related-terms": 11,
          see: 12,
          abstract: 13,
          definition: 14,
          "scope-note": 15,
        },
      },
    };
    expect(reader("page").read(input)).toEqual({ terms: [expected], notices: [] });
  });

  it("reads an HTML page's metadata, with the id from the label's slug", () => {
    const input = inputFor("page/term.html", "html");
    const { terms } = reader("page").read(input);
    expect(terms).toHaveLength(1);
    expect(terms[0]?.id).toBe("bifocal");
    expect(terms[0]?.record).toEqual({ label: "Bifocal", definition: "Lenses with two powers." });
    expect(terms[0]?.location.span).toBeUndefined();
  });

  it("normalizes: trims, drops empty values, and makes a string list field a list", () => {
    const { terms } = reader("page").read(inputFor("page/normalize.md", "markdown"));
    expect(terms.map((term) => [term.id, term.record, term.language])).toEqual([
      ["bifocal", { label: "bifocal", "alt-labels": ["two-power lens"], broader: ["corrective lens"] }, undefined],
    ]);
    expect(terms[0]?.location.fieldLines).toEqual({ label: 3, "alt-labels": 6, broader: 8 });
  });

  it("reads nothing from a page without type: term", () => {
    expect(reader("page").read(inputFor("page/not-term.md", "markdown"))).toEqual(EMPTY);
  });

  it("skips a term page with no label, with a notice", () => {
    expect(reader("page").read(inputFor("page/no-label.md", "markdown"))).toEqual({
      terms: [],
      notices: ["page/no-label.md:1: skipped a page entry with no term."],
    });
  });

  // A one-value field given a list or a mapping used to vanish with no word,
  // so a `see: [x]` redirect never reached `see-not-empty` or a render.
  it("reports a one-value field given a list or a mapping, and reads the rest", () => {
    const { terms, notices } = reader("page").read(inputFor("page/see-list.md", "markdown"));
    expect(terms.map((t) => t.record)).toEqual([{ label: "varifocal" }]);
    expect(notices).toEqual([
      'page/see-list.md:6: ignored abstract on "varifocal": an abstract holds text.',
      'page/see-list.md:5: ignored see on "varifocal": a see holds one value, not a list.',
    ]);
  });
});

describe("manifest", () => {
  it("reads each top-level key as an entry, keeping entry and field lines", () => {
    const input = manifestInput("manifest/terms.yaml");
    expect(reader("manifest").read(input)).toEqual({
      terms: [
        {
          id: "progressive-lens",
          record: {
            label: "progressive lens",
            "alt-labels": ["PAL", "graduated lens"],
            abstract: "Lenses that correct presbyopia without a visible line.",
          },
          location: {
            file: "manifest/terms.yaml",
            path: input.path,
            construct: "manifest",
            line: 1,
            fieldLines: { label: 2, "alt-labels": 3, abstract: 4 },
          },
        },
        {
          id: "bifocal",
          record: { label: "bifocal", broader: ["corrective lens"] },
          location: {
            file: "manifest/terms.yaml",
            path: input.path,
            construct: "manifest",
            line: 5,
            fieldLines: { label: 6, broader: 8 },
          },
        },
      ],
      notices: ["manifest/terms.yaml:9: skipped a manifest entry with no term."],
    });
  });

  it("reports a see given as a list, and reads the rest of the entry", () => {
    const { terms, notices } = reader("manifest").read(manifestInput("manifest/see-list.yaml"));
    expect(terms.map((t) => t.record)).toEqual([
      { label: "varifocal", definition: "A lens whose power varies from top to bottom." },
    ]);
    expect(notices).toEqual([
      'manifest/see-list.yaml:3: ignored see on "varifocal": a see holds one value, not a list.',
    ]);
  });

  it("reads a .json manifest as JSON", () => {
    const { terms } = reader("manifest").read(manifestInput("manifest/terms.json"));
    expect(terms.map((term) => [term.id, term.record, term.location.line, term.location.fieldLines])).toEqual([
      ["progressive-lens", { label: "progressive lens", "alt-labels": ["PAL"] }, 2, { label: 3, "alt-labels": 4 }],
    ]);
  });

  it("refuses a manifest that is not a mapping", () => {
    const run = (): unknown => reader("manifest").read(manifestInput("manifest/not-mapping.yaml"));
    expect(run).toThrow(TermError);
    expect(run).toThrow("manifest/not-mapping.yaml: a term manifest is a mapping of id to entry.");
  });

  it("refuses an entry that is not a mapping, naming it", () => {
    const run = (): unknown => reader("manifest").read(manifestInput("manifest/entry-not-mapping.yaml"));
    expect(run).toThrow(TermError);
    expect(run).toThrow('manifest/entry-not-mapping.yaml:3: entry "progressive-lens" is not a mapping of fields.');
  });

  it("refuses a manifest that does not parse", () => {
    const run = (): unknown => reader("manifest").read(manifestInput("manifest/invalid.json"));
    expect(run).toThrow(TermError);
    expect(run).toThrow(/^manifest\/invalid\.json: could not be parsed as JSON: /);
  });
});

describe("DITA glossentry", () => {
  it("reads a glossentry topic: glossdef is the definition", () => {
    const input = inputFor("dita/glossentry.dita", "xml");
    expect(reader("dita-glossentry").read(input)).toEqual({
      terms: [
        {
          id: "progressive-lens",
          record: {
            label: "progressive lens",
            definition: "Lenses that correct presbyopia without a visible line.",
            "alt-labels": ["PAL", "graduated lens"],
            "scope-note": "Spectacles only.",
          },
          location: {
            file: "dita/glossentry.dita",
            path: input.path,
            construct: "dita-glossentry",
            line: 2,
            fieldLines: { label: 3, definition: 5, "scope-note": 7, "alt-labels": 9 },
            span: spanOf(input.content, "<glossentry", "</glossentry>"),
          },
        },
      ],
      notices: [],
    });
  });

  it("reads nothing from a glossgroup or a plain topic", () => {
    expect(reader("dita-glossentry").read(inputFor("dita/glossgroup.dita", "xml"))).toEqual(EMPTY);
    expect(reader("dita-glossentry").read(inputFor("dita/topic.dita", "xml"))).toEqual(EMPTY);
  });
});

describe("DITA glossgroup", () => {
  it("reads each child glossentry, with a span each, and skips one with no glossterm", () => {
    const input = inputFor("dita/glossgroup.dita", "xml");
    const location = (line: number, nth: number, fieldLines: Term["location"]["fieldLines"]): Term["location"] => ({
      file: "dita/glossgroup.dita",
      path: input.path,
      construct: "dita-glossgroup",
      line,
      fieldLines,
      span: spanOf(input.content, "<glossentry", "</glossentry>", nth),
    });
    expect(reader("dita-glossgroup").read(input)).toEqual({
      terms: [
        {
          id: "bifocal",
          record: { label: "bifocal", definition: "Lenses with two powers." },
          location: location(4, 0, { label: 5, definition: 6 }),
        },
        {
          id: "trifocal-lens",
          record: { label: "Trifocal Lens" },
          location: location(8, 1, { label: 9 }),
        },
      ],
      notices: ["dita/glossgroup.dita:11: skipped a DITA glossgroup entry with no term."],
    });
  });

  it("reads nothing from a glossentry topic", () => {
    expect(reader("dita-glossgroup").read(inputFor("dita/glossentry.dita", "xml"))).toEqual(EMPTY);
  });
});

describe("DocBook glossary", () => {
  it("reads every glossentry under a glossary, glossdivs included", () => {
    const input = inputFor("docbook/glossary.xml", "xml");
    const location = (line: number, nth: number, fieldLines: Term["location"]["fieldLines"]): Term["location"] => ({
      file: "docbook/glossary.xml",
      path: input.path,
      construct: "docbook-glossary",
      line,
      fieldLines,
      span: spanOf(input.content, "<glossentry", "</glossentry>", nth),
    });
    expect(reader("docbook-glossary").read(input)).toEqual({
      terms: [
        {
          id: "pal",
          record: {
            label: "progressive lens",
            "alt-labels": ["PAL"],
            definition: "Corrective lenses whose power increases from top to bottom.\n\nThey have no visible line.",
            "related-terms": ["bifocal", "trifocal"],
          },
          location: location(6, 0, { label: 7, "alt-labels": 8, definition: 9, "related-terms": 13 }),
        },
        {
          id: "varifocal",
          record: { label: "varifocal", see: "pal" },
          location: location(19, 1, { label: 20, see: 21 }),
        },
        {
          id: "graduated-lens",
          record: { label: "Graduated Lens", "alt-labels": ["graded lens"], see: "progressive lens" },
          location: location(23, 2, { label: 24, "alt-labels": 25, see: 26 }),
        },
      ],
      notices: ["docbook/glossary.xml:29: skipped a DocBook glossary entry with no term."],
    });
  });

  it("reads nothing from DITA", () => {
    expect(reader("docbook-glossary").read(inputFor("dita/glossgroup.dita", "xml"))).toEqual(EMPTY);
  });
});

describe("HTML dl", () => {
  it("reads each dt group: first dt the label, later dts alt-labels, first dd the definition", () => {
    const input = inputFor("html/dl.html", "html");
    const span = (fromOpen: string, nth: number): { start: number; end: number } => ({
      start: input.content.indexOf(fromOpen),
      end: spanOf(input.content, "<dd>", "</dd>", nth).end,
    });
    expect(reader("html-dl").read(input)).toEqual({
      terms: [
        {
          id: "pal",
          record: {
            label: "progressive lens",
            "alt-labels": ["PAL", "graduated lens"],
            definition: "Corrective lenses whose power increases.",
          },
          language: "en",
          location: {
            file: "html/dl.html",
            path: input.path,
            construct: "html-dl",
            line: 9,
            fieldLines: { label: 9, "alt-labels": 10, definition: 13 },
            span: span('<dt id="pal">', 0),
          },
        },
        {
          id: "bifocal",
          record: { label: "Bifocal", definition: "Two powers.\n\nOne line." },
          language: "en",
          location: {
            file: "html/dl.html",
            path: input.path,
            construct: "html-dl",
            line: 14,
            fieldLines: { label: 14, definition: 15 },
            span: span("<dt><dfn>", 1),
          },
        },
      ],
      notices: ["html/dl.html:16: skipped a dl entry with no term."],
    });
  });

  it("reads nothing from a page that does not declare type: term-set", () => {
    expect(reader("html-dl").read(inputFor("html/not-term-set.html", "html"))).toEqual(EMPTY);
  });
});

describe("HTML dfn", () => {
  it("takes the label from title, then an only-child abbr's title, then the text", () => {
    const input = inputFor("html/dfn.html", "html");
    const location = (line: number, open: string): Term["location"] => {
      const start = input.content.indexOf(open);
      return {
        file: "html/dfn.html",
        path: input.path,
        construct: "html-dfn",
        line,
        fieldLines: { label: line },
        span: { start, end: input.content.indexOf("</dfn>", start) + "</dfn>".length },
      };
    };
    expect(reader("html-dfn").read(input)).toEqual({
      terms: [
        { id: "pal", record: { label: "progressive lens" }, location: location(7, '<dfn id="pal">') },
        { id: "bifocal", record: { label: "bifocal" }, location: location(8, '<dfn title="bifocal">') },
        {
          id: "add-power",
          record: { label: "add power", "alt-labels": ["ADD"] },
          location: { ...location(9, "<dfn><abbr"), fieldLines: { label: 9, "alt-labels": 9 } },
        },
      ],
      notices: ["html/dfn.html:10: skipped a dfn entry with no term."],
    });
  });

  it("reads nothing from a page that does not declare type: term-set", () => {
    expect(reader("html-dfn").read(inputFor("html/not-term-set.html", "html"))).toEqual(EMPTY);
  });
});

describe("a file that is not the reader's", () => {
  it("yields nothing, and never throws", () => {
    const cases: [TermConstruct, TermInput][] = [
      ["page", inputFor("dita/glossentry.dita", "xml")],
      ["dita-glossentry", inputFor("docbook/glossary.xml", "xml")],
      ["dita-glossgroup", inputFor("docbook/glossary.xml", "xml")],
      ["docbook-glossary", inputFor("dita/topic.dita", "xml")],
      ["html-dl", inputFor("page/term.html", "html")],
      ["html-dfn", inputFor("page/term.html", "html")],
    ];
    for (const [construct, input] of cases) {
      expect(reader(construct).read(input), construct).toEqual(EMPTY);
    }
  });
});

describe("loadTermSet with the registered readers", () => {
  it("reads pages, DITA and manifests together", async () => {
    const base = join(FIXTURES, "mixed");
    const set = await loadTermSet({
      run: {
        config: null,
        inputs: ["docs"],
        base,
        collections: [],
        fromCollections: false,
        manifests: [{ path: join(base, "terms.yaml"), written: "terms.yaml" }],
        tools: {},
      },
      readers: TERM_READERS,
    });
    expect(set.terms.map((term) => [term.id, term.location.construct]).sort()).toEqual([
      ["bifocal", "dita-glossgroup"],
      ["contact-lens", "manifest"],
      ["progressive-lens", "page"],
    ]);
    expect(set.references.map((reference) => reference.label)).toEqual(["bifocal"]);
    expect(set.notices).toEqual([]);
  });
});
