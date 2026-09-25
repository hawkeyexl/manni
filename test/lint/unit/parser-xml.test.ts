/**
 * The XML parser.
 *
 * The parser is imported directly rather than through the registry, so a
 * failure here is this parser's and not the registry's - routing has its own
 * tests.
 */
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseXml, xmlParser, XML_VOCABULARIES } from "../../../src/lint/parsers/xml.js";
import type { XmlVocabulary } from "../../../src/lint/parsers/xml.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import { loadTemplate } from "../../../src/lint/core/template-registry.js";
import { LintError } from "../../../src/lint/types.js";
import type { SectionNode } from "../../../src/lint/types.js";
import { at, defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "formats");
const maps = join(here, "..", "fixtures", "ditamap");

const parse = (xml: string, file = "test.xml") => xmlParser.parse(xml, file);

/** One `.ditamap` fixture, parsed under its own name so the extension is real. */
const parseMap = (name: string) => {
  const file = join(maps, name);
  return xmlParser.parse(readFileSync(file, "utf8"), file);
};

/** Every section of a tree, depth-first. */
function all(sections: SectionNode[]): SectionNode[] {
  return sections.flatMap((s) => [s, ...all(s.sections)]);
}

/** Depth-first section lookup by title. */
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

/** `title@level` for every section, depth-first, for shape comparisons. */
function outline(sections: SectionNode[]): string[] {
  return sections.flatMap((s) => [`${s.title}@${s.level}`, ...outline(s.sections)]);
}

/**
 * The same page in both built-in vocabularies. DITA nests `<topic>`/`<section>`
 * and writes prose in `<p>`; DocBook nests `<chapter>`/`<section>` and writes
 * it in `<para>`. Nothing downstream should be able to tell.
 */
const DITA_DOC = `<?xml version="1.0"?>
<topic id="guide" type="how-to">
  <title>Guide</title>
  <body>
    <p>Lead prose.</p>
    <section>
      <title>Setup</title>
      <p>Setup prose.</p>
      <codeblock outputclass="language-bash">npm install</codeblock>
      <ul>
        <li>one</li>
        <li>two</li>
      </ul>
    </section>
  </body>
  <topic id="usage">
    <title>Usage</title>
    <body>
      <p>Usage prose.</p>
      <topic id="advanced">
        <title>Advanced</title>
        <body><p>Deeper still.</p></body>
      </topic>
    </body>
  </topic>
</topic>
`;

const DOCBOOK_DOC = `<?xml version="1.0"?>
<chapter xmlns="http://docbook.org/ns/docbook" version="5.0" type="how-to">
  <title>Guide</title>
  <para>Lead prose.</para>
  <section>
    <title>Setup</title>
    <para>Setup prose.</para>
    <programlisting language="bash">npm install</programlisting>
    <itemizedlist>
      <listitem>one</listitem>
      <listitem>two</listitem>
    </itemizedlist>
  </section>
  <section>
    <title>Usage</title>
    <para>Usage prose.</para>
    <section>
      <title>Advanced</title>
      <para>Deeper still.</para>
    </section>
  </section>
</chapter>
`;

