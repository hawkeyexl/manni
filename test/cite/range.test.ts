/**
 * The source and line grammar. Two patterns, spelled once each: `FILE_PATTERN`
 * is the schema's `$defs.fileRef.pattern`, the `source.file` an entry writes,
 * and `SRC_PATTERN` is the command line's `<src>`, the same thing with an
 * optional `:L`/`:L1-L2` suffix. The line helpers turn a `lines` spec into a
 * range and back.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  FILE_PATTERN,
  SRC_PATTERN,
  formatSrc,
  lineSpec,
  parseLines,
  parseSrc,
  rangeLines,
  sourceRange,
  spellLines,
  spellSource,
} from "../../src/cite/core/range.js";
import { CiteError } from "../../src/cite/errors.js";
import type { SourceRange } from "../../src/cite/types.js";

const require = createRequire(import.meta.url);
const schema = require("../../src/cite/schema/citations.json") as {
  $id: string;
  $defs: { fileRef: { pattern: string } };
};
const draft = require("../../docs/proposals/0044/schemas/citations/1.0.0-proposal.3.json") as unknown;

/** Ciphertext-shaped: `~` and 84 base64url characters. The grammar checks shape, not keys. */
const TOKEN = "~" + "AQx7Vb2_Kp-9Qm".repeat(6);
/** The shortest a ciphertext can be: 82 characters after the `~`. */
const SHORTEST = TOKEN.slice(0, 83);

/** The schema's pattern as the engine compiles it; a JSON string cannot escape `/`. */
const SCHEMA_FILE_PATTERN = new RegExp(schema.$defs.fileRef.pattern);

describe("the bundled schema", () => {
  it("is the proposal.3 draft, byte for byte", () => {
    expect(schema).toEqual(draft);
    expect(schema.$id).toBe("manni:citations:1.0.0-proposal.3");
  });
});

describe("FILE_PATTERN", () => {
  it("is the schema's fileRef pattern, spelled once in each place", () => {
    // `.source` re-escapes `/` however the regex was built, so both sides go
    // through the same normalisation before they are compared.
    expect(FILE_PATTERN.source).toBe(SCHEMA_FILE_PATTERN.source);
    expect(FILE_PATTERN.flags).toBe(SCHEMA_FILE_PATTERN.flags);
  });

  it.each([
    "docs/release notes/v1.2.md",
    "a",
    "a/b.ts",
    ".hidden/file",
    "a/.b",
    "a.b/c.d",
    TOKEN,
    SHORTEST,
  ])("accepts %j", (file) => {
    expect(FILE_PATTERN.test(file)).toBe(true);
    expect(SCHEMA_FILE_PATTERN.test(file)).toBe(true);
  });

  it.each([
    // A file reference carries no line suffix: `lines` is its own key.
    "a/b.ts:1",
    "a/b.ts:1-3",
    `${TOKEN}:2`,
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
    "https://x/y",
    // proposal.1's hashed token: sixteen hex digits carry no ciphertext.
    "~9c1f0a2b3c4d5e6f",
    SHORTEST.slice(0, -1),
    "~" + "AQx7Vb2+Kp/9Qm".repeat(6),
    "~",
    "~notatoken",
    "a\tb",
    "a\nb",
  ])("rejects %j", (file) => {
    expect(FILE_PATTERN.test(file)).toBe(false);
    expect(SCHEMA_FILE_PATTERN.test(file)).toBe(false);
  });
});

describe("SRC_PATTERN", () => {
  it("is FILE_PATTERN plus an optional line suffix", () => {
    // Everything the schema's file reference accepts is a src with no lines.
    for (const file of ["a", "a/b.ts", TOKEN, SHORTEST, "docs/release notes/v1.2.md"]) {
      expect(FILE_PATTERN.test(file)).toBe(true);
      expect(SRC_PATTERN.test(file)).toBe(true);
      expect(SRC_PATTERN.test(`${file}:2`)).toBe(true);
      expect(SRC_PATTERN.test(`${file}:2-5`)).toBe(true);
    }
  });

  it.each([
    "docs/release notes/v1.2.md:4-9",
    "a",
    "a/b.ts:1",
    "a/b.ts:1-1",
    // The grammar takes it; `parseSrc` is what refuses a backwards range.
    "a/b.ts:9-3",
    `${TOKEN}:2`,
  ])("accepts %j", (src) => {
    expect(SRC_PATTERN.test(src)).toBe(true);
  });

  it.each([
    "/abs",
    "C:/x",
    "a\\b",
    "./a",
    "../a",
    "a/./b",
    "a//b",
    "a/",
    "",
    "a:0",
    "a:01",
    "a:1-",
    "a:1-0",
    "https://x/y",
    "~9c1f0a2b3c4d5e6f",
    `${TOKEN}=`,
    "~",
    "a\tb",
  ])("rejects %j", (src) => {
    expect(SRC_PATTERN.test(src)).toBe(false);
  });
});

