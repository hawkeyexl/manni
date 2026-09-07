/**
 * Page rewrites. Frontmatter appends ride meta's `applyFrontmatter`, so the
 * tests here pin what cite relies on it for (comments, key order, BOM, EOL and
 * body survive) rather than re-testing the serializer. The `src:` splice and
 * the inline insert/replace are cite's own and are tested line by line.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  appendFrontmatterCitation,
  insertStatementBefore,
  replaceStatement,
  spliceEntryField,
  unifiedDiff,
} from "../../src/cite/core/write.js";
import { CiteError } from "../../src/cite/errors.js";
import { extractFrontmatter } from "../../src/meta/index.js";
import type { Citation } from "../../src/cite/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const readPage = (name: string): string =>
  readFileSync(`${here}/../fixtures/cite/pages/${name}`, "utf8");

const PIN =
  "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const NEW_PIN =
  "sha256-1c4e000000000000000000000000000000000000000000000000000000001c4e";

const entry: Citation = {
  id: "retries",
  src: "src/limits.ts:3",
  integrity: PIN,
  claim: "Retries default to 3.",
};

/** The `citations` array as meta reads it back from a page. */
const citationsOf = (content: string): unknown =>
  extractFrontmatter(content, "markdown").data.citations;

describe("appendFrontmatterCitation", () => {
  it("appends to an existing list, keeping comments and key order elsewhere", () => {
    const page = [
      "---",
      "# house rule: description before title",
      "description: Limits of the fetcher",
      "citations:",
      "  - src: src/limits.ts:2",
      `    integrity: ${PIN}`,
      "title: Limits # shown in the nav",
      "tags: [a, b]",
      "---",
      "",
      "# Limits",
      "",
      "The fetch timeout is 10 seconds.",
      "",
    ].join("\n");

    const out = appendFrontmatterCitation(page, "markdown", entry, "docs/limits.md");

    expect(citationsOf(out)).toEqual([
      { src: "src/limits.ts:2", integrity: PIN },
      entry,
    ]);
    // Comments, the unusual key order and the flow sequence all survive.
    expect(out).toContain("# house rule: description before title");
    expect(out).toContain("title: Limits # shown in the nav");
    // Flow style survives; the bracket spacing is the yaml serializer's.
    expect(out).toMatch(/tags: \[ ?a, b ?\]/);
    const keys = extractFrontmatter(out, "markdown");
    expect(Object.keys(keys.data)).toEqual(["description", "citations", "title", "tags"]);
    // The entry is written with its fields in the order given.
    expect(out).toMatch(/- src: src\/limits\.ts:2\n\s+integrity: sha256-[0-9a-f]+\n\s+- id: retries\n\s+src: src\/limits\.ts:3\n\s+integrity: sha256-[0-9a-f]+\n\s+claim: Retries default to 3\./);
    // Body byte-for-byte.
    expect(out.slice(out.indexOf("\n# Limits"))).toBe(page.slice(page.indexOf("\n# Limits")));
  });

  it("creates the citations key on a page whose frontmatter has none", () => {
    const page = readPage("no-citations.md");
    const out = appendFrontmatterCitation(page, "markdown", entry, "docs/limits.md");
    expect(citationsOf(out)).toEqual([entry]);
    expect(out).toMatch(/^---\ntitle: Limits\ncitations:\n/);
    expect(out.endsWith("\n# Limits\n\nThe fetch timeout is 10 seconds.\n")).toBe(true);
  });

  it("creates a block on a page with no frontmatter at all", () => {
    const page = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const out = appendFrontmatterCitation(page, "markdown", entry);
    expect(citationsOf(out)).toEqual([entry]);
    expect(out.startsWith("---\ncitations:\n")).toBe(true);
    expect(out.endsWith("---\n\n# Limits\n\nThe fetch timeout is 10 seconds.\n")).toBe(true);
  });

  it("keeps a BOM", () => {
    const BOM = String.fromCharCode(0xfeff);
    const page = `${BOM}---\ntitle: Limits\n---\n\nBody.\n`;
    const out = appendFrontmatterCitation(page, "markdown", entry);
    expect(out.startsWith(`${BOM}---\n`)).toBe(true);
    expect(out.endsWith("---\n\nBody.\n")).toBe(true);
    expect(citationsOf(out)).toEqual([entry]);
  });

  it("keeps CRLF line endings throughout", () => {
    const page = readPage("crlf.md");
    const out = appendFrontmatterCitation(page, "markdown", entry, "docs/crlf.md");
    expect(out).not.toMatch(/[^\r]\n/);
    expect(out.endsWith("not configurable.\r\n")).toBe(true);
    expect(citationsOf(out)).toEqual([
      { id: "fetch-timeout", src: "src/limits.ts:2", integrity: PIN, claim: "The fetch timeout is 10 seconds." },
      entry,
    ]);
  });

  it("drops undefined optional fields rather than writing null", () => {
    const page = readPage("no-citations.md");
    const sparse: Citation = { src: "src/limits.ts:3", integrity: PIN, id: undefined, claim: undefined };
    const out = appendFrontmatterCitation(page, "markdown", sparse);
    expect(out).not.toContain("null");
    expect(citationsOf(out)).toEqual([{ src: "src/limits.ts:3", integrity: PIN }]);
  });

  it("refuses an html page, naming the file", () => {
    const page = readPage("inline.html");
    expect(() => appendFrontmatterCitation(page, "html", entry, "docs/limits.html")).toThrow(
      new CiteError("docs/limits.html has no frontmatter to write to. Use --inline."),
    );
    expect(() => appendFrontmatterCitation(page, "html", entry)).toThrow(
      "the page has no frontmatter to write to. Use --inline.",
    );
  });

  it("refuses TOML frontmatter with a one-line explanation", () => {
    const page = '+++\ntitle = "Limits"\n+++\n\nBody.\n';
    expect(() => appendFrontmatterCitation(page, "markdown", entry, "docs/limits.md")).toThrow(CiteError);
    expect(() => appendFrontmatterCitation(page, "markdown", entry, "docs/limits.md")).toThrow(
      /docs\/limits\.md has TOML frontmatter/,
    );
  });

  it("rethrows meta's refusals as CiteError", () => {
    const page = "= Limits\n\nBody.\n";
    expect(() => appendFrontmatterCitation(page, "asciidoc", entry, "docs/limits.adoc")).toThrow(CiteError);
    expect(() => appendFrontmatterCitation(page, "asciidoc", entry, "docs/limits.adoc")).toThrow(
      /docs\/limits\.adoc: .*no fenced front matter block/,
    );
  });

  it("refuses when citations is not a list", () => {
    const page = "---\ncitations: nope\n---\n";
    expect(() => appendFrontmatterCitation(page, "markdown", entry, "docs/x.md")).toThrow(
      new CiteError("docs/x.md: `citations` is not a list; edit it by hand."),
    );
  });

  it("refuses an unknown format", () => {
    expect(() => appendFrontmatterCitation("", "nope", entry)).toThrow(CiteError);
  });
});