describe("xml parser: vocabularies", () => {
  it("builds the same tree shape from DITA and DocBook", () => {
    const dita = outline(parse(DITA_DOC).sections);
    const docbook = outline(parse(DOCBOOK_DOC, "test.docbook.xml").sections);
    expect(dita).toEqual([
      "Guide@1",
      "Setup@2",
      "Usage@2",
      "Advanced@3",
    ]);
    expect(docbook).toEqual(dita);
  });

  it("maps both vocabularies onto the same content kinds", () => {
    for (const doc of [DITA_DOC, DOCBOOK_DOC]) {
      const setup = section(parse(doc).sections, "Setup");
      expect(setup.children.map((n) => n.kind)).toEqual([
        "paragraph",
        "codeBlock",
        "list",
      ]);
    }
  });

  it("recognizes DocBook by namespace even when the root name is shared", () => {
    // `<section>` is a root in both built-ins, so only the namespace separates
    // them - and `<para>` would too, if the namespace were absent.
    const xml = `<section xmlns="http://docbook.org/ns/docbook">
  <title>Only</title>
  <para>Prose.</para>
</section>`;
    const tree = parse(xml);
    const root = at(tree.sections, 0, "root section");
    expect(root.children.map((n) => n.kind)).toEqual(["paragraph"]);
  });

  it("lets one exclusive content element outweigh a root-name match", () => {
    // `<section>` is a DocBook root, but `<p>` is DITA's alone. Reading this as
    // DocBook would leave `<p>` unmapped and silently skip it, producing a
    // titled section with no content and no complaint.
    const xml = `<section>
  <title>Only</title>
  <p>Prose.</p>
</section>`;
    const tree = parse(xml);
    const root = at(tree.sections, 0, "root section");
    expect(root.children.map((n) => n.kind)).toEqual(["paragraph"]);
  });

  it("reads a bespoke schema from a caller-supplied vocabulary", () => {
    const acme: XmlVocabulary = {
      name: "acme",
      label: "Acme Docs",
      namespaces: ["https://acme.example/docs"],
      roots: ["manual"],
      sections: ["manual", "chapter"],
      titles: ["heading"],
      titleWrappers: [],
      transparent: ["content"],
      paragraphs: ["text"],
      code: ["sample"],
      codeLangAttributes: ["lang"],
      unorderedLists: ["bullets"],
      orderedLists: ["numbered"],
      listItems: ["item"],
    };
    const xml = `<manual xmlns="https://acme.example/docs">
  <heading>Manual</heading>
  <content>
    <chapter>
      <heading>First</heading>
      <text>Prose.</text>
      <sample lang="go">println()</sample>
    </chapter>
  </content>
</manual>`;
    const tree = parseXml(xml, "acme.xml", [acme]);
    expect(outline(tree.sections)).toEqual(["Manual@1", "First@2"]);
    const first = section(tree.sections, "First");
    expect(first.children.map((n) => n.kind)).toEqual(["paragraph", "codeBlock"]);
    expect(first.children[1]).toMatchObject({ kind: "codeBlock", language: "go" });
  });

  it("ships DITA, DocBook and DITA maps as the built-ins", () => {
    expect(XML_VOCABULARIES.map((v) => v.name)).toEqual([
      "dita",
      "docbook",
      "ditamap",
    ]);
  });
});

describe("xml parser: nesting and the fold", () => {
  it("turns element nesting into heading level", () => {
    const tree = parse(DITA_DOC);
    expect(tree.sections.map((s) => s.title)).toEqual(["Guide"]);
    expect(section(tree.sections, "Guide").level).toBe(1);
    expect(section(tree.sections, "Setup").level).toBe(2);
    expect(section(tree.sections, "Advanced").level).toBe(3);
  });

  it("records order and parentSlug from the fold", () => {
    const tree = parse(DITA_DOC);
    expect(at(tree.sections, 0, "root section").parentSlug).toBeNull();
    const setup = section(tree.sections, "Setup");
    const usage = section(tree.sections, "Usage");
    expect(setup.order).toBe(1);
    expect(usage.order).toBe(2);
    expect(usage.parentSlug).toBe("guide");
    expect(section(tree.sections, "Advanced").parentSlug).toBe("usage");
  });

  it("does not count transparent wrappers as levels", () => {
    // `<body>` wraps the section but is not one; `Setup` is a child of `Guide`,
    // not a grandchild.
    expect(section(parse(DITA_DOC).sections, "Setup").parentSlug).toBe("guide");
  });

  it("treats a section container with no title as transparent", () => {
    // An untitled DITA <section> is legal. It adds no heading, so it adds no
    // level either, and its content belongs to the section around it.
    const xml = `<topic>
  <title>Only</title>
  <body>
    <section>
      <p>Untitled prose.</p>
    </section>
    <p>Sibling prose.</p>
  </body>
</topic>`;
    const tree = parse(xml);
    expect(outline(tree.sections)).toEqual(["Only@1"]);
    expect(at(tree.sections, 0, "root section").children.map((n) => n.kind)).toEqual([
      "paragraph",
      "paragraph",
    ]);
  });

  it("clamps levels at 6", () => {
    const deep = (depth: number): string =>
      depth === 0
        ? "<p>bottom</p>"
        : `<topic><title>L${depth}</title>${deep(depth - 1)}</topic>`;
    const tree = parse(deep(9));
    const levels: number[] = [];
    const walk = (sections: SectionNode[]): void => {
      for (const s of sections) {
        levels.push(s.level);
        walk(s.sections);
      }
    };
    walk(tree.sections);
    expect(Math.max(...levels)).toBe(6);
    expect(levels.length).toBe(9);
  });

  it("puts the title first, so no implicit lead section is opened", () => {
    const tree = parse(DITA_DOC);
    const root = at(tree.sections, 0, "root section");
    expect(root.level).toBe(1);
    expect(root.titlePosition).not.toBeNull();
  });
});

