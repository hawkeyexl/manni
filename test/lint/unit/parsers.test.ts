import { describe, expect, it } from "vitest";
import { markdownParser, mdxParser } from "../../../src/lint/parsers/markdown.js";
import {
  listFormats,
  parserByName,
  parserForExtension,
  supportedExtensions,
} from "../../../src/lint/parsers/index.js";
import { LintError } from "../../../src/lint/types.js";
import type {
  AdmonitionNode,
  BlockquoteNode,
  ContentNode,
  DocumentTree,
  ElementNode,
  SectionNode,
  TableNode,
} from "../../../src/lint/types.js";
import { at, defined } from "../helpers.js";

const parse = (md: string) => markdownParser.parse(md, "test.md");

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

/** The first top-level section, which nearly every test here indexes into. */
function firstSection(tree: DocumentTree): SectionNode {
  return at(tree.sections, 0, "top-level section");
}

/**
 * The single content node a section holds. Most of the mapping tests below
 * parse one construct and assert on what it became, and asserting the count
 * here is what catches a construct that mapped to two nodes instead of one.
 */
function onlyChild(tree: DocumentTree): ContentNode {
  const children = firstSection(tree).children;
  expect(children.map((n) => n.kind)).toHaveLength(1);
  return at(children, 0, "the section's only content node");
}

