/**
 * Reading a page's two ends: the entries, which live in the frontmatter or in
 * a manifest handed in, and the markers, which live in the body. Each fixture
 * under test/fixtures/cite/pages exercises one rule or one format; the inline
 * cases cover the shapes too small to earn a file.
 *
 * The findings made here are the ones that need no source: entry-invalid,
 * marker-invalid, marker-orphan, marker-repeated and anchor-invalid.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  MARKER_JSON,
  MAX_MARKERS_PER_PAGE,
  bodyLineOf,
  readPage,
  validateEntry,
} from "../../src/cite/core/page.js";
import { CiteError } from "../../src/cite/errors.js";
import type { CitationFinding, CitationInput } from "../../src/cite/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = `${here}/../fixtures/cite/pages`;
const readFixture = (name: string): string => readFileSync(`${pagesDir}/${name}`, "utf8");
const fixture = (name: string, format?: string) =>
  readPage(`${pagesDir}/${name}`, readFixture(name), format === undefined ? undefined : { format });

/** `src/limits.ts:2`, the source every fixture pins. */
const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
/** The claim pin over "The fetch timeout is 10 seconds." */
const CLAIM_PIN = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
/** A keyed pin, the form only an encrypted source carries. */
const KEYED_PIN = "hmac-sha256-37877721a601647d7e548daef40912170becfed3e8c83d0bea171ba88870cb09";
/** The ciphertext `encrypted.md` writes for `src/limits.ts`. */
const CIPHERTEXT =
  "~AR0xkbn6TCOEnTuPRlThMp8jMnnAFcLDk2IpquSbS9r6-IERRVTl8LqTLATZ32yUSV1p-HKaD0oeiUh2mg";

const rules = (findings: CitationFinding[]): string[] => findings.map((f) => f.rule);

/** A page whose one entry is `entry`, as YAML under `citations:`. */
function pageWith(entry: string): string {
  return `---\ntitle: Limits\ncitations:\n${entry}---\n# Limits\n\nThe fetch timeout is 10 seconds.\n`;
}

describe("readPage: formats", () => {
  it("reads a markdown page's entries, body offset and body line", () => {
    const content = readFixture("current.md");
    const page = fixture("current.md");
    expect(page.format).toBe("markdown");
    expect(page.file).toBe(`${pagesDir}/current.md`);
    expect(page.content).toBe(content);
    expect(page.bodyOffset).toBe(content.indexOf("# Limits"));
    expect(page.bodyLine).toBe(13);
    expect(page.findings).toEqual([]);
    expect(page.statements).toEqual([]);
    expect(page.citations).toEqual([
      {
        citation: {
          id: "fetch-timeout",
          claim: { lines: 3, integrity: CLAIM_PIN },
          source: { file: "src/limits.ts", lines: 2, integrity: PIN },
        },
        origin: { kind: "frontmatter", file: `${pagesDir}/current.md`, line: 4, index: 0 },
      },
    ]);
  });

  it("reads mdx through its expression marker", () => {
    const page = fixture("marker.mdx");
    expect(page.format).toBe("mdx");
    expect(page.findings).toEqual([]);
    expect(page.statements).toMatchObject([
      { line: 14, payload: { kind: "ref", id: "retries" }, anchorLine: 15 },
    ]);
    expect(page.citations[0]?.marker?.line).toBe(14);
  });

  it("reads the asciidoc and rst marker forms", () => {
    const adoc = fixture("marker.adoc");
    expect(adoc.format).toBe("asciidoc");
    expect(adoc.findings).toEqual([]);
    expect(adoc.citations[0]?.marker?.line).toBe(14);
    const rst = fixture("marker.rst");
    expect(rst.format).toBe("rst");
    expect(rst.findings).toEqual([]);
    expect(rst.citations[0]?.marker?.line).toBe(15);
  });

  it("reads html with the body starting at offset 0 and body line 1", () => {
    const page = fixture("marker.html");
    expect(page.format).toBe("html");
    expect(page.bodyOffset).toBe(0);
    expect(page.bodyLine).toBe(1);
    // The fixture carries no element-backed metadata, so the marker names an
    // entry that is nowhere: the page's own end of the pair is missing.
    expect(page.findings).toMatchObject([{ rule: "marker-orphan", line: 5, id: "fetch-timeout" }]);
    expect(page.statements).toMatchObject([
      { line: 5, payload: { kind: "ref", id: "fetch-timeout" }, anchorLine: 6 },
    ]);
  });

  it("honours an explicit format over the extension", () => {
    const page = readPage("page.txt", readFixture("current.md"), { format: "markdown" });
    expect(page.format).toBe("markdown");
    expect(page.citations).toHaveLength(1);
  });

  it("refuses an unknown format or extension with meta's wording", () => {
    expect(() => readPage("page.md", "x", { format: "nope" })).toThrow(CiteError);
    expect(() => readPage("page.md", "x", { format: "nope" })).toThrow(
      /^Unknown format "nope"\. Supported extensions: /,
    );
    expect(() => readPage("page.txt", "x")).toThrow(CiteError);
    expect(() => readPage("page.txt", "x")).toThrow(/^Unsupported file type "\.txt"/);
  });

  it("counts a CRLF page by line, once per line", () => {
    const content = readFixture("crlf.md");
    expect(content).toContain("\r\n");
    const page = readPage(`${pagesDir}/crlf.md`, content);
    expect(page.findings).toEqual([]);
    expect(page.bodyLine).toBe(13);
    expect(page.citations[0]?.origin).toMatchObject({ line: 4, index: 0 });
  });

  it("returns nothing for a page with no citations, and the body past the frontmatter", () => {
    const page = fixture("no-citations.md");
    expect(page.citations).toEqual([]);
    expect(page.statements).toEqual([]);
    expect(page.findings).toEqual([]);
    expect(page.bodyOffset).toBe("---\ntitle: Limits\n---\n".length);
    expect(page.bodyLine).toBe(4);
  });

  it("bodyLineOf: line 1 with no frontmatter, and the line after the closing fence", () => {
    expect(bodyLineOf("x\ny\n", 0)).toBe(1);
    const content = "---\na: 1\n---\nbody\n";
    expect(bodyLineOf(content, content.indexOf("body"))).toBe(4);
    // A page that ends at the closing fence with no newline: the body would
    // start on the line after it.
    expect(bodyLineOf("---\na: 1\n---", 12)).toBe(4);
  });
});

