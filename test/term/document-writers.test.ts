/**
 * The document writers (proposal 0052 § 5): each of the seven document formats
 * in each shape it supports renders a term set that `loadTermSet` reads back
 * as the same records, minus exactly the fields the render said it dropped.
 */
import { DOMParser } from "@xmldom/xmldom";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { slugOf } from "../../src/term/core/id.js";
import { loadTermSet } from "../../src/term/core/load-set.js";
import { DOCUMENT_WRITERS } from "../../src/term/core/writers/documents.js";
import { writerFor } from "../../src/term/core/writers/index.js";
import { TermError } from "../../src/term/errors.js";
import {
  TERM_FIELDS,
  type Term,
  type TermField,
  type TermRecord,
  type TermRender,
  type TermRun,
  type TermShape,
  type TermTarget,
  type TermWriteFormat,
  type TermWriter,
} from "../../src/term/types.js";
import { term } from "./writer-fixture.js";

type DocumentFormat = "markdown" | "mdx" | "asciidoc" | "rst" | "html" | "dita" | "docbook";

const NO_EXISTING = { existing: new Map<string, string>() };

const EXTENSION: Record<DocumentFormat, string> = {
  markdown: ".md",
  mdx: ".mdx",
  asciidoc: ".adoc",
  rst: ".rst",
  html: ".html",
  dita: ".dita",
  docbook: ".xml",
};

const LIST: readonly TermField[] = ["label", "definition", "alt-labels"];

/** What each format and shape holds, and whether the construct carries an id of its own. */
const CASES: { format: DocumentFormat; shape: TermShape; holds: readonly TermField[]; id: boolean }[] = [
  { format: "markdown", shape: "directory", holds: TERM_FIELDS, id: true },
  { format: "markdown", shape: "file", holds: LIST, id: false },
  { format: "mdx", shape: "directory", holds: TERM_FIELDS, id: true },
  { format: "mdx", shape: "file", holds: LIST, id: false },
  { format: "asciidoc", shape: "directory", holds: TERM_FIELDS, id: true },
  { format: "asciidoc", shape: "file", holds: LIST, id: false },
  { format: "rst", shape: "directory", holds: TERM_FIELDS, id: true },
  { format: "rst", shape: "file", holds: LIST, id: false },
  { format: "html", shape: "directory", holds: TERM_FIELDS, id: true },
  { format: "html", shape: "file", holds: LIST, id: true },
  { format: "dita", shape: "directory", holds: [...LIST, "scope-note"], id: true },
  { format: "dita", shape: "file", holds: [...LIST, "scope-note"], id: true },
  { format: "docbook", shape: "file", holds: [...LIST, "see", "related-terms"], id: true },
];

/** A representative set: casing, an acronym, paragraphs, a scope note, a language, and markup to escape. */
function representative(): Term[] {
  return [
    term("apple", { label: "apple", definition: "A pomaceous fruit." }),
    term("command-line-interface", {
      label: "Command-Line Interface",
      definition: "A program you drive\nby typing commands.\n\nIt prints to a terminal.",
      abstract: "A text interface.",
      "alt-labels": ["CLI", "command line"],
      "hidden-labels": ["comand line"],
      broader: ["user interface"],
      narrower: ["shell"],
      "related-terms": ["terminal", "console"],
      see: "shell",
      "scope-note": "Terminals only.",
    }),
    term("pal", {
      label: "progressive lens",
      definition: "A lens with no visible line.",
      "alt-labels": ["PAL"],
      "scope-note": "Spectacles only.",
    }),
    term("brille", { label: "Brille", definition: "Gläser, die man trägt." }, "de"),
    term(slugOf("C++ & co"), { label: "C++ & co", definition: `Languages <with> "quotes" & 'apostrophes'.` }),
  ];
}

/**
 * How a record reads back: only the held fields, and, from a body construct,
 * a paragraph's line breaks as spaces, since every body reader joins lines.
 * A page's metadata keeps a value exactly.
 */
