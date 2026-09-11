import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashLines, hashRange, normalizeText, sliceLines, splitLines } from "../../src/cite/core/hash.js";
import { CiteError } from "../../src/cite/errors.js";

const require = createRequire(import.meta.url);
const ladder = require("../../docs/proposals/0044/ladders/drift-examples.cjs") as {
  SOURCE: string;
  variants: Record<string, string>;
  // A property, not a method: the ladder's `mint` is a plain function that
  // never touches `this`, so destructuring it below is sound.
  mint: (text: string, l1?: number, l2?: number, salt?: string) => string | undefined;
};
const { SOURCE, variants, mint } = ladder;

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "cite", "src", "limits.ts");

const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_1_3 = "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6";
const PIN_WHOLE = "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023";

describe("the fixture", () => {
  it("is byte-for-byte the ladder's SOURCE", () => {
    expect(readFileSync(FIXTURE, "utf8")).toBe(SOURCE);
  });
});

describe("normalizeText", () => {
  it("strips one leading BOM and folds CRLF to LF", () => {
    expect(normalizeText("﻿a\r\nb\r\n")).toBe("a\nb\n");
    expect(normalizeText("﻿﻿a")).toBe("﻿a");
    expect(normalizeText("a\rb")).toBe("a\rb");
  });
});

describe("splitLines", () => {
  it("drops the empty element a trailing LF leaves, and only that one", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\nb\n\n")).toEqual(["a", "b", ""]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
  });

  it("normalizes first", () => {
    expect(splitLines("﻿a\r\nb\r\n")).toEqual(["a", "b"]);
  });
});

describe("sliceLines", () => {
  const lines = splitLines(SOURCE);

  it("joins every line for a whole-file range", () => {
    expect(sliceLines(lines)).toBe(SOURCE.slice(0, -1));
    expect(sliceLines(lines, {})).toBe(SOURCE.slice(0, -1));
  });

  it("takes one line for start alone, and an inclusive range otherwise", () => {
    expect(sliceLines(lines, { start: 2 })).toBe("export const FETCH_TIMEOUT_MS = 10_000;");
    expect(sliceLines(lines, { start: 2, end: 2 })).toBe("export const FETCH_TIMEOUT_MS = 10_000;");
    expect(sliceLines(lines, { start: 1, end: 3 })).toBe(lines.slice(0, 3).join("\n"));
    expect(sliceLines(lines, { start: 1, end: 7 })).toBe(sliceLines(lines));
  });

  it("keeps trailing whitespace", () => {
    expect(sliceLines(["a ", "b"], { start: 1, end: 2 })).toBe("a \nb");
  });

  it("throws CiteError when the range runs past the end", () => {
    expect(() => sliceLines(lines, { start: 1, end: 9 }, "src/limits.ts")).toThrow(CiteError);
    expect(() => sliceLines(lines, { start: 1, end: 9 }, "src/limits.ts")).toThrow(
      "src/limits.ts has 7 lines; line 9 is out of range.",
    );
    expect(() => sliceLines(lines, { start: 8 }, "src/limits.ts")).toThrow(
      "src/limits.ts has 7 lines; line 8 is out of range.",
    );
    expect(() => sliceLines(lines, { start: 12, end: 20 }, "src/limits.ts")).toThrow(
      "src/limits.ts has 7 lines; line 12 is out of range.",
    );
  });

  it("labels the text 'the source' by default", () => {
    expect(() => sliceLines(lines, { start: 9 })).toThrow("the source has 7 lines; line 9 is out of range.");
  });
});

describe("hashLines", () => {
  it("spells the pin sha256-<64 hex>", () => {
    expect(hashLines("")).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(hashLines("")).toBe("sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("keys the hash with the salt and one LF, and an empty salt is still a key", () => {
    expect(hashLines("x", "s")).toBe(hashLines("s\nx"));
    expect(hashLines("x", "")).toBe(hashLines("\nx"));
    expect(hashLines("x", "")).not.toBe(hashLines("x"));
  });
});

describe("hashRange", () => {
  it("reproduces the plan's golden hashes", () => {
    expect(hashRange(SOURCE, { start: 2 })).toBe(PIN_L2);
    expect(hashRange(SOURCE, { start: 2, end: 2 })).toBe(PIN_L2);
    expect(hashRange(SOURCE, { start: 1, end: 3 })).toBe(PIN_1_3);
    expect(hashRange(SOURCE)).toBe(PIN_WHOLE);
    expect(hashRange(SOURCE, { start: 1, end: 7 })).toBe(PIN_WHOLE);
  });

  it("hashes the fixture on disk to the same pins", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(hashRange(text, { start: 2 })).toBe(PIN_L2);
    expect(hashRange(text)).toBe(PIN_WHOLE);
  });

  it("holds across CRLF and a BOM, and sees trailing whitespace", () => {
    expect(hashRange(variants["CRLF"] ?? "", { start: 2 })).toBe(PIN_L2);
    expect(hashRange(variants["BOM"] ?? "", { start: 1, end: 3 })).toBe(PIN_1_3);
    expect(hashRange(variants["TRAILING_WS"] ?? "", { start: 2 })).not.toBe(PIN_L2);
  });

  it("is keyed only when a salt is passed, and an empty salt still keys", () => {
    expect(hashRange(SOURCE, { start: 2 }, "SALT-LADDER")).not.toBe(PIN_L2);
    expect(hashRange(SOURCE, { start: 2 }, "")).not.toBe(PIN_L2);
    expect(hashRange(SOURCE, { start: 2 }, undefined)).toBe(PIN_L2);
  });

  it("agrees with the ladder's mint on every variant, plain and keyed", () => {
    const texts: Record<string, string> = { SOURCE, ...variants };
    const ranges: [number | undefined, number | undefined][] = [
      [undefined, undefined],
      [1, undefined],
      [2, undefined],
      [1, 3],
      [2, 3],
    ];
    for (const [name, text] of Object.entries(texts)) {
      for (const [l1, l2] of ranges) {
        for (const salt of [undefined, "", "SALT-LADDER"]) {
          const want = mint(text, l1, l2, salt);
          if (want === undefined) continue;
          const label = `${name} ${JSON.stringify([l1, l2, salt])}`;
          expect(hashRange(text, { start: l1, end: l2 }, salt), label).toBe(want);
        }
      }
    }
  });

  it("throws CiteError where the ladder's mint returns undefined", () => {
    expect(mint(variants["SHRUNK"] ?? "", 1, 7)).toBeUndefined();
    expect(() => hashRange(variants["SHRUNK"] ?? "", { start: 1, end: 7 })).toThrow(CiteError);
  });
});
