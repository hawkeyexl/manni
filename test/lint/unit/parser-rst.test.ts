/**
 * The reStructuredText parser.
 *
 * The heart of it is level discovery, which is why the first block of tests is
 * the largest: RST fixes no heading hierarchy, so what `===` means is a fact
 * about the document, not about the character. Everything after that pins the
 * mapping onto the generic content kinds and the two things a scanner-based
 * parser is most likely to get wrong - positions and what it skips.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rstParser } from "../../../src/lint/parsers/rst.js";
import { loadTemplate } from "../../../src/lint/core/template-registry.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import type {
  AdmonitionNode,
  BlockquoteNode,
  CodeNode,
  DefinitionListNode,
  ListNode,
  SectionNode,
  TableNode,
} from "../../../src/lint/types.js";
import { at, defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "formats");

const parse = (rst: string) => rstParser.parse(rst, "test.rst");

/** Depth-first section lookup by title, for asserting on nested trees. */
function find(sections: SectionNode[], title: string): SectionNode | undefined {
  for (const section of sections) {
    if (section.title === title) return section;
    const nested = find(section.sections, title);
    if (nested) return nested;
  }
  return undefined;
}

/** The same lookup, for the far more common case where it must find one. */
function section(sections: SectionNode[], title: string): SectionNode {
  return defined(find(sections, title), `section "${title}"`);
}

/** Every section in the tree, flattened, in document order. */
function flatten(sections: SectionNode[]): SectionNode[] {
  return sections.flatMap((s) => [s, ...flatten(s.sections)]);
}

describe("rst parser: section levels", () => {
  // The whole reason this format was hard. The spec: "Rather than imposing a
  // fixed number and order of section title adornment styles, the order
  // enforced will be the order as encountered."
  it("assigns levels by the order adornment styles first appear", () => {
    const tree = parse(
      ["Top", "===", "", "Middle", "------", "", "Deep", "~~~~", ""].join("\n"),
    );
    expect(flatten(tree.sections).map((s) => [s.title, s.level])).toEqual([
      ["Top", 1],
      ["Middle", 2],
      ["Deep", 3],
    ]);
  });

  // A hardcoded character-to-level table would put `+++` below `---`. There is
  // no such table: this document says `+++` is level 2 because it got there
  // second, and that is the only thing that decides.
  it("follows a non-conventional order rather than a fixed table", () => {
    const tree = parse(
      ["Top", "===", "", "Middle", "++++++", "", "Deep", "----", ""].join("\n"),
    );
    expect(flatten(tree.sections).map((s) => [s.title, s.level])).toEqual([
      ["Top", 1],
      ["Middle", 2],
      ["Deep", 3],
    ]);
    expect(section(tree.sections, "Deep").parentSlug).toBe("middle");
  });

  // "Underline-only adornment styles are distinct from overline-and-underline
  // styles that use the same character" - so `=` appears twice here, at two
  // different levels, and the second use does not reopen the first.
  it("treats over-and-underlined titles as a style of their own", () => {
    const tree = parse(
      [
        "=====",
        "Part",
        "=====",
        "",
        "Chapter",
        "=======",
        "",
        "Section",
        "-------",
        "",
      ].join("\n"),
    );
    expect(flatten(tree.sections).map((s) => [s.title, s.level])).toEqual([
      ["Part", 1],
      ["Chapter", 2],
      ["Section", 3],
    ]);
  });

  it("nests sections and records order and parentSlug", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        "B",
        "-",
        "",
        "text",
        "",
        "C",
        "~",
        "",
        "D",
        "-",
        "",
      ].join("\n"),
    );
    expect(tree.sections.map((s) => s.title)).toEqual(["A"]);
    const a = at(tree.sections, 0, "top-level section");
    expect(a.sections.map((s) => s.title)).toEqual(["B", "D"]);
    expect(section(tree.sections, "B").sections.map((s) => s.title)).toEqual(["C"]);

    const d = section(tree.sections, "D");
    expect(d.order).toBe(2);
    expect(d.parentSlug).toBe("a");
    expect(a.parentSlug).toBeNull();
  });

  it("disambiguates repeated titles in slugs", () => {
    const tree = parse(["Install", "=======", "", "Install", "=======", ""].join("\n"));
    expect(tree.sections.map((s) => s.slug)).toEqual(["install", "install-1"]);
  });

  // The adornment is measured against the title as *written* - the spec's
  // "right edge of the title text" - so the run matches the 26 source
  // characters, not the 20 that survive flattening.
  it("flattens inline markup in a title", () => {
    const tree = parse(
      ["Use the ``lint`` *command*", "==========================", ""].join("\n"),
    );
    const title = at(tree.sections, 0, "top-level section");
    expect(title.title).toBe("Use the lint command");
    expect(title.slug).toBe("use-the-lint-command");
  });

  /**
   * The spec requires the adornment to extend "at least as far as the right
   * edge of the title text". A shorter run is therefore not a section title,
   * and the line is ordinary text - which is what this parser implements, and
   * what `docmeta`'s RST extractor already assumes for the document title.
   *
   * Stated plainly because docutils the *implementation* is more forgiving: it
   * reports "Title underline too short" and recovers into a section anyway. We
   * take the strict reading, so a document that trips this rule loses the
   * section rather than gaining a silently-invented one.
   */
  it("does not make a section from an adornment shorter than its title", () => {
    const tree = parse(["Overview of the thing", "---", "", "Body text.", ""].join("\n"));
    expect(tree.sections.map((s) => s.title)).toEqual([""]);
    const lead = at(tree.sections, 0, "lead section");
    expect(lead.level).toBe(0);
    expect(lead.children.map((c) => c.text)).toEqual([
      "Overview of the thing",
      "Body text.",
    ]);
  });

  // A run on its own is a transition, not a heading and not content.
  it("skips a transition", () => {
    const tree = parse(["A", "=", "", "before", "", "-----", "", "after", ""].join("\n"));
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.text)).toEqual(["before", "after"]);
  });
});