function asRead(record: TermRecord, holds: readonly TermField[], page = false): TermRecord {
  const kept: Record<string, unknown> = {};
  for (const field of TERM_FIELDS) {
    const value = record[field];
    if (value !== undefined && holds.includes(field)) kept[field] = value;
  }
  const out = kept as unknown as TermRecord;
  if (out.definition !== undefined && !page) {
    out.definition = out.definition
      .split(/\n[ \t]*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .join("\n\n");
  }
  return out;
}

function documentWriter(format: TermWriteFormat): TermWriter {
  const found = writerFor(format, DOCUMENT_WRITERS);
  if (found === undefined) throw new Error(`no ${format} writer`);
  return found;
}

function runOf(base: string, input: string): TermRun {
  return {
    config: null,
    inputs: [input],
    base,
    collections: [],
    fromCollections: false,
    manifests: [],
    tools: {},
  };
}

let tmp: string;
beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-term-writers-")));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function targetFor(format: DocumentFormat, shape: TermShape, name = "glossary"): TermTarget {
  return shape === "directory"
    ? { path: join(tmp, name), shape }
    : { path: join(tmp, `${name}${EXTENSION[format]}`), shape };
}

async function writeRender(render: TermRender): Promise<void> {
  for (const file of render.files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, "utf8");
  }
}

async function renderAndRead(
  format: DocumentFormat,
  shape: TermShape,
  terms: readonly Term[],
  name = "glossary",
): Promise<{ render: TermRender; read: Term[] }> {
  const target = targetFor(format, shape, name);
  const render = documentWriter(format).render(terms, target, NO_EXISTING);
  await writeRender(render);
  const set = await loadTermSet({ run: runOf(tmp, basename(target.path)) });
  return { render, read: set.terms };
}

function expectedDropped(terms: readonly Term[], holds: readonly TermField[]): { id: string; field: TermField }[] {
  return terms.flatMap((t) =>
    TERM_FIELDS.filter((field) => t.record[field] !== undefined && !holds.includes(field)).map((field) => ({
      id: t.id,
      field,
    })),
  );
}

