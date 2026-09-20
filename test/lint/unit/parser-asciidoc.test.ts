/**
 * The AsciiDoc parser.
 *
 * Two things get most of the attention here. Positions, because Asciidoctor
 * reports line numbers and nothing else - no columns, no offsets, no end of a
 * block - and the pre-rewrite `parsers/asciidoc.js` papered over that by
 * rebuilding a `== Title` marker and running `content.indexOf()` on it, which
 * lands on the wrong occurrence for a repeated heading and misses entirely when
 * a heading carries an attribute line. And metadata, because AsciiDoc's native
 * header is how a real page says `:type: how-to`, so routing depends on it.
 *
 * The fixtures at the bottom are the point of the exercise: the same document,
 * written in AsciiDoc, has to produce the same findings as its Markdown twin.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asciidocParser } from "../../../src/lint/parsers/asciidoc.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import { loadTemplate } from "../../../src/lint/core/template-registry.js";
import { LintError } from "../../../src/lint/types.js";
import type { ListNode, SectionNode } from "../../../src/lint/types.js";
import { at, defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "formats");

const parse = (adoc: string) => asciidocParser.parse(adoc, "test.adoc");

/** Depth-first section lookup by title, for asserting on nested trees. */
function find(sections: SectionNode[], title: string): SectionNode | undefined {
  for (const candidate of sections) {
    if (candidate.title === title) return candidate;
    const nested = find(candidate.sections, title);
    if (nested) return nested;
  }
  return undefined;
}

/** The same lookup, for the far more common case where it must find one. */
function section(sections: SectionNode[], title: string): SectionNode {
  return defined(find(sections, title), `section "${title}"`);
}

/** Findings as one readable line each, so a failure names what went wrong. */
async function lint(file: string): Promise<string[]> {
  const path = join(fixtures, file);
  const tree = asciidocParser.parse(await readFile(path, "utf8"), path);
  const findings = validateDocument(tree, await loadTemplate("tgdp:how-to:1.6"));
  return findings.map((f) => `${f.position.start.line}: [${f.type}] ${f.message}`);
}

describe("asciidoc parser", () => {
  it("registers itself for the AsciiDoc extensions", () => {
    expect(asciidocParser).toMatchObject({
      name: "asciidoc",
      label: "AsciiDoc",
    });
    expect(asciidocParser.extensions).toEqual([".adoc", ".asciidoc"]);
  });

  // Asciidoctor's `=` title is level 0 and lives on the document rather than in
  // the block tree, so both the offset and the promotion have to be undone.
  it("nests sections by level, with the document title as the H1", () => {
    const tree = parse("= A\n\n== B\n\ntext\n\n=== C\n\n== D\n");
    expect(tree.format).toBe("asciidoc");
    expect(tree.sections.map((s) => s.title)).toEqual(["A"]);
    expect(at(tree.sections, 0, "section").level).toBe(1);
    expect(at(tree.sections, 0, "section").sections.map((s) => s.title)).toEqual(
      ["B", "D"],
    );
    expect(section(tree.sections, "B").level).toBe(2);
    expect(section(tree.sections, "B").sections.map((s) => s.title)).toEqual([
      "C",
    ]);
    expect(section(tree.sections, "C").level).toBe(3);
  });

  it("records order and parentSlug", () => {
    const tree = parse("= A\n\n== B\n\n== D\n");
    const d = section(tree.sections, "D");
    expect(d.order).toBe(2);
    expect(d.parentSlug).toBe("a");
    const root = at(tree.sections, 0, "document title section");
    expect(root.order).toBe(1);
    expect(root.parentSlug).toBeNull();
  });

  // Asciidoctor hands back titles as inline HTML, so flattening them is what
  // makes `heading: {const: "..."}` mean the same thing it does in Markdown.
  it("flattens inline markup in a heading title", () => {
    const tree = parse("= T\n\n== Use the `lint` *command*\n");
    const root = at(tree.sections, 0, "document title section");
    const heading = at(root.sections, 0, "first subsection");
    expect(heading.title).toBe("Use the lint command");
    expect(heading.slug).toBe("use-the-lint-command");
  });

  it("puts the preamble under a document title into the title's own content", () => {
    const tree = parse("= A\n\nLead prose.\n\n== B\n\nmore\n");
    const root = at(tree.sections, 0, "document title section");
    expect(root.children.map((n) => n.kind)).toEqual(["paragraph"]);
    expect(at(root.children, 0, "preamble paragraph").text).toBe("Lead prose.");
    expect(root.sections.map((s) => s.title)).toEqual(["B"]);
  });
});