describe("readPage: entries", () => {
  it("reads a whole-file pin with no id and no claim", () => {
    const page = fixture("whole-file.md");
    expect(page.findings).toEqual([]);
    expect(page.citations).toEqual([
      {
        citation: {
          source: {
            file: "src/limits.ts",
            integrity: "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023",
          },
        },
        origin: { kind: "frontmatter", file: `${pagesDir}/whole-file.md`, line: 4, index: 0 },
      },
    ]);
  });

  it("carries a commit-sha through, and indexes every entry in list order", () => {
    const page = fixture("frontmatter-only.md");
    expect(page.findings).toEqual([]);
    expect(page.citations.map((c) => c.origin.index)).toEqual([0, 1]);
    expect(page.citations.map((c) => c.origin.line)).toEqual([4, 12]);
    expect(page.citations[1]?.citation.source["commit-sha"]).toBe(
      "fc09aeff7891fcbedfe7d127393fc662fd3ddf7a",
    );
  });

  it("reports an invalid entry with Ajv's text and a duplicate id, keeping the rest", () => {
    const page = fixture("entry-invalid.md");
    expect(page.findings).toMatchObject([
      { rule: "entry-invalid", severity: "error", line: 4, index: 0, id: "fetch-timeout" },
      { rule: "entry-invalid", line: 13, index: 2, id: "fetch-timeout" },
    ]);
    expect(page.findings[0]?.message).toBe("/source must have required property 'integrity'");
    expect(page.findings[1]?.message).toBe('duplicate id "fetch-timeout"');
    // The first entry never validated; the duplicate is kept but unresolvable.
    expect(page.citations.map((c) => c.origin.index)).toEqual([1, 2]);
  });

  it("reports a claim range that ends before it starts, naming the end", () => {
    const page = readPage(
      "p.md",
      pageWith(`  - id: x\n    claim:\n      lines: "5-2"\n      integrity: ${CLAIM_PIN}\n    source:\n      file: src/limits.ts\n      integrity: ${PIN}\n`),
    );
    expect(page.citations).toEqual([]);
    expect(page.findings).toMatchObject([
      { rule: "entry-invalid", severity: "error", line: 4, index: 0, id: "x" },
    ]);
    expect(page.findings[0]?.message).toBe('x: claim.lines "5-2" ends before it starts');
  });

  it("reports a source range that ends before it starts, and drops the id when there is none", () => {
    const page = readPage(
      "p.md",
      pageWith(`  - source:\n      file: src/limits.ts\n      lines: "9-3"\n      integrity: ${PIN}\n`),
    );
    expect(page.findings).toMatchObject([{ rule: "entry-invalid", line: 4, index: 0 }]);
    expect(page.findings[0]?.message).toBe('source.lines "9-3" ends before it starts');
    expect(page.findings[0]?.id).toBeUndefined();
  });

  it("accepts an encrypted source pinned with the keyed pin", () => {
    const page = fixture("encrypted.md");
    expect(page.findings).toEqual([]);
    expect(page.citations[0]?.citation.source.file).toBe(CIPHERTEXT);
    expect(page.citations[0]?.citation.source.integrity).toBe(KEYED_PIN);
  });

  it("reports an encrypted source pinned plain", () => {
    const page = fixture("hmac-mismatch.md");
    expect(page.citations).toEqual([]);
    expect(page.findings).toMatchObject([
      { rule: "entry-invalid", line: 4, index: 0, id: "fetch-timeout", src: `${CIPHERTEXT}:2` },
    ]);
    expect(page.findings[0]?.message).toBe(
      "fetch-timeout: an encrypted source is pinned with hmac-sha256-, not sha256-.",
    );
  });

  it("reports a plain source pinned with the keyed pin", () => {
    const page = readPage(
      "p.md",
      pageWith(`  - id: x\n    source:\n      file: src/limits.ts\n      lines: 2\n      integrity: ${KEYED_PIN}\n`),
    );
    expect(page.citations).toEqual([]);
    expect(page.findings).toMatchObject([
      { rule: "entry-invalid", line: 4, index: 0, id: "x", src: "src/limits.ts:2" },
    ]);
    expect(page.findings[0]?.message).toBe(
      "x: a plain source is pinned with sha256-, not hmac-sha256-.",
    );
  });

  it("rejects every citation- key at the page root", () => {
    const content =
      "---\ntitle: Limits\ncitation-commit: 3f9c2a1\ncitation-anything: 1\n---\n# Limits\n";
    const page = readPage("p.md", content);
    expect(rules(page.findings)).toEqual(["entry-invalid", "entry-invalid"]);
    expect(page.findings.map((f) => f.line)).toEqual([3, 4]);
    expect(page.findings[0]?.message).toBe(
      '"citation-commit" is not a citations key; the page root reserves the citation- prefix',
    );
    expect(page.findings[1]?.message).toContain('"citation-anything"');
  });

  it("reports citations that is not an array", () => {
    const page = readPage("p.md", "---\ncitations: yes\n---\nx\n");
    expect(page.citations).toEqual([]);
    expect(page.findings).toMatchObject([
      { rule: "entry-invalid", line: 2, message: "citations must be an array of entries" },
    ]);
  });

  it("takes entries from a manifest instead of the frontmatter, and puts findings in it", () => {
    const injected: CitationInput[] = [
      {
        entry: { id: "retries", source: { file: "src/limits.ts", lines: 3, integrity: PIN } },
        origin: { kind: "manifest", file: "docs/citations.yaml", line: 7 },
      },
      {
        entry: { id: "broken", source: { file: "src/limits.ts" } },
        origin: { kind: "manifest", file: "docs/citations.yaml", line: 12 },
      },
    ];
    const page = readPage(`${pagesDir}/marker.md`, readFixture("marker.md"), {
      citations: injected,
    });
    expect(page.citations).toHaveLength(1);
    expect(page.citations[0]?.origin).toEqual({
      kind: "manifest",
      file: "docs/citations.yaml",
      line: 7,
      index: 0,
    });
    // The page's own frontmatter entry is not read at all: the marker resolves
    // against the manifest's ids.
    expect(page.citations[0]?.marker?.line).toBe(18);
    expect(page.findings).toMatchObject([
      { rule: "entry-invalid", file: "docs/citations.yaml", line: 12, index: 1, id: "broken" },
    ]);
  });

  it("sorts findings by line, with the ones that have none last", () => {
    const content = `---\ntitle: Limits\ncitations:\n  - id: x\n    source:\n      file: src/limits.ts\n      integrity: ${PIN}\n---\n# Limits\n\n<!-- cite nope -->\nSome claim.\n`;
    const page = readPage("p.md", content);
    expect(rules(page.findings)).toEqual(["marker-orphan"]);
    expect(page.findings[0]?.line).toBe(11);
  });
});