describe("xml parser: content", () => {
  it("skips unmapped elements together with their subtree", () => {
    // <prolog> and <related-links> stay in no bucket at all, unlike <note> and
    // <table> which now map onto admonition and table.
    const xml = `<topic>
  <title>Only</title>
  <body>
    <p>Real prose.</p>
    <related-links><link href="x"/></related-links>
  </body>
  <prolog><author>Not prose either.</author></prolog>
</topic>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["paragraph"]);
    expect(at(content, 0, "paragraph").text).toBe("Real prose.");
  });

  it("distinguishes ordered from unordered lists", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <ul><li>a</li></ul>
    <ol><li>b</li></ol>
    <steps><step><cmd>c</cmd></step></steps>
  </body>
</topic>`;
    const lists = at(parse(xml).sections, 0, "root section").children;
    expect(lists.map((n) => (n as { ordered: boolean }).ordered)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("gives list items their own content, so item rules can run", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <ol>
      <li>
        <p>Run it.</p>
        <codeblock outputclass="language-bash">ls</codeblock>
      </li>
    </ol>
  </body>
</topic>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    const list = at(content, 0, "list") as {
      items: { text: string; children: { kind: string }[] }[];
    };
    expect(list.items).toHaveLength(1);
    const item = at(list.items, 0, "list item");
    expect(item.children.map((c) => c.kind)).toEqual([
      "paragraph",
      "codeBlock",
    ]);
    expect(item.text).toBe("Run it. ls");
  });

  it("keeps a code block's language and its text verbatim", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <codeblock outputclass="language-bash">
      one
        two
    </codeblock>
  </body>
</topic>`;
    const code = at(
      at(parse(xml).sections, 0, "root section").children,
      0,
      "code block",
    ) as {
      kind: string;
      language?: string;
      text: string;
    };
    expect(code.kind).toBe("codeBlock");
    // `outputclass="language-bash"` is the DITA spelling of a fence's info string.
    expect(code.language).toBe("bash");
    expect(code.text).toBe("      one\n        two");
  });

  it("flattens inline markup in a title", () => {
    const xml = `<topic><title>Use the <codeph>lint</codeph> command</title><body><p>x</p></body></topic>`;
    const tree = parse(xml);
    const root = at(tree.sections, 0, "root section");
    expect(root.title).toBe("Use the lint command");
    expect(root.slug).toBe("use-the-lint-command");
  });

  it("finds a DocBook title inside <info>", () => {
    const xml = `<article xmlns="http://docbook.org/ns/docbook">
  <info><title>Wrapped</title></info>
  <para>Prose.</para>
</article>`;
    const tree = parse(xml);
    const root = at(tree.sections, 0, "root section");
    expect(root.title).toBe("Wrapped");
    // <info> itself is metadata, so nothing inside it becomes content.
    expect(root.children.map((n) => n.kind)).toEqual(["paragraph"]);
  });
});

describe("xml parser: tables", () => {
  it("maps a DITA CALS <table> and <simpletable>, marking the thead/sthead row as header", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <table>
      <tgroup cols="2">
        <thead>
          <row><entry>Name</entry><entry>Value</entry></row>
        </thead>
        <tbody>
          <row><entry>a</entry><entry>1</entry></row>
        </tbody>
      </tgroup>
    </table>
    <simpletable>
      <sthead><stentry>Col A</stentry><stentry>Col B</stentry></sthead>
      <strow><stentry>x</stentry><stentry>y</stentry></strow>
    </simpletable>
  </body>
</topic>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["table", "table"]);

    const cals = content[0] as { children: { header: boolean; children: { text: string }[] }[] };
    expect(cals.children.map((r) => r.header)).toEqual([true, false]);
    expect(cals.children[0]?.children.map((c) => c.text)).toEqual(["Name", "Value"]);
    expect(cals.children[1]?.children.map((c) => c.text)).toEqual(["a", "1"]);

    const simple = content[1] as { children: { header: boolean; children: { text: string }[] }[] };
    expect(simple.children.map((r) => r.header)).toEqual([true, false]);
    expect(simple.children[0]?.children.map((c) => c.text)).toEqual(["Col A", "Col B"]);
    expect(simple.children[1]?.children.map((c) => c.text)).toEqual(["x", "y"]);
  });

  it("maps DocBook's <table> and <informaltable>, CALS thead/tbody shape", () => {
    const xml = `<chapter xmlns="http://docbook.org/ns/docbook">
  <title>Guide</title>
  <informaltable>
    <thead><row><entry>Name</entry><entry>Value</entry></row></thead>
    <tbody><row><entry>a</entry><entry>1</entry></row></tbody>
  </informaltable>
</chapter>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["table"]);
    const table = content[0] as { children: { header: boolean; children: { text: string }[] }[] };
    expect(table.children.map((r) => r.header)).toEqual([true, false]);
    expect(table.children[0]?.children.map((c) => c.text)).toEqual(["Name", "Value"]);
  });
});