describe("spliceEntryField", () => {
  const page = readPage("frontmatter-only.md");

  it("rewrites src in place, touching nothing else", () => {
    const out = spliceEntryField(page, "markdown", 0, "src", "src/limits.ts:4");
    const diff = unifiedDiff("p", page, out);
    expect(diff).toContain("-    src: src/limits.ts:2\n+    src: src/limits.ts:4\n");
    expect(diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))).toHaveLength(1);
    expect(extractFrontmatter(out, "markdown").data.citations).toMatchObject([
      { src: "src/limits.ts:4" },
      { src: "src/limits.ts" },
    ]);
  });

  it("addresses the second entry and its other fields", () => {
    let out = spliceEntryField(page, "markdown", 1, "integrity", NEW_PIN);
    out = spliceEntryField(out, "markdown", 1, "commit", "89abcdef0123456789abcdef0123456789abcdef");
    expect(extractFrontmatter(out, "markdown").data.citations).toMatchObject([
      { integrity: PIN },
      { integrity: NEW_PIN, commit: "89abcdef0123456789abcdef0123456789abcdef" },
    ]);
  });

  it("keeps a trailing comment", () => {
    const commented = page.replace("src: src/limits.ts:2", "src: src/limits.ts:2   # the timeout");
    const out = spliceEntryField(commented, "markdown", 0, "src", "src/limits.ts:4");
    expect(out).toContain("    src: src/limits.ts:4   # the timeout\n");
  });

  it("keeps the quoting style of a quoted src", () => {
    const dq = page.replace("src: src/limits.ts:2", 'src: "src/limits.ts:2"');
    expect(spliceEntryField(dq, "markdown", 0, "src", "docs notes/limits.ts:4")).toContain(
      '    src: "docs notes/limits.ts:4"\n',
    );
    const sq = page.replace("src: src/limits.ts:2", "src: 'src/limits.ts:2' # x");
    expect(spliceEntryField(sq, "markdown", 0, "src", "a'b.ts:1")).toContain(
      "    src: 'a''b.ts:1' # x\n",
    );
  });

  it("leaves a plain scalar plain, quoting only when YAML would misread it", () => {
    expect(spliceEntryField(page, "markdown", 0, "src", "~9c1f0e2b7a3d4c5e:2")).toContain(
      "    src: ~9c1f0e2b7a3d4c5e:2\n",
    );
    expect(spliceEntryField(page, "markdown", 0, "src", "my docs/limits.ts:4")).toContain(
      "    src: my docs/limits.ts:4\n",
    );
    const out = spliceEntryField(page, "markdown", 0, "src", "odd: name.ts");
    expect(out).toContain('    src: "odd: name.ts"\n');
    expect(extractFrontmatter(out, "markdown").data.citations).toMatchObject([
      { src: "odd: name.ts" },
      { src: "src/limits.ts" },
    ]);
  });

  it("works on a CRLF page", () => {
    const crlf = readPage("crlf.md");
    const out = spliceEntryField(crlf, "markdown", 0, "src", "src/limits.ts:4");
    expect(out).toContain("    src: src/limits.ts:4\r\n");
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it("works on a flow entry that starts on the dash line", () => {
    const dashed = "---\ncitations:\n- src: a.ts:1\n  integrity: x\n---\n";
    expect(spliceEntryField(dashed, "markdown", 0, "src", "b.ts:2")).toBe(
      "---\ncitations:\n- src: b.ts:2\n  integrity: x\n---\n",
    );
  });

  it("refuses TOML, an absent entry and an absent field", () => {
    const toml = `+++\n[[citations]]\nsrc = "src/limits.ts:2"\nintegrity = "${PIN}"\n+++\n`;
    expect(() => spliceEntryField(toml, "markdown", 0, "src", "x")).toThrow(
      new CiteError("Cannot rewrite citations[0].src in markdown frontmatter; edit it by hand."),
    );
    expect(() => spliceEntryField(page, "markdown", 5, "src", "x")).toThrow(
      new CiteError("Cannot rewrite citations[5].src in markdown frontmatter; edit it by hand."),
    );
    expect(() => spliceEntryField(page, "markdown", 0, "commit", "x")).toThrow(
      new CiteError("Cannot rewrite citations[0].commit in markdown frontmatter; edit it by hand."),
    );
    expect(() => spliceEntryField("no frontmatter\n", "markdown", 0, "src", "x")).toThrow(CiteError);
  });

  it("refuses a flow-style entry it cannot address line by line", () => {
    const flow = "---\ncitations: [{ src: a.ts:1, integrity: x }]\n---\n";
    expect(() => spliceEntryField(flow, "markdown", 0, "src", "b.ts:2")).toThrow(CiteError);
  });
});