describe("rst parser: content", () => {
  it("classifies content into generic kinds, in document order", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        "A paragraph.",
        "",
        ".. code-block:: bash",
        "",
        "   ls",
        "",
        "* one",
        "* two",
        "",
      ].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.kind)).toEqual([
      "paragraph",
      "codeBlock",
      "list",
    ]);
  });

  it("joins a soft-wrapped paragraph and flattens its inline markup", () => {
    const tree = parse(
      ["A", "=", "", "Run the ``lint`` command", "on **every** file.", ""].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    expect(at(a.children, 0, "paragraph").text).toBe(
      "Run the lint command\non every file.",
    );
  });

  // `::` at the end of a paragraph opens a literal block. docutils collapses
  // the marker into the prose rather than leaving it there, so we do too.
  it("reads a literal block, and strips the `::` from the paragraph", () => {
    const tree = parse(
      ["A", "=", "", "Run this::", "", "   widget keys rotate", "   --id abc123", ""].join("\n"),
    );
    const content = at(tree.sections, 0, "section A").children;
    const para = at(content, 0, "paragraph");
    const code = at(content, 1, "literal block");
    expect(para).toMatchObject({ kind: "paragraph", text: "Run this:" });
    expect(code).toMatchObject({
      kind: "codeBlock",
      text: "widget keys rotate\n--id abc123",
    });
    expect((code as CodeNode).language).toBeUndefined();
  });

  it("drops a paragraph that is only the `::` marker", () => {
    const tree = parse(["A", "=", "", "::", "", "   just code", ""].join("\n"));
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.kind)).toEqual(["codeBlock"]);
  });

  it("takes the language from a code directive and drops its options", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        ".. code-block:: python",
        "   :linenos:",
        "",
        "   print('hi')",
        "",
      ].join("\n"),
    );
    const content = at(tree.sections, 0, "section A").children;
    expect(at(content, 0, "code block")).toMatchObject({
      kind: "codeBlock",
      language: "python",
      text: "print('hi')",
    });
  });

  it("reads bullet and enumerated lists, with ordering", () => {
    const tree = parse(
      ["A", "=", "", "* one", "* two", "", "1. first", "2. second", ""].join("\n"),
    );
    const content = at(tree.sections, 0, "section A").children as ListNode[];
    const bullets = at(content, 0, "bullet list");
    const steps = at(content, 1, "enumerated list");
    expect(bullets).toMatchObject({ kind: "list", ordered: false });
    expect(bullets.items.map((i) => i.text)).toEqual(["one", "two"]);
    expect(steps).toMatchObject({ kind: "list", ordered: true });
    expect(steps.items.map((i) => i.text)).toEqual(["first", "second"]);
  });

  it("reads an auto-enumerated list as ordered", () => {
    const tree = parse(["A", "=", "", "#. first", "#. second", ""].join("\n"));
    const content = at(tree.sections, 0, "section A").children;
    expect(at(content, 0, "list")).toMatchObject({ kind: "list", ordered: true });
  });

  // Items separated by blank lines are one list, not one list per item.
  it("keeps blank-separated items in a single list", () => {
    const tree = parse(["A", "=", "", "* one", "", "* two", "", "* three", ""].join("\n"));
    const content = at(tree.sections, 0, "section A").children;
    const list = at(content, 0, "bullet list") as ListNode;
    expect(content).toHaveLength(1);
    expect(list.items).toHaveLength(3);
  });

  it("nests content inside list items so item rules can run", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        "1. Do the thing::",
        "",
        "      widget do",
        "",
        "2. Do the next thing.",
        "",
      ].join("\n"),
    );
    const content = at(tree.sections, 0, "section A").children;
    const list = at(content, 0, "enumerated list") as ListNode;
    const first = at(list.items, 0, "list item");
    const second = at(list.items, 1, "list item");
    expect(first.children.map((c) => c.kind)).toEqual(["paragraph", "codeBlock"]);
    expect(at(first.children, 1, "nested code block")).toMatchObject({
      text: "widget do",
    });
    expect(second.children.map((c) => c.kind)).toEqual(["paragraph"]);
  });

  it("nests a sublist inside its item", () => {
    const tree = parse(["A", "=", "", "* one", "", "  * inner", "", "* two", ""].join("\n"));
    const content = at(tree.sections, 0, "section A").children;
    const list = at(content, 0, "bullet list") as ListNode;
    expect(list.items).toHaveLength(2);
    expect(at(list.items, 0, "list item").children.map((c) => c.kind)).toEqual([
      "paragraph",
      "list",
    ]);
  });
});