describe("document writers", () => {
  it("registers the seven document formats", () => {
    expect(DOCUMENT_WRITERS.map((w) => w.format)).toEqual([
      "markdown",
      "mdx",
      "asciidoc",
      "rst",
      "html",
      "dita",
      "docbook",
    ]);
    for (const format of ["markdown", "mdx", "asciidoc", "rst", "html", "dita"] as const) {
      expect(documentWriter(format).shapes).toEqual(["file", "directory"]);
    }
    expect(documentWriter("docbook").shapes).toEqual(["file"]);
  });

  it.each(CASES)("$format $shape holds what its construct can say", ({ format, shape, holds }) => {
    expect([...documentWriter(format).holds(shape)].sort()).toEqual([...holds].sort());
  });

  it("docbook refuses a directory", () => {
    expect(() => documentWriter("docbook").render(representative(), targetFor("docbook", "directory"), NO_EXISTING)).toThrow(
      new TermError("-f docbook writes one file, not a directory. Pass -o <file>."),
    );
  });

  it.each(CASES)("$format $shape round-trips through the readers", async ({ format, shape, holds, id }) => {
    const terms = representative();
    const { render, read } = await renderAndRead(format, shape, terms);
    expect(render.removals).toEqual([]);
    expect(render.dropped).toEqual(expectedDropped(terms, holds));
    if (shape === "directory") {
      expect(render.files.map((f) => basename(f.path))).toEqual(terms.map((t) => `${t.id}${EXTENSION[format]}`));
    } else {
      expect(render.files.map((f) => f.path)).toEqual([targetFor(format, shape).path]);
    }

    expect(read).toHaveLength(terms.length);
    for (const original of terms) {
      const expectedId = id ? original.id : slugOf(original.record.label);
      const found = read.find((t) => t.id === expectedId);
      expect(found, `${expectedId} in ${read.map((t) => t.id).join(", ")}`).toBeDefined();
      expect(found?.record).toEqual(asRead(original.record, holds, shape === "directory" && format !== "dita"));
      expect(found?.language).toBe(shape === "directory" ? original.language : undefined);
    }
  });

  it.each(CASES.filter((c) => c.shape === "file"))(
    "$format file states a language every term shares",
    async ({ format }) => {
      const terms = [
        term("brille", { label: "Brille", definition: "Gläser." }, "de"),
        term("linse", { label: "Linse", definition: "Ein Glas." }, "de"),
      ];
      const { read } = await renderAndRead(format, "file", terms);
      expect(read.map((t) => t.language)).toEqual(["de", "de"]);
    },
  );

  it.each(CASES)("$format $shape renders the same bytes twice", ({ format, shape }) => {
    const target = targetFor(format, shape);
    const first = documentWriter(format).render(representative(), target, NO_EXISTING);
    const second = documentWriter(format).render(representative(), target, NO_EXISTING);
    expect(second).toEqual(first);
    for (const file of first.files) {
      expect(file.content.endsWith("\n")).toBe(true);
      expect(file.content.endsWith("\n\n")).toBe(false);
      expect(file.content).not.toContain("\r");
    }
  });

  it("round-trips across formats: DocBook file, Markdown pages, DITA file", async () => {
    const terms = representative();
    const docbook = await renderAndRead("docbook", "file", terms, "a");
    const pages = await renderAndRead("markdown", "directory", docbook.read, "b");
    const dita = await renderAndRead("dita", "file", pages.read, "c");

    expect(docbook.render.dropped).toEqual(expectedDropped(terms, [...LIST, "see", "related-terms"]));
    expect(pages.render.dropped).toEqual([]);
    expect(dita.render.dropped).toEqual(expectedDropped(pages.read, [...LIST, "scope-note"]));

    const survived = [...LIST];
    for (const original of terms) {
      const found = dita.read.find((t) => t.id === original.id);
      expect(found?.record).toEqual(asRead(original.record, survived));
    }
  });

  it("docbook reads a glossdef holding only cross-references as no definition", async () => {
    const terms = [term("lens", { label: "lens", "related-terms": ["optics"] })];
    const { read } = await renderAndRead("docbook", "file", terms);
    expect(read.map((t) => t.record)).toEqual([{ label: "lens", "related-terms": ["optics"] }]);
  });

  it("refuses an id that cannot name a file, and two terms with one id", () => {
    expect(() =>
      documentWriter("markdown").render(
        [term("x", { label: "x" }), term("x", { label: "X" })],
        targetFor("markdown", "directory"),
        NO_EXISTING,
      ),
    ).toThrow(new TermError('two terms have the id "x", and a directory holds one file per id.'));
    for (const format of ["markdown", "html", "dita"] as const) {
      expect(() =>
        documentWriter(format).render(
          [term("../x", { label: "x", definition: "y" })],
          targetFor(format, "directory"),
          NO_EXISTING,
        ),
      ).toThrow(TermError);
    }
  });
});

