import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/kg/core/analyze.js";

const ALL = new Set(["docs/intro.md", "docs/config.md", "docs/sub/deep.md"]);

describe("analyzeDoc — frontmatter", () => {
  it("extracts frontmatter data via docmeta", () => {
    const doc = analyzeDoc(
      "---\ntitle: Intro\ntags: [setup]\n---\n\n# Hello\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.frontmatterPresent).toBe(true);
    expect(doc.frontmatter).toEqual({ title: "Intro", tags: ["setup"] });
  });

  it("handles a doc without frontmatter", () => {
    const doc = analyzeDoc("# Just a heading\n", "docs/intro.md", ALL);
    expect(doc.frontmatterPresent).toBe(false);
    expect(doc.frontmatter).toEqual({});
  });

  it("handles CRLF files", () => {
    const doc = analyzeDoc(
      "---\r\ntitle: Win\r\n---\r\n\r\n# Heading\r\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.frontmatter).toEqual({ title: "Win" });
    expect(doc.sections).toHaveLength(1);
  });
});

describe("analyzeDoc — headings", () => {
  it("builds a section list with levels, slugs, order, and parents", () => {
    const doc = analyzeDoc(
      "# Title\n\n## Install\n\ntext\n\n## Usage\n\n### Advanced\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.firstH1).toBe("Title");
    expect(doc.sections).toEqual([
      { slug: "title", title: "Title", level: 1, order: 1, parentSlug: null },
      {
        slug: "install",
        title: "Install",
        level: 2,
        order: 1,
        parentSlug: "title",
      },
      {
        slug: "usage",
        title: "Usage",
        level: 2,
        order: 2,
        parentSlug: "title",
      },
      {
        slug: "advanced",
        title: "Advanced",
        level: 3,
        order: 1,
        parentSlug: "usage",
      },
    ]);
  });

  it("disambiguates duplicate headings in document order", () => {
    const doc = analyzeDoc("## Setup\n\n## Setup\n", "docs/intro.md", ALL);
    expect(doc.sections.map((s) => s.slug)).toEqual(["setup", "setup-1"]);
  });

  it("attaches level-skipping headings to the nearest shallower ancestor", () => {
    const doc = analyzeDoc("# Top\n\n### Deep\n", "docs/intro.md", ALL);
    expect(doc.sections[1]).toMatchObject({ slug: "deep", parentSlug: "top" });
  });

  it("handles headings before any shallower heading (parent = doc)", () => {
    const doc = analyzeDoc("### Orphan\n\n# Later\n", "docs/intro.md", ALL);
    expect(doc.sections[0]).toMatchObject({
      slug: "orphan",
      parentSlug: null,
      order: 1,
    });
    expect(doc.sections[1]).toMatchObject({
      slug: "later",
      parentSlug: null,
      order: 2,
    });
  });
});

describe("analyzeDoc — links", () => {
  it("classifies internal, external, and broken links", () => {
    const doc = analyzeDoc(
      "[a](config.md) [b](https://example.com/x) [c](missing.md)\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.links).toEqual([
      { raw: "config.md", kind: "internal", resolvedPath: "docs/config.md" },
      {
        raw: "https://example.com/x",
        kind: "external",
        url: "https://example.com/x",
      },
      { raw: "missing.md", kind: "broken" },
    ]);
  });

  it("resolves relative traversal and anchors", () => {
    const doc = analyzeDoc(
      "[up](../intro.md#install) [peer](deep.md)\n",
      "docs/sub/deep.md",
      new Set(["docs/intro.md", "docs/sub/deep.md"]),
    );
    expect(doc.links[0]).toEqual({
      raw: "../intro.md#install",
      kind: "internal",
      resolvedPath: "docs/intro.md",
      anchor: "install",
    });
  });

  it("ignores same-document anchor links", () => {
    const doc = analyzeDoc("[here](#install)\n", "docs/intro.md", ALL);
    expect(doc.links).toEqual([]);
  });

  it("ignores site-root-absolute links (published-site routes, not repo paths)", () => {
    const doc = analyzeDoc("[route](/docs/config/)\n", "docs/intro.md", ALL);
    expect(doc.links).toEqual([]);
  });

  it("ignores scheme-bearing targets that are not parseable URLs (example junk)", () => {
    const doc = analyzeDoc(
      '[x](http://localhost:8092","params":{"token":"t"}}})\n',
      "docs/intro.md",
      ALL,
    );
    expect(doc.links).toEqual([]);
  });

  it("resolves reference-style links via definitions", () => {
    const doc = analyzeDoc(
      "[a][ref]\n\n[ref]: config.md\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.links).toEqual([
      { raw: "config.md", kind: "internal", resolvedPath: "docs/config.md" },
    ]);
  });

  it("resolves relative extensionless links by trying extensions and index files", () => {
    const paths = new Set([
      "docs/input-formats/overview.mdx",
      "docs/input-formats/custom.mdx",
      "docs/actions/index.md",
      "docs/actions/find.mdx",
    ]);
    const doc = analyzeDoc(
      "[a](custom) [b](../actions/) [c](../actions/find#usage)\n",
      "docs/input-formats/overview.mdx",
      paths,
    );
    expect(doc.links).toEqual([
      {
        raw: "custom",
        kind: "internal",
        resolvedPath: "docs/input-formats/custom.mdx",
      },
      {
        raw: "../actions/",
        kind: "internal",
        resolvedPath: "docs/actions/index.md",
      },
      {
        raw: "../actions/find#usage",
        kind: "internal",
        resolvedPath: "docs/actions/find.mdx",
        anchor: "usage",
      },
    ]);
  });

  it("does not crash on malformed percent-encodings (stray %)", () => {
    const doc = analyzeDoc(
      "[sale](50%-off.md) [also](file%zz.md)\n",
      "docs/intro.md",
      new Set(["docs/intro.md", "docs/50%-off.md"]),
    );
    // raw form is used when decoding fails; exact corpus match still works
    expect(doc.links[0]).toEqual({
      raw: "50%-off.md",
      kind: "internal",
      resolvedPath: "docs/50%-off.md",
    });
    expect(doc.links[1]).toEqual({ raw: "file%zz.md", kind: "broken" });
  });

  it("skips a relative link to a non-document file", () => {
    // Same rule as the route branch (ADR 01033): a download beside the page is
    // not a document dockg failed to find.
    const doc = analyzeDoc(
      "[the turtle](./ns.ttl) and [the archive](../dist.zip)\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.links).toEqual([]);
  });

  it("marks links escaping the root as broken", () => {
    const doc = analyzeDoc("[out](../../outside.md)\n", "docs/intro.md", ALL);
    expect(doc.links).toEqual([{ raw: "../../outside.md", kind: "broken" }]);
  });
});

describe("analyzeDoc — route mapping", () => {
  const paths = new Set([
    "docs/pages/actions/find.mdx",
    "docs/pages/actions/index.mdx",
    "docs/pages/intro.md",
    "docs/linker.md",
  ]);
  const routes = [
    {
      basePath: "/docs",
      root: "docs/pages",
      extensions: [".mdx", ".md"],
      indexFiles: ["index"],
    },
  ];

  it("resolves a route to its source file, trying extensions", () => {
    const doc = analyzeDoc(
      "[a](/docs/actions/find) [b](/docs/intro)\n",
      "docs/linker.md",
      paths,
      { routes },
    );
    expect(doc.links).toEqual([
      {
        raw: "/docs/actions/find",
        kind: "internal",
        resolvedPath: "docs/pages/actions/find.mdx",
      },
      {
        raw: "/docs/intro",
        kind: "internal",
        resolvedPath: "docs/pages/intro.md",
      },
    ]);
  });

  it("falls back to extension candidates for trailing-slash pretty URLs", () => {
    // Hugo/Docusaurus serve find.mdx at /docs/actions/find/ — no index file exists
    const doc = analyzeDoc(
      "[pretty](/docs/actions/find/)\n",
      "docs/linker.md",
      paths,
      {
        routes,
      },
    );
    expect(doc.links).toEqual([
      {
        raw: "/docs/actions/find/",
        kind: "internal",
        resolvedPath: "docs/pages/actions/find.mdx",
      },
    ]);
    // ...but index files still win when both exist
    const dirDoc = analyzeDoc(
      "[dir](/docs/actions/)\n",
      "docs/linker.md",
      paths,
      { routes },
    );
    expect(dirDoc.links[0]).toMatchObject({
      resolvedPath: "docs/pages/actions/index.mdx",
    });
  });

  it("resolves directory routes (trailing slash) via index files, and keeps anchors", () => {
    const doc = analyzeDoc(
      "[dir](/docs/actions/) [anchored](/docs/actions/find#usage)\n",
      "docs/linker.md",
      paths,
      { routes },
    );
    expect(doc.links[0]).toEqual({
      raw: "/docs/actions/",
      kind: "internal",
      resolvedPath: "docs/pages/actions/index.mdx",
    });
    expect(doc.links[1]).toMatchObject({
      resolvedPath: "docs/pages/actions/find.mdx",
      anchor: "usage",
    });
  });

  it("marks unresolvable routes under a mapped basePath as broken", () => {
    const doc = analyzeDoc(
      "[gone](/docs/actions/missing)\n",
      "docs/linker.md",
      paths,
      {
        routes,
      },
    );
    expect(doc.links).toEqual([
      { raw: "/docs/actions/missing", kind: "broken" },
    ]);
  });

  it("skips a route target whose extension is not a document extension", () => {
    // A mapping's `extensions` declares what its DOCUMENTS look like. A site
    // also serves static assets under the same basePath — dockg's own
    // /dockg/ns.ttl — and calling one a broken document link is a finding the
    // author cannot act on: there is no .md they could add. (ADR 01033)
    const doc = analyzeDoc(
      "[turtle](/docs/ns.ttl) and [spec](/docs/actions/spec.pdf)\n",
      "docs/linker.md",
      paths,
      { routes },
    );
    expect(doc.links).toEqual([]);
  });

  it("still breaks on a route target that IS a document extension", () => {
    // The narrowing is about non-document extensions only. A link written with
    // the source extension still has to resolve.
    const doc = analyzeDoc(
      "[typo](/docs/actions/missing.mdx)\n",
      "docs/linker.md",
      paths,
      { routes },
    );
    expect(doc.links).toEqual([
      { raw: "/docs/actions/missing.mdx", kind: "broken" },
    ]);
  });

  it("still skips root-absolute links outside every mapped basePath", () => {
    const doc = analyzeDoc("[other](/blog/post)\n", "docs/linker.md", paths, {
      routes,
    });
    expect(doc.links).toEqual([]);
  });

  it("matches case-insensitively and slug-normalized (Fern-style kebab slugs)", () => {
    const camelPaths = new Set([
      "docs/pages/actions/closeSurface.mdx",
      "docs/pages/actions/stopRecord.mdx",
      "docs/linker.md",
    ]);
    const doc = analyzeDoc(
      "[a](/docs/actions/closesurface) [b](/docs/actions/stop-record)\n",
      "docs/linker.md",
      camelPaths,
      { routes },
    );
    expect(doc.links).toEqual([
      {
        raw: "/docs/actions/closesurface",
        kind: "internal",
        resolvedPath: "docs/pages/actions/closeSurface.mdx",
      },
      {
        raw: "/docs/actions/stop-record",
        kind: "internal",
        resolvedPath: "docs/pages/actions/stopRecord.mdx",
      },
    ]);
  });

  it("decodes percent-encoded routes before matching", () => {
    const doc = analyzeDoc(
      "[x](/docs/getting%20started)\n",
      "docs/linker.md",
      new Set(["docs/pages/getting started.mdx", "docs/linker.md"]),
      { routes },
    );
    expect(doc.links).toEqual([
      {
        raw: "/docs/getting%20started",
        kind: "internal",
        resolvedPath: "docs/pages/getting started.mdx",
      },
    ]);
  });

  it("treats trailing-slash routes as directories (index files only)", () => {
    // both guide.mdx and guide/index.mdx exist: /docs/guide/ must pick the index
    const both = new Set([
      "docs/pages/guide.mdx",
      "docs/pages/guide/index.mdx",
      "docs/linker.md",
    ]);
    const doc = analyzeDoc(
      "[dir](/docs/guide/) [page](/docs/guide)\n",
      "docs/linker.md",
      both,
      {
        routes,
      },
    );
    expect(doc.links[0]).toMatchObject({
      resolvedPath: "docs/pages/guide/index.mdx",
    });
    expect(doc.links[1]).toMatchObject({
      resolvedPath: "docs/pages/guide.mdx",
    });
  });

  it("resolves the bare basePath itself to the root index", () => {
    const doc = analyzeDoc("[home](/docs)\n", "docs/linker.md", paths, {
      routes: [{ ...routes[0]!, root: "docs/pages/actions" }],
    });
    expect(doc.links).toEqual([
      {
        raw: "/docs",
        kind: "internal",
        resolvedPath: "docs/pages/actions/index.mdx",
      },
    ]);
  });
});

describe("analyzeDoc — images and code", () => {
  it("collects images with resolved targets", () => {
    const doc = analyzeDoc(
      "![alt](img/a.png)\n![ext](https://example.com/b.png)\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.images).toEqual([
      { raw: "img/a.png", target: "docs/img/a.png", external: false },
      {
        raw: "https://example.com/b.png",
        target: "https://example.com/b.png",
        external: true,
      },
    ]);
  });

  it("collects distinct fenced code languages, sorted", () => {
    const doc = analyzeDoc(
      "```python\nx\n```\n\n```bash\ny\n```\n\n```python\nz\n```\n\n```\nplain\n```\n",
      "docs/intro.md",
      ALL,
    );
    expect(doc.codeLanguages).toEqual(["bash", "python"]);
  });
});

describe("analyzeDoc — a route mapping with no configured extensions", () => {
  // `extensions: []` is schema-valid (no minItems). ADR 01033's narrowing asks
  // "is this extension one of the mapping's document extensions?" — and against
  // an empty list the answer is always no, which would skip EVERY
  // extension-bearing target, including a genuinely broken `.md` link. The
  // narrowing must not become a way to turn the check off.
  const paths = new Set(["docs/pages/actions/find.mdx"]);
  const routes = [
    { basePath: "/docs", root: "docs/pages", extensions: [], indexFiles: [] },
  ];

  it("still reports a broken document link", () => {
    const doc = analyzeDoc(
      "[gone](/docs/actions/missing.md)\n",
      "docs/l.md",
      paths,
      {
        routes,
      },
    );
    expect(doc.links).toEqual([
      { raw: "/docs/actions/missing.md", kind: "broken" },
    ]);
  });
});

describe("analyzeDoc — content hash (ADR 01036)", () => {
  /** An independent digest, so the test does not just restate the implementation. */
  const sha256 = (s: string): string =>
    createHash("sha256").update(s, "utf8").digest("hex");

  it("is the sha256 of the content as read", () => {
    const content = "---\ntitle: T\n---\n\n# T\n\nBody.\n";
    const doc = analyzeDoc(content, "docs/intro.md", ALL);
    expect(doc.contentHash).toBe(sha256(content));
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes CRLF from LF", () => {
    // The corpus pins a CRLF fixture on purpose (.gitattributes). A digest that
    // normalized line endings would call two genuinely different files the
    // same, which is the one thing a drift signal must not do.
    const lf = "# T\n\nBody.\n";
    const crlf = "# T\r\n\r\nBody.\r\n";
    expect(analyzeDoc(lf, "a.md", ALL).contentHash).not.toBe(
      analyzeDoc(crlf, "a.md", ALL).contentHash,
    );
    expect(analyzeDoc(crlf, "a.md", ALL).contentHash).toBe(sha256(crlf));
  });

  it("depends on content alone, not on the path", () => {
    // The join key a consumer needs is "what was in this file", so two paths
    // holding identical bytes must agree — a rename is not a content change.
    const content = "# Same\n";
    const a = analyzeDoc(content, "docs/a.md", ALL).contentHash;
    // Assert it is a digest before asserting equality: `undefined === undefined`
    // would make this pass with no implementation at all.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(analyzeDoc(content, "docs/sub/b.md", ALL).contentHash).toBe(a);
  });

  it("changes when a single byte changes", () => {
    const a = analyzeDoc("# T\n\nBody.\n", "a.md", ALL).contentHash;
    const b = analyzeDoc("# T\n\nBody!\n", "a.md", ALL).contentHash;
    expect(a).not.toBe(b);
  });
});
