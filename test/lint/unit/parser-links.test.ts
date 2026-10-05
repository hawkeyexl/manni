/**
 * Raw link targets and explicit section ids, per parser.
 *
 * Both are additive: `manni graph` builds its link graph from them, and no
 * lint rule reads either. So every case here pins what a parser keeps, and
 * every negative pins the reason a target is *not* kept - a permalink, a
 * stylesheet, a key reference, an unresolved name - because a link graph with
 * those in it reports edges nobody wrote.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { htmlParser } from "../../../src/lint/parsers/html.js";
import { xmlParser } from "../../../src/lint/parsers/xml.js";
import { asciidocParser } from "../../../src/lint/parsers/asciidoc.js";
import { rstParser } from "../../../src/lint/parsers/rst.js";
import { markdownParser } from "../../../src/lint/parsers/markdown.js";
import {
  supportedExtensions,
  unsupportedFormatMessage,
} from "../../../src/lint/parsers/index.js";
import type { DocumentTree, SectionNode } from "../../../src/lint/types.js";
import { at, defined } from "../helpers.js";

const targets = (tree: DocumentTree): string[] => tree.links.map((l) => l.target);

/** Every section, depth-first, in document order. */
function all(sections: SectionNode[]): SectionNode[] {
  return sections.flatMap((s) => [s, ...all(s.sections)]);
}

function section(tree: DocumentTree, title: string): SectionNode {
  return defined(
    all(tree.sections).find((s) => s.title === title),
    `section "${title}"`,
  );
}

describe("html links and ids", () => {
  const parse = (html: string) => htmlParser.parse(html, "page.html");

  it("collects <a> and <area> hrefs in document order", () => {
    const tree = parse(
      `<h1>T</h1><p>See <a href="other.html#x">x</a>.</p>` +
        `<map><area href="map.html" alt="m"></map><p><a href="https://example.com">e</a></p>`,
    );
    expect(targets(tree)).toEqual(["other.html#x", "map.html", "https://example.com"]);
  });

  it("positions a link on its own element", () => {
    const tree = parse(`<p>a <a href="b.html">b</a></p>`);
    const link = at(tree.links, 0, "link");
    expect(link.position.start).toEqual({ line: 1, column: 6, offset: 5 });
  });

  it("does not collect <link rel=stylesheet> or <base>", () => {
    const tree = parse(
      `<html><head><link rel="stylesheet" href="style.css"><base href="/root/"></head>` +
        `<body><h1>T</h1></body></html>`,
    );
    expect(targets(tree)).toEqual([]);
  });

  it("drops a heading's self-permalink but keeps other links in the heading", () => {
    const tree = parse(
      `<h2 id="install">Install <a href="#install">¶</a> <a href="#other">o</a></h2>`,
    );
    expect(targets(tree)).toEqual(["#other"]);
    expect(at(tree.sections, 0, "section").title).toBe("Install o");
  });

  it("drops a permalink to an id the heading inherited from its section", () => {
    const tree = parse(
      `<section id="setup"><h2>Setup<a class="headerlink" href="#setup">¶</a></h2></section>`,
    );
    expect(targets(tree)).toEqual([]);
    // The glyph is a widget, not the title, and the slug follows the title.
    const s = section(tree, "Setup");
    expect(s.id).toBe("setup");
    expect(s.slug).toBe("setup");
  });

  it("gives a heading its own id attribute, and leaves the slug alone", () => {
    const tree = parse(`<h2 id="get-started">Install it</h2>`);
    const s = section(tree, "Install it");
    expect(s.id).toBe("get-started");
    expect(s.slug).toBe("install-it");
  });

  it("lets only the first heading in a <section>/<article> claim its id", () => {
    const tree = parse(
      `<article id="guide"><h1>Guide</h1><h2>Later</h2></article>` +
        `<section id="s2"><p>x</p><h2>Second</h2><h3>Third</h3></section>`,
    );
    expect(section(tree, "Guide").id).toBe("guide");
    expect(section(tree, "Later").id).toBeUndefined();
    expect(section(tree, "Second").id).toBe("s2");
    expect(section(tree, "Third").id).toBeUndefined();
  });

  it("prefers the heading's own id over an enclosing section's", () => {
    const tree = parse(`<section id="outer"><h2 id="inner">H</h2></section>`);
    expect(section(tree, "H").id).toBe("inner");
  });

  it("leaves a heading with no id anywhere without one", () => {
    expect(section(parse(`<h2>Plain</h2>`), "Plain").id).toBeUndefined();
  });
});