describe("document writer output", () => {
  function file(format: DocumentFormat, shape: TermShape, terms: readonly Term[] = representative()): string {
    const render = documentWriter(format).render(terms, targetFor(format, shape), NO_EXISTING);
    const [first] = render.files;
    if (first === undefined) throw new Error("no file rendered");
    return first.content;
  }

  const one = [
    term("pal", {
      label: "progressive lens",
      definition: "A lens.",
      abstract: "Short.",
      "alt-labels": ["PAL", "graded lens"],
      "scope-note": "Spectacles: only.",
    }, "en"),
  ];

  it("writes a Markdown term page with its metadata in order and an empty body", () => {
    expect(file("markdown", "directory", one)).toBe(
      [
        "---",
        "title: progressive lens",
        "description: Short.",
        "type: term",
        "id: pal",
        "language: en",
        "label: progressive lens",
        "definition: A lens.",
        "abstract: Short.",
        "alt-labels:",
        "  - PAL",
        "  - graded lens",
        'scope-note: "Spectacles: only."',
        "---",
        "",
      ].join("\n"),
    );
  });

  it("writes a Markdown definition list under term-set frontmatter", () => {
    expect(file("markdown", "file", one)).toBe(
      ["---", "type: term-set", "language: en", "---", "", "progressive lens", "PAL", "graded lens", ":   A lens.", ""].join(
        "\n",
      ),
    );
  });

  it("writes a DITA glossentry topic with a DOCTYPE, a glossBody and an acronym", () => {
    const content = file("dita", "directory", one);
    expect(content).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE glossentry PUBLIC "-//OASIS//DTD DITA 2.0 Glossary Entry//EN" "glossentry.dtd">',
        '<glossentry id="pal" xml:lang="en">',
        "  <glossterm>progressive lens</glossterm>",
        "  <glossdef>A lens.</glossdef>",
        "  <glossBody>",
        "    <glossUsage>Spectacles: only.</glossUsage>",
        "    <glossAlt>",
        "      <glossAcronym>PAL</glossAcronym>",
        "    </glossAlt>",
        "    <glossAlt>",
        "      <glossSynonym>graded lens</glossSynonym>",
        "    </glossAlt>",
        "  </glossBody>",
        "</glossentry>",
        "",
      ].join("\n"),
    );
  });

  it("writes one well-formed DITA glossgroup with a title", () => {
    const content = file("dita", "file");
    expect(content).toContain('<!DOCTYPE glossgroup PUBLIC "-//OASIS//DTD DITA 2.0 Glossary Group//EN" "glossgroup.dtd">');
    const doc = parseXml(content);
    expect(doc.documentElement?.tagName).toBe("glossgroup");
    expect(doc.documentElement?.getElementsByTagName("title").item(0)?.textContent).toBe("Glossary");
    expect(doc.documentElement?.getElementsByTagName("glossentry").length).toBe(5);
    expect(content).toContain("<glossterm>C++ &amp; co</glossterm>");
    expect(content).toContain("<p>It prints to a terminal.</p>");
  });

  it("writes a DocBook 5 glossary with paragraphs, acronyms and cross-references", () => {
    const content = file("docbook", "file");
    const doc = parseXml(content);
    expect(doc.documentElement?.tagName).toBe("glossary");
    expect(doc.documentElement?.namespaceURI).toBe("http://docbook.org/ns/docbook");
    expect(content).toContain('<glossentry xml:id="command-line-interface">');
    expect(content).toContain("<acronym>CLI</acronym>");
    expect(content).toContain("<glossterm>command line</glossterm>");
    expect(content).toContain("<glossseealso>terminal</glossseealso>");
    expect(content).toContain("<glosssee>shell</glosssee>");
    expect(content).toContain("<para>Languages &lt;with&gt; \"quotes\" &amp; 'apostrophes'.</para>");
  });

  it("writes an HTML dl with the id on the first dt", () => {
    const content = file("html", "file");
    expect(content).toContain('<meta name="type" content="term-set">');
    expect(content).toContain('<dt id="pal">progressive lens</dt>');
    expect(content).toContain("<dt>PAL</dt>");
    expect(content).toContain("<dt id=\"c--co\">C++ &amp; co</dt>");
  });

  it("writes an HTML term page with a meta per field", () => {
    const content = file("html", "directory", one);
    expect(content).toContain("<title>progressive lens</title>");
    expect(content).toContain('<meta name="type" content="term">');
    expect(content).toContain('<meta name="alt-labels" content="[&quot;PAL&quot;,&quot;graded lens&quot;]">');
  });

  it("writes an AsciiDoc [glossary] list and an rST glossary directive", () => {
    const unset = one.map((t) => term(t.id, t.record));
    expect(file("asciidoc", "file", unset)).toBe(
      ["[glossary]", "progressive lens::", "PAL::", "graded lens:: A lens.", ""].join("\n"),
    );
    expect(file("asciidoc", "file", one)).toBe(
      ["---", "language: en", "---", "", "[glossary]", "progressive lens::", "PAL::", "graded lens:: A lens.", ""].join(
        "\n",
      ),
    );
    expect(file("rst", "file", unset)).toBe(
      [".. glossary::", "", "   progressive lens", "   PAL", "   graded lens", "      A lens.", ""].join("\n"),
    );
  });
});

function parseXml(content: string): ReturnType<DOMParser["parseFromString"]> {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === "error" || level === "fatalError") errors.push(msg);
    },
  }).parseFromString(content, "text/xml");
  expect(errors).toEqual([]);
  return doc;
}