describe("xml parser: admonitions", () => {
  it("names a DITA <note>'s variant from @type, defaulting to note when absent", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <note type="tip"><p>Use caching.</p></note>
    <note><p>Default note.</p></note>
    <note type="restriction"><p>Not one of the six.</p></note>
  </body>
</topic>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    // Still three admonitions - the @type="restriction" note is not skipped,
    // it simply names no variant in the six-value set. Inventing an
    // equivalence (e.g. mapping it onto "note") would make `variant: note`
    // pass on a page that never said "note".
    expect(content.map((n) => n.kind)).toEqual(["admonition", "admonition", "admonition"]);
    const [tip, note, restriction] = content as {
      variant?: string;
      children: { kind: string; text: string }[];
    }[];
    expect(tip?.variant).toBe("tip");
    expect(tip?.children.map((c) => ({ kind: c.kind, text: c.text }))).toEqual([
      { kind: "paragraph", text: "Use caching." },
    ]);
    expect(note?.variant).toBe("note");
    expect(note?.children.map((c) => ({ kind: c.kind, text: c.text }))).toEqual([
      { kind: "paragraph", text: "Default note." },
    ]);
    expect(restriction?.variant).toBeUndefined();
    expect(restriction?.children.map((c) => ({ kind: c.kind, text: c.text }))).toEqual([
      { kind: "paragraph", text: "Not one of the six." },
    ]);
  });

  it("names a DocBook admonition's variant from the element itself", () => {
    const xml = `<chapter xmlns="http://docbook.org/ns/docbook">
  <title>Guide</title>
  <warning><para>Careful.</para></warning>
  <tip><para>Handy.</para></tip>
</chapter>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["admonition", "admonition"]);
    const [warning, tip] = content as { variant: string }[];
    expect(warning?.variant).toBe("warning");
    expect(tip?.variant).toBe("tip");
  });
});

describe("xml parser: images", () => {
  it("reads a DITA <image>'s href/alt directly, and a <fig>'s from its nested <image>", () => {
    const xml = `<topic>
  <title>Only</title>
  <body>
    <image href="diagram.png"><alt>A diagram</alt></image>
    <fig>
      <title>Figure caption</title>
      <image href="fig.png"><alt>Figure alt</alt></image>
    </fig>
  </body>
</topic>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["image", "image"]);
    const [image, fig] = content as { url: string; alt: string; title?: string }[];
    expect(image).toMatchObject({ url: "diagram.png", alt: "A diagram" });
    expect(image?.title).toBeUndefined();
    expect(fig).toMatchObject({ url: "fig.png", alt: "Figure alt", title: "Figure caption" });
  });

  it("reads a DocBook <mediaobject>/<figure>'s url from the nested <imagedata fileref>", () => {
    const xml = `<chapter xmlns="http://docbook.org/ns/docbook">
  <title>Guide</title>
  <mediaobject>
    <imageobject><imagedata fileref="diagram.png"/></imageobject>
  </mediaobject>
  <figure>
    <title>Figure caption</title>
    <mediaobject><imageobject><imagedata fileref="fig.png"/></imageobject></mediaobject>
  </figure>
</chapter>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["image", "image"]);
    const [media, figure] = content as { url: string; title?: string }[];
    expect(media?.url).toBe("diagram.png");
    expect(figure).toMatchObject({ url: "fig.png", title: "Figure caption" });
  });
});

describe("xml parser: blockquotes", () => {
  it("maps DITA's <lq>", () => {
    const xml = `<topic><title>Only</title><body><lq><p>Quoted text.</p></lq></body></topic>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["blockquote"]);
    const quote = content[0] as { children: { kind: string; text: string }[] };
    expect(quote.children.map((c) => ({ kind: c.kind, text: c.text }))).toEqual([
      { kind: "paragraph", text: "Quoted text." },
    ]);
  });

  it("maps DocBook's <blockquote>", () => {
    const xml = `<chapter xmlns="http://docbook.org/ns/docbook"><title>Guide</title><blockquote><para>Quoted.</para></blockquote></chapter>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["blockquote"]);
  });
});

describe("xml parser: definition lists", () => {
  it("pairs DITA's <dt>/<dd> inside <dlentry>", () => {
    const xml = `<topic><title>Only</title><body>
  <dl><dlentry><dt>Term</dt><dd><p>Definition text.</p></dd></dlentry></dl>
</body></topic>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["definitionList"]);
    const list = content[0] as {
      children: { kind: string; term: string; definition: { kind: string; text: string }[] }[];
    };
    expect(list.children).toHaveLength(1);
    expect(list.children[0]?.term).toBe("Term");
    expect(list.children[0]?.definition.map((c) => ({ kind: c.kind, text: c.text }))).toEqual([
      { kind: "paragraph", text: "Definition text." },
    ]);
  });

  it("pairs DocBook's <term>/<listitem> inside <varlistentry>", () => {
    const xml = `<chapter xmlns="http://docbook.org/ns/docbook"><title>Guide</title>
  <variablelist>
    <varlistentry><term>Term</term><listitem><para>Definition text.</para></listitem></varlistentry>
  </variablelist>
</chapter>`;
    const content = at(parse(xml).sections, 0, "root section").children;
    expect(content.map((n) => n.kind)).toEqual(["definitionList"]);
    const list = content[0] as {
      children: { term: string; definition: { kind: string; text: string }[] }[];
    };
    expect(list.children[0]?.term).toBe("Term");
    expect(list.children[0]?.definition.map((c) => ({ kind: c.kind, text: c.text }))).toEqual([
      { kind: "paragraph", text: "Definition text." },
    ]);
  });
});

