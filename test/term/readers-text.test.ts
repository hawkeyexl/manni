/**
 * Term lists in a text format's body (proposal 0052 § 3 and § 4): Markdown and
 * MDX definition lists in a file declaring `type: term-set`, AsciiDoc
 * `[glossary]` lists and reStructuredText `.. glossary::` directives, which
 * declare themselves. The first of several terms is the label and the rest are
 * alt-labels; code is never read; each entry knows its lines and its span.
 */
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractorByName, extractorForExtension } from "../../src/meta/internal.js";
import { loadTermSet } from "../../src/term/core/load-set.js";
import { asciidocGlossaryReader } from "../../src/term/core/readers/asciidoc-glossary.js";
import { markdownDeflistReader } from "../../src/term/core/readers/markdown-deflist.js";
import { rstGlossaryReader } from "../../src/term/core/readers/rst-glossary.js";
import { TEXT_READERS } from "../../src/term/core/readers/text.js";
import type { Term, TermInput, TermReadResult, TermReader } from "../../src/term/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "term", "readers-text");

function inputOf(content: string, file: string, format: string): TermInput {
  const extractor = extractorByName(format);
  if (extractor === undefined) throw new Error(`no extractor ${format}`);
  const extracted = extractor.extract(content, file);
  return { content, file, format, metadata: extracted.data, lineFor: extracted.lineFor };
}

function fixture(name: string): TermInput {
  const extractor = extractorForExtension(extname(name));
  if (extractor === undefined) throw new Error(`no extractor for ${name}`);
  return inputOf(readFileSync(join(FIXTURES, name), "utf8"), name, extractor.name);
}

function read(reader: TermReader, input: TermInput): TermReadResult {
  return reader.read(input);
}

function byId(result: TermReadResult, id: string): Term {
  const term = result.terms.find((t) => t.id === id);
  if (term === undefined) throw new Error(`no term ${id} in ${result.terms.map((t) => t.id).join(", ")}`);
  return term;
}

/** The text an entry's span covers. */
function spanned(input: TermInput, term: Term): string | undefined {
  const span = term.location.span;
  return span === undefined ? undefined : input.content.slice(span.start, span.end);
}

describe("markdown-deflist", () => {
  it("names itself and its formats", () => {
    expect(markdownDeflistReader.construct).toBe("markdown-deflist");
    expect(markdownDeflistReader.label).toBe("definition list");
    expect(markdownDeflistReader.formats).toEqual(["markdown", "mdx"]);
    expect(markdownDeflistReader.apply).toBeUndefined();
  });

  it("reads a simple entry after frontmatter, with its lines and span", () => {
    const input = fixture("deflist.md");
    const result = read(markdownDeflistReader, input);
    const apple = byId(result, "apple");
    expect(apple.record).toEqual({ label: "Apple", definition: "A pomaceous fruit." });
    expect(apple.language).toBe("en");
    expect(apple.location).toMatchObject({
      file: "deflist.md",
      construct: "markdown-deflist",
      line: 8,
      fieldLines: { label: 8, definition: 9 },
    });
    expect(spanned(input, apple)).toBe("Apple\n:   A pomaceous fruit.");
  });

  it("reads stacked terms as alt-labels and joins a multi-paragraph definition", () => {
    const input = fixture("deflist.md");
    const cli = byId(read(markdownDeflistReader, input), "command-line-interface");
    expect(cli.record).toEqual({
      label: "Command-line interface",
      "alt-labels": ["CLI"],
      definition: "A program you drive by typing commands.\n\nIt prints to a terminal.",
    });
    expect(cli.location.line).toBe(11);
    expect(cli.location.fieldLines).toEqual({ label: 11, "alt-labels": 12, definition: 13 });
    expect(spanned(input, cli)).toBe(
      "Command-line interface\nCLI\n:   A program you drive\n    by typing commands.\n\n    It prints to a terminal.",
    );
  });

  it("reads a lazy continuation line into the definition", () => {
    const input = fixture("deflist.md");
    const result = read(markdownDeflistReader, input);
    const schema = byId(result, "schema");
    expect(schema.record.definition).toBe("A document that describes another document.");
    expect(spanned(input, schema)).toBe("Schema\n: A document that describes\nanother document.");
    expect(result.terms.map((t) => t.id)).toEqual(["apple", "command-line-interface", "schema"]);
    expect(result.notices).toEqual([]);
  });

  it("reads nothing from a file that does not declare type: term-set", () => {
    expect(read(markdownDeflistReader, fixture("deflist-no-type.md"))).toEqual({ terms: [], notices: [] });
  });

  it("reads nothing inside fenced code", () => {
    expect(read(markdownDeflistReader, fixture("deflist-in-code.md"))).toEqual({ terms: [], notices: [] });
  });

  it("reads MDX", () => {
    const input = fixture("deflist.mdx");
    const result = read(markdownDeflistReader, input);
    expect(result.terms.map((t) => [t.id, t.location.line])).toEqual([["apple", 7]]);
    expect(result.terms[0]?.language).toBeUndefined();
  });

  it("keeps the first definition and says so for each extra, and skips entries it cannot read", () => {
    const input = fixture("deflist-notices.md");
    const result = read(markdownDeflistReader, input);
    expect(result.terms).toHaveLength(1);
    const banana = byId(result, "banana");
    expect(banana.record).toEqual({ label: "Banana", definition: "A long yellow fruit." });
    expect(spanned(input, banana)).toBe(
      "Banana\n:   A long yellow fruit.\n\n:   A second definition.\n:   A third definition.",
    );
    expect(result.notices).toEqual([
      "deflist-notices.md:5: skipped a definition list entry with no term.",
      'deflist-notices.md:10: kept the first of 3 definitions for "Banana".',
      'deflist-notices.md:11: kept the first of 3 definitions for "Banana".',
      "deflist-notices.md:13: skipped a definition list entry with no definition.",
    ]);
  });

  it("excludes a CR from the span of a CRLF file", () => {
    const content = "---\r\ntype: term-set\r\n---\r\nApple\r\n:   Fruit.\r\n\r\n";
    const input = inputOf(content, "crlf.md", "markdown");
    const [apple] = read(markdownDeflistReader, input).terms;
    expect(apple?.record).toEqual({ label: "Apple", definition: "Fruit." });
    expect(apple?.location.line).toBe(4);
    expect(apple === undefined ? undefined : spanned(input, apple)).toBe("Apple\r\n:   Fruit.");
  });

  it("does not read a heading as a term", () => {
    const input = inputOf("---\ntype: term-set\n---\n# Apple\n: Fruit.\n", "h.md", "markdown");
    expect(read(markdownDeflistReader, input)).toEqual({
      terms: [],
      notices: ["h.md:5: skipped a definition list entry with no term."],
    });
  });
});