describe("markdown parser", () => {
  it("nests sections by heading depth", () => {
    const tree = parse("# A\n\n## B\n\ntext\n\n### C\n\n## D\n");
    expect(tree.sections.map((s) => s.title)).toEqual(["A"]);
    expect(firstSection(tree).sections.map((s) => s.title)).toEqual(["B", "D"]);
    expect(section(tree.sections, "B").sections.map((s) => s.title)).toEqual([
      "C",
    ]);
  });

  it("records order and parentSlug", () => {
    const tree = parse("# A\n\n## B\n\n## D\n");
    const d = section(tree.sections, "D");
    expect(d.order).toBe(2);
    expect(d.parentSlug).toBe("a");
    expect(firstSection(tree).parentSlug).toBeNull();
  });

  it("disambiguates repeated headings in slugs", () => {
    const tree = parse("# Install\n\n# Install\n");
    expect(tree.sections.map((s) => s.slug)).toEqual(["install", "install-1"]);
  });

  // The pre-rewrite parser joined `child.value` across heading children, which
  // is undefined for anything but a text node, so inline markup vanished.
  it("flattens inline markup in a heading title", () => {
    const tree = parse("# Use the `lint` *command*\n");
    const a = firstSection(tree);
    expect(a.title).toBe("Use the lint command");
    expect(a.slug).toBe("use-the-lint-command");
  });

  it("ends a section where the next sibling heading begins, not at its last child", () => {
    const md = "# A\n\npara\n\n\n\n# B\n";
    const tree = parse(md);
    const a = at(tree.sections, 0, "section A");
    const b = at(tree.sections, 1, "section B");
    expect(a.position.end.offset).toBe(b.position.start.offset);
    // The last child ends well before the section does.
    expect(
      at(a.children, 0, "first child of A").position.end.offset,
    ).toBeLessThan(a.position.end.offset);
  });

  it("ends the final section at the end of the document", () => {
    const md = "# A\n\npara\n";
    const tree = parse(md);
    expect(firstSection(tree).position.end.offset).toBe(md.length);
  });

  it("classifies content into generic kinds, in document order", () => {
    const tree = parse("# A\n\npara\n\n```js\ncode\n```\n\n- one\n- two\n");
    expect(firstSection(tree).children.map((n) => n.kind)).toEqual([
      "paragraph",
      "codeBlock",
      "list",
    ]);
  });

  it("keeps code language and list ordering", () => {
    const tree = parse("# A\n\n```bash\nls\n```\n\n1. one\n2. two\n");
    const [code, list] = firstSection(tree).children;
    expect(code).toMatchObject({ kind: "codeBlock", language: "bash", text: "ls" });
    expect(list).toMatchObject({ kind: "list", ordered: true });
    expect((list as { items: unknown[] }).items).toHaveLength(2);
  });

  it("nests content inside list items so item rules can run", () => {
    const tree = parse("# A\n\n- item text\n\n  ```js\n  x\n  ```\n");
    const list = firstSection(tree).children[0] as { items: { children: { kind: string }[] }[] };
    expect(at(list.items, 0, "first list item").children.map((c) => c.kind)).toEqual([
      "paragraph",
      "codeBlock",
    ]);
  });

  // A blockquote is not a paragraph and a table is not a list. Each is now its
  // own kind rather than being dropped, and neither is counted as a paragraph:
  // that is still what keeps `paragraphs: {max: N}` from failing a document a
  // reader would say satisfies it.
  it("maps a blockquote and a table to their own kinds, never to paragraph", () => {
    const tree = parse("# A\n\n> quoted\n\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(firstSection(tree).children.map((n) => n.kind)).toEqual([
      "blockquote",
      "table",
    ]);
  });

  describe("tables", () => {
    const table = (md: string): TableNode => {
      const node = onlyChild(parse(`# A\n\n${md}`));
      expect(node.kind).toBe("table");
      return node as TableNode;
    };

    // GFM guarantees the first row is the header, which is the one format of
    // six where the positional convention is safe to apply.
    it("marks only the first row as the header", () => {
      const rows = table("| Name | Type |\n| - | - |\n| a | string |\n| b | int |\n")
        .children;
      expect(rows.map((r) => r.kind)).toEqual(["tableRow", "tableRow", "tableRow"]);
      expect(rows.map((r) => r.header)).toEqual([true, false, false]);
    });

    it("carries cells as children, with their flattened text", () => {
      const header = at(
        table("| Name | `Type` |\n| - | - |\n| a | string |\n").children,
        0,
        "header row",
      );
      expect(header.children.map((c) => c.kind)).toEqual(["tableCell", "tableCell"]);
      expect(header.children.map((c) => c.text)).toEqual(["Name", "Type"]);
    });

    it("gives every level a real source position", () => {
      const node = table("| Name |\n| - |\n| a |\n");
      const header = at(node.children, 0, "header row");
      const cell = at(header.children, 0, "header cell");
      expect(node.position.start.line).toBe(3);
      expect(header.position.start.line).toBe(3);
      expect(cell.position.start.line).toBe(3);
      expect(cell.position.start.offset).toBeGreaterThan(0);
    });
  });

  describe("blockquotes and GitHub alerts", () => {
    it("keeps a plain blockquote's own children", () => {
      const node = onlyChild(parse("# A\n\n> quoted prose\n>\n> - one\n> - two\n"));
      expect(node.kind).toBe("blockquote");
      expect((node as BlockquoteNode).children.map((c) => c.kind)).toEqual([
        "paragraph",
        "list",
      ]);
    });

    it("maps an alert to an admonition and strips the marker from the text", () => {
      const node = onlyChild(parse("# A\n\n> [!WARNING]\n> Back up first.\n"));
      expect(node).toMatchObject({
        kind: "admonition",
        variant: "warning",
        text: "Back up first.",
      });
      const body = (node as AdmonitionNode).children;
      expect(body.map((c) => c.kind)).toEqual(["paragraph"]);
      expect(at(body, 0, "alert body").text).toBe("Back up first.");
    });

    it("reads a marker on its own paragraph", () => {
      const node = onlyChild(parse("# A\n\n> [!TIP]\n>\n> Body here.\n"));
      expect(node).toMatchObject({ kind: "admonition", variant: "tip", text: "Body here." });
      expect((node as AdmonitionNode).children.map((c) => c.text)).toEqual([
        "Body here.",
      ]);
    });

    it("matches the marker case-insensitively, as GitHub does", () => {
      const variants = [
        ["[!note]", "note"],
        ["[!Tip]", "tip"],
        ["[!IMPORTANT]", "important"],
        ["[!Warning]", "warning"],
        ["[!caution]", "caution"],
      ] as const;
      for (const [marker, variant] of variants) {
        expect(onlyChild(parse(`# A\n\n> ${marker}\n> Body.\n`)), marker).toMatchObject(
          { kind: "admonition", variant },
        );
      }
    });

    // `variant` is set only where the source names one of the six. GitHub
    // defines five alert types, and a word outside them is not an equivalence
    // to invent: the blockquote stays a blockquote, marker text and all.
    it("leaves a marker GitHub does not define as a plain blockquote", () => {
      for (const marker of ["[!DANGER]", "[!HINT]", "[!NOTE] and more"]) {
        const node = onlyChild(parse(`# A\n\n> ${marker}\n> Body.\n`));
        expect(node.kind, marker).toBe("blockquote");
        expect(node.text, marker).toContain(marker);
      }
    });

    it("keeps an alert that carries only its marker", () => {
      const node = onlyChild(parse("# A\n\n> [!NOTE]\n"));
      expect(node).toMatchObject({ kind: "admonition", variant: "note", text: "" });
      expect((node as AdmonitionNode).children).toEqual([]);
    });
  });

  describe("images", () => {
    it("maps a paragraph holding nothing but an image", () => {
      const tree = parse('# A\n\n![Architecture](arch.png "The parts")\n');
      expect(onlyChild(tree)).toMatchObject({
        kind: "image",
        url: "arch.png",
        alt: "Architecture",
        title: "The parts",
        text: "Architecture",
      });
    });

    it("tolerates an image with no alt text", () => {
      expect(onlyChild(parse("# A\n\n![](arch.png)\n"))).toMatchObject({
        kind: "image",
        url: "arch.png",
        alt: "",
      });
    });

    // An image is only its own node when it is the whole block. Inside prose it
    // is part of what that paragraph says, and promoting it would take the
    // sentence around it out of the paragraph count.
    it("leaves an image inside richer prose in its paragraph", () => {
      expect(onlyChild(parse("# A\n\nSee ![the map](b.png) for details.\n"))).toMatchObject(
        { kind: "paragraph", text: "See the map for details." },
      );
    });

    it("leaves two images in one paragraph in that paragraph", () => {
      expect(onlyChild(parse("# A\n\n![one](a.png)\n![two](b.png)\n")).kind).toBe(
        "paragraph",
      );
    });
  });

  // Hugo and Docusaurus both write the anchor a reader never sees. A template
  // matches the heading as rendered.
  describe("heading anchors", () => {
    it("strips a trailing {#anchor} from the title and the slug", () => {
      const tree = parse("# Guide\n\n## Overview {#custom-id}\n");
      const overview = at(firstSection(tree).sections, 0, "the Overview section");
      expect(overview.title).toBe("Overview");
      expect(overview.slug).toBe("overview");
    });

    it("leaves a brace that is not an anchor alone", () => {
      const tree = parse("# Use {placeholder} here\n");
      expect(firstSection(tree).title).toBe("Use {placeholder} here");
    });
  });

  // `element` is MDX's kind. Plain Markdown has no JSX, so raw tags stay raw
  // and the parser must not claim a capability its trees never carry.
  it("emits no element for raw tags, and declares none", () => {
    const tree = parse("# A\n\n<Steps>\n\nOne.\n\n</Steps>\n");
    expect(firstSection(tree).children.map((n) => n.kind)).not.toContain("element");
    expect(markdownParser.kinds).not.toContain("element");
  });

  it("declares exactly the kinds it emits", () => {
    expect(markdownParser.kinds).toEqual([
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
    ]);
  });

  it("puts content before any heading in an implicit lead section", () => {
    const tree = parse("intro prose\n\n## Prerequisites\n\nmore\n");
    const lead = firstSection(tree);
    expect(lead.level).toBe(0);
    expect(lead.titlePosition).toBeNull();
    expect(lead.children).toHaveLength(1);
    // Later headings nest under the lead rather than closing it.
    expect(lead.sections.map((s) => s.title)).toEqual(["Prerequisites"]);
  });

  it("reads frontmatter values and locates the block", () => {
    const tree = parse("---\ntype: how-to\ntags:\n  - a\n  - b\n---\n\n# A\n");
    expect(tree.frontmatter).toEqual({ type: "how-to", tags: ["a", "b"] });
    expect(tree.frontmatterPosition?.start.line).toBe(1);
    // The old line-splitting parser produced the string "- a\n- b" here.
    expect(Array.isArray(defined(tree.frontmatter, "frontmatter").tags)).toBe(
      true,
    );
  });

  // Docusaurus, Hugo, and Starlight render the page title from frontmatter, so
  // their pages start at `##`. Read literally such a page has no top-level
  // section, and every doctype template misaligns against it.
  describe("a frontmatter title standing in for a missing H1", () => {
    it("becomes the top-level section", () => {
      const tree = parse("---\ntitle: Install the widget\n---\n\n## Overview\n\nWhy.\n");
      const root = firstSection(tree);
      expect(root.level).toBe(1);
      expect(root.title).toBe("Install the widget");
      expect(root.sections.map((s) => s.title)).toEqual(["Overview"]);
    });

    it("is anchored on the frontmatter, where the title actually is", () => {
      const tree = parse("---\ntitle: A\n---\n\n## Overview\n");
      const root = firstSection(tree);
      expect(root.titlePosition?.start.line).toBe(1);
      expect(root.titlePosition?.start.offset).toBe(0);
    });

    it("does not displace a real H1", () => {
      const tree = parse("---\ntitle: From frontmatter\n---\n\n# From the body\n");
      expect(tree.sections.map((s) => s.title)).toEqual(["From the body"]);
    });

    it("is not synthesized without a title", () => {
      const tree = parse("---\ntype: how-to\n---\n\n## Overview\n");
      const root = firstSection(tree);
      expect(root.title).toBe("Overview");
      expect(root.level).toBe(2);
    });

    it("ignores a non-string or empty title", () => {
      expect(firstSection(parse("---\ntitle: []\n---\n\n## A\n")).level).toBe(2);
      expect(firstSection(parse('---\ntitle: ""\n---\n\n## A\n')).level).toBe(2);
    });

    // A blank title is as absent as no title. Admitting it gave the document a
    // top-level section with an empty heading, which every template then
    // reported as the wrong title while naming nothing to search for.
    it("ignores a title that is only whitespace", () => {
      expect(firstSection(parse('---\ntitle: "   "\n---\n\n## A\n')).level).toBe(
        2,
      );
    });

    it("trims the title it does use", () => {
      const tree = parse('---\ntitle: "  Install the widget  "\n---\n\n## A\n');
      expect(firstSection(tree).title).toBe("Install the widget");
    });

    it("takes the content before the first heading with it", () => {
      const tree = parse("---\ntitle: A\n---\n\nLead prose.\n\n## Overview\n");
      const root = firstSection(tree);
      expect(root.children.map((n) => n.kind)).toEqual(["paragraph"]);
      expect(root.sections.map((s) => s.title)).toEqual(["Overview"]);
    });
  });

  it("reports no frontmatter when there is none", () => {
    const tree = parse("# A\n");
    expect(tree.frontmatter).toBeNull();
    expect(tree.frontmatterPosition).toBeNull();
  });

  it("excludes the frontmatter block from section content", () => {
    const tree = parse("---\ntype: how-to\n---\n\n# A\n\npara\n");
    expect(firstSection(tree).children.map((n) => n.kind)).toEqual(["paragraph"]);
  });
});