describe("insertStatementBefore", () => {
  it("inserts at the start of the line holding the offset, LF", () => {
    const page = "# T\n\nThe claim is here.\nMore.\n";
    const offset = page.indexOf("claim");
    expect(insertStatementBefore(page, offset, "<!-- cite x -->")).toBe(
      "# T\n\n<!-- cite x -->\nThe claim is here.\nMore.\n",
    );
  });

  it("uses the page's CRLF", () => {
    const page = "# T\r\n\r\nThe claim is here.\r\nMore.\r\n";
    const offset = page.indexOf("claim");
    expect(insertStatementBefore(page, offset, "<!-- cite x -->")).toBe(
      "# T\r\n\r\n<!-- cite x -->\r\nThe claim is here.\r\nMore.\r\n",
    );
  });

  it("inserts at offset 0 and at the end", () => {
    expect(insertStatementBefore("a\n", 0, "s")).toBe("s\na\n");
    expect(insertStatementBefore("a\nb", 3, "s")).toBe("a\ns\nb");
  });
});

describe("replaceStatement", () => {
  it("replaces exactly the span", () => {
    const page = "x\n<!-- cite old -->\ny\n";
    const start = page.indexOf("<!--");
    const end = page.indexOf("-->") + 3;
    expect(replaceStatement(page, start, end, "<!-- cite new -->")).toBe(
      "x\n<!-- cite new -->\ny\n",
    );
  });

  it("refuses an inverted or out-of-range span", () => {
    expect(() => replaceStatement("abc", 2, 1, "s")).toThrow(CiteError);
    expect(() => replaceStatement("abc", 0, 9, "s")).toThrow(CiteError);
  });
});

