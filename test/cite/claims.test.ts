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
  noUnitAt,
  normalizeWhitespace,
  otherClaimSpans,
  pinOfLines,
  spellElsewhere,
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

  it("skips a blank line, the closing fence and a line past the page", () => {
    const page = fixture("quote.md");
    const lines = splitLines(page.content);
    expect(lines[14]).toBe("");
    expect(unitAt(page, 15, lines)).toBeUndefined();
    expect(noUnitAt(page, 15, lines)).toBe("blank");
    // The closing fence is the block's own line, so a claim starting there is
    // not inside the block.
    expect(unitAt(page, 20, lines)).toBeUndefined();
    expect(noUnitAt(page, 20, lines)).toBe("fence-crossed");
    expect(unitAt(page, lines.length + 1, lines)).toBeUndefined();
  });

  it("gives the recorded lines a claim holds inside a fenced block", () => {
    const page = fixture("quote.md");
    const lines = splitLines(page.content);
    expect(unitAt(page, 17, lines)).toEqual({
      lines: { start: 17, end: 17 },
      kind: "fenced-lines",
      text: ["export const MAX_FILES = 10_000;"],
    });
    expect(unitAt(page, 18, lines, { start: 18, end: 19 })).toEqual({
      lines: { start: 18, end: 19 },
      kind: "fenced-lines",
      text: ["export const FETCH_TIMEOUT_MS = 10_000;", "export const RETRIES = 3;"],
    });
  });

  it("holds no claim when the recorded lines run past the closing fence", () => {
    const page = fixture("quote.md");
    const lines = splitLines(page.content);
    expect(noUnitAt(page, 19, lines, { start: 19, end: 20 })).toBe("fence-crossed");
    expect(unitAt(page, 19, lines, { start: 19, end: 20 })).toBeUndefined();
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

describe("unitAt: a table row", () => {
  it("gives a body row alone, not the rows under it", () => {
    const page = fixture("table-row.md");
    const lines = splitLines(page.content);
    expect(unitAt(page, 17, lines)).toEqual({
      lines: { start: 17, end: 17 },
      kind: "paragraph",
      text: ["| `--retries` | 5 | How many times a request is retried. |"],
    });
  });

  it("gives the header row alone, and holds no claim at the rule under it", () => {
    const page = fixture("table-row.md");
    const lines = splitLines(page.content);
    expect(unitAt(page, 15, lines)).toEqual({
      lines: { start: 15, end: 15 },
      kind: "paragraph",
      text: ["| Flag | Default | What it does |"],
    });
    // The rule carries no words, so a pin over it would say nothing.
    expect(noUnitAt(page, 16, lines)).toBe("table-rule");
    expect(unitAt(page, 16, lines)).toBeUndefined();
  });

  it("gives the last row alone where prose follows the table with no blank line", () => {
    const content = "---\ntitle: T\n---\n| a | b |\n|---|---|\n| 1 | 2 |\nProse right after.\n";
    const page = readPage("p.md", content);
    const lines = splitLines(page.content);
    expect(unitAt(page, 6, lines)).toEqual({
      lines: { start: 6, end: 6 },
      kind: "paragraph",
      text: ["| 1 | 2 |"],
    });
  });

  it("gives the one row of a one-row table", () => {
    const content = "---\ntitle: T\n---\n| only |\n";
    const page = readPage("p.md", content);
    const lines = splitLines(page.content);
    expect(unitAt(page, 4, lines)).toEqual({
      lines: { start: 4, end: 4 },
      kind: "paragraph",
      text: ["| only |"],
    });
  });

  it("keeps the recorded span of a claim over several rows", () => {
    const page = fixture("table-span.md");
    const lines = splitLines(page.content);
    expect(unitAt(page, 17, lines, { start: 17, end: 19 })).toEqual({
      lines: { start: 17, end: 19 },
      kind: "paragraph",
      text: [
        "| `claim-changed` | error |",
        "| `claim-moved` | warning |",
        "| `source-moved` | warning |",
      ],
    });
  });

  it("refuses a recorded span the table no longer covers", () => {
    const content = "---\ntitle: T\n---\n| a | b |\n|---|---|\nProse replaced the row.\n";
    const page = readPage("p.md", content);
    const lines = splitLines(page.content);
    expect(unitAt(page, 4, lines, { start: 4, end: 6 })).toBeUndefined();
    expect(noUnitAt(page, 4, lines, { start: 4, end: 6 })).toBe("table-short");
    // The rows it does still cover are re-pinned as they are.
    expect(unitAt(page, 4, lines, { start: 4, end: 5 })).toMatchObject({
      lines: { start: 4, end: 5 },
    });
  });

  it("refuses a recorded span that runs past the end of the page", () => {
    const page = fixture("table-span.md");
    const lines = splitLines(page.content);
    expect(noUnitAt(page, 19, lines, { start: 19, end: 21 })).toBe("table-short");
  });

  it("reads a pipe line inside a fenced block as fenced lines, not as a row", () => {
    const content = "---\ntitle: T\n---\n```\n| a | b |\n```\n";
    const page = readPage("p.md", content);
    const lines = splitLines(page.content);
    // The fence is read first, so the recorded width decides the span and the
    // table rules never run.
    expect(unitAt(page, 5, lines)).toEqual({
      lines: { start: 5, end: 5 },
      kind: "fenced-lines",
      text: ["| a | b |"],
    });
  });
});

describe("unitAt: a cite marker", () => {
  const page = (body: string): PageCitations => readPage("p.md", `---\ntitle: T\n---\n${body}`);

  it("holds no claim: a line that is one marker and nothing else", () => {
    const marked = page("<!-- cite c1 -->\nThe fetch timeout is 10 seconds.\n");
    const lines = splitLines(marked.content);
    expect(noUnitAt(marked, 4, lines)).toBe("marker");
    expect(unitAt(marked, 4, lines)).toBeUndefined();
  });

  it("ends the unit above a marker, so a re-pin never covers one", () => {
    const marked = page("The fetch timeout is 10 seconds.\n<!-- cite c1 -->\nMore prose.\n");
    const lines = splitLines(marked.content);
    expect(unitAt(marked, 4, lines)).toEqual({
      lines: { start: 4, end: 4 },
      kind: "paragraph",
      text: ["The fetch timeout is 10 seconds."],
    });
  });

  it("gives the marker line and the text under it once the entry is named", () => {
    const marked = page("<!-- cite c1 -->\nThe fetch timeout is 10 seconds.\n");
    const lines = splitLines(marked.content);
    expect(unitAt(marked, 4, lines, undefined, true)).toEqual({
      lines: { start: 4, end: 5 },
      kind: "paragraph",
      text: ["<!-- cite c1 -->", "The fetch timeout is 10 seconds."],
    });
    expect(noUnitAt(marked, 4, lines, undefined, true)).toBeUndefined();
  });
});

describe("unitAt: a table rule", () => {
  const page = (body: string): PageCitations => readPage("p.md", `---\ntitle: T\n---\n${body}`);
  const TABLE = "| Flag | Default |\n|---|---|\n| `--retries` | 5 |\n";

  it("holds no claim: a span that is nothing but rules", () => {
    const table = page(TABLE);
    const lines = splitLines(table.content);
    expect(noUnitAt(table, 5, lines)).toBe("table-rule");
    expect(unitAt(table, 5, lines)).toBeUndefined();
  });

  it("keeps a claim that covers a header, its rule and a body row", () => {
    const table = page(TABLE);
    const lines = splitLines(table.content);
    expect(unitAt(table, 4, lines, { start: 4, end: 6 })).toEqual({
      lines: { start: 4, end: 6 },
      kind: "paragraph",
      text: ["| Flag | Default |", "|---|---|", "| `--retries` | 5 |"],
    });
  });

  it("gives the rule row once the entry is named", () => {
    const table = page(TABLE);
    const lines = splitLines(table.content);
    expect(unitAt(table, 5, lines, undefined, true)).toEqual({
      lines: { start: 5, end: 5 },
      kind: "paragraph",
      text: ["|---|---|"],
    });
  });
});

describe("otherClaimSpans", () => {
  const REPEATED = "---\ntitle: T\n---\nRepeated line.\n\nOther.\n\nRepeated line.\n";

  it("names where else in the body the same text sits, in file lines", () => {
    const page = readPage("p.md", REPEATED);
    const lines = splitLines(page.content);
    const span = { start: 4, end: 4 };
    const pin = pinOfLines(lines, span);
    expect(pin).toBeDefined();
    const spans = otherClaimSpans(lines, span, pin ?? "", page.bodyLine);
    expect(spans).toEqual([{ start: 8, end: 8 }]);
    expect(spellElsewhere(spans)).toBe("line 8");
  });

  it("is empty for text that sits in one place", () => {
    const page = readPage("p.md", REPEATED);
    const lines = splitLines(page.content);
    const span = { start: 6, end: 6 };
    const pin = pinOfLines(lines, span);
    expect(pin).toBeDefined();
    expect(otherClaimSpans(lines, span, pin ?? "", page.bodyLine)).toEqual([]);
  });
});

describe("noUnitAt", () => {
  const page = (body: string): PageCitations => readPage("p.md", `---\ntitle: T\n---\n${body}`);

  it("names a blank line, a crossing claim, a line that starts no paragraph, and one outside the body", () => {
    const blank = page("\nText.\n");
    expect(noUnitAt(blank, 4, splitLines(blank.content))).toBe("blank");

    const fenced = page("```ts\nconst a = 1;\n```\n");
    // Line 5 is code the claim can hold; a claim reaching line 6 covers the
    // closing fence, and one starting there is on it.
    expect(noUnitAt(fenced, 5, splitLines(fenced.content))).toBeUndefined();
    expect(noUnitAt(fenced, 5, splitLines(fenced.content), { start: 5, end: 6 })).toBe(
      "fence-crossed",
    );
    expect(noUnitAt(fenced, 6, splitLines(fenced.content))).toBe("fence-crossed");

    const broken = page("----\n");
    expect(noUnitAt(broken, 4, splitLines(broken.content))).toBe("not-a-paragraph");

    const short = page("Text.\n");
    const lines = splitLines(short.content);
    expect(noUnitAt(short, lines.length + 1, lines)).toBe("outside");
    expect(noUnitAt(short, 1, lines)).toBe("outside");
  });

  it("is undefined where a unit is found", () => {
    const plain = page("Text.\n");
    expect(noUnitAt(plain, 4, splitLines(plain.content))).toBeUndefined();
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
