/**
 * The claim end: the page text a citation supports, classified against the
 * page as it is now.
 *
 * A claim's `lines` are body-relative, so editing the frontmatter never moves
 * them; every line a reader sees is a file line, translated here. The pin
 * holds where it was recorded: `current`. The same text sits verbatim
 * elsewhere: `moved`, once, or `moved-ambiguous`. Nowhere: `changed`. A
 * marker-anchored claim pins what its marker anchors, so it never moves.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  blockMatches,
  claimEnd,
  claimLine,
  claimLineNow,
  claimLinesNow,
  markerUnit,
  normalizeWhitespace,
  pinOfLines,
  toBodyLines,
  toFileLines,
  unitAt,
} from "../../src/cite/core/claims.js";
import { splitLines } from "../../src/cite/core/hash.js";
import { readPage } from "../../src/cite/core/page.js";
import type { ClaimEnd, PageCitations } from "../../src/cite/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = `${here}/../fixtures/cite/pages`;
const readFixture = (name: string): string => readFileSync(`${pagesDir}/${name}`, "utf8");
const fixture = (name: string): PageCitations =>
  readPage(`${pagesDir}/${name}`, readFixture(name));

/** The claim pin over "The fetch timeout is 10 seconds." */
const CLAIM_PIN = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";

/** The claim end of the page's first entry. */
function endOf(page: PageCitations): ClaimEnd | null {
  const entry = page.citations[0];
  if (entry === undefined) throw new Error("the fixture has no citations");
  return claimEnd(page, entry, splitLines(page.content));
}

const endOfFixture = (name: string): ClaimEnd | null => endOf(fixture(name));

describe("normalizeWhitespace", () => {
  it("collapses runs of whitespace to one space and trims", () => {
    expect(normalizeWhitespace("  a \t b\r\n\n c  ")).toBe("a b c");
    expect(normalizeWhitespace("")).toBe("");
  });
});

describe("blockMatches", () => {
  it("compares under the hashing rule: a BOM, CRLF and one trailing LF do not count", () => {
    const cited = "export const A = 1;\nexport const B = 2;";
    expect(blockMatches("export const A = 1;\nexport const B = 2;\n", cited)).toBe(true);
    expect(blockMatches("﻿export const A = 1;\r\nexport const B = 2;\r\n", cited)).toBe(true);
    expect(blockMatches("export const A = 1;\nexport const B = 2;", cited)).toBe(true);
  });

  it("is strict about everything else", () => {
    const cited = "export const A = 1;";
    expect(blockMatches("export const A = 2;\n", cited)).toBe(false);
    expect(blockMatches("export const A = 1; \n", cited)).toBe(false);
    expect(blockMatches("export const A = 1;\n\n", cited)).toBe(false);
  });
});

describe("toFileLines and toBodyLines", () => {
  it("body line 1 is the first line after the frontmatter", () => {
    expect(toFileLines({ start: 1, end: 1 }, 13)).toEqual({ start: 13, end: 13 });
    expect(toFileLines({ start: 3, end: 4 }, 13)).toEqual({ start: 15, end: 16 });
    // A page with no frontmatter: the body starts on line 1 and nothing moves.
    expect(toFileLines({ start: 3, end: 4 }, 1)).toEqual({ start: 3, end: 4 });
  });

  it("round-trips a range through the body line", () => {
    const lines = { start: 3, end: 7 };
    expect(toBodyLines(toFileLines(lines, 13), 13)).toEqual(lines);
    expect(toBodyLines({ start: 15, end: 16 }, 13)).toEqual({ start: 3, end: 4 });
  });
});

describe("pinOfLines", () => {
  it("pins a range of page lines, plain, under the hashing rule", () => {
    const lines = splitLines(readFixture("current.md"));
    expect(pinOfLines(lines, { start: 15, end: 15 })).toBe(CLAIM_PIN);
    expect(pinOfLines(lines, { start: 15, end: 15 })).not.toBe(
      pinOfLines(lines, { start: 15, end: 17 }),
    );
  });

  it("is undefined for a range that runs off either end of the page", () => {
    const lines = splitLines("a\nb\nc\n");
    expect(pinOfLines(lines, { start: 1, end: 3 })).toBeDefined();
    expect(pinOfLines(lines, { start: 1, end: 4 })).toBeUndefined();
    expect(pinOfLines(lines, { start: 0, end: 1 })).toBeUndefined();
  });
});