describe("readPage: markers", () => {
  it("resolves a marker to the entry it names, and anchors the paragraph after it", () => {
    const page = fixture("marker.md");
    expect(page.findings).toEqual([]);
    expect(page.statements).toMatchObject([
      { line: 18, payload: { kind: "ref", id: "retries" }, raw: "cite retries", anchorLine: 19 },
    ]);
    expect(page.citations[0]?.marker).toBe(page.statements[0]);
  });

  it("anchors the rest of the marker's own line when it carries text", () => {
    const content = `---\ncitations:\n  - id: x\n    claim:\n      integrity: ${CLAIM_PIN}\n    source:\n      file: src/limits.ts\n      integrity: ${PIN}\n---\n<!-- cite x --> The fetch timeout is 10 seconds.\n`;
    const page = readPage("p.md", content);
    expect(page.findings).toEqual([]);
    expect(page.statements[0]?.anchorLine).toBe(10);
    expect(page.statements[0]?.line).toBe(10);
  });

  it("anchors the fenced block after a quote marker", () => {
    const page = fixture("quote-marker.md");
    expect(page.findings).toEqual([]);
    expect(page.citations[0]?.citation.quote).toBe(true);
    expect(page.citations[0]?.marker?.line).toBe(15);
    // The marker's own anchorLine is the paragraph rule; `quote` widens it to
    // the block, which the claim end resolves.
    expect(page.statements[0]?.anchorLine).toBe(16);
  });

  it("reports a marker naming no entry", () => {
    const page = fixture("marker-orphan.md");
    expect(page.citations).toHaveLength(1);
    expect(page.findings).toMatchObject([
      { rule: "marker-orphan", ruleId: "manni:cite/marker-orphan", severity: "error", line: 12, id: "nope" },
    ]);
    expect(page.findings[0]?.message).toBe('no entry has id "nope"');
  });

  it("reports a repeated marker and keeps the first as the anchor", () => {
    const page = fixture("marker-repeated.md");
    expect(page.statements).toHaveLength(2);
    expect(page.citations[0]?.marker?.line).toBe(14);
    expect(page.findings).toMatchObject([
      {
        rule: "marker-repeated",
        severity: "warning",
        line: 19,
        id: "retries",
        index: 0,
        src: "src/limits.ts:3",
      },
    ]);
    expect(page.findings[0]?.message).toBe(
      "retries is named by markers at lines 14 and 19; the first anchors it.",
    );
  });

  it("reports a JSON payload with the message that says where an entry lives", () => {
    const page = fixture("marker-json.md");
    expect(page.statements[0]?.payload).toEqual({
      kind: "bad",
      reason: "a JSON payload",
      json: true,
    });
    expect(page.findings).toMatchObject([
      { rule: "marker-invalid", ruleId: "manni:cite/marker-invalid", severity: "error", line: 12 },
    ]);
    expect(page.findings[0]?.message).toBe(MARKER_JSON);
    expect(MARKER_JSON).toBe(
      "A marker names an entry by id. Write the entry in frontmatter or the sidecar.",
    );
  });

  it("reports a payload that is not an id, and an empty one, with the reason", () => {
    const page = readPage("p.md", "<!-- cite Fetch Timeout -->\nx\n\n<!-- cite -->\ny\n");
    expect(rules(page.findings)).toEqual(["marker-invalid", "marker-invalid"]);
    expect(page.findings[0]?.message).toBe("invalid marker: payload is not an id");
    expect(page.findings[1]?.message).toBe("invalid marker: empty payload");
  });

  it("never scans the frontmatter for markers", () => {
    const content = `---\ntitle: "<!-- cite x -->"\n---\nbody\n`;
    expect(readPage("p.md", content).statements).toEqual([]);
  });

  it("caps markers per page with one marker-invalid", () => {
    const body = Array.from(
      { length: MAX_MARKERS_PER_PAGE + 1 },
      (_, i) => `<!-- cite m${String(i)} -->\nx\n`,
    ).join("\n");
    const page = readPage("p.md", body);
    expect(page.statements).toHaveLength(MAX_MARKERS_PER_PAGE + 1);
    const capped = page.findings.filter((f) => f.rule === "marker-invalid");
    expect(capped).toHaveLength(1);
    expect(capped[0]?.message).toBe(
      `more than ${String(MAX_MARKERS_PER_PAGE)} markers on one page (${String(MAX_MARKERS_PER_PAGE + 1)}); the rest are not read`,
    );
    // Only the markers inside the cap are resolved, so only they are orphans.
    expect(page.findings.filter((f) => f.rule === "marker-orphan")).toHaveLength(
      MAX_MARKERS_PER_PAGE,
    );
  });
});