describe("content kinds", () => {
  it("classifies content generically, in document order", () => {
    const tree = parse(
      "= A\n\n== B\n\npara\n\n[source,js]\n----\ncode\n----\n\n* one\n* two\n",
    );
    expect(section(tree.sections, "B").children.map((n) => n.kind)).toEqual([
      "paragraph",
      "codeBlock",
      "list",
    ]);
  });

  it("carries a listing's language and its unconverted source", () => {
    const tree = parse("= A\n\n[source,bash]\n----\nls -l && echo 'a < b'\n----\n");
    const root = at(tree.sections, 0, "document title section");
    expect(at(root.children, 0, "listing block")).toMatchObject({
      kind: "codeBlock",
      language: "bash",
      text: "ls -l && echo 'a < b'",
    });
  });

  it("reads an unlabelled listing and a literal block as code with no language", () => {
    const tree = parse("= A\n\n----\nplain\n----\n\n....\nliteral\n....\n");
    const content = at(tree.sections, 0, "document title section").children;
    expect(content.map((n) => n.kind)).toEqual(["codeBlock", "codeBlock"]);
    expect(at(content, 0, "listing block")).not.toHaveProperty("language");
    expect(at(content, 1, "literal block")).not.toHaveProperty("language");
  });

  it("distinguishes ordered from unordered lists", () => {
    // In separate sections deliberately: two adjacent lists with different
    // markers are one nested list to AsciiDoc, not two siblings.
    const tree = parse("= A\n\n== U\n\n* one\n* two\n\n== O\n\n. first\n. second\n. third\n");
    const unordered = at(
      section(tree.sections, "U").children,
      0,
      "unordered list",
    ) as ListNode;
    const ordered = at(
      section(tree.sections, "O").children,
      0,
      "ordered list",
    ) as ListNode;
    expect(unordered).toMatchObject({ kind: "list", ordered: false });
    expect(unordered.items.map((i) => i.text)).toEqual(["one", "two"]);
    expect(ordered).toMatchObject({ kind: "list", ordered: true });
    expect(ordered.items).toHaveLength(3);
  });

  // An item's principal text is not one of its blocks in Asciidoctor, but it is
  // a paragraph child in mdast - so `lists: {items: {paragraphs: ...}}` only
  // counts the same thing in both formats because the parser puts it there.
  it("nests an item's own text and its attached blocks so item rules can run", () => {
    const tree = parse("= A\n\n* item text\n+\n[source,js]\n----\nx\n----\n");
    const root = at(tree.sections, 0, "document title section");
    const list = at(root.children, 0, "list") as ListNode;
    const item = at(list.items, 0, "list item");
    expect(item.children.map((c) => c.kind)).toEqual(["paragraph", "codeBlock"]);
    expect(at(item.children, 0, "item text paragraph").text).toBe("item text");
  });

  it("nests a list inside the item that carries it", () => {
    const tree = parse("= A\n\n* outer\n. inner one\n. inner two\n");
    const root = at(tree.sections, 0, "document title section");
    const list = at(root.children, 0, "list") as ListNode;
    const nested = at(
      at(list.items, 0, "outer list item").children,
      1,
      "nested list",
    ) as ListNode;
    expect(list.items).toHaveLength(1);
    expect(nested).toMatchObject({ kind: "list", ordered: true });
    expect(nested.items.map((i) => i.text)).toEqual(["inner one", "inner two"]);
    expect(nested.position.start.line).toBe(4);
  });

  // An admonition is not a paragraph and a table is not a list; counting them
  // as one would make `paragraphs: {max: N}` fail documents that satisfy it.
  // Skipping is whole-subtree, so an admonition's own paragraph is gone too.
  it("skips block types the content model does not describe", () => {
    const tree = parse(
      [
        "= A",
        "",
        "NOTE: an admonition",
        "",
        "|===",
        "| a | b",
        "|===",
        "",
        "****",
        "a sidebar",
        "****",
        "",
        "term:: definition",
        "",
        "'''",
        "",
      ].join("\n"),
    );
    expect(at(tree.sections, 0, "document title section").children).toEqual([]);
  });
});