describe("mdx parser", () => {
  it("parses MDX expressions that plain Markdown would not", () => {
    const tree = mdxParser.parse("# A\n\n<Note>hi</Note>\n", "test.mdx");
    expect(tree.format).toBe("mdx");
    expect(firstSection(tree).title).toBe("A");
  });

  // remark-mdx reads `{` as an expression delimiter, so the two formats need
  // separate processors selected by extension.
  it("leaves a literal brace alone in Markdown", () => {
    const tree = parse("# A\n\nUse {placeholder} here.\n");
    const content = firstSection(tree).children;
    expect(at(content, 0, "first content node").text).toBe(
      "Use {placeholder} here.",
    );
  });

  it("reports a malformed MDX file as an operational error naming the file", () => {
    expect(() => mdxParser.parse("# A\n\n{unclosed\n", "broken.mdx")).toThrow(
      LintError,
    );
  });

  describe("JSX elements", () => {
    const parseMdx = (mdx: string) => mdxParser.parse(mdx, "test.mdx");

    const element = (mdx: string): ElementNode => {
      const children = at(parseMdx(`# A\n\n${mdx}`).sections, 0, "section A").children;
      expect(children.map((n) => n.kind)).toEqual(["element"]);
      return at(children, 0, "the element") as ElementNode;
    };

    // Proposal 0053, stress test 4: a section holding one <Steps> holds one
    // block. Counting through the wrapper would fail `paragraphs: {max: 3}` on
    // a page a reader would say satisfies it.
    it("owns its children rather than spilling them into the section", () => {
      const node = element("<Steps>\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\n</Steps>\n");
      expect(node).toMatchObject({ kind: "element", name: "Steps" });
      expect(node.children.map((c) => c.kind)).toEqual([
        "paragraph",
        "paragraph",
        "paragraph",
        "paragraph",
      ]);
      expect(node.text).toBe("One.Two.Three.Four.");
    });

    it("records string, boolean and expression attributes for what they are", () => {
      const node = element('<Steps count={3} open title="Install" {...rest}>\n\nOne.\n\n</Steps>\n');
      expect(node.attributes).toEqual({
        count: "{3}",
        open: true,
        title: "Install",
      });
    });

    it("omits attributes entirely when the element has none", () => {
      expect(element("<Steps>\n\nOne.\n\n</Steps>\n").attributes).toBeUndefined();
    });

    it("gives a fragment no name", () => {
      expect(element("<>\n\nOne.\n\n</>\n")).toMatchObject({ kind: "element", name: "" });
    });

    it("anchors the element on its own source span", () => {
      expect(element("<Steps>\n\nOne.\n\n</Steps>\n").position.start.line).toBe(3);
    });

    // An inline element is part of what the paragraph says, so it flattens
    // into that paragraph's text rather than becoming a block of its own.
    it("flattens an inline JSX element into the surrounding text", () => {
      const tree = parseMdx("# A\n\nText with <Badge>new</Badge> here.\n");
      expect(at(firstSection(tree).children, 0, "paragraph")).toMatchObject({
        kind: "paragraph",
        text: "Text with new here.",
      });
    });

    it("leaves MDX expressions and comments invisible", () => {
      const tree = parseMdx("# A\n\n{/* a note to the author */}\n\nprose\n");
      expect(firstSection(tree).children.map((n) => n.kind)).toEqual(["paragraph"]);
    });
  });

  // Everything but the processor is shared with Markdown, so the wider
  // vocabulary has to arrive in MDX too - a spot check that the seam holds.
  it("maps tables, alerts and images the same way Markdown does", () => {
    const tree = mdxParser.parse(
      "# A\n\n| a |\n| - |\n| 1 |\n\n> [!NOTE]\n> Mind this.\n\n![Map](m.png)\n",
      "test.mdx",
    );
    expect(at(tree.sections, 0, "section A").children.map((n) => n.kind)).toEqual([
      "table",
      "admonition",
      "image",
    ]);
  });

  it("declares exactly the kinds it emits", () => {
    expect(mdxParser.kinds).toEqual([
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
      "element",
    ]);
  });
});

