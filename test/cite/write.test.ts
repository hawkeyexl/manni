/**
 * Page rewrites. Frontmatter appends ride meta's `applyFrontmatter`, so the
 * tests here pin what cite relies on it for (comments, key order, BOM, EOL and
 * body survive) rather than re-testing the serializer. `entryObject`'s reading
 * order, the per-field splice a repair makes, and the marker insert are cite's
 * own and are tested field by field and line by line.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  appendFrontmatterCitation,
  entryObject,
  insertStatementBefore,
  spliceEntryField,
  unifiedDiff,
} from "../../src/cite/core/write.js";
import { CiteError } from "../../src/cite/errors.js";
import { extractFrontmatter } from "../../src/meta/index.js";
import type { Citation } from "../../src/cite/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const readPage = (name: string): string =>
  readFileSync(`${here}/../fixtures/cite/pages/${name}`, "utf8");

const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_L3 = "sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3";
const PIN_WHOLE = "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023";
const CLAIM_PIN = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
const WRAPPED_PIN = "sha256-93f59d1e26513d9a8be099c55aa8ba06c90020f079d7fb16d4a7ca65851f0ec3";
const NEW_PIN = "sha256-1c4e000000000000000000000000000000000000000000000000000000001c4e";
const COMMIT = "89abcdef0123456789abcdef0123456789abcdef";

const entry: Citation = {
  id: "retries",
  claim: { lines: 5, integrity: CLAIM_PIN },
  source: { file: "src/limits.ts", lines: 3, integrity: PIN_L3 },
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
      "  - source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN}`,
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
      { source: { file: "src/limits.ts", lines: 2, integrity: PIN } },
      entry,
    ]);
    // Comments, the unusual key order and the flow sequence all survive.
    expect(out).toContain("# house rule: description before title");
    expect(out).toContain("title: Limits # shown in the nav");
    // Flow style survives; the bracket spacing is the yaml serializer's.
    expect(out).toMatch(/tags: \[ ?a, b ?\]/);
    const keys = extractFrontmatter(out, "markdown");
    expect(Object.keys(keys.data)).toEqual(["description", "citations", "title", "tags"]);
    // Body byte-for-byte.
    expect(out.slice(out.indexOf("\n# Limits"))).toBe(page.slice(page.indexOf("\n# Limits")));
  });

  it("writes the entry's fields in reading order", () => {
    const page = readPage("no-citations.md");
    const out = appendFrontmatterCitation(page, "markdown", { ...entry, quote: true });
    expect(out).toMatch(
      /- id: retries\n\s+claim:\n\s+lines: 5\n\s+integrity: sha256-[0-9a-f]+\n\s+source:\n\s+file: src\/limits\.ts\n\s+lines: 3\n\s+integrity: sha256-[0-9a-f]+\n\s+quote: true\n/,
    );
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
    expect(out.endsWith("The fetch timeout is 10 seconds.\r\n")).toBe(true);
    expect(citationsOf(out)).toEqual([
      {
        id: "fetch-timeout",
        claim: { lines: 3, integrity: CLAIM_PIN },
        source: { file: "src/limits.ts", lines: 2, integrity: PIN },
      },
      entry,
    ]);
  });

  it("drops undefined optional fields rather than writing null", () => {
    const page = readPage("no-citations.md");
    const sparse: Citation = {
      id: undefined,
      claim: undefined,
      source: { file: "src/limits.ts", lines: undefined, integrity: PIN_WHOLE, "commit-sha": undefined },
      quote: undefined,
    };
    const out = appendFrontmatterCitation(page, "markdown", sparse);
    expect(out).not.toContain("null");
    expect(citationsOf(out)).toEqual([{ source: { file: "src/limits.ts", integrity: PIN_WHOLE } }]);
  });

  it("refuses an html page, naming the file and where the entry should go instead", () => {
    const page = readPage("marker.html");
    expect(() => appendFrontmatterCitation(page, "html", entry, "docs/limits.html")).toThrow(
      new CiteError(
        "docs/limits.html has no frontmatter to write to; keep its citations in a manifest instead.",
      ),
    );
    expect(() => appendFrontmatterCitation(page, "html", entry)).toThrow(
      "the page has no frontmatter to write to; keep its citations in a manifest instead.",
    );
  });

  it("refuses TOML frontmatter with a one-line explanation", () => {
    const page = '+++\ntitle = "Limits"\n+++\n\nBody.\n';
    expect(() => appendFrontmatterCitation(page, "markdown", entry, "docs/limits.md")).toThrow(
      CiteError,
    );
    expect(() => appendFrontmatterCitation(page, "markdown", entry, "docs/limits.md")).toThrow(
      /docs\/limits\.md has TOML frontmatter.*Add the entry by hand\.$/s,
    );
  });

  it("rethrows meta's refusals as CiteError", () => {
    const page = "= Limits\n\nBody.\n";
    expect(() => appendFrontmatterCitation(page, "asciidoc", entry, "docs/limits.adoc")).toThrow(
      CiteError,
    );
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

describe("entryObject", () => {
  it("reads id, claim, source, quote, and the source file, lines, integrity, commit-sha", () => {
    const full: Citation = {
      id: "fetch-timeout",
      claim: { lines: "3-4", integrity: WRAPPED_PIN },
      source: { file: "src/limits.ts", lines: 2, integrity: PIN, "commit-sha": COMMIT },
      quote: true,
    };
    const object = entryObject(full);
    expect(Object.keys(object)).toEqual(["id", "claim", "source", "quote"]);
    expect(Object.keys(object.claim as Record<string, unknown>)).toEqual(["lines", "integrity"]);
    expect(Object.keys(object.source as Record<string, unknown>)).toEqual([
      "file",
      "lines",
      "integrity",
      "commit-sha",
    ]);
  });

  it("leaves every absent optional out, down to a bare pin", () => {
    expect(entryObject({ source: { file: "src/limits.ts", integrity: PIN_WHOLE } })).toEqual({
      source: { file: "src/limits.ts", integrity: PIN_WHOLE },
    });
  });

  it("writes a marker-anchored claim with its pin and no lines", () => {
    const object = entryObject({
      id: "retries",
      claim: { integrity: CLAIM_PIN },
      source: { file: "src/limits.ts", lines: 3, integrity: PIN_L3 },
    });
    expect(object.claim).toEqual({ integrity: CLAIM_PIN });
    expect(Object.keys(object.claim as Record<string, unknown>)).toEqual(["integrity"]);
  });
});

describe("spliceEntryField", () => {
  const page = readPage("frontmatter-only.md");

  it("rewrites source.file in place, touching nothing else", () => {
    const out = spliceEntryField(page, "markdown", 0, ["source", "file"], "lib/limits.ts");
    const diff = unifiedDiff("p", page, out);
    expect(diff).toContain("-      file: src/limits.ts\n+      file: lib/limits.ts\n");
    expect(diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))).toHaveLength(1);
    expect(extractFrontmatter(out, "markdown").data.citations).toMatchObject([
      { source: { file: "lib/limits.ts" } },
      { source: { file: "src/limits.ts" } },
    ]);
  });

  it("rewrites source.lines, plain, so a range that became one line reads as an integer", () => {
    const range = spliceEntryField(page, "markdown", 0, ["source", "lines"], "4-6");
    expect(range).toContain("      lines: 4-6\n");
    const one = spliceEntryField(range, "markdown", 0, ["source", "lines"], 4);
    expect(one).toContain("      lines: 4\n");
    expect(extractFrontmatter(one, "markdown").data.citations).toMatchObject([
      { source: { lines: 4 } },
      {},
    ]);
  });

  it("rewrites source.integrity and source.commit-sha on the entry that carries them", () => {
    let out = spliceEntryField(page, "markdown", 0, ["source", "integrity"], NEW_PIN);
    out = spliceEntryField(out, "markdown", 1, ["source", "commit-sha"], COMMIT);
    expect(extractFrontmatter(out, "markdown").data.citations).toMatchObject([
      { source: { integrity: NEW_PIN } },
      { source: { integrity: PIN_WHOLE, "commit-sha": COMMIT } },
    ]);
  });

  it("rewrites claim.lines and claim.integrity", () => {
    let out = spliceEntryField(page, "markdown", 0, ["claim", "lines"], "5-6");
    out = spliceEntryField(out, "markdown", 0, ["claim", "integrity"], NEW_PIN);
    expect(extractFrontmatter(out, "markdown").data.citations).toMatchObject([
      { claim: { lines: "5-6", integrity: NEW_PIN } },
      {},
    ]);
    // The source end of the same entry is untouched.
    expect(out).toContain(`      integrity: ${PIN}\n`);
  });

  it("collapses a claim range to the integer when it became one line", () => {
    const out = spliceEntryField(page, "markdown", 0, ["claim", "lines"], 3);
    expect(out).toContain("      lines: 3\n");
    expect(extractFrontmatter(out, "markdown").data.citations).toMatchObject([
      { claim: { lines: 3 } },
      {},
    ]);
  });

  it("keeps a trailing comment", () => {
    const commented = page.replace("file: src/limits.ts", "file: src/limits.ts   # the timeout");
    const out = spliceEntryField(commented, "markdown", 0, ["source", "file"], "lib/limits.ts");
    expect(out).toContain("      file: lib/limits.ts   # the timeout\n");
  });

  it("keeps the quoting style of a quoted scalar", () => {
    const dq = page.replace("file: src/limits.ts", 'file: "src/limits.ts"');
    expect(spliceEntryField(dq, "markdown", 0, ["source", "file"], "docs notes/limits.ts")).toContain(
      '      file: "docs notes/limits.ts"\n',
    );
    const sq = page.replace("file: src/limits.ts", "file: 'src/limits.ts' # x");
    expect(spliceEntryField(sq, "markdown", 0, ["source", "file"], "a'b.ts")).toContain(
      "      file: 'a''b.ts' # x\n",
    );
  });

  it("leaves a plain scalar plain, quoting only when YAML would misread it", () => {
    expect(
      spliceEntryField(page, "markdown", 0, ["source", "file"], "~9c1f0e2b7a3d4c5e"),
    ).toContain("      file: ~9c1f0e2b7a3d4c5e\n");
    expect(spliceEntryField(page, "markdown", 0, ["source", "file"], "my docs/limits.ts")).toContain(
      "      file: my docs/limits.ts\n",
    );
    const out = spliceEntryField(page, "markdown", 0, ["source", "file"], "odd: name.ts");
    expect(out).toContain('      file: "odd: name.ts"\n');
    expect(extractFrontmatter(out, "markdown").data.citations).toMatchObject([
      { source: { file: "odd: name.ts" } },
      { source: { file: "src/limits.ts" } },
    ]);
  });

  it("works on a CRLF page", () => {
    const crlf = readPage("crlf.md");
    const out = spliceEntryField(crlf, "markdown", 0, ["source", "lines"], "2-3");
    expect(out).toContain("      lines: 2-3\r\n");
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it("works on an entry that starts on the dash line", () => {
    const dashed = "---\ncitations:\n- source:\n    file: a.ts\n    integrity: x\n---\n";
    expect(spliceEntryField(dashed, "markdown", 0, ["source", "file"], "b.ts")).toBe(
      "---\ncitations:\n- source:\n    file: b.ts\n    integrity: x\n---\n",
    );
  });

  it("refuses TOML, an absent entry, an absent end and an absent field", () => {
    const toml = `+++\n[[citations]]\n[citations.source]\nfile = "src/limits.ts"\nintegrity = "${PIN}"\n+++\n`;
    expect(() => spliceEntryField(toml, "markdown", 0, ["source", "file"], "x")).toThrow(
      new CiteError(
        "Cannot rewrite citations[0].source.file in markdown frontmatter; edit it by hand.",
      ),
    );
    expect(() => spliceEntryField(page, "markdown", 5, ["source", "file"], "x")).toThrow(
      new CiteError(
        "Cannot rewrite citations[5].source.file in markdown frontmatter; edit it by hand.",
      ),
    );
    // The second entry is a bare pin: it has no claim end at all.
    expect(() => spliceEntryField(page, "markdown", 1, ["claim", "integrity"], NEW_PIN)).toThrow(
      new CiteError(
        "Cannot rewrite citations[1].claim.integrity in markdown frontmatter; edit it by hand.",
      ),
    );
    // ...and no `lines` under its source: it pins the whole file.
    expect(() => spliceEntryField(page, "markdown", 1, ["source", "lines"], 2)).toThrow(
      new CiteError(
        "Cannot rewrite citations[1].source.lines in markdown frontmatter; edit it by hand.",
      ),
    );
    expect(() => spliceEntryField("no frontmatter\n", "markdown", 0, ["source", "file"], "x")).toThrow(
      CiteError,
    );
  });

  it("refuses a flow-style entry it cannot address line by line", () => {
    const flow = "---\ncitations: [{ source: { file: a.ts, integrity: x } }]\n---\n";
    expect(() => spliceEntryField(flow, "markdown", 0, ["source", "file"], "b.ts")).toThrow(CiteError);
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

  it("never shows a BOM as part of a line", () => {
    const d = unifiedDiff("p", "\uFEFFa\nb\n", "\uFEFFa\nc\n");
    expect(d).toBe(["--- p", "+++ p", "@@ -1,2 +1,2 @@", " a", "-b", "+c", ""].join("\n"));
    expect(d).not.toContain("\uFEFF");
  });

  it("matches the add --dry-run rung shape", () => {
    const before =
      "---\ntitle: Limits\n---\n# Limits\n\nThe fetch timeout is 10 seconds, and it is\nnot configurable.\n";
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