describe("xml parser: positions", () => {
  const xml = [
    `<?xml version="1.0"?>`, //          line 1
    `<topic>`, //                        line 2
    `  <title>Only</title>`, //          line 3
    `  <body>`, //                       line 4
    `    <p>Prose.</p>`, //              line 5
    `  </body>`, //                      line 6
    `</topic>`, //                       line 7
    ``,
  ].join("\n");

  /** The lone paragraph of the document above, in any spelling of it. */
  const paragraph = (source: string) =>
    at(at(parse(source).sections, 0, "root section").children, 0, "paragraph");

  it("reports 1-based line and column with a 0-based offset", () => {
    const para = paragraph(xml);
    expect(para.position.start).toEqual({ line: 5, column: 5, offset: 65 });
    expect(xml.slice(para.position.start.offset)).toMatch(/^<p>Prose\.<\/p>/);
  });

  it("ends a block exclusively, right after its closing tag", () => {
    const para = paragraph(xml);
    expect(xml.slice(para.position.start.offset, para.position.end.offset)).toBe(
      "<p>Prose.</p>",
    );
  });

  it("spans a heading from its container's start tag through its title", () => {
    const tree = parse(xml);
    const root = at(tree.sections, 0, "root section");
    const heading = defined(root.titlePosition, "heading position");
    expect(xml.slice(heading.start.offset, heading.end.offset)).toBe(
      "<topic>\n  <title>Only</title>",
    );
  });

  it("ends the last section at the end of the document", () => {
    const tree = parse(xml);
    expect(at(tree.sections, 0, "root section").position.end.offset).toBe(
      xml.length,
    );
  });

  it("keeps offsets pointing into the file when it uses CRLF", () => {
    const crlf = xml.replace(/\n/g, "\r\n");
    const para = paragraph(crlf);
    expect(crlf.slice(para.position.start.offset)).toMatch(/^<p>Prose\.<\/p>/);
  });

  it("keeps offsets pointing into the file when it starts with a BOM", () => {
    const bom = `﻿${xml}`;
    const para = paragraph(bom);
    expect(bom.slice(para.position.start.offset)).toMatch(/^<p>Prose\.<\/p>/);
  });
});