describe("rst parser: skipping", () => {
  // The Markdown parser skips blockquotes and tables rather than mapping them
  // onto a nearest neighbour, and this parser used to skip the same shapes.
  // What remains genuinely unread - a plain comment, a target, a substitution
  // definition, and a directive this parser does not map - stays skipped.
  it("skips directives it does not map, and comments", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        "Real paragraph.",
        "",
        ".. seealso::",
        "",
        "   Not one of the mapped directives.",
        "",
        ".. This is a plain comment,",
        "   continued on a second line.",
        "",
        ".. _a-target:",
        "",
        ".. |sub| replace:: substituted",
        "",
        "Second real paragraph.",
        "",
      ].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.text)).toEqual([
      "Real paragraph.",
      "Second real paragraph.",
    ]);
  });

  it("skips doctest blocks", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        "Real paragraph.",
        "",
        ">>> doctest()",
        "output",
        "",
        "Second real paragraph.",
        "",
      ].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.text)).toEqual([
      "Real paragraph.",
      "Second real paragraph.",
    ]);
  });

  // Field lists are metadata; `readMetadata` owns them. If the scanner read
  // them as prose, a docinfo block would open an implicit lead section and the
  // template's top-level slot would claim it instead of the title.
  it("skips field lists rather than reading them as prose", () => {
    const tree = parse(
      ["Title", "=====", "", ":type: how-to", ":author: someone", "", "Body.", ""].join("\n"),
    );
    expect(tree.sections).toHaveLength(1);
    const title = at(tree.sections, 0, "title section");
    expect(title.level).toBe(1);
    expect(title.children.map((c) => c.text)).toEqual(["Body."]);
  });
});