describe("claimLine, claimLineNow and claimLinesNow", () => {
  it("claimLine is where the claim was recorded, whatever happened since", () => {
    expect(claimLine({ fileLines: "15", status: "current" })).toBe(15);
    expect(claimLine({ fileLines: "15-16", status: "changed" })).toBe(15);
    expect(claimLine({ status: "changed" })).toBeUndefined();
  });

  it("claimLineNow prefers where the claim moved to, then the first candidate", () => {
    expect(
      claimLineNow({ fileLines: "15", status: "moved", newFileLines: "17" }),
    ).toBe(17);
    expect(
      claimLineNow({ fileLines: "15", status: "moved-ambiguous", candidateFileLines: ["17", "21"] }),
    ).toBe(17);
    expect(claimLineNow({ fileLines: "15", status: "current" })).toBe(15);
    expect(claimLineNow({ status: "skipped" })).toBeUndefined();
  });

  it("claimLinesNow gives the whole range the claim occupies now", () => {
    expect(
      claimLinesNow({ fileLines: "15-16", status: "moved", newFileLines: "20-21" }),
    ).toEqual({ start: 20, end: 21 });
    expect(claimLinesNow({ fileLines: "16-20", status: "current" })).toEqual({
      start: 16,
      end: 20,
    });
    expect(claimLinesNow({ status: "changed" })).toBeUndefined();
  });
});

describe("claimEnd: recorded lines", () => {
  it("is current when the pin holds, with the body lines translated to file lines", () => {
    const page = fixture("current.md");
    expect(page.bodyLine).toBe(13);
    expect(endOf(page)).toEqual({ lines: "3", fileLines: "15", status: "current" });
  });

  it("translates a multi-line claim the same way", () => {
    expect(endOfFixture("claim-range.md")).toEqual({
      lines: "3-4",
      fileLines: "15-16",
      status: "current",
    });
  });

  it("is moved when the text sits verbatim somewhere else, in both line frames", () => {
    expect(endOfFixture("claim-moved.md")).toEqual({
      lines: "3",
      fileLines: "15",
      status: "moved",
      newLines: "5",
      newFileLines: "17",
    });
  });

  it("is moved-ambiguous when the text sits in more than one place", () => {
    expect(endOfFixture("claim-moved-ambiguous.md")).toEqual({
      lines: "3",
      fileLines: "15",
      status: "moved-ambiguous",
      candidates: ["5", "9"],
      candidateFileLines: ["17", "21"],
    });
  });

  it("is changed when the sentence was edited, and carries the lines as they read now", () => {
    expect(endOfFixture("claim-changed.md")).toEqual({
      lines: "3",
      fileLines: "15",
      status: "changed",
      text: ["The fetch timeout is 30 seconds."],
    });
  });

  it("stays current when the frontmatter grows a key above the claim", () => {
    // frontmatter-tag.md is current.md with `tags:` added: the claim's body
    // lines are untouched and the file line it maps to moves by one.
    const tagged = fixture("frontmatter-tag.md");
    expect(tagged.bodyLine).toBe(14);
    expect(endOf(tagged)).toEqual({ lines: "3", fileLines: "16", status: "current" });
    expect(endOfFixture("current.md")).toMatchObject({ lines: "3", fileLines: "15" });
  });

  it("is null for an entry with no claim: a bare pin", () => {
    expect(endOfFixture("whole-file.md")).toBeNull();
  });

  it("is skipped when the entry carries both anchors, which anchor-invalid reports", () => {
    expect(endOfFixture("anchor-both.md")).toEqual({
      lines: "3",
      fileLines: "15",
      status: "skipped",
    });
  });
});

