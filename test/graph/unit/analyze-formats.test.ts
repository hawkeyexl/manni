/**
 * Proposal 0077 §2 and §3: every format lint parses is a graph document. These
 * pin the non-Markdown analyzer path (sections minted from lint's tree, links
 * through `classifyLink`) and the discovery rules for named and walked files.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDoc, formatOf } from "../../../src/graph/core/analyze.js";
import { defaultConfig } from "../../../src/graph/core/config.js";
import { resolveDocumentSet } from "../../../src/graph/core/discover.js";
import { GraphError } from "../../../src/graph/types.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const ALL = new Set(["index.md", "guide.html", "topic.dita"]);

/** An HTML page, `body` inside `<body>`, with a `<title>` in the head. */
function html(body: string, title = "Page"): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

describe("analyzeDoc — sections from lint's tree", () => {
  it("keeps an IRI-safe source id verbatim as the anchor", () => {
    const doc = analyzeDoc(
      html('<section id="GUID-A1B2-C3D4"><h1>How it works</h1><p>x</p></section>'),
      "guide.html",
      ALL,
    );
    expect(doc.format).toBe("html");
    expect(doc.sections).toEqual([
      { slug: "GUID-A1B2-C3D4", title: "How it works", level: 1, order: 1, parentSlug: null },
    ]);
  });

  it("slugs the title when the id is not IRI-safe", () => {
    const doc = analyzeDoc(
      html('<h1 id="has space">Install Now</h1><h2 id="café">Verify</h2>'),
      "guide.html",
      ALL,
    );
    expect(doc.sections.map((s) => s.slug)).toEqual(["install-now", "verify"]);
  });

  it("slugs an id that would collide with a provenance fragment", () => {
    const doc = analyzeDoc(html('<h1 id="prov.generation">Made</h1>'), "guide.html", ALL);
    expect(doc.sections.map((s) => s.slug)).toEqual(["made"]);
  });

  it("disambiguates duplicate ids, and slugs against ids in one namespace", () => {
    const doc = analyzeDoc(
      html(
        '<h1 id="intro">A</h1><h2 id="intro">B</h2><h2>Intro</h2><h2 id="intro-2">C</h2>',
      ),
      "guide.html",
      ALL,
    );
    expect(doc.sections.map((s) => s.slug)).toEqual([
      "intro",
      "intro-1",
      // The slugger's own "intro" and "intro-1" are taken by verbatim ids.
      "intro-2",
      // A verbatim id the slugger took first is disambiguated in turn.
      "intro-2-1",
    ]);
  });

  it("nests by level and orders siblings, as the Markdown path does", () => {
    const doc = analyzeDoc(
      html("<h1>Top</h1><h2>One</h2><h3>Deep</h3><h2>Two</h2>"),
      "guide.html",
      ALL,
    );
    expect(doc.sections).toEqual([
      { slug: "top", title: "Top", level: 1, order: 1, parentSlug: null },
      { slug: "one", title: "One", level: 2, order: 1, parentSlug: "top" },
      { slug: "deep", title: "Deep", level: 3, order: 1, parentSlug: "one" },
      { slug: "two", title: "Two", level: 2, order: 2, parentSlug: "top" },
    ]);
    expect(doc.firstH1).toBe("Top");
  });

  it("mints no section for the lead, and its headings stay top-level", () => {
    const doc = analyzeDoc(
      html("<p>Lead prose.</p><h2>Later</h2>"),
      "guide.html",
      ALL,
    );
    expect(doc.sections).toEqual([
      { slug: "later", title: "Later", level: 2, order: 1, parentSlug: null },
    ]);
  });

  it("mints no section, and no firstH1, for a title read from metadata", () => {
    // A `= Title`-less AsciiDoc page with a YAML title: lint adds a synthetic
    // H1 from it, which is not a heading the author wrote.
    const doc = analyzeDoc(
      "---\ntitle: From metadata\n---\n\n== Section\n\nText.\n",
      "notes.adoc",
      ALL,
    );
    expect(doc.frontmatter).toEqual({ title: "From metadata" });
    expect(doc.firstH1).toBeUndefined();
    expect(doc.sections).toEqual([
      { slug: "_section", title: "Section", level: 2, order: 1, parentSlug: null },
    ]);
  });

  it("reads metadata with meta's extractor for the format", () => {
    const doc = analyzeDoc(
      html("<h1>T</h1>", "Head title").replace(
        "</head>",
        '<meta name="description" content="Said in a meta."></head>',
      ),
      "guide.html",
      ALL,
    );
    expect(doc.frontmatterPresent).toBe(true);
    expect(doc.frontmatter["description"]).toBe("Said in a meta.");
  });
});