describe("rst parser: admonitions", () => {
  it("maps note/tip/important/caution/warning/danger to their own variant", () => {
    const tree = parse(
      ["A", "=", "", ".. warning::", "", "   Back up first.", ""].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const node = at(a.children, 0, "admonition") as AdmonitionNode;
    expect(node).toMatchObject({ kind: "admonition", variant: "warning" });
    expect(node.text).toBe("Back up first.");
  });

  it("nests block content inside an admonition", () => {
    const tree = parse(
      ["A", "=", "", ".. note::", "", "   First line.", "", "   * a", "   * b", ""].join(
        "\n",
      ),
    );
    const a = at(tree.sections, 0, "section A");
    const node = at(a.children, 0, "admonition") as AdmonitionNode;
    expect(node.variant).toBe("note");
    expect(node.children.map((c) => c.kind)).toEqual(["paragraph", "list"]);
  });

  // `attention`, `hint`, `error` and the generic `admonition` directive name
  // no six-value variant. Rather than invent an equivalence (`hint` as `tip`,
  // `error` as `danger`), they still become an admonition, just with no
  // `variant` field - so a `variant: tip` rule never matches a page that
  // never said tip, and a plain count rule still counts them.
  it("maps attention, hint, error, and the generic admonition with no variant", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        ".. attention::",
        "",
        "   x",
        "",
        ".. hint::",
        "",
        "   y",
        "",
        ".. error::",
        "",
        "   z",
        "",
        ".. admonition:: Custom",
        "",
        "   w",
        "",
      ].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.kind)).toEqual([
      "admonition",
      "admonition",
      "admonition",
      "admonition",
    ]);
    for (const node of a.children as AdmonitionNode[]) {
      expect(node.variant).toBeUndefined();
    }
    expect(a.children.map((c) => c.text)).toEqual(["x", "y", "z", "w"]);
  });
});

describe("rst parser: images", () => {
  it("reads an image directive's url and alt", () => {
    const tree = parse(
      ["A", "=", "", ".. image:: diagram.png", "   :alt: A diagram", ""].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const image = at(a.children, 0, "image");
    expect(image).toMatchObject({ kind: "image", url: "diagram.png", alt: "A diagram" });
  });

  it("reads a figure directive the same way, defaulting alt to empty", () => {
    const tree = parse(["A", "=", "", ".. figure:: shot.png", ""].join("\n"));
    const a = at(tree.sections, 0, "section A");
    expect(at(a.children, 0, "image")).toMatchObject({
      kind: "image",
      url: "shot.png",
      alt: "",
    });
  });
});

describe("rst parser: block quotes", () => {
  it("reads an indented block with no `::` ahead as a blockquote", () => {
    const tree = parse(
      ["A", "=", "", "Real paragraph.", "", "   A quoted block.", "", "Second.", ""].join(
        "\n",
      ),
    );
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.kind)).toEqual([
      "paragraph",
      "blockquote",
      "paragraph",
    ]);
    const bq = at(a.children, 1, "blockquote") as BlockquoteNode;
    expect(bq.text).toBe("A quoted block.");
    expect(bq.children.map((c) => c.kind)).toEqual(["paragraph"]);
  });
});

describe("rst parser: definition lists", () => {
  it("reads a term and its indented definition", () => {
    const tree = parse(["A", "=", "", "term", "   its definition", "", "Body.", ""].join("\n"));
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.kind)).toEqual(["definitionList", "paragraph"]);
    const dl = at(a.children, 0, "definition list") as DefinitionListNode;
    expect(dl.children).toHaveLength(1);
    const item = at(dl.children, 0, "definition item");
    expect(item.term).toBe("term");
    expect(item.definition.map((d) => d.text)).toEqual(["its definition"]);
  });

  it("groups consecutive term/definition pairs into one list", () => {
    const tree = parse(["A", "=", "", "one", "   first", "two", "   second", ""].join("\n"));
    const a = at(tree.sections, 0, "section A");
    expect(a.children.map((c) => c.kind)).toEqual(["definitionList"]);
    const dl = at(a.children, 0, "definition list") as DefinitionListNode;
    expect(dl.children.map((item) => item.term)).toEqual(["one", "two"]);
  });
});