describe("xml parser: metadata", () => {
  it("reads the doctype from the root element's attributes", () => {
    const tree = parse(DITA_DOC);
    expect(tree.frontmatter).toMatchObject({ id: "guide", type: "how-to" });
  });

  it("drops namespace declarations from the metadata", () => {
    const tree = parse(DOCBOOK_DOC, "test.docbook.xml");
    expect(Object.keys(tree.frontmatter ?? {})).not.toContain("xmlns");
    expect(tree.frontmatter).toMatchObject({ type: "how-to" });
  });

  it("anchors frontmatterPosition on the root element's start tag", () => {
    const xml = `<topic id="a" type="how-to">\n  <title>Only</title>\n</topic>\n`;
    const pos = defined(
      parse(xml).frontmatterPosition,
      "frontmatter position",
    );
    expect(xml.slice(pos.start.offset, pos.end.offset)).toBe(
      `<topic id="a" type="how-to">`,
    );
  });
});

describe("xml parser: failure modes", () => {
  it("raises LintError naming the file for malformed XML", () => {
    expect(() => parse("<topic><title>T</topic>", "broken.xml")).toThrow(
      LintError,
    );
    expect(() => parse("<topic><title>T</topic>", "broken.xml")).toThrow(
      /broken\.xml: could not parse as XML/,
    );
  });

  it("raises for an unclosed root element", () => {
    expect(() => parse("<topic><title>T</title>", "unclosed.xml")).toThrow(
      LintError,
    );
  });

  it("raises for content that is not XML at all", () => {
    expect(() => parse("just some prose", "prose.xml")).toThrow(LintError);
  });

  it("raises on an error xmldom recovered from by guessing", () => {
    // A stray `<` is level `error`, not `fatalError`: xmldom repairs it and
    // carries on. In XML the element tree *is* the structure, so linting a
    // repaired tree would report on a document nobody wrote.
    expect(() => parse("<topic><title>a &lt; b</title><p>x < y</p></topic>")).toThrow(
      LintError,
    );
  });

  it("tolerates a warning xmldom recovers from without changing the tree", () => {
    // An unquoted attribute value is a `warning`: the element tree is intact,
    // and attributes here are metadata, not structure.
    const tree = parse(`<topic id=guide><title>Only</title><body><p>x</p></body></topic>`);
    expect(tree.sections.map((s) => s.title)).toEqual(["Only"]);
  });

  it("names the gap when no vocabulary recognizes the document", () => {
    const xml = `<invoice><customer>Acme</customer><total>10</total></invoice>`;
    expect(() => parse(xml, "invoice.xml")).toThrow(LintError);
    expect(() => parse(xml, "invoice.xml")).toThrow(
      /invoice\.xml: no known XML vocabulary matched <invoice>.*DITA, DocBook.*XML_VOCABULARIES/s,
    );
  });

  it("names the gap when a vocabulary matches but nothing is titled", () => {
    // A DITA topic must be titled: its title is an element in the body, and a
    // topic without one has no structure to check. Saying that beats returning
    // an empty tree that lints as "missing every section". (A map is the other
    // case, and is titled by its nesting - see the DITA maps block below.)
    const xml = `<topic id="x"><body><p>Prose.</p></body></topic>`;
    expect(() => parse(xml, "untitled.xml")).toThrow(
      /untitled\.xml: read as DITA, but no titled section was found/,
    );
  });
});

/**
 * DITA maps.
 *
 * A map is a table of contents, which is to say a tree of navigation entries -
 * exactly what a section tree is. The entries are usually untitled, because a
 * real map points by `@keyref` or `@href` and lets the referenced topic supply
 * the title, so an untitled entry has to be a section rather than a failure.
 */