describe("asciidoc-glossary", () => {
  it("names itself and its format", () => {
    expect(asciidocGlossaryReader.construct).toBe("asciidoc-glossary");
    expect(asciidocGlossaryReader.label).toBe("[glossary] list");
    expect(asciidocGlossaryReader.formats).toEqual(["asciidoc"]);
    expect(asciidocGlossaryReader.apply).toBeUndefined();
  });

  it("reads a term with its definition on the same line", () => {
    const input = fixture("glossary.adoc");
    const mud = byId(read(asciidocGlossaryReader, input), "mud");
    expect(mud.record).toEqual({ label: "mud", definition: "wet, cold dirt" });
    expect(mud.location).toMatchObject({
      construct: "asciidoc-glossary",
      line: 6,
      fieldLines: { label: 6, definition: 6 },
    });
    expect(spanned(input, mud)).toBe("mud:: wet, cold dirt");
  });

  it("reads a definition on the following lines, dedented and joined", () => {
    const input = fixture("glossary.adoc");
    const jam = byId(read(asciidocGlossaryReader, input), "jam");
    expect(jam.record).toEqual({ label: "jam", definition: "sweet, sticky mess" });
    expect(jam.location.fieldLines).toEqual({ label: 7, definition: 8 });
    expect(spanned(input, jam)).toBe("jam::\n  sweet, sticky\n  mess");
  });

  it("reads stacked terms as alt-labels, and a + continuation as a new paragraph", () => {
    const input = fixture("glossary.adoc");
    const cli = byId(read(asciidocGlossaryReader, input), "command-line-interface");
    expect(cli.record).toEqual({
      label: "command-line interface",
      "alt-labels": ["CLI"],
      definition: "a program you drive by typing commands.\n\nIt prints to a terminal.",
    });
    expect(cli.location.line).toBe(10);
    expect(cli.location.fieldLines).toEqual({ label: 10, "alt-labels": 11, definition: 11 });
    expect(spanned(input, cli)).toBe(
      "command-line interface::\nCLI:: a program you drive\nby typing commands.\n+\nIt prints to a terminal.",
    );
  });

  it("continues the list past a blank line before an item, and ends it at a paragraph", () => {
    const result = read(asciidocGlossaryReader, fixture("glossary.adoc"));
    expect(result.terms.map((t) => [t.id, t.location.line])).toEqual([
      ["mud", 6],
      ["jam", 7],
      ["command-line-interface", 10],
      ["yak", 16],
    ]);
    expect(result.notices).toEqual([
      "glossary.adoc:21: skipped a [glossary] list entry with no definition.",
    ]);
  });

  it("reads nothing inside a listing block, or from a block the attribute belongs to", () => {
    expect(read(asciidocGlossaryReader, fixture("glossary-in-code.adoc"))).toEqual({ terms: [], notices: [] });
  });

  it("reads a glossary after frontmatter, with file lines", () => {
    const content = "---\nlanguage: de\n---\n[glossary]\nZweig:: eine Entwicklungslinie\n";
    const result = read(asciidocGlossaryReader, inputOf(content, "fm.adoc", "asciidoc"));
    expect(result.terms.map((t) => [t.id, t.location.line, t.language])).toEqual([["zweig", 5, "de"]]);
  });
});