describe("parser registry", () => {
  it("resolves parsers by extension, case-insensitively", () => {
    expect(parserForExtension(".md")?.name).toBe("markdown");
    expect(parserForExtension(".MDX")?.name).toBe("mdx");
  });

  it("resolves parsers by name for --as", () => {
    expect(parserByName("markdown")?.name).toBe("markdown");
    expect(parserByName("nope")).toBeUndefined();
  });

  it("walks directories using only extensions a parser reads", () => {
    const exts = supportedExtensions();
    expect(exts).toEqual(expect.arrayContaining([".md", ".markdown", ".mdx"]));
    // Every extension offered for a directory walk must belong to a parser, or
    // the walk collects files it will only skip.
    for (const ext of exts) {
      expect(parserForExtension(ext), ext).toBeDefined();
    }
  });

  // The list is exactly the formats the tool reads. A row carries a name, a
  // label, extensions, and the content kinds it emits, and no state beside
  // that: a listed format is one that is read. Asserted exhaustively, so
  // dropping a parser fails here.
  it("lists every format it reads, and no state beside it", () => {
    const formats = listFormats();
    expect(formats.map((f) => f.name).sort()).toEqual([
      "asciidoc",
      "html",
      "markdown",
      "mdx",
      "rst",
      "xml",
    ]);
    for (const format of formats) {
      expect(format.extensions.length, format.name).toBeGreaterThan(0);
      expect(Object.keys(format).sort(), format.name).toEqual([
        "extensions",
        "kinds",
        "label",
        "name",
      ]);
      // A capability declaration, so it must be non-empty and must not repeat
      // itself. What each format emits beyond the shared three is that
      // parser's own test; asserting one list for all six here would only
      // record whichever format was widened last.
      expect(format.kinds.length, format.name).toBeGreaterThan(0);
      expect(new Set(format.kinds).size, format.name).toBe(format.kinds.length);
      expect(format.kinds, format.name).toEqual(
        expect.arrayContaining(["paragraph", "codeBlock", "list"]),
      );
      expect(parserByName(format.name)?.name).toBe(format.name);
    }
  });
});