describe("xml parser: DITA maps", () => {
  it("reads a map of untitled keyref entries as a section tree", () => {
    const tree = parseMap("keyref-toc.ditamap");
    expect(outline(tree.sections)).toEqual(["@1", "@2", "@3", "@3", "@2"]);
    for (const node of all(tree.sections)) {
      expect(node.title).toBe("");
      // Untitled, but still a heading with a place in the file: an entry the
      // fold dropped would take its children up a level with it.
      expect(node.titlePosition).not.toBeNull();
    }
  });

  it("nests a topicref inside a topicref as a child section", () => {
    const map = at(parseMap("keyref-toc.ditamap").sections, 0, "map");
    expect(map.sections).toHaveLength(2);
    expect(at(map.sections, 0, "first entry").sections).toHaveLength(2);
    expect(at(map.sections, 1, "second entry").sections).toEqual([]);
  });

  it("titles an entry from @navtitle and from <topicmeta><navtitle>", () => {
    expect(outline(parseMap("navtitles.ditamap").sections)).toEqual([
      "DITA Open Toolkit@1",
      "Attribute form@2",
      "Element form@2",
    ]);
  });

  it("keeps the literal text of a title split by an inline key reference", () => {
    // `<title>DITA Open Toolkit <keyword keyref="release"/></title>`: the key
    // resolves at build time, so the text present is the whole of the title.
    expect(at(parseMap("navtitles.ditamap").sections, 0, "map").title).toBe(
      "DITA Open Toolkit",
    );
  });

  it("carries a map entry's <shortdesc> as its prose", () => {
    const entry = section(parseMap("navtitles.ditamap").sections, "Element form");
    expect(entry.children.map((n) => n.kind)).toEqual(["paragraph"]);
    expect(at(entry.children, 0, "paragraph")).toMatchObject({
      text: "A map entry can carry prose.",
    });
  });

  it("skips a reltable and a keydef with their subtrees", () => {
    expect(outline(parseMap("reltable-keydef.ditamap").sections)).toEqual([
      "Relationships@1",
      "Navigation@2",
    ]);
  });

  it("reads a glossref as a navigation entry", () => {
    expect(outline(parseMap("glossary.ditamap").sections)).toEqual([
      "Glossary entries@1",
      "@2",
      "@3",
      "@3",
    ]);
  });

  it("passes straight through a topicgroup", () => {
    const xml = `<map>
  <title>Grouped</title>
  <topicgroup>
    <topicref navtitle="A" href="a.dita"/>
    <topicref navtitle="B" href="b.dita"/>
  </topicgroup>
</map>`;
    expect(outline(parse(xml, "grouped.ditamap").sections)).toEqual([
      "Grouped@1",
      "A@2",
      "B@2",
    ]);
  });

  it("reads a bookmap's divisions, with <frontmatter> as a wrapper", () => {
    // The fixture titles itself <booktitle><mainbooktitle>, as a real bookmap
    // does, and the <booklibrary> beside it names the series, not the book.
    expect(outline(parseMap("bookmap.ditamap").sections)).toEqual([
      "Toolkit Guide@1",
      "About this guide@2",
      "Getting started@2",
      "Install@3",
      "Reference@2",
    ]);
  });

  it("takes a bookmap's plain <title> too, the other legal spelling", () => {
    const xml = `<bookmap>
  <title>Toolkit Guide</title>
  <chapter navtitle="Install" href="install.dita"/>
</bookmap>`;
    expect(outline(parse(xml, "book.ditamap").sections)).toEqual([
      "Toolkit Guide@1",
      "Install@2",
    ]);
  });

  it("spans an entry's heading across its own start tag", () => {
    const xml = [
      `<?xml version="1.0"?>`, //          line 1
      `<map>`, //                          line 2
      `  <title>Nav</title>`, //           line 3
      `  <topicref keyref="a">`, //        line 4
      `    <topicref keyref="b"/>`, //     line 5
      `  </topicref>`, //                  line 6
      `</map>`, //                         line 7
      ``,
    ].join("\n");
    const outer = at(
      at(parse(xml, "nav.ditamap").sections, 0, "map").sections,
      0,
      "outer entry",
    );
    expect(outer.position.start.line).toBe(4);
    const heading = defined(outer.titlePosition, "heading position");
    // There is no title element to end on, so the heading ends where the start
    // tag does - any further and it would swallow the nested entry's own.
    expect(xml.slice(heading.start.offset, heading.end.offset)).toBe(
      `<topicref keyref="a">`,
    );

    const inner = at(outer.sections, 0, "inner entry");
    expect(inner.position.start.line).toBe(5);
    const innerHeading = defined(inner.titlePosition, "inner heading position");
    expect(xml.slice(innerHeading.start.offset, innerHeading.end.offset)).toBe(
      `<topicref keyref="b"/>`,
    );
  });
});