describe("xml links and ids", () => {
  const parse = (xml: string, file = "topic.dita") => xmlParser.parse(xml, file);

  it("collects DITA xref and link hrefs, including inside <related-links>", () => {
    const tree = parse(
      `<topic id="t"><title>T</title><body><p>See <xref href="a.dita"/>.</p></body>` +
        `<related-links><link href="b.dita"><linktext>B</linktext></link></related-links></topic>`,
    );
    expect(targets(tree)).toEqual(["a.dita", "b.dita"]);
  });

  it("does not let <related-links> content into the sections", () => {
    const tree = parse(
      `<topic id="t"><title>T</title><body><p>one</p></body>` +
        `<related-links><link href="b.dita"><linktext>B</linktext></link></related-links></topic>`,
    );
    expect(section(tree, "T").children.map((c) => c.text)).toEqual(["one"]);
  });

  it("normalizes DITA's file#topic/element to file#element", () => {
    const tree = parse(
      `<topic id="t"><title>T</title><body><p>` +
        `<xref href="other.dita#other/step2"/><xref href="#t/sub"/><xref href="#t"/>` +
        `</p></body></topic>`,
    );
    expect(targets(tree)).toEqual(["other.dita#step2", "#sub", "#t"]);
  });

  it("never rewrites a scheme-bearing href", () => {
    const tree = parse(
      `<topic id="t"><title>T</title><body><p>` +
        `<xref href="https://example.com/docs#section/sub" scope="external"/>` +
        `<xref href="mailto:a@example.com#x/y"/></p></body></topic>`,
    );
    expect(targets(tree)).toEqual([
      "https://example.com/docs#section/sub",
      "mailto:a@example.com#x/y",
    ]);
  });

  it("gives keyref, conkeyref and conref no link", () => {
    const tree = parse(
      `<topic id="t"><title>T</title><body>` +
        `<p><xref keyref="install"/></p><p conref="lib.dita#lib/p1"/><p conkeyref="k/p"/>` +
        `</body></topic>`,
    );
    expect(targets(tree)).toEqual([]);
  });

  it("collects href on map topicrefs, but not on keydefs or keyref-only entries", () => {
    const tree = parse(
      `<map><title>M</title><keydef keys="k" href="k.dita"/>` +
        `<topicref href="a.dita"><topicref href="b.dita#b/sec"/></topicref>` +
        `<topicref keyref="c"/><mapref href="sub.ditamap"/></map>`,
      "map.ditamap",
    );
    expect(targets(tree)).toEqual(["a.dita", "b.dita#sec", "sub.ditamap"]);
  });

  it("gives a DITA topic and section their @id", () => {
    const tree = parse(
      `<topic id="intro"><title>Intro</title><body>` +
        `<section id="usage"><title>Usage</title><p>x</p></section></body></topic>`,
    );
    expect(section(tree, "Intro").id).toBe("intro");
    expect(section(tree, "Usage").id).toBe("usage");
    expect(section(tree, "Usage").slug).toBe("usage");
  });

  it("collects DocBook link, ulink and linkend targets", () => {
    const tree = parse(
      `<article xmlns="http://docbook.org/ns/docbook" xmlns:xlink="http://www.w3.org/1999/xlink">` +
        `<title>A</title><para><link xlink:href="https://example.com">x</link>` +
        `<ulink url="old.html">u</ulink><xref linkend="install"/><link linkend="setup">s</link>` +
        `</para></article>`,
      "book.xml",
    );
    expect(targets(tree)).toEqual(["https://example.com", "old.html", "#install", "#setup"]);
  });

  it("does not apply DITA's fragment rewrite to DocBook", () => {
    const tree = parse(
      `<article xmlns="http://docbook.org/ns/docbook" xmlns:xlink="http://www.w3.org/1999/xlink">` +
        `<title>A</title><para><link xlink:href="other.xml#a/b">x</link></para></article>`,
      "book.xml",
    );
    expect(targets(tree)).toEqual(["other.xml#a/b"]);
  });

  it("gives DocBook sections their xml:id (or id)", () => {
    const tree = parse(
      `<article xmlns="http://docbook.org/ns/docbook" xml:id="art"><title>A</title>` +
        `<section xml:id="install"><title>Install</title><para>x</para></section>` +
        `<sect1 id="legacy"><title>Legacy</title><para>y</para></sect1></article>`,
      "book.xml",
    );
    expect(section(tree, "A").id).toBe("art");
    expect(section(tree, "Install").id).toBe("install");
    expect(section(tree, "Legacy").id).toBe("legacy");
  });
});