describe("analyzeDoc — links, images and code from lint's tree", () => {
  it("resolves links across formats, keeping the anchor", () => {
    const doc = analyzeDoc(
      html(
        '<h1 id="t">T<a href="#t">¶</a></h1><p><a href="index.md">home</a> <a href="topic.dita#GUID-A1B2-C3D4">c</a> <a href="https://example.com/docs#section/sub">x</a></p>',
      ),
      "guide.html",
      ALL,
    );
    expect(doc.links).toEqual([
      { raw: "index.md", kind: "internal", resolvedPath: "index.md" },
      {
        raw: "topic.dita#GUID-A1B2-C3D4",
        kind: "internal",
        resolvedPath: "topic.dita",
        anchor: "GUID-A1B2-C3D4",
      },
      {
        raw: "https://example.com/docs#section/sub",
        kind: "external",
        url: "https://example.com/docs#section/sub",
      },
    ]);
  });

  it("reports a missing .html page as broken: an HTML page is a document now", () => {
    const doc = analyzeDoc(html('<p><a href="gone.html">g</a></p>'), "guide.html", ALL);
    expect(doc.links).toEqual([{ raw: "gone.html", kind: "broken" }]);
  });

  it("collects images and code languages, nested content included", () => {
    const doc = analyzeDoc(
      html(
        '<h1>T</h1><img src="a.png" alt="a"><ul><li><pre><code class="language-bash">ls</code></pre></li></ul>',
      ),
      "guide.html",
      ALL,
    );
    expect(doc.images).toEqual([{ raw: "a.png", target: "a.png", external: false }]);
    expect(doc.codeLanguages).toEqual(["bash"]);
  });

  it("names the format and the file when the parser throws, exit 2", () => {
    let caught: unknown;
    try {
      analyzeDoc("<concept><title>Unclosed", "topic.dita", ALL);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GraphError);
    expect((caught as Error).message).toMatch(/^Could not parse xml in topic\.dita: /);
  });

  it("parses by --as whatever the extension says", () => {
    const doc = analyzeDoc(html("<h1>Forced</h1>"), "page.txt", ALL, { format: "html" });
    expect(doc.format).toBe("html");
    expect(doc.sections.map((s) => s.title)).toEqual(["Forced"]);
  });
});

describe("formatOf", () => {
  it.each([
    ["a.md", "markdown"],
    ["a.markdown", "markdown"],
    ["a.mdx", "mdx"],
    ["a.html", "html"],
    ["a.htm", "html"],
    ["a.adoc", "asciidoc"],
    ["a.rst", "rst"],
    ["a.dita", "xml"],
    ["a.ditamap", "xml"],
    ["a.xml", "xml"],
    // Only a walk with --ext reaches an unclaimed extension; it reads as
    // markdown, as every file did before 0077.
    ["a.txt", "markdown"],
  ])("reads %s as %s", (path, format) => {
    expect(formatOf(path)).toBe(format);
  });
});

describe("resolveDocumentSet — formats", () => {
  let dir: string;
  let stderr: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "manni-graph-formats-"));
    for (const name of ["a.md", "b.html", "c.dita", "pom.xml", "notes.txt"]) {
      writeFileSync(join(dir, name), "");
    }
    resetWarnings();
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("walks every format lint walks, and never .xml", () => {
    expect(resolveDocumentSet(defaultConfig(dir), { paths: ["."] }, "build", dir)).toEqual([
      "a.md",
      "b.html",
      "c.dita",
    ]);
  });

  it("reads a named .xml file", () => {
    expect(
      resolveDocumentSet(defaultConfig(dir), { paths: ["pom.xml"] }, "build", dir),
    ).toEqual(["pom.xml"]);
  });

  it("skips a named file no parser claims, with lint's warning", () => {
    expect(
      resolveDocumentSet(defaultConfig(dir), { paths: ["notes.txt", "a.md"] }, "build", dir),
    ).toEqual(["a.md"]);
    expect(stderr.join("")).toBe(
      'manni: skipped notes.txt: no parser is registered for ".txt". Supported extensions: .md, .markdown, .mdx, .html, .htm, .adoc, .asciidoc, .rst, .dita, .ditamap. Use --as to override.\n',
    );
  });

  it("keeps a named unclaimed file under --as", () => {
    expect(
      resolveDocumentSet(
        defaultConfig(dir),
        { paths: ["notes.txt"], as: "html" },
        "build",
        dir,
      ),
    ).toEqual(["notes.txt"]);
    expect(stderr).toEqual([]);
  });
});