describe("xml parser: registry shape", () => {
  it("declares itself as the .xml parser", () => {
    expect(xmlParser.name).toBe("xml");
    expect(xmlParser.label).toBe("XML");
    // `.dita` and `.ditamap` too: that is what a DITA topic and a DITA map are
    // called on disk, and a docset of them would otherwise be walked past.
    expect(xmlParser.extensions).toEqual([".xml", ".dita", ".ditamap"]);
    expect(xmlParser.walkExtensions).toEqual([".dita", ".ditamap"]);
  });

  it("declares exactly the kinds it emits", () => {
    expect(xmlParser.kinds).toEqual([
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

  it("reports its own format on the tree", () => {
    expect(parse(DITA_DOC).format).toBe("xml");
  });
});

/**
 * The payoff: the same built-in template that checks a Markdown page checks a
 * DITA page, and says the same thing about it.
 */
describe("xml parser: tgdp:how-to:1.6", () => {
  it("lints the conforming fixture clean", async () => {
    const file = join(fixtures, "how-to.xml");
    const tree = xmlParser.parse(await readFile(file, "utf8"), file);
    const findings = validateDocument(tree, await loadTemplate("tgdp:how-to:1.6"));
    expect(findings.map((f) => `[${f.type}] ${f.message}`)).toEqual([]);
  });

  it("routes on the type declared as a root attribute", async () => {
    const file = join(fixtures, "how-to.xml");
    const tree = xmlParser.parse(await readFile(file, "utf8"), file);
    expect(tree.frontmatter).toMatchObject({ type: "how-to" });
  });

  it("reports exactly the one defect in the broken fixture", async () => {
    const file = join(fixtures, "how-to-broken.xml");
    const tree = xmlParser.parse(await readFile(file, "utf8"), file);
    const findings = validateDocument(tree, await loadTemplate("tgdp:how-to:1.6"));
    expect(findings).toHaveLength(1);
    const finding = at(findings, 0, "finding");
    expect(finding.type).toBe("missing_section");
    expect(finding.message).toBe('Missing section "See also"');
  });

  it("matches its Markdown twin's outline section for section", async () => {
    const file = join(fixtures, "how-to.xml");
    const tree = xmlParser.parse(await readFile(file, "utf8"), file);
    expect(outline(tree.sections)).toEqual([
      "Rotate an API key@1",
      "Overview@2",
      "Before you start@2",
      "Rotate the key@2",
      "See also@2",
    ]);
  });
});

describe("xml parser: glossary topics", () => {
  /**
   * A `<glossentry>` titles itself with `<glossterm>`, never `<title>`. It was
   * in `sections` from the start and `glossterm` was in no bucket, so every
   * real glossary topic parsed to nothing and reported "no titled section was
   * found". The only DITA fixture until now was a hand-written `<topic>`
   * carrying a `<title>`, which is why it never showed. DITA-OT's own docset
   * has thirteen of these, and all thirteen failed.
   */
  it("titles a glossentry by its glossterm", () => {
    const file = join(here, "..", "fixtures", "dita", "glossentry.dita");
    const tree = xmlParser.parse(readFileSync(file, "utf8"), file);
    expect(outline(tree.sections)).toEqual(["option@1"]);
  });

  it("reads a glossdef as the definition's prose", () => {
    const file = join(here, "..", "fixtures", "dita", "glossentry.dita");
    const tree = xmlParser.parse(readFileSync(file, "utf8"), file);
    const entry = section(tree.sections, "option");
    expect(entry.children.map((n) => n.kind)).toEqual(["paragraph"]);
  });
});