describe("positions", () => {
  it("anchors a section on its own source line", () => {
    const adoc = "= A\n\n== B\n\npara\n\n== C\n\npara\n";
    const tree = parse(adoc);
    const b = section(tree.sections, "B");
    const heading = defined(b.titlePosition, "heading position");
    expect(heading.start.line).toBe(3);
    expect(heading.start.column).toBe(1);
    expect(heading.start.offset).toBe(adoc.indexOf("== B"));
    // The heading spans its own line, the way an mdast heading spans its `#`.
    expect(heading.end.offset).toBe(adoc.indexOf("== B") + "== B".length);
  });

  it("ends a section where the next sibling begins", () => {
    const adoc = "= A\n\n== B\n\npara\n\n\n\n== C\n\npara\n";
    const tree = parse(adoc);
    const siblings = at(tree.sections, 0, "document title section").sections;
    const b = at(siblings, 0, "section B");
    const c = at(siblings, 1, "section C");
    expect(b.position.end.offset).toBe(c.position.start.offset);
    expect(c.position.start.offset).toBe(adoc.indexOf("== C"));
    // The span covers the blank lines a reader would call part of the section.
    expect(at(b.children, 0, "paragraph in B").position.start.offset).toBeLessThan(
      b.position.end.offset,
    );
  });

  it("ends the final section at the end of the document", () => {
    const adoc = "= A\n\n== B\n\npara\n";
    const tree = parse(adoc);
    expect(section(tree.sections, "B").position.end.offset).toBe(adoc.length);
    expect(
      at(tree.sections, 0, "document title section").position.end.offset,
    ).toBe(adoc.length);
  });

  // The pre-rewrite parser recovered offsets with `content.indexOf("== Setup")`,
  // which returns the first occurrence whichever section is being placed.
  it("places repeated headings independently", () => {
    const adoc = "= A\n\n== Setup\n\none\n\n== Setup\n\ntwo\n";
    const tree = parse(adoc);
    const root = at(tree.sections, 0, "document title section");
    const first = at(root.sections, 0, "first Setup section");
    const second = at(root.sections, 1, "second Setup section");
    const firstHeading = defined(
      first.titlePosition,
      "first heading position",
    );
    const secondHeading = defined(
      second.titlePosition,
      "second heading position",
    );
    expect(firstHeading.start.line).toBe(3);
    expect(secondHeading.start.line).toBe(7);
    expect(secondHeading.start.offset).toBe(adoc.lastIndexOf("== Setup"));
    expect(root.sections.map((s) => s.slug)).toEqual(["setup", "setup-1"]);
  });

  // ...and a heading carrying an id line is not written the way the
  // reconstructed marker assumed, so it never matched at all.
  it("places a heading that carries a block attribute line", () => {
    const adoc = "= A\n\n[#setup]\n== Setup\n\none\n";
    const tree = parse(adoc);
    const root = at(tree.sections, 0, "document title section");
    const setup = at(root.sections, 0, "Setup section");
    const heading = defined(setup.titlePosition, "heading position");
    expect(heading.start.line).toBe(4);
    expect(heading.start.offset).toBe(adoc.indexOf("== Setup"));
  });

  it("gives content nodes spans that tile the section in document order", () => {
    const adoc = "= A\n\n== B\n\none\n\ntwo\n\n== C\n";
    const tree = parse(adoc);
    const b = section(tree.sections, "B");
    const one = at(b.children, 0, "first paragraph in B");
    const two = at(b.children, 1, "second paragraph in B");
    expect(one.position.start.line).toBe(5);
    expect(two.position.start.line).toBe(7);
    expect(one.position.end.offset).toBe(two.position.start.offset);
    expect(two.position.end.offset).toBe(adoc.indexOf("== C"));
  });
});

