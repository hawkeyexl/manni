import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { htmlParser } from "../../../src/lint/parsers/html.js";
import { loadTemplate } from "../../../src/lint/core/template-registry.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import type { CodeNode, ListNode, SectionNode } from "../../../src/lint/types.js";
import { at, defined } from "../helpers.js";

const parse = (html: string) => htmlParser.parse(html, "test.html");

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

/** The first content node of the first section, which the code cases assert on. */
function firstContent(tree: ReturnType<typeof parse>) {
  const root = at(tree.sections, 0, "top-level section");
  return at(root.content, 0, "first content node");
}

/**
 * Wrap body markup in a real document, the way the fixtures are written.
 *
 * The default `<head>` carries no `<title>` on purpose: a title would stand in
 * as an H1 for every body that has none, which is the right behavior but not
 * what most of these cases are about.
 */
const doc = (body: string, head = '<meta charset="utf-8">') =>
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

const fixture = (name: string) =>
  readFile(fileURLToPath(new URL(`../fixtures/formats/${name}`, import.meta.url)), "utf8");

describe("html parser", () => {
  it("registers as the format for .html and .htm", () => {
    expect(htmlParser.name).toBe("html");
    expect(htmlParser.label).toBe("HTML");
    expect(htmlParser.extensions).toEqual([".html", ".htm"]);
    expect(parse(doc("<h1>A</h1>")).format).toBe("html");
  });

  it("nests sections by heading level", () => {
    const tree = parse(doc("<h1>A</h1><h2>B</h2><p>text</p><h3>C</h3><h2>D</h2>"));
    expect(tree.sections.map((s) => s.title)).toEqual(["A"]);
    const root = at(tree.sections, 0, "top-level section");
    expect(root.sections.map((s) => s.title)).toEqual(["B", "D"]);
    expect(section(tree.sections, "B").sections.map((s) => s.title)).toEqual(["C"]);
    const d = section(tree.sections, "D");
    expect(d.order).toBe(2);
    expect(d.parentSlug).toBe("a");
  });

  // The exact bug the Markdown parser had before the rewrite: a title built
  // from text nodes alone dropped every inline element.
  it("flattens inline markup inside a heading", () => {
    const tree = parse(
      doc('<h1>Use the <code>lint</code> <em>command</em> in <a href="/x">CI</a></h1>'),
    );
    const root = at(tree.sections, 0, "top-level section");
    expect(root.title).toBe("Use the lint command in CI");
    expect(root.slug).toBe("use-the-lint-command-in-ci");
  });

  // A heading written across several indented lines still has to equal the
  // `heading: {const: ...}` a template compares it against.
  it("collapses insignificant whitespace in a heading", () => {
    const tree = parse(doc("<h2>\n      Before you\n      start\n    </h2>"));
    expect(at(tree.sections, 0, "top-level section").title).toBe("Before you start");
  });

  it("classifies content into generic kinds, in document order", () => {
    const tree = parse(
      doc("<h1>A</h1><p>para</p><pre><code>code</code></pre><ul><li>one</li></ul>"),
    );
    const root = at(tree.sections, 0, "top-level section");
    expect(root.content.map((n) => n.kind)).toEqual([
      "paragraph",
      "code",
      "list",
    ]);
  });

  // A blockquote is not a paragraph and a table is not a list; a div is neither.
  // Counting any of them would make `paragraphs: {max: N}` fail a page that
  // satisfies it.
  it("does not map blockquotes, tables, or figures to a nearest neighbour", () => {
    const tree = parse(
      doc(
        "<h1>A</h1>" +
          "<blockquote><p>quoted</p></blockquote>" +
          "<table><tr><td><p>cell</p></td></tr></table>" +
          "<figure><img src='x.png' alt='x'><figcaption>caption</figcaption></figure>" +
          "<hr>",
      ),
    );
    expect(at(tree.sections, 0, "top-level section").content).toHaveLength(0);
  });

  it("descends through wrapper elements without emitting them", () => {
    const tree = parse(
      doc(
        "<div class='layout'><main><article><div class='prose'>" +
          "<h1>A</h1><p>para</p>" +
          "</div></article></main></div>",
      ),
    );
    expect(tree.sections.map((s) => s.title)).toEqual(["A"]);
    const root = at(tree.sections, 0, "top-level section");
    expect(root.content.map((n) => n.kind)).toEqual(["paragraph"]);
  });

  it("descends into unknown elements, so a custom wrapper does not hide content", () => {
    const tree = parse(doc("<my-callout><h2>Inside</h2><p>text</p></my-callout>"));
    const root = at(tree.sections, 0, "top-level section");
    expect(root.title).toBe("Inside");
    expect(root.content.map((n) => n.kind)).toEqual(["paragraph"]);
  });

  // Descending into an element already emitted as content would emit its prose
  // a second time.
  it("does not emit content twice", () => {
    const tree = parse(
      doc("<h1>A</h1><pre><code>x</code></pre><ul><li><p>item</p></li></ul>"),
    );
    const root = at(tree.sections, 0, "top-level section");
    const kinds = root.content.map((n) => n.kind);
    expect(kinds).toEqual(["code", "list"]);
    // The list item's paragraph belongs to the item, not to the section.
    expect(kinds.filter((k) => k === "paragraph")).toHaveLength(0);
  });

  it("keeps list ordering and maps list items", () => {
    const tree = parse(
      doc("<h1>A</h1><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>"),
    );
    const content = at(tree.sections, 0, "top-level section").content;
    const [unordered, ordered] = content as [ListNode, ListNode];
    expect(unordered).toMatchObject({ kind: "list", ordered: false });
    expect(unordered.items.map((i) => i.text)).toEqual(["one", "two"]);
    expect(ordered).toMatchObject({ kind: "list", ordered: true });
    expect(ordered.items).toHaveLength(1);
  });

  it("maps content inside a list item so item rules can run", () => {
    const tree = parse(
      doc(
        "<h1>A</h1><ol><li><p>Install it:</p>" +
          '<pre><code class="language-bash">npm i x</code></pre>' +
          "<ul><li>note</li></ul></li></ol>",
      ),
    );
    const list = firstContent(tree) as ListNode;
    expect(at(list.items, 0, "first list item").children.map((c) => c.kind)).toEqual([
      "paragraph",
      "code",
      "list",
    ]);
  });

  it("reads a code language from either the pre or the code element", () => {
    const onCode = firstContent(
      parse(doc('<h1>A</h1><pre><code class="language-bash">ls -la</code></pre>')),
    ) as CodeNode;
    expect(onCode).toMatchObject({ kind: "code", lang: "bash", text: "ls -la" });

    const onPre = firstContent(
      parse(doc('<h1>A</h1><pre class="language-yaml">a: 1</pre>')),
    ) as CodeNode;
    expect(onPre).toMatchObject({ kind: "code", lang: "yaml", text: "a: 1" });

    const none = firstContent(
      parse(doc("<h1>A</h1><pre><code>plain</code></pre>")),
    ) as CodeNode;
    expect(none.lang).toBeUndefined();
  });

  it("keeps code whitespace but drops the newline the markup added", () => {
    const code = firstContent(
      parse(
        doc('<h1>A</h1><pre><code class="language-yaml">\nwidgets:\n  - moose\n</code></pre>'),
      ),
    ) as CodeNode;
    expect(code.text).toBe("widgets:\n  - moose");
  });

  // Explicit <section> nesting is ignored: `sectionize` derives structure from
  // heading level for every format, and a page's element nesting is as often a
  // layout choice as a semantic one.
  describe("explicit <section> nesting", () => {
    it("changes nothing when it agrees with the heading levels", () => {
      const nested = parse(
        doc("<section><h1>A</h1><section><h2>B</h2><p>x</p></section></section>"),
      );
      const flat = parse(doc("<h1>A</h1><h2>B</h2><p>x</p>"));
      const nestedRoot = at(nested.sections, 0, "nested top-level section");
      const flatRoot = at(flat.sections, 0, "flat top-level section");
      expect(nestedRoot.sections.map((s) => s.title)).toEqual(
        flatRoot.sections.map((s) => s.title),
      );
    });

    it("does not override the heading levels when the two disagree", () => {
      // Element nesting says B is inside A; the heading levels say they are
      // siblings. The headings win, so a page nests the way its Markdown twin
      // with the same headings does.
      const tree = parse(doc("<section><h2>A</h2><section><h2>B</h2></section></section>"));
      expect(tree.sections.map((s) => s.title)).toEqual(["A", "B"]);
      expect(at(tree.sections, 1, "second top-level section").parentSlug).toBeNull();
    });
  });

  describe("positions", () => {
    it("maps parse5 locations onto the 1-based, end-exclusive span", () => {
      const html = doc("<h1>Title</h1>\n<p>Body text.</p>");
      const tree = parse(html);
      const root = at(tree.sections, 0, "top-level section");
      const heading = defined(root.headingPosition, "heading position");
      const paragraph = at(root.content, 0, "first content node").position;

      expect(html.slice(heading.start.offset, heading.end.offset)).toBe(
        "<h1>Title</h1>",
      );
      expect(html.slice(paragraph.start.offset, paragraph.end.offset)).toBe(
        "<p>Body text.</p>",
      );

      // Line and column are 1-based; the end column is one past the last
      // character, so a span's width is `end.column - start.column`.
      const lines = html.split("\n");
      expect(lines[heading.start.line - 1]).toBe("<h1>Title</h1>");
      expect(heading.start.column).toBe(1);
      expect(heading.end.column - heading.start.column).toBe("<h1>Title</h1>".length);
    });

    it("ends a section where the next sibling heading begins", () => {
      const html = doc("<h1>A</h1>\n<p>para</p>\n\n\n<h1>B</h1>");
      const tree = parse(html);
      const a = at(tree.sections, 0, "first top-level section");
      const b = at(tree.sections, 1, "second top-level section");
      expect(a.position.end.offset).toBe(b.position.start.offset);
      expect(at(a.content, 0, "first content node").position.end.offset).toBeLessThan(
        a.position.end.offset,
      );
    });

    it("ends the final section at the end of the document", () => {
      const html = doc("<h1>A</h1>\n<p>para</p>");
      const tree = parse(html);
      const root = at(tree.sections, 0, "top-level section");
      expect(root.position.end.offset).toBe(html.length);
    });
  });

  describe("metadata", () => {
    it("reads <meta> tags, which is what routes a page by type", () => {
      const tree = parse(
        doc("<h1>A</h1>", '<meta name="type" content="how-to">\n<title>T</title>'),
      );
      expect(tree.frontmatter).toMatchObject({ type: "how-to", title: "T" });
    });

    it("anchors the metadata span on <head>", () => {
      const html = doc("<h1>A</h1>", '<meta name="type" content="how-to">');
      const tree = parse(html);
      const span = defined(tree.frontmatterPosition, "frontmatter position");
      expect(html.slice(span.start.offset, span.end.offset)).toContain("<head>");
      expect(html.slice(span.start.offset, span.end.offset)).toContain("</head>");
    });

    it("also reads a fenced block, which .html files carry in Jekyll-style sites", () => {
      const html = `---\ntype: how-to\ntags:\n  - a\n  - b\n---\n<html><body><h1>A</h1></body></html>\n`;
      const tree = parse(html);
      expect(tree.frontmatter).toMatchObject({ type: "how-to", tags: ["a", "b"] });
      expect(tree.frontmatterPosition?.start.line).toBe(1);
      expect(tree.frontmatterPosition?.start.offset).toBe(0);
      // The fence is metadata, not body text, so it is not content either.
      expect(at(tree.sections, 0, "top-level section").content).toHaveLength(0);
    });

    it("reports no metadata when a page carries none", () => {
      const tree = htmlParser.parse("<h1>A</h1>\n", "bare.html");
      expect(tree.frontmatter).toBeNull();
      expect(tree.frontmatterPosition).toBeNull();
    });
  });

  // The same rule the Markdown parser applies to a frontmatter title, and more
  // natural here: <title> is where HTML says a page's title goes.
  describe("a <title> standing in for a missing H1", () => {
    it("becomes the top-level section", () => {
      const tree = parse(doc("<h2>Overview</h2><p>Why.</p>", "<title>Install it</title>"));
      const root = at(tree.sections, 0, "top-level section");
      expect(root.level).toBe(1);
      expect(root.title).toBe("Install it");
      expect(root.sections.map((s) => s.title)).toEqual(["Overview"]);
    });

    it("is anchored on the head, where the title actually is", () => {
      const tree = parse(doc("<h2>Overview</h2>", "<title>A</title>"));
      const root = at(tree.sections, 0, "top-level section");
      expect(defined(root.headingPosition, "heading position").start.line).toBe(3);
    });

    it("does not displace a real H1", () => {
      const tree = parse(doc("<h1>From the body</h1>", "<title>From the head</title>"));
      expect(tree.sections.map((s) => s.title)).toEqual(["From the body"]);
    });

    it("is not synthesized without a title", () => {
      const tree = parse(
        doc("<h2>Overview</h2>", '<meta name="type" content="how-to">'),
      );
      const root = at(tree.sections, 0, "top-level section");
      expect(root.title).toBe("Overview");
      expect(root.level).toBe(2);
    });

    it("takes the content before the first heading with it", () => {
      const tree = parse(doc("<p>Lead prose.</p><h2>Overview</h2>", "<title>A</title>"));
      const root = at(tree.sections, 0, "top-level section");
      expect(root.content.map((n) => n.kind)).toEqual(["paragraph"]);
      expect(root.sections.map((s) => s.title)).toEqual(["Overview"]);
    });
  });

  // HTML5 defines recovery for every parse error, so parse5 never throws. The
  // point of these is to pin what recovery actually produces rather than to
  // pretend the parser can fail.
  describe("malformed markup", () => {
    it("recovers from unclosed and mis-nested tags instead of throwing", () => {
      expect(() => parse(doc("<h1>A<p>para<div><h2>B</h2>"))).not.toThrow();
    });

    it("keeps the tree a browser would build", () => {
      // An unclosed <h1> is not closed by <p>, so tree construction nests the
      // rest of the document inside the heading - exactly as a browser does -
      // and the H2 goes with it.
      const tree = parse(doc("<h1>A<p>para<div><h2>B</h2></div>"));
      expect(tree.sections).toHaveLength(1);
      const root = at(tree.sections, 0, "top-level section");
      expect(root.title).toContain("A");
      expect(root.sections).toHaveLength(0);
    });

    it("still parses a body-only fragment, with no metadata span", () => {
      const tree = htmlParser.parse("<h1>A</h1>\n<p>b</p>\n", "fragment.html");
      const root = at(tree.sections, 0, "top-level section");
      expect(root.title).toBe("A");
      expect(root.content.map((n) => n.kind)).toEqual(["paragraph"]);
      expect(tree.frontmatterPosition).toBeNull();
    });
  });
});

