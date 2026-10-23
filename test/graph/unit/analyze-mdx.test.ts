import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import { GraphError } from "../../../src/graph/types.js";

/**
 * MDX support (ADR 01022). A JSX element's `href` is a link on any element —
 * dockg reads structure, not component semantics. `src` is narrower: it is
 * HTML's generic external-resource attribute, so it means an image only on an
 * image element.
 *
 * The motivating case is a Starlight/Docusaurus corpus where most navigation is
 * written as components, so a parser that only sees Markdown links reports an
 * orphan list and an impact traversal that silently understate the corpus.
 */
const corpus = new Set(["docs/guide.md", "docs/other.md", "docs/target.mdx"]);

describe("analyzeDoc over .mdx", () => {
  it("derives a link from an href attribute on a JSX element", async () => {
    const doc = await analyzeDoc(
      `import { LinkCard } from '@astrojs/starlight/components';\n\n` +
        `<LinkCard title="Other" href="other.md" />\n`,
      "docs/guide.mdx",
      corpus,
    );
    expect(doc.links.map((l) => l.raw)).toContain("other.md");
    expect(doc.links[0]?.kind).toBe("internal");
    expect(doc.links[0]?.resolvedPath).toBe("docs/other.md");
  });

  it("derives an image from a src attribute on an image element", async () => {
    for (const element of ["img", "Image"]) {
      const doc = await analyzeDoc(
        `<${element} src="img/arch.png" alt="Architecture" />\n`,
        "docs/guide.mdx",
        corpus,
      );
      expect(doc.images.map((i) => i.raw)).toEqual(["img/arch.png"]);
    }
  });

  it("does not call every src an image", async () => {
    // HTML's `src` is the generic external-resource attribute — iframe, video,
    // script, audio, source, embed all use it. Emitting `schema:image` for a
    // YouTube embed or a script tag would be a wrong type assertion, not a
    // merely-extra edge, so only image elements are read (ADR 01022).
    for (const source of [
      `<iframe src="https://youtube.com/embed/x" />\n`,
      `<video src="demo.mp4" />\n`,
      `<script src="analytics.js" />\n`,
    ]) {
      const doc = await analyzeDoc(source, "docs/guide.mdx", corpus);
      expect(doc.images).toEqual([]);
    }
  });

  it("reaches a JSX element nested inside another", async () => {
    const doc = await analyzeDoc(
      `<CardGrid>\n  <LinkCard href="other.md" />\n</CardGrid>\n`,
      "docs/guide.mdx",
      corpus,
    );
    expect(doc.links.map((l) => l.raw)).toEqual(["other.md"]);
  });

  it("still derives ordinary Markdown links and headings from .mdx", async () => {
    const doc = await analyzeDoc(
      `# Guide\n\nSee [other](other.md) and <LinkCard href="target.mdx" />.\n`,
      "docs/guide.mdx",
      corpus,
    );
    expect(doc.firstH1).toBe("Guide");
    expect(doc.links.map((l) => l.raw).sort()).toEqual([
      "other.md",
      "target.mdx",
    ]);
  });

  it("skips an expression attribute rather than guessing its value", async () => {
    // `href={route}` is not knowable without evaluating the module; asserting a
    // wrong edge confidently is worse than asserting none.
    const doc = await analyzeDoc(
      `<LinkCard href={route} />\n`,
      "docs/guide.mdx",
      corpus,
    );
    expect(doc.links).toEqual([]);
  });

  it("classifies an absolute JSX href as external", async () => {
    const doc = await analyzeDoc(
      `<LinkCard href="https://example.com/x" />\n`,
      "docs/guide.mdx",
      corpus,
    );
    expect(doc.links[0]?.kind).toBe("external");
  });
});

describe("unparseable .mdx", () => {
  // Parsing MDX means parse *failures* are now possible where Markdown never
  // had any. A raw micromark throw escapes cli.ts's `fail()`, which only
  // converts GraphError — so the CLI would dump a stack trace, exit 1 (which
  // the contract reserves for findings), and never name the offending file.
  const bad = `# Bad\n\n<LinkCard href="x">\n`;

  it("raises a GraphError rather than letting the parser throw", async () => {
    await expect(analyzeDoc(bad, "docs/broken.mdx", corpus)).rejects.toThrow(
      GraphError,
    );
  });

  it("names the file and the parser's reason", async () => {
    let message = "";
    try {
      await analyzeDoc(bad, "docs/broken.mdx", corpus);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("docs/broken.mdx");
    expect(message).toContain("closing tag");
  });
});

describe("analyzeDoc over .md is unaffected", () => {
  it("treats JSX-looking text as ordinary content, not attributes", async () => {
    const doc = await analyzeDoc(
      `# Guide\n\n<LinkCard href="other.md" />\n`,
      "docs/guide.md",
      corpus,
    );
    // No MDX parsing for .md: the element is raw HTML, so no link is derived.
    expect(doc.links).toEqual([]);
    expect(doc.firstH1).toBe("Guide");
  });

  it("parses prose containing braces, which MDX would treat as an expression", async () => {
    const doc = await analyzeDoc(
      `# Guide\n\nUse {placeholder} in the template, then see [other](other.md).\n`,
      "docs/guide.md",
      corpus,
    );
    expect(doc.firstH1).toBe("Guide");
    expect(doc.links.map((l) => l.raw)).toEqual(["other.md"]);
  });
});

describe("analyzeDoc's format", () => {
  it("is mdx for a .mdx path and markdown for a .md path", async () => {
    expect((await analyzeDoc("# A\n", "docs/guide.mdx", corpus)).format).toBe("mdx");
    expect((await analyzeDoc("# A\n", "docs/guide.md", corpus)).format).toBe("markdown");
  });

  it("is what --as names, whatever the path says", async () => {
    expect(
      (await analyzeDoc("# A\n", "docs/guide.md", corpus, { format: "mdx" })).format,
    ).toBe("mdx");
  });
});