describe("document metadata", () => {
  // `extractFrontmatter` only ever reads a fenced block, so a parser that
  // called it alone would leave every real AsciiDoc page unrouted.
  it("reads the native header, so a page can declare its doctype", () => {
    const tree = parse("= Rotate a key\n:type: how-to\n:draft: true\n\n== Overview\n");
    expect(tree.frontmatter).toMatchObject({
      type: "how-to",
      draft: true,
      title: "Rotate a key",
    });
    expect(tree.frontmatterPosition).toMatchObject({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 3 },
    });
  });

  it("keeps header attribute values typed rather than stringly", () => {
    const tree = parse("= T\n:version: 2\n:draft: false\n\n== Overview\n");
    expect(tree.frontmatter).toMatchObject({ version: 2, draft: false });
  });

  it("reads a fenced block, and positions the metadata on it", () => {
    const adoc = "---\ntype: how-to\ntags:\n  - a\n  - b\n---\n\n= T\n\n== Overview\n";
    const tree = parse(adoc);
    expect(tree.frontmatter).toMatchObject({ type: "how-to", tags: ["a", "b"] });
    expect(
      Array.isArray(defined(tree.frontmatter, "frontmatter")["tags"]),
    ).toBe(true);
    expect(tree.frontmatterPosition?.start.line).toBe(1);
  });

  // A `---` fence is a thematic break in AsciiDoc. Without `skip-front-matter`
  // the metadata would parse as body content - and the line numbers of
  // everything after it still have to index the original file.
  it("keeps the fence out of the body without shifting line numbers", () => {
    const adoc = "---\ntype: how-to\n---\n\n= T\n\n== Overview\n\npara\n";
    const tree = parse(adoc);
    expect(tree.sections.map((s) => s.title)).toEqual(["T"]);
    const root = at(tree.sections, 0, "document title section");
    const overview = section(tree.sections, "Overview");
    expect(root.children).toEqual([]);
    expect(
      defined(root.titlePosition, "document title heading position").start
        .line,
    ).toBe(5);
    expect(
      defined(overview.titlePosition, "Overview heading position").start.line,
    ).toBe(7);
    expect(
      at(overview.children, 0, "paragraph in Overview").position.start.line,
    ).toBe(9);
  });

  it("reports no metadata when the file carries none", () => {
    const tree = parse("== Overview\n\nprose\n");
    expect(tree.frontmatter).toBeNull();
    expect(tree.frontmatterPosition).toBeNull();
  });
});