describe("rst-glossary", () => {
  it("names itself and its format", () => {
    expect(rstGlossaryReader.construct).toBe("rst-glossary");
    expect(rstGlossaryReader.label).toBe(".. glossary::");
    expect(rstGlossaryReader.formats).toEqual(["rst"]);
    expect(rstGlossaryReader.apply).toBeUndefined();
  });

  it("skips options and reads a multi-line definition", () => {
    const input = fixture("glossary.rst");
    const env = byId(read(rstGlossaryReader, input), "environment");
    expect(env.record).toEqual({
      label: "environment",
      definition: "A structure where information is saved.",
    });
    expect(env.location).toMatchObject({
      construct: "rst-glossary",
      line: 7,
      fieldLines: { label: 7, definition: 8 },
    });
    expect(spanned(input, env)).toBe("environment\n      A structure where information\n      is saved.");
  });

  it("reads stacked terms as alt-labels and a multi-paragraph definition", () => {
    const input = fixture("glossary.rst");
    const src = byId(read(rstGlossaryReader, input), "source-directory");
    expect(src.record).toEqual({
      label: "source directory",
      "alt-labels": ["source dir"],
      definition: "The directory that holds sources.\n\nIt may have subdirectories.",
    });
    expect(src.location.fieldLines).toEqual({ label: 11, "alt-labels": 12, definition: 13 });
    expect(spanned(input, src)).toBe(
      "source directory\n   source dir\n      The directory that holds sources.\n\n      It may have subdirectories.",
    );
  });

  it("drops a term's classifier, ends at the directive's indentation, and says what it skipped", () => {
    const result = read(rstGlossaryReader, fixture("glossary.rst"));
    expect(byId(result, "builder").record).toEqual({
      label: "builder",
      definition: "A class that turns documents into output.",
    });
    expect(result.terms.map((t) => t.id)).toEqual(["environment", "source-directory", "builder"]);
    expect(result.notices).toEqual(["glossary.rst:20: skipped a .. glossary:: entry with no definition."]);
  });

  it("reads a definition after a blank line, as Sphinx does", () => {
    const content = ".. glossary::\n\n   term\n\n      Its definition.\n\n   other\n\n   last\n      Defined.\n";
    const result = read(rstGlossaryReader, inputOf(content, "gap.rst", "rst"));
    expect(result.terms.map((t) => [t.id, t.record.definition, t.location.fieldLines])).toEqual([
      ["term", "Its definition.", { label: 3, definition: 5 }],
      ["last", "Defined.", { label: 9, definition: 10 }],
    ]);
    expect(result.notices).toEqual(["gap.rst:7: skipped a .. glossary:: entry with no definition."]);
  });

  it("reads nothing inside a code-block directive or a literal block", () => {
    expect(read(rstGlossaryReader, fixture("glossary-in-code.rst"))).toEqual({ terms: [], notices: [] });
  });

  it("reads a glossary after frontmatter, with file lines", () => {
    const input = fixture("glossary-frontmatter.rst");
    const [term] = read(rstGlossaryReader, input).terms;
    expect(term?.id).toBe("branche");
    expect(term?.language).toBe("fr");
    expect(term?.location.line).toBe(7);
    expect(term?.record.definition).toBe("Une ligne de développement.");
  });
});

describe("TEXT_READERS", () => {
  it("registers the three body readers, and loadTermSet reads through them", async () => {
    expect(TEXT_READERS.map((r) => r.construct)).toEqual([
      "markdown-deflist",
      "asciidoc-glossary",
      "rst-glossary",
    ]);
    const set = await loadTermSet({
      run: {
        config: null,
        inputs: ["deflist.md", "glossary.adoc", "glossary.rst"],
        base: FIXTURES,
        collections: [],
        fromCollections: false,
        manifests: [],
        tools: {},
      },
    });
    const constructs = new Map(set.terms.map((t) => [t.id, t.location.construct]));
    expect(constructs.get("apple")).toBe("markdown-deflist");
    expect(constructs.get("mud")).toBe("asciidoc-glossary");
    expect(constructs.get("environment")).toBe("rst-glossary");
  });
});