describe("readPage: anchors", () => {
  it("reports an entry with claim lines and a marker, at the marker", () => {
    const page = fixture("anchor-both.md");
    expect(page.findings).toMatchObject([
      {
        rule: "anchor-invalid",
        ruleId: "manni:cite/anchor-invalid",
        severity: "error",
        line: 15,
        id: "fetch-timeout",
        src: "src/limits.ts:2",
        index: 0,
      },
    ]);
    expect(page.findings[0]?.message).toBe("fetch-timeout has claim lines and a marker. Keep one.");
  });

  it("reports a quote with neither a claim nor a marker, at the entry", () => {
    const page = fixture("anchor-quote.md");
    expect(page.findings).toMatchObject([
      { rule: "anchor-invalid", severity: "error", line: 4, id: "header", index: 0 },
    ]);
    expect(page.findings[0]?.message).toBe("header: quote needs a claim or a marker.");
  });

  it("accepts a quote anchored by claim lines, and one anchored by a marker", () => {
    expect(fixture("quote.md").findings).toEqual([]);
    expect(fixture("quote-marker.md").findings).toEqual([]);
  });

  it("drops the `<id>: ` prefix for an entry that has no id", () => {
    const page = readPage(
      "p.md",
      pageWith(`  - source:\n      file: src/limits.ts\n      lines: 2\n      integrity: ${PIN}\n    quote: true\n`),
    );
    expect(page.findings).toMatchObject([{ rule: "anchor-invalid", line: 4, index: 0 }]);
    expect(page.findings[0]?.message).toBe("quote needs a claim or a marker.");
    expect(page.findings[0]?.id).toBeUndefined();
  });
});

