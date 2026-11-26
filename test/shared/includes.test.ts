import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expandIncludes, MAX_INCLUDE_DEPTH } from "../../src/shared/includes.js";

const FIXTURES = resolve(__dirname, "../fixtures/includes");

function expand(dir: string, file: string, content?: string) {
  const root = join(FIXTURES, dir);
  const warnings: string[] = [];
  const result = expandIncludes({
    content: content ?? readFileSync(join(root, file), "utf8"),
    filePath: file,
    root,
    report: (m) => warnings.push(m),
  });
  return { ...result, warnings };
}

describe("expandIncludes", () => {
  it("renders an MDX import where its component appears", () => {
    const { text, included, locate, warnings } = expand("mdx", "docs/install.mdx");
    expect(warnings).toEqual([]);
    expect(text).toContain("## Before you begin");
    expect(text).not.toContain("<Prereqs />");
    expect([...included].some((f) => f.endsWith("prereqs.mdx"))).toBe(true);
    // The heading came from the partial's line 1 and reports at the directive.
    const at = locate(text.indexOf("## Before you begin"));
    expect(at.line).toBe(7);
    expect(at.includedFrom).toEqual({ file: "docs/_partials/prereqs.mdx", line: 1 });
    // The page's own text maps to its own line.
    const steps = locate(text.indexOf("## Steps"));
    expect(steps.line).toBe(9);
    expect(steps.includedFrom).toBeUndefined();
  });

  it("leaves a component inside a code fence alone", () => {
    const content = 'import P from "./_partials/prereqs.mdx";\n\n```mdx\n<P />\n```\n';
    const { text, warnings } = expand("mdx", "docs/example.mdx", content);
    expect(text).toBe(content);
    expect(warnings).toEqual([]);
  });

  it("expands mdBook includes, whole, by line and by anchor", () => {
    const { text } = expand("markdown-mdbook", "src/page.md");
    expect(text).toBe(
      "# Page\n\nShared first line.\nShared second line.\nHello from the anchor.\n\n" +
        "Shared second line.\n\nHello from the anchor.\n",
    );
  });

  it("leaves an mdBook include shown in inline code or a comment", () => {
    const content = "Write `{{#include path}}` to include.\n\n<!-- {{#include ./shared.md}} -->\n";
    const { text, warnings } = expand("markdown-mdbook", "src/example.md", content);
    expect(text).toBe(content);
    expect(warnings).toEqual([]);
  });

  it("expands MkDocs snippets from the root, whole and by section", () => {
    const { text } = expand("mkdocs", "docs/page.md");
    expect(text).toBe("# Page\n\nSnippet text.\nOnly the part.\n\nOnly the part.\n");
  });

  it("expands AsciiDoc includes with attributes, tags and lines", () => {
    const { text, locate } = expand("asciidoc", "page.adoc");
    expect(text).toBe(
      "= Page\n:partials: partials\n\n" +
        "Intro first line.\n// tag::core[]\nCore of the intro.\n// end::core[]\n\n" +
        "Core of the intro.\n\nIntro first line.\n",
    );
    // The tagged include, on the page's line 6.
    const at = locate(text.indexOf("Core of the intro.\n\nIntro"));
    expect(at.line).toBe(6);
    expect(at.includedFrom).toEqual({ file: "partials/intro.adoc", line: 3 });
  });

  it("expands rST includes and skips one shown in a literal block", () => {
    const { text } = expand("rst", "page.rst");
    expect(text).toBe(
      "Page\n====\n\nNotice first line.\nNotice second line.\n\nNotice second line.\n\n" +
        "Example::\n\n   .. include:: _includes/notice.rst\n",
    );
  });

  it("warns once on a cycle and stops", () => {
    const { text, warnings } = expand("cycle", "a.md");
    expect(text).toContain("B text.");
    expect(warnings).toEqual(["a.md includes itself: a.md → b.md → a.md; stopped expanding."]);
  });

  it("warns on a missing target and leaves the directive", () => {
    const { text, warnings } = expand("missing", "page.md");
    expect(text).toContain("{{#include ./absent.md}}");
    expect(warnings).toEqual(['page.md:3: include "./absent.md" not found; left unexpanded.']);
  });

  it("refuses a target outside the root", () => {
    const { text, warnings } = expand("outside", "docs/page.md");
    expect(text).toContain("{{#include");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^docs\/page\.md:3: include "\.\.\/\.\.\/mdx\/docs\/_partials\/prereqs\.mdx" is outside .+\/outside; left unexpanded\.$/,
    );
  });

  it("refuses a URL", () => {
    const content = "= Page\n\ninclude::https://example.com/x.adoc[]\n";
    const { text, warnings } = expand("asciidoc", "page.adoc", content);
    expect(text).toBe(content);
    expect(warnings).toEqual(['page.adoc:3: include "https://example.com/x.adoc" is a URL; left unexpanded.']);
  });

  it("stops past the depth cap", () => {
    // A chain, not a cycle: each file includes the next, 70 deep.
    const root = mkdtempSync(join(tmpdir(), "manni-includes-"));
    for (let i = 0; i < 70; i++) {
      writeFileSync(join(root, `${String(i)}.md`), `Level ${String(i)}.\n\n{{#include ${String(i + 1)}.md}}\n`);
    }
    const warnings: string[] = [];
    const { text } = expandIncludes({
      content: readFileSync(join(root, "0.md"), "utf8"),
      filePath: "0.md",
      root,
      report: (m) => warnings.push(m),
    });
    expect(text).toContain(`Level ${String(MAX_INCLUDE_DEPTH)}.`);
    expect(text).not.toContain("Level 69.");
    expect(warnings).toEqual([`0.md: includes nest deeper than ${String(MAX_INCLUDE_DEPTH)}; stopped expanding.`]);
  });

  it("returns the page untouched when it has no includes", () => {
    const content = "# Plain\n\nNo includes here.\n";
    const { text, included, locate } = expand("mdx", "docs/plain.md", content);
    expect(text).toBe(content);
    expect(included.size).toBe(0);
    expect(locate(content.indexOf("No"))).toEqual({ offset: 9, line: 3, column: 1 });
  });

  it("does not expand a format without an include syntax", () => {
    const content = "<p>{{#include ./x.md}}</p>";
    const { text } = expand("mdx", "docs/page.html", content);
    expect(text).toBe(content);
  });
});