// The payoff: an HTML page and the built-in doctype template meet with no
// per-format special casing between them.
describe("the how-to fixtures against tgdp:how-to:1.6", () => {
  it("routes on the type declared in a <meta> tag", async () => {
    const tree = htmlParser.parse(await fixture("how-to.html"), "how-to.html");
    expect(tree.frontmatter?.["type"]).toBe("how-to");
  });

  it("derives the sections the template expects", async () => {
    const tree = htmlParser.parse(await fixture("how-to.html"), "how-to.html");
    expect(tree.sections.map((s) => s.title)).toEqual(["Install the moose widget"]);
    const root = at(tree.sections, 0, "top-level section");
    expect(root.sections.map((s) => s.title)).toEqual([
      "Overview",
      "Before you start",
      "Install the widget",
      "See also",
    ]);
    const install = section(tree.sections, "Install the widget");
    expect(install.sections.map((s) => s.title)).toEqual(["Verify the installation"]);
  });

  // Positions are only worth anything if they point at the right bytes of a
  // file somebody actually wrote, indentation and all.
  it("anchors headings on their real source span", async () => {
    const source = await fixture("how-to.html");
    const tree = htmlParser.parse(source, "how-to.html");
    const seeAlso = section(tree.sections, "See also");
    const span = defined(seeAlso.headingPosition, "heading position");
    expect(source.slice(span.start.offset, span.end.offset)).toBe("<h2>See also</h2>");
    const line = at(source.split("\n"), span.start.line - 1, "heading source line");
    expect(line.trim()).toBe("<h2>See also</h2>");
  });

  it("lints the conforming fixture clean", async () => {
    const template = await loadTemplate("tgdp:how-to:1.6");
    const tree = htmlParser.parse(await fixture("how-to.html"), "how-to.html");
    expect(validateDocument(tree, template)).toEqual([]);
  });

  it("reports the one defect in the broken fixture", async () => {
    const template = await loadTemplate("tgdp:how-to:1.6");
    const tree = htmlParser.parse(await fixture("how-to-broken.html"), "how-to-broken.html");
    const findings = validateDocument(tree, template);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "missing_section",
      heading: "Install the moose widget",
      message: 'Missing section "See also"',
      severity: "error",
    });
  });
});