describe("rst parser: tables", () => {
  it("reads a grid table with a header row", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        "+-------+-------+",
        "| A     | B     |",
        "+=======+=======+",
        "| 1     | 2     |",
        "+-------+-------+",
        "",
      ].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const table = at(a.children, 0, "table") as TableNode;
    expect(table.children).toHaveLength(2);
    const header = at(table.children, 0, "header row");
    expect(header.header).toBe(true);
    expect(header.children.map((c) => c.text)).toEqual(["A", "B"]);
    const body = at(table.children, 1, "body row");
    expect(body.header).toBe(false);
    expect(body.children.map((c) => c.text)).toEqual(["1", "2"]);
  });

  it("reads a simple table with a header row", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        "=====  =====",
        "col a  col b",
        "=====  =====",
        "1      2",
        "3      4",
        "=====  =====",
        "",
      ].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const table = at(a.children, 0, "table") as TableNode;
    const header = at(table.children, 0, "header row");
    expect(header.header).toBe(true);
    expect(header.children.map((c) => c.text)).toEqual(["col a", "col b"]);
    expect(table.children.slice(1).every((r) => !r.header)).toBe(true);
    expect(table.children.slice(1).map((r) => r.children.map((c) => c.text))).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("reads a simple table with no header when there is no separator", () => {
    const tree = parse(
      ["A", "=", "", "=====  =====", "1      2", "=====  =====", ""].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const table = at(a.children, 0, "table") as TableNode;
    expect(table.children).toHaveLength(1);
    expect(table.children[0]?.header).toBe(false);
  });

  it("reads a list-table with header-rows", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        ".. list-table::",
        "   :header-rows: 1",
        "",
        "   * - Col A",
        "     - Col B",
        "   * - 1",
        "     - 2",
        "",
      ].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const table = at(a.children, 0, "table") as TableNode;
    expect(table.children).toHaveLength(2);
    expect(at(table.children, 0, "header row").header).toBe(true);
    expect(at(table.children, 0, "header row").children.map((c) => c.text)).toEqual([
      "Col A",
      "Col B",
    ]);
    expect(at(table.children, 1, "body row").header).toBe(false);
  });

  it("reads a list-table with no header when :header-rows: is absent", () => {
    const tree = parse(
      ["A", "=", "", ".. list-table::", "", "   * - 1", "     - 2", ""].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const table = at(a.children, 0, "table") as TableNode;
    expect(table.children.every((r) => !r.header)).toBe(true);
  });

  it("reads a csv-table's inline rows, with no header by default", () => {
    const tree = parse(
      ["A", "=", "", ".. csv-table::", "", "   1, 2", "   3, 4", ""].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const table = at(a.children, 0, "table") as TableNode;
    expect(table.children).toHaveLength(2);
    expect(table.children.every((r) => !r.header)).toBe(true);
    expect(table.children.map((r) => r.children.map((c) => c.text))).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("reads a csv-table's :header: option as a header row", () => {
    const tree = parse(
      ["A", "=", "", ".. csv-table::", '   :header: "A", "B"', "", "   1, 2", ""].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const table = at(a.children, 0, "table") as TableNode;
    expect(table.children).toHaveLength(2);
    expect(at(table.children, 0, "header row")).toMatchObject({ header: true });
    expect(at(table.children, 0, "header row").children.map((c) => c.text)).toEqual([
      "A",
      "B",
    ]);
    expect(at(table.children, 1, "body row").header).toBe(false);
  });

  // The third path, and the one most real documents take. `:header:` supplies
  // a header row that is not in the data; `:header-rows:` promotes rows that
  // are, which is a different branch of the scanner.
  it("reads a csv-table's :header-rows: option as header rows", () => {
    const tree = parse(
      [
        "A",
        "=",
        "",
        ".. csv-table::",
        "   :header-rows: 1",
        "",
        "   H1, H2",
        "   1, 2",
        "",
      ].join("\n"),
    );
    const a = at(tree.sections, 0, "section A");
    const table = at(a.children, 0, "table") as TableNode;
    expect(table.children).toHaveLength(2);
    expect(at(table.children, 0, "header row").header).toBe(true);
    expect(at(table.children, 0, "header row").children.map((c) => c.text)).toEqual([
      "H1",
      "H2",
    ]);
    expect(at(table.children, 1, "body row").header).toBe(false);
  });
});

describe("rst parser: positions", () => {
  it("anchors headings and content on their source lines", () => {
    const rst = ["Title", "=====", "", "First paragraph.", "", "   indented", ""].join("\n");
    const tree = parse(rst);
    const first = at(tree.sections, 0, "title section");

    // The heading spans the title line through its underline.
    expect(first.titlePosition).toMatchObject({
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 2, column: 6 },
    });
    const heading = defined(first.titlePosition, "heading position");
    expect(rst.slice(0, heading.end.offset)).toBe("Title\n=====");

    const para = at(first.children, 0, "paragraph");
    expect(para.position.start).toMatchObject({ line: 4, column: 1 });
    expect(rst.slice(para.position.start.offset, para.position.end.offset)).toBe(
      "First paragraph.",
    );
  });

  it("starts an indented block at its own column", () => {
    const rst = ["A", "=", "", "Code::", "", "   indented", ""].join("\n");
    const a = at(parse(rst).sections, 0, "section A");
    const code = at(a.children, 1, "indented literal block");
    expect(code.position.start).toMatchObject({ line: 6, column: 4 });
    expect(rst.slice(code.position.start.offset, code.position.end.offset)).toBe("indented");
  });

  it("ends a section where the next sibling begins, and the last one at EOF", () => {
    const rst = ["A", "=", "", "para", "", "", "", "B", "=", ""].join("\n");
    const tree = parse(rst);
    const a = at(tree.sections, 0, "section A");
    const b = at(tree.sections, 1, "section B");
    expect(a.position.end.offset).toBe(b.position.start.offset);
    expect(at(a.children, 0, "paragraph").position.end.offset).toBeLessThan(
      a.position.end.offset,
    );
    expect(b.position.end.offset).toBe(rst.length);
  });

  it("keeps line numbers exact across CRLF", () => {
    const tree = parse("Title\r\n=====\r\n\r\nPara.\r\n");
    const title = at(tree.sections, 0, "title section");
    expect(at(title.children, 0, "paragraph").position.start.line).toBe(4);
    expect(title.title).toBe("Title");
  });
});

describe("rst parser: frontmatter", () => {
  // The idiomatic RST case, and the one `extractFrontmatter` alone cannot read:
  // a docinfo field list under the title. Routing by `type` depends on it.
  it("reads a native docinfo field list", () => {
    const rst = ["Rotate an API key", "=================", "", ":type: how-to", "", "Body.", ""].join("\n");
    const tree = parse(rst);
    expect(tree.frontmatter).toMatchObject({
      type: "how-to",
      title: "Rotate an API key",
    });
    expect(tree.frontmatterPosition).toMatchObject({
      start: { line: 4, column: 1 },
      end: { line: 4, column: 14 },
    });
    const docinfo = defined(tree.frontmatterPosition, "frontmatter position");
    expect(rst.slice(docinfo.start.offset, docinfo.end.offset)).toBe(
      ":type: how-to",
    );
  });

  it("reads a fenced block, and spans it with docmeta's locator", () => {
    const tree = parse(
      ["---", "type: how-to", "title: Fenced", "---", "", "Body", "====", ""].join("\n"),
    );
    expect(tree.frontmatter).toMatchObject({ type: "how-to", title: "Fenced" });
    const fence = defined(tree.frontmatterPosition, "frontmatter position");
    expect(fence.start).toMatchObject({ line: 1, column: 1, offset: 0 });
    // The fence is metadata, not a section, and does not open a lead section.
    expect(tree.sections.map((s) => s.title)).toEqual(["Body"]);
  });

  it("reports no frontmatter when the page carries none", () => {
    const tree = parse(["Just prose, no title and no fields.", ""].join("\n"));
    expect(tree.frontmatter).toBeNull();
    expect(tree.frontmatterPosition).toBeNull();
  });

  /**
   * ADR 01006's rule, restated for RST - and it fires far less often here.
   * Markdown levels are absolute, so a page starting at `##` really has no H1.
   * RST levels are relative: the first adornment style *is* level 1. So the
   * rule only reaches a page that declares a title and has no sections at all.
   */
  it("prepends a synthetic H1 from frontmatter when the body has no section", () => {
    const tree = parse(
      ["---", "title: Rotate an API key", "type: how-to", "---", "", "Body prose.", ""].join("\n"),
    );
    expect(tree.sections.map((s) => [s.title, s.level])).toEqual([["Rotate an API key", 1]]);
    const synthetic = at(tree.sections, 0, "synthetic H1 section");
    expect(synthetic.titlePosition).toEqual(tree.frontmatterPosition);
    expect(synthetic.children.map((c) => c.text)).toEqual(["Body prose."]);
  });

  it("does not prepend one when the body already has a level-1 section", () => {
    const tree = parse(
      ["Real title", "==========", "", ":type: how-to", "", "Body.", ""].join("\n"),
    );
    expect(tree.frontmatter).toMatchObject({ title: "Real title" });
    expect(tree.sections.map((s) => s.title)).toEqual(["Real title"]);
  });
});

describe("rst parser: registration", () => {
  it("declares itself as the rst parser", () => {
    expect(rstParser).toMatchObject({
      name: "rst",
      label: "reStructuredText",
      extensions: [".rst"],
    });
    expect(parse("A\n=\n").format).toBe("rst");
    expect(rstParser.parse("A\n=\n", "docs/a.rst").filePath).toBe("docs/a.rst");
  });

  it("declares exactly the content kinds it emits", () => {
    expect(rstParser.kinds).toEqual([
      "paragraph",
      "codeBlock",
      "list",
      "listItem",
      "table",
      "tableRow",
      "tableCell",
      "admonition",
      "image",
      "blockquote",
      "definitionList",
      "definitionItem",
    ]);
  });
});

/**
 * The payoff. `tgdp:how-to:1.6` is a real published doctype, and neither it nor
 * anything between it and the tree knows this format exists. Imported directly
 * rather than through the registry, so a failure here is this parser's and not
 * the registry's - routing has its own tests.
 */
describe("rst parser against tgdp:how-to:1.6", () => {
  it("lints the conforming fixture clean", async () => {
    const path = join(fixtures, "how-to.rst");
    const tree = rstParser.parse(readFileSync(path, "utf8"), path);
    const template = await loadTemplate("tgdp:how-to:1.6");
    expect(validateDocument(tree, template).map((f) => `${f.type}: ${f.message}`)).toEqual([]);

    // The docinfo field list is metadata, not content. If the scanner emitted
    // anything before the title, `sectionize` would open a level-0 lead
    // section and the template's top-level slot would claim that instead.
    expect(tree.sections.map((s) => [s.title, s.level])).toEqual([
      ["Rotate an API key", 1],
    ]);
  });

  it("reports the single defect in the non-conforming fixture", async () => {
    const path = join(fixtures, "how-to-broken.rst");
    const tree = rstParser.parse(readFileSync(path, "utf8"), path);
    const template = await loadTemplate("tgdp:how-to:1.6");
    const findings = validateDocument(tree, template);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "missing_section",
      message: 'Missing section "See also"',
      severity: "error",
    });
  });

  it("routes the conforming fixture by the type its docinfo declares", () => {
    const path = join(fixtures, "how-to.rst");
    const tree = rstParser.parse(readFileSync(path, "utf8"), path);
    expect(tree.frontmatter?.["type"]).toBe("how-to");
  });
});