describe("parseSrc", () => {
  it("parses a bare path as a whole-file range", () => {
    expect(parseSrc("src/limits.ts")).toEqual({ path: "src/limits.ts", encrypted: false });
  });

  it("parses path:L as a one-line range with end equal to start", () => {
    expect(parseSrc("src/limits.ts:2")).toEqual({
      path: "src/limits.ts",
      encrypted: false,
      start: 2,
      end: 2,
    });
  });

  it("parses path:L1-L2", () => {
    expect(parseSrc("docs/release notes/v1.2.md:4-9")).toEqual({
      path: "docs/release notes/v1.2.md",
      encrypted: false,
      start: 4,
      end: 9,
    });
  });

  it("parses an encrypted source with the same line forms", () => {
    expect(parseSrc(TOKEN)).toEqual({ path: TOKEN, encrypted: true });
    expect(parseSrc(`${TOKEN}:4-11`)).toEqual({ path: TOKEN, encrypted: true, start: 4, end: 11 });
  });

  it("rejects bad grammar with a CiteError naming the src", () => {
    expect(() => parseSrc("/abs:1")).toThrow(CiteError);
    expect(() => parseSrc("/abs:1")).toThrow(/^Invalid src "\/abs:1": /);
    expect(() => parseSrc("/abs:1")).toThrow(
      'Invalid src "/abs:1": expected path, path:L, path:L1-L2, or an encrypted source (~ and at least 82 base64url characters) with the same line forms; the path is repo-root-relative, posix, and free of . and .. segments.',
    );
  });

  it("rejects an end line before the start line, after the grammar passes", () => {
    expect(() => parseSrc("a:9-3")).toThrow(CiteError);
    expect(() => parseSrc("a:9-3")).toThrow('Invalid range "a:9-3": end line 3 is before start line 9.');
  });

  it("agrees with the ladder's parser on every well-formed src", () => {
    const ladder = require("../../docs/proposals/0044/ladders/drift-examples.cjs") as {
      parseSrc(src: string): SourceRange;
    };
    for (const src of ["a", "a:2", "a:1-3", TOKEN, `${TOKEN}:2`, `${TOKEN}:1-3`]) {
      expect(parseSrc(src)).toEqual(ladder.parseSrc(src));
    }
  });
});

describe("formatSrc", () => {
  it("spells a whole-file range as the bare path", () => {
    expect(formatSrc({ path: "a/b.ts", encrypted: false })).toBe("a/b.ts");
  });

  it("spells one line as path:L, whether end is equal or absent", () => {
    expect(formatSrc({ path: "a/b.ts", encrypted: false, start: 2, end: 2 })).toBe("a/b.ts:2");
    expect(formatSrc({ path: "a/b.ts", encrypted: false, start: 2 })).toBe("a/b.ts:2");
  });

  it("spells a range as path:L1-L2", () => {
    expect(formatSrc({ path: "a/b.ts", encrypted: false, start: 1, end: 3 })).toBe("a/b.ts:1-3");
  });

  it("passes an encrypted source through unchanged", () => {
    expect(formatSrc({ path: TOKEN, encrypted: true, start: 4, end: 4 })).toBe(`${TOKEN}:4`);
    expect(formatSrc({ path: TOKEN, encrypted: true })).toBe(TOKEN);
  });

  it("round-trips parseSrc on the canonical spellings", () => {
    for (const src of ["a", "a/b:1", "a/b:1-3", TOKEN, `${TOKEN}:7-9`]) {
      expect(formatSrc(parseSrc(src))).toBe(src);
    }
    expect(formatSrc(parseSrc("a:1-1"))).toBe("a:1");
  });
});