describe("unifiedDiff", () => {
  it("is empty when nothing changed", () => {
    expect(unifiedDiff("p", "a\nb\n", "a\nb\n")).toBe("");
  });

  it("shows an insertion with one line of context", () => {
    const before = "l1\nl2\nl3\nl4\nl5\nl6\nl7\n";
    const after = "l1\nl2\nl3\nl4\nl5\nl6\nnew\nl7\n";
    expect(unifiedDiff("docs/limits.md", before, after)).toBe(
      [
        "--- docs/limits.md",
        "+++ docs/limits.md",
        "@@ -6,2 +6,3 @@",
        " l6",
        "+new",
        " l7",
        "",
      ].join("\n"),
    );
  });

  it("shows a replacement and separates distant hunks", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const after = "a\nB\nc\nd\ne\nf\ng\nH\n";
    expect(unifiedDiff("p", before, after)).toBe(
      [
        "--- p",
        "+++ p",
        "@@ -1,3 +1,3 @@",
        " a",
        "-b",
        "+B",
        " c",
        "@@ -7,2 +7,2 @@",
        " g",
        "-h",
        "+H",
        "",
      ].join("\n"),
    );
  });

  it("merges hunks whose context would touch", () => {
    const before = "a\nb\nc\nd\ne\n";
    const after = "a\nB\nc\nD\ne\n";
    expect(unifiedDiff("p", before, after)).toBe(
      ["--- p", "+++ p", "@@ -1,5 +1,5 @@", " a", "-b", "+B", " c", "-d", "+D", " e", ""].join("\n"),
    );
  });

  it("handles a deletion at the top and an empty side", () => {
    expect(unifiedDiff("p", "a\nb\n", "b\n")).toBe(
      ["--- p", "+++ p", "@@ -1,2 +1,1 @@", "-a", " b", ""].join("\n"),
    );
    expect(unifiedDiff("p", "", "a\n")).toBe(
      ["--- p", "+++ p", "@@ -0,0 +1,1 @@", "+a", ""].join("\n"),
    );
  });

  it("diffs CRLF text by line", () => {
    const d = unifiedDiff("p", "a\r\nb\r\n", "a\r\nc\r\n");
    expect(d).toContain("-b\n+c\n");
    expect(d).not.toContain("\r");
  });

  it("matches the add --dry-run rung shape", () => {
    const before = "---\ntitle: Limits\n---\n# Limits\n\nThe fetch timeout is 10 seconds, and it is\nnot configurable.\n";
    const after = before.replace(
      "The fetch timeout",
      "<!-- cite fetch-timeout -->\nThe fetch timeout",
    );
    expect(unifiedDiff("docs/limits.md", before, after)).toBe(
      [
        "--- docs/limits.md",
        "+++ docs/limits.md",
        "@@ -5,2 +5,3 @@",
        " ",
        "+<!-- cite fetch-timeout -->",
        " The fetch timeout is 10 seconds, and it is",
        "",
      ].join("\n"),
    );
  });
});