describe("validateEntry", () => {
  it("accepts a minimal entry and a full one", () => {
    expect(validateEntry({ source: { file: "a.ts", integrity: PIN } })).toBeUndefined();
    expect(
      validateEntry({
        id: "fetch-timeout",
        claim: { lines: "3-4", integrity: CLAIM_PIN },
        source: {
          file: "a.ts",
          lines: 2,
          integrity: PIN,
          "commit-sha": "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182",
        },
        quote: true,
      }),
    ).toBeUndefined();
  });

  it("reports the first error as a pointer and a message", () => {
    expect(validateEntry({})).toBe("must have required property 'source'");
    expect(validateEntry({ source: { file: "a.ts" } })).toBe(
      "/source must have required property 'integrity'",
    );
    expect(validateEntry({ source: { file: "a.ts", integrity: "nope" } })).toMatch(
      /^\/source\/integrity must match pattern/,
    );
    expect(validateEntry("a string")).toBe("must be object");
  });

  it("refuses the keys the rewrite removed: src, a top-level integrity, a text claim, commit", () => {
    const source = { file: "a.ts", integrity: PIN };
    // The old shape has no `source` at all, which is the first thing missing.
    expect(validateEntry({ src: "a.ts:2", integrity: PIN })).toBe(
      "must have required property 'source'",
    );
    expect(validateEntry({ source, src: "a.ts:2" })).toContain("additional");
    expect(validateEntry({ source, integrity: PIN })).toContain("additional");
    expect(validateEntry({ source, claim: "The fetch timeout is 10 seconds." })).toContain("object");
    expect(validateEntry({ source, commit: "3f9c2a1" })).toContain("additional");
  });

  it("refuses a claim with no integrity, and an id that is not kebab-case", () => {
    const source = { file: "a.ts", integrity: PIN };
    expect(validateEntry({ source, claim: { lines: 3 } })).toBe(
      "/claim must have required property 'integrity'",
    );
    expect(validateEntry({ source, id: "Fetch Timeout" })).toMatch(/^\/id must match pattern/);
  });
});
