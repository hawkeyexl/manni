import { describe, expect, it } from "vitest";
import { markdownParser, mdxParser } from "../../../src/lint/parsers/markdown.js";
import {
  listFormats,
  parserByName,
  parserForExtension,
  supportedExtensions,
} from "../../../src/lint/parsers/index.js";
import { LintError } from "../../../src/lint/types.js";
import type { DocumentTree, SectionNode } from "../../../src/lint/types.js";
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
      at(a.content, 0, "first child of A").position.end.offset,
    ).toBeLessThan(a.position.end.offset);
  });

  it("ends the final section at the end of the document", () => {
    const md = "# A\n\npara\n";
    const tree = parse(md);
    expect(firstSection(tree).position.end.offset).toBe(md.length);
  });

  it("classifies content into generic kinds, in document order", () => {
    const tree = parse("# A\n\npara\n\n```js\ncode\n```\n\n- one\n- two\n");
    expect(firstSection(tree).content.map((n) => n.kind)).toEqual([
      "paragraph",
      "code",
      "list",
    ]);
  });

  it("keeps code language and list ordering", () => {
    const tree = parse("# A\n\n```bash\nls\n```\n\n1. one\n2. two\n");
    const [code, list] = firstSection(tree).content;
    expect(code).toMatchObject({ kind: "code", lang: "bash", text: "ls" });
    expect(list).toMatchObject({ kind: "list", ordered: true });
    expect((list as { items: unknown[] }).items).toHaveLength(2);
  });

  it("nests content inside list items so item rules can run", () => {
    const tree = parse("# A\n\n- item text\n\n  ```js\n  x\n  ```\n");
    const list = firstSection(tree).content[0] as { items: { children: { kind: string }[] }[] };
    expect(at(list.items, 0, "first list item").children.map((c) => c.kind)).toEqual([
      "paragraph",
      "code",
    ]);
  });

  // A blockquote is not a paragraph and a table is not a list; counting them as
  // one would make `paragraphs: {max: N}` fail documents that satisfy it.
  it("ignores block types the DSL does not describe", () => {
    const tree = parse("# A\n\n> quoted\n\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(firstSection(tree).content).toHaveLength(0);
  });

  it("puts content before any heading in an implicit lead section", () => {
    const tree = parse("intro prose\n\n## Prerequisites\n\nmore\n");
    const lead = firstSection(tree);
    expect(lead.level).toBe(0);
    expect(lead.headingPosition).toBeNull();
    expect(lead.content).toHaveLength(1);
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
      expect(root.headingPosition?.start.line).toBe(1);
      expect(root.headingPosition?.start.offset).toBe(0);
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
      expect(root.content.map((n) => n.kind)).toEqual(["paragraph"]);
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
    expect(firstSection(tree).content.map((n) => n.kind)).toEqual(["paragraph"]);
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
    const content = firstSection(tree).content;
    expect(at(content, 0, "first content node").text).toBe(
      "Use {placeholder} here.",
    );
  });

  it("reports a malformed MDX file as an operational error naming the file", () => {
    expect(() => mdxParser.parse("# A\n\n{unclosed\n", "broken.mdx")).toThrow(
      LintError,
    );
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
  // label and extensions, and no state: a listed format is one that is read.
  // Asserted exhaustively, so dropping a parser fails here.
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
        "label",
        "name",
      ]);
      expect(parserByName(format.name)?.name).toBe(format.name);
    }
  });
});