describe("asciidoc links and ids", () => {
  const parse = (adoc: string) => asciidocParser.parse(adoc, "page.adoc");

  it("collects link targets from paragraphs, titles and list items", () => {
    const tree = parse(
      `= Doc\n\n== Use https://example.com[the site]\n\nSee link:guide.html[Guide].\n\n` +
        `* item <<install>>\n`,
    );
    expect(targets(tree)).toEqual(["https://example.com", "guide.html", "#install"]);
  });

  it("keeps a cross-file xref's .adoc suffix", () => {
    const tree = parse(`= Doc\n\nSee xref:other.adoc#sec[Other] and xref:more.adoc[].\n`);
    expect(targets(tree)).toEqual(["other.adoc#sec", "more.adoc"]);
  });

  it("decodes entities in an href", () => {
    const tree = parse(`= Doc\n\nlink:a.html?x=1&y=2[q]\n`);
    expect(targets(tree)).toEqual(["a.html?x=1&y=2"]);
  });

  it("never reads an include, and does not count it as a link", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-adoc-include-"));
    const secret = join(dir, "secret.adoc").replace(/\\/g, "/");
    writeFileSync(secret, "== Leaked\n\nleaked text\n");
    const tree = parse(`= Doc\n\ninclude::${secret}[]\n`);
    expect(all(tree.sections).map((s) => s.title)).not.toContain("Leaked");
    expect(JSON.stringify(tree.sections)).not.toContain("leaked text");
    expect(targets(tree)).toEqual([]);
  });

  it("does not count a footnote reference as a link", () => {
    const tree = parse(`= Doc\n\nText.footnote:[A note.]\n`);
    expect(targets(tree)).toEqual([]);
  });

  it("gives a section its explicit or generated id, and leaves the slug alone", () => {
    const tree = parse(`= Doc\n\n[[get-started]]\n== Install it\n\n== Second\n`);
    expect(section(tree, "Install it").id).toBe("get-started");
    expect(section(tree, "Install it").slug).toBe("install-it");
    expect(section(tree, "Second").id).toBe("_second");
  });

  it("positions a link on its block's line", () => {
    const tree = parse(`= Doc\n\nfirst\n\nsee https://example.com[x]\n`);
    expect(at(tree.links, 0, "link").position.start.line).toBe(5);
  });
});

describe("rst links and ids", () => {
  const parse = (rst: string) => rstParser.parse(rst, "page.rst");

  it("collects embedded URIs, named and anonymous", () => {
    const tree = parse("Title\n=====\n\nSee `the site <https://example.com>`_ and `x <other.html>`__.\n");
    expect(targets(tree)).toEqual(["https://example.com", "other.html"]);
  });

  it("positions an embedded link at its own column", () => {
    const tree = parse("Para `x <a.html>`_.\n");
    expect(at(tree.links, 0, "link").position.start).toEqual({ line: 1, column: 6, offset: 5 });
  });

  it("resolves a named reference against the document's targets, case- and space-insensitively", () => {
    const tree = parse(
      "Title\n=====\n\nUse Python_ and `the   Docs`_.\n\n" +
        ".. _python: https://python.org\n.. _The Docs: https://docs.example\n",
    );
    expect(targets(tree)).toEqual(["https://python.org", "https://docs.example"]);
  });

  it("gives an unresolved named reference no link", () => {
    const tree = parse("Title\n=====\n\nUse nowhere_ and `no target`_ and snake_case.\n");
    expect(targets(tree)).toEqual([]);
  });

  it("collects :doc: targets, in both forms, and not :ref:", () => {
    const tree = parse(
      "Title\n=====\n\nSee :doc:`install` and :doc:`the guide <guide/start>`, " +
        "not :ref:`label` or :ref:`x <label>`.\n",
    );
    expect(targets(tree)).toEqual(["install", "guide/start"]);
  });

  it("ignores link syntax inside a literal block", () => {
    const tree = parse("Title\n=====\n\nExample::\n\n    `x <a.html>`_\n\n.. code-block:: rst\n\n    :doc:`b`\n");
    expect(targets(tree)).toEqual([]);
  });

  it("gives a section the label of an internal target directly above it", () => {
    const tree = parse(".. _install-label:\n\nInstall it\n==========\n\ntext\n");
    const s = section(tree, "Install it");
    expect(s.id).toBe("install-label");
    expect(s.slug).toBe("install-it");
  });

  it("gives no id from a target that is not directly above a title", () => {
    const tree = parse(
      "Title\n=====\n\n.. _floating:\n\nA paragraph.\n\nNext\n----\n\ntext\n",
    );
    expect(section(tree, "Next").id).toBeUndefined();
    expect(section(tree, "Title").id).toBeUndefined();
  });

  it("gives no id from an external target above a title", () => {
    const tree = parse(".. _ext: https://example.com\n\nTitle\n=====\n");
    expect(section(tree, "Title").id).toBeUndefined();
  });
});

describe("synthetic metadata title", () => {
  it("is marked synthetic, and a real title is not", () => {
    const synthetic = markdownParser.parse("---\ntitle: From meta\n---\n\n## Body\n", "a.md");
    expect(section(synthetic, "From meta").synthetic).toBe(true);
    expect(section(synthetic, "Body").synthetic).toBeUndefined();

    const real = markdownParser.parse("---\ntitle: From meta\n---\n\n# Real\n", "b.md");
    expect(section(real, "Real").synthetic).toBeUndefined();
  });
});

describe("every parser reports links", () => {
  it("returns an array even when the document has none", () => {
    expect(markdownParser.parse("# T\n", "a.md").links).toEqual([]);
    expect(htmlParser.parse("<h1>T</h1>", "a.html").links).toEqual([]);
  });
});

describe("unsupportedFormatMessage", () => {
  it("names the extension and every supported one", () => {
    expect(unsupportedFormatMessage(".xyz")).toBe(
      `no parser is registered for ".xyz". Supported extensions: ${supportedExtensions().join(", ")}. Use --as to override.`,
    );
  });
});