describe("a metadata title standing in for a missing document title", () => {
  it("becomes the top-level section", () => {
    const tree = parse(":title: Rotate an API key\n:type: how-to\n\n== Overview\n\nWhy.\n");
    const root = at(tree.sections, 0, "document title section");
    expect(root.level).toBe(1);
    expect(root.title).toBe("Rotate an API key");
    expect(root.sections.map((s) => s.title)).toEqual(["Overview"]);
  });

  it("is anchored on the header, where the title actually is", () => {
    const tree = parse(":title: A\n\n== Overview\n");
    const root = at(tree.sections, 0, "document title section");
    expect(root.titlePosition?.start.line).toBe(1);
    expect(root.titlePosition?.start.offset).toBe(0);
  });

  it("does not displace a real document title", () => {
    const tree = parse("= From the body\n:title: From metadata\n\n== Overview\n");
    expect(tree.sections.map((s) => s.title)).toEqual(["From the body"]);
  });

  it("is not synthesized without a title", () => {
    const tree = parse(":type: how-to\n\n== Overview\n");
    const root = at(tree.sections, 0, "top-level section");
    expect(root.title).toBe("Overview");
    expect(root.level).toBe(2);
  });

  it("takes the content before the first heading with it", () => {
    const tree = parse(":title: A\n\nLead prose.\n\n== Overview\n");
    const root = at(tree.sections, 0, "document title section");
    expect(root.children.map((n) => n.kind)).toEqual(["paragraph"]);
    expect(root.sections.map((s) => s.title)).toEqual(["Overview"]);
  });
});

// Asciidoctor recovers from every malformed *document* it was given here - an
// unterminated block warns and carries on - so the guard is what turns a
// refusal by the loader itself into a named operational error rather than a
// stack trace out of Opal.
it("reports input Asciidoctor cannot load as an operational error naming the file", () => {
  const notAString = 42 as unknown as string;
  expect(() => asciidocParser.parse(notAString, "broken.adoc")).toThrow(LintError);
  expect(() => asciidocParser.parse(notAString, "broken.adoc")).toThrow(
    /broken\.adoc: could not parse as asciidoc/,
  );
});

/**
 * The fixtures, end to end. The parser is imported directly rather than through
 * `parserForExtension`, so a failure here is this parser's and not the
 * registry's - routing has its own tests, and a broken registry entry would
 * otherwise fail every parser's suite at once.
 */
describe("the AsciiDoc format fixtures, against tgdp:how-to:1.6", () => {
  it("routes how-to.adoc on the doctype in its header", async () => {
    const path = join(fixtures, "how-to.adoc");
    const tree = asciidocParser.parse(await readFile(path, "utf8"), path);
    expect(tree.frontmatter?.["type"]).toBe("how-to");
  });

  it("lints how-to.adoc clean", async () => {
    expect(await lint("how-to.adoc")).toEqual([]);
  });

  it("reports the one missing section in how-to-broken.adoc", async () => {
    const findings = await lint("how-to-broken.adoc");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/\[missing_section\].*See also/);
  });
});

describe("asciidoc parser: open blocks", () => {
  // `--` is how an author attaches several blocks to one list item. Skipping it
  // as an unmapped context made a numbered step's whole body invisible to a
  // template - the most likely real-world surprise in this parser.
  const STEP = [
    "= T",
    "",
    "== Steps",
    "",
    ". Do the thing",
    "+",
    "--",
    "Extra prose.",
    "",
    "----",
    "cmd",
    "----",
    "--",
    "",
    "[NOTE]",
    "--",
    "An aside.",
    "--",
    "",
  ].join("\n");

  const steps = () => {
    const tree = asciidocParser.parse(STEP, "t.adoc");
    const root = at(tree.sections, 0, "document title section");
    return at(root.sections, 0, "Steps section");
  };

  it("shows a list item the blocks attached to it", () => {
    const list = steps().children.find((c) => c.kind === "list");
    expect(list).toBeDefined();
    const items = (list as { items: { children: { kind: string }[] }[] }).items;
    expect(at(items, 0, "step item").children.map((c) => c.kind)).toEqual([
      "paragraph",
      "paragraph",
      "codeBlock",
    ]);
  });

  // A `--` block turned into a real construct arrives with that construct's own
  // context, so it is skipped by the default branch just as mdast skips a
  // blockquote. Only the bare attach-blocks form still reports `open`.
  it("still skips an admonition built from a -- block", () => {
    expect(steps().children.map((c) => c.kind)).toEqual(["list"]);
  });
});