describe("claimEnd: marker-anchored", () => {
  it("is current when the pin holds over what the marker anchors", () => {
    expect(endOfFixture("marker.md")).toEqual({ fileLines: "19", status: "current" });
  });

  it("is changed when the anchored sentence was edited; it never moves", () => {
    expect(endOfFixture("marker-changed.md")).toEqual({
      fileLines: "15",
      status: "changed",
      text: ["Retries default to 5."],
    });
  });

  it("pins the whole fenced block under quote, fences included", () => {
    expect(endOfFixture("quote-marker.md")).toEqual({ fileLines: "16-18", status: "current" });
  });

  it("is changed when a claim pin anchors nothing at all", () => {
    const content = `---\ntitle: Limits\ncitations:\n  - id: x\n    claim:\n      integrity: ${CLAIM_PIN}\n    source:\n      file: src/limits.ts\n      integrity: ${PIN}\n---\n# Limits\n\nThe fetch timeout is 10 seconds.\n`;
    const page = readPage("p.md", content);
    expect(page.findings).toEqual([]);
    expect(endOf(page)).toEqual({ status: "changed" });
  });
});

describe("unitAt", () => {
  it("gives the paragraph opening on a line, to its last line", () => {
    const page = fixture("claim-range.md");
    const lines = splitLines(page.content);
    expect(unitAt(page, 15, lines)).toEqual({
      lines: { start: 15, end: 16 },
      kind: "paragraph",
      text: ["The fetch timeout is 10 seconds. It is", "not configurable."],
    });
  });

  it("gives the fenced block opening on a line, fences included", () => {
    const page = fixture("quote.md");
    const lines = splitLines(page.content);
    expect(unitAt(page, 16, lines)).toEqual({
      lines: { start: 16, end: 20 },
      kind: "block",
      text: [
        "```ts",
        "export const MAX_FILES = 10_000;",
        "export const FETCH_TIMEOUT_MS = 10_000;",
        "export const RETRIES = 3;",
        "```",
      ],
    });
  });

  it("skips a blank line, a line inside a fenced block, and a line past the page", () => {
    const page = fixture("quote.md");
    const lines = splitLines(page.content);
    expect(lines[14]).toBe("");
    expect(unitAt(page, 15, lines)).toBeUndefined();
    expect(unitAt(page, 17, lines)).toBeUndefined();
    expect(unitAt(page, 20, lines)).toBeUndefined();
    expect(unitAt(page, lines.length + 1, lines)).toBeUndefined();
  });

  it("skips every line of the frontmatter", () => {
    const page = fixture("current.md");
    const lines = splitLines(page.content);
    expect(page.bodyLine).toBe(13);
    for (let line = 1; line < page.bodyLine; line++) {
      expect(unitAt(page, line, lines)).toBeUndefined();
    }
    expect(unitAt(page, page.bodyLine, lines)).toMatchObject({ kind: "paragraph" });
  });
});

describe("markerUnit", () => {
  it("gives the paragraph a marker anchors", () => {
    const page = fixture("marker.md");
    const entry = page.citations[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(markerUnit(page, entry, splitLines(page.content))).toEqual({
      lines: { start: 19, end: 19 },
      kind: "paragraph",
      text: ["Retries default to 3. Really."],
    });
  });

  it("gives the fenced block a quote marker anchors, and nothing for an entry with no marker", () => {
    const quoted = fixture("quote-marker.md");
    const quotedEntry = quoted.citations[0];
    expect(quotedEntry).toBeDefined();
    if (!quotedEntry) return;
    expect(markerUnit(quoted, quotedEntry, splitLines(quoted.content))).toEqual({
      lines: { start: 16, end: 18 },
      kind: "block",
      text: ["```ts", "export const FETCH_TIMEOUT_MS = 10_000;", "```"],
    });

    const plain = fixture("current.md");
    const plainEntry = plain.citations[0];
    expect(plainEntry).toBeDefined();
    if (!plainEntry) return;
    expect(markerUnit(plain, plainEntry, splitLines(plain.content))).toBeUndefined();
  });
});
