/**
 * Claim anchoring: whitespace-normalized search scoped to paragraphs, one hit
 * per paragraph, reported at the line the claim starts on. The cases are the
 * ladder's (docs/proposals/0044/ladders/drift-examples.cjs), plus the fixture
 * with a soft-wrapped claim under a frontmatter block.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  blockMatches,
  findClaim,
  normalizeWhitespace,
  paragraphContains,
} from "../../src/cite/core/claims.js";

const here = dirname(fileURLToPath(import.meta.url));
const readPage = (name: string): string =>
  readFileSync(`${here}/../fixtures/cite/pages/${name}`, "utf8");

const CLAIM = "The fetch timeout is 10 seconds.";
const PAGE = `# Limits\n\nThe fetch timeout is 10 seconds. It is\nnot configurable.\n\nRetries default to 3.\n`;

describe("normalizeWhitespace", () => {
  it("collapses runs of whitespace to one space and trims", () => {
    expect(normalizeWhitespace("  a \t b\r\n\n c  ")).toBe("a b c");
    expect(normalizeWhitespace("")).toBe("");
  });
});

describe("findClaim", () => {
  it("finds a claim in a paragraph, at the line it starts on", () => {
    expect(findClaim(PAGE, 0, CLAIM)).toEqual([{ paragraphStart: 10, line: 3 }]);
  });

  it("misses a claim that is not there", () => {
    expect(findClaim(PAGE, 0, "The fetch timeout is 9 seconds.")).toEqual([]);
  });

  it("treats punctuation verbatim: a comma for a full stop is a miss", () => {
    expect(findClaim("The fetch timeout is 10 seconds, and it is\nnot configurable.\n", 0, CLAIM)).toEqual([]);
  });

  it("finds a soft-wrapped claim across two lines", () => {
    expect(
      findClaim(PAGE, 0, "The fetch timeout is 10 seconds. It is not configurable.").map((h) => h.line),
    ).toEqual([3]);
  });

  it("reports one hit per paragraph containing the claim", () => {
    const twice = `Retries default to 3.\n\nSome other text.\n\n<!-- cite retries -->\nRetries default to 3. Really.\n`;
    expect(findClaim(twice, 0, "Retries default to 3.").map((h) => h.line)).toEqual([1, 6]);
  });

  it("points at the sentence, not the statement sitting above it in the same paragraph", () => {
    const body = "<!-- cite x -->\nlead-in\nThe claim here.\n";
    expect(findClaim(body, 0, "The claim here.")).toEqual([{ paragraphStart: 0, line: 3 }]);
  });

  it("searches only from the body offset and skips fenced code", () => {
    const content = "claim: Retries default to 3.\n---\n\n```\nRetries default to 3.\n```\n\nRetries default to 3.\n";
    const bodyOffset = content.indexOf("---\n") + 4;
    expect(findClaim(content, bodyOffset, "Retries default to 3.").map((h) => h.line)).toEqual([8]);
  });

  it("skips a fence indented inside a list item, as the statement scanner does", () => {
    const content = "- Step one.\n  ```\n  Retries default to 3.\n  ```\n\nRetries default to 3.\n";
    expect(findClaim(content, 0, "Retries default to 3.").map((h) => h.line)).toEqual([6]);
    expect(paragraphContains(content, 0, "Step one.")).toBe(true);
    expect(paragraphContains(content, 0, "Retries default to 3.")).toBe(false);
  });

  it("finds the fixture's soft-wrapped claim under its frontmatter", () => {
    const content = readPage("wrapped-claim.md");
    const bodyOffset = content.indexOf("# Limits");
    const hits = findClaim(content, bodyOffset, "The fetch timeout is 10 seconds. It is not configurable.");
    expect(hits.map((h) => h.line)).toEqual([12]);
    expect(content.slice(hits[0]?.paragraphStart)).toMatch(/^The fetch timeout/);
  });

  it("never matches an empty claim", () => {
    expect(findClaim(PAGE, 0, "  ")).toEqual([]);
  });
});

describe("paragraphContains", () => {
  it("checks the paragraph starting at an offset, whitespace-normalized", () => {
    const at = PAGE.indexOf("The fetch");
    expect(paragraphContains(PAGE, at, "The fetch timeout is 10 seconds. It is not configurable.")).toBe(true);
    expect(paragraphContains(PAGE, at, "Retries default to 3.")).toBe(false);
  });

  it("skips blank lines before the paragraph", () => {
    expect(paragraphContains(PAGE, PAGE.indexOf("\n\nThe fetch"), CLAIM)).toBe(true);
  });

  it("reads a fenced block's content when the offset sits on its fence", () => {
    const content = "x\n```ts\nconst a = 1;\n```\n";
    expect(paragraphContains(content, 2, "const a = 1;")).toBe(true);
    expect(paragraphContains(content, 2, "const b = 2;")).toBe(false);
  });
});

describe("blockMatches", () => {
  it("compares under the hashing rule: BOM, CRLF and one trailing LF do not count", () => {
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