describe("parseLines", () => {
  it("reads an integer as the one line it names", () => {
    expect(parseLines(1)).toEqual({ start: 1, end: 1 });
    expect(parseLines(42)).toEqual({ start: 42, end: 42 });
  });

  it('reads "L1-L2" as the inclusive range', () => {
    expect(parseLines("3-7")).toEqual({ start: 3, end: 7 });
    expect(parseLines("3-3")).toEqual({ start: 3, end: 3 });
  });

  it("is undefined for a value the schema refuses", () => {
    expect(parseLines(0)).toBeUndefined();
    expect(parseLines(-1)).toBeUndefined();
    expect(parseLines(2.5)).toBeUndefined();
    expect(parseLines("")).toBeUndefined();
    expect(parseLines("3")).toEqual({ start: 3, end: 3 });
    expect(parseLines("01-3")).toBeUndefined();
    expect(parseLines("3-")).toBeUndefined();
    expect(parseLines("a-b")).toBeUndefined();
  });

  it("is undefined when the end precedes the start", () => {
    // The schema's pattern cannot compare two numbers, so this is the rule.
    expect(parseLines("7-3")).toBeUndefined();
  });
});

describe("lineSpec and spellLines", () => {
  it("writes one line as the integer and several as the string", () => {
    expect(lineSpec({ start: 3, end: 3 })).toBe(3);
    expect(lineSpec({ start: 3, end: 7 })).toBe("3-7");
  });

  it("spells lines for a report, always as a string", () => {
    expect(spellLines({ start: 3, end: 3 })).toBe("3");
    expect(spellLines({ start: 3, end: 7 })).toBe("3-7");
  });

  it("round-trips parseLines on every spelling", () => {
    for (const lines of [{ start: 1, end: 1 }, { start: 4, end: 9 }]) {
      expect(parseLines(lineSpec(lines))).toEqual(lines);
    }
  });
});

describe("sourceRange and spellSource", () => {
  const PIN = `sha256-${"0".repeat(64)}`;

  it("reads an entry's source as a range", () => {
    expect(sourceRange({ file: "a/b.ts", integrity: PIN })).toEqual({
      path: "a/b.ts",
      encrypted: false,
    });
    expect(sourceRange({ file: "a/b.ts", lines: 2, integrity: PIN })).toEqual({
      path: "a/b.ts",
      encrypted: false,
      start: 2,
      end: 2,
    });
    expect(sourceRange({ file: "a/b.ts", lines: "2-5", integrity: PIN })).toEqual({
      path: "a/b.ts",
      encrypted: false,
      start: 2,
      end: 5,
    });
  });

  it("marks an encrypted file encrypted, lines and all", () => {
    expect(sourceRange({ file: TOKEN, lines: 3, integrity: PIN })).toEqual({
      path: TOKEN,
      encrypted: true,
      start: 3,
      end: 3,
    });
  });

  it("leaves the lines off a spec the schema would refuse", () => {
    expect(sourceRange({ file: "a/b.ts", lines: "7-3", integrity: PIN })).toEqual({
      path: "a/b.ts",
      encrypted: false,
    });
  });

  it("spells a source the way the command line takes one", () => {
    expect(spellSource({ file: "a/b.ts", integrity: PIN })).toBe("a/b.ts");
    expect(spellSource({ file: "a/b.ts", lines: 2, integrity: PIN })).toBe("a/b.ts:2");
    expect(spellSource({ file: "a/b.ts", lines: "1-3", integrity: PIN })).toBe("a/b.ts:1-3");
    expect(spellSource({ file: TOKEN, lines: 2, integrity: PIN })).toBe(`${TOKEN}:2`);
  });
});

describe("rangeLines", () => {
  it("is undefined for a whole file", () => {
    expect(rangeLines({ path: "a", encrypted: false })).toBeUndefined();
  });

  it("writes the integer for one line and the string for several", () => {
    expect(rangeLines({ path: "a", encrypted: false, start: 2, end: 2 })).toBe(2);
    expect(rangeLines({ path: "a", encrypted: false, start: 2 })).toBe(2);
    expect(rangeLines({ path: "a", encrypted: false, start: 2, end: 5 })).toBe("2-5");
  });

  it("round-trips a parsed src back into an entry's lines", () => {
    expect(rangeLines(parseSrc("a/b.ts:4-9"))).toBe("4-9");
    expect(rangeLines(parseSrc("a/b.ts:4"))).toBe(4);
    expect(rangeLines(parseSrc("a/b.ts"))).toBeUndefined();
  });
});
