import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { SRC_PATTERN, formatSrc, isObfuscatedToken, parseSrc } from "../../src/cite/core/range.js";
import { CiteError } from "../../src/cite/errors.js";
import type { SourceRange } from "../../src/cite/types.js";

const require = createRequire(import.meta.url);
const schema = require("../../src/cite/schema/citations.json") as {
  $defs: { srcRef: { pattern: string } };
};

const TOKEN = "~9c1f0a2b3c4d5e6f";

/** The schema's pattern as the engine compiles it; a JSON string cannot escape `/`. */
const SCHEMA_PATTERN = new RegExp(schema.$defs.srcRef.pattern);

describe("SRC_PATTERN", () => {
  it("is the schema's srcRef pattern, spelled once in each place", () => {
    // `.source` re-escapes `/` however the regex was built, so both sides go
    // through the same normalisation before they are compared.
    expect(SRC_PATTERN.source).toBe(SCHEMA_PATTERN.source);
    expect(SRC_PATTERN.flags).toBe(SCHEMA_PATTERN.flags);
  });

  it.each([
    "docs/release notes/v1.2.md:4-9",
    "a",
    "a/b.ts",
    "a/b.ts:1",
    "a/b.ts:1-1",
    "a/b.ts:9-3",
    ".hidden/file",
    "a/.b",
    "a.b/c.d",
    TOKEN,
    `${TOKEN}:2`,
    `${TOKEN}:2-5`,
  ])("accepts %j", (src) => {
    expect(SRC_PATTERN.test(src)).toBe(true);
    expect(SCHEMA_PATTERN.test(src)).toBe(true);
  });

  it.each([
    "/abs",
    "C:/x",
    "a\\b",
    "./a",
    "../a",
    "a/./b",
    "a/../b",
    "a/..",
    "a//b",
    "a/",
    "",
    "a:0",
    "a:01",
    "a:1-",
    "a:1-0",
    "https://x/y",
    "~9C1F0A2B3C4D5E6F",
    "~9c1f0a2b3c4d5e6",
    "~9c1f0a2b3c4d5e6f0",
    "~",
    "~notatoken",
    "a\tb",
    "a\nb",
  ])("rejects %j", (src) => {
    expect(SRC_PATTERN.test(src)).toBe(false);
    expect(SCHEMA_PATTERN.test(src)).toBe(false);
  });
});

describe("parseSrc", () => {
  it("parses a bare path as a whole-file range", () => {
    expect(parseSrc("src/limits.ts")).toEqual({ path: "src/limits.ts", obfuscated: false });
  });

  it("parses path:L as a one-line range with end equal to start", () => {
    expect(parseSrc("src/limits.ts:2")).toEqual({
      path: "src/limits.ts",
      obfuscated: false,
      start: 2,
      end: 2,
    });
  });

  it("parses path:L1-L2", () => {
    expect(parseSrc("docs/release notes/v1.2.md:4-9")).toEqual({
      path: "docs/release notes/v1.2.md",
      obfuscated: false,
      start: 4,
      end: 9,
    });
  });

  it("parses an obfuscated token with the same line forms", () => {
    expect(parseSrc(TOKEN)).toEqual({ path: TOKEN, obfuscated: true });
    expect(parseSrc(`${TOKEN}:4-11`)).toEqual({ path: TOKEN, obfuscated: true, start: 4, end: 11 });
  });

  it("rejects bad grammar with a CiteError naming the src", () => {
    expect(() => parseSrc("/abs:1")).toThrow(CiteError);
    expect(() => parseSrc("/abs:1")).toThrow(/^Invalid src "\/abs:1": /);
  });

  it("rejects an end line before the start line, after the grammar passes", () => {
    expect(() => parseSrc("a:9-3")).toThrow(CiteError);
    expect(() => parseSrc("a:9-3")).toThrow('Invalid range "a:9-3": end line 3 is before start line 9.');
  });

  it("agrees with the ladder's parser on every well-formed src", () => {
    const ladder = require("../../docs/proposals/0035/ladders/drift-examples.cjs") as {
      parseSrc(src: string): SourceRange;
    };
    for (const src of ["a", "a:2", "a:1-3", TOKEN, `${TOKEN}:2`, `${TOKEN}:1-3`]) {
      expect(parseSrc(src)).toEqual(ladder.parseSrc(src));
    }
  });
});

describe("formatSrc", () => {
  it("spells a whole-file range as the bare path", () => {
    expect(formatSrc({ path: "a/b.ts", obfuscated: false })).toBe("a/b.ts");
  });

  it("spells one line as path:L, whether end is equal or absent", () => {
    expect(formatSrc({ path: "a/b.ts", obfuscated: false, start: 2, end: 2 })).toBe("a/b.ts:2");
    expect(formatSrc({ path: "a/b.ts", obfuscated: false, start: 2 })).toBe("a/b.ts:2");
  });

  it("spells a range as path:L1-L2", () => {
    expect(formatSrc({ path: "a/b.ts", obfuscated: false, start: 1, end: 3 })).toBe("a/b.ts:1-3");
  });

  it("passes an obfuscated token through unchanged", () => {
    expect(formatSrc({ path: TOKEN, obfuscated: true, start: 4, end: 4 })).toBe(`${TOKEN}:4`);
    expect(formatSrc({ path: TOKEN, obfuscated: true })).toBe(TOKEN);
  });

  it("round-trips parseSrc on the canonical spellings", () => {
    for (const src of ["a", "a/b:1", "a/b:1-3", TOKEN, `${TOKEN}:7-9`]) {
      expect(formatSrc(parseSrc(src))).toBe(src);
    }
    expect(formatSrc(parseSrc("a:1-1"))).toBe("a:1");
  });
});

describe("isObfuscatedToken", () => {
  it("is true only for ~ and sixteen lowercase hex digits", () => {
    expect(isObfuscatedToken(TOKEN)).toBe(true);
    expect(isObfuscatedToken("~9C1F0A2B3C4D5E6F")).toBe(false);
    expect(isObfuscatedToken("~9c1f0a2b3c4d5e6")).toBe(false);
    expect(isObfuscatedToken(`${TOKEN}:2`)).toBe(false);
    expect(isObfuscatedToken("src/limits.ts")).toBe(false);
  });
});
