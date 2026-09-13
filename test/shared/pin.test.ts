/**
 * The pin engine, shared by cite and meta: normalization, line slicing, the
 * plain and keyed pin, the move search, and the line grammar a command line
 * and a stored range use. The goldens are the ones `test/cite/hash.test.ts`
 * pins, so the move out of cite cannot change a single digit.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { keyedPin } from "../../src/shared/encryption.js";
import { ToolError } from "../../src/shared/errors.js";
import {
  LineRangeError,
  MAX_RANGE_LINES,
  MOVE_BUDGET_BYTES,
  MOVE_WINDOW_LINES,
  findWindows,
  hashLines,
  hashRange,
  isKeyedPin,
  lineSpec,
  normalizeText,
  parseLines,
  pinOfLines,
  sliceLines,
  spellLines,
  splitLines,
  splitPageArgument,
  toBodyLines,
  toFileLines,
} from "../../src/shared/pin.js";
import { STDIN_LINES_MARKER } from "../../src/shared/run.js";

const require = createRequire(import.meta.url);
const ladder = require("../../docs/proposals/0044/ladders/drift-examples.cjs") as {
  SOURCE: string;
  variants: Record<string, string>;
  KEY: string;
};
const { SOURCE, variants, KEY } = ladder;

const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_1_3 = "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6";
const PIN_WHOLE = "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023";
const PIN_EMPTY = "sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("normalizeText and splitLines", () => {
  it("strip one BOM, fold CRLF, and drop only the trailing LF's empty element", () => {
    expect(normalizeText("\uFEFFa\r\nb\r\n")).toBe("a\nb\n");
    expect(normalizeText("\uFEFF\uFEFFa")).toBe("\uFEFFa");
    expect(normalizeText("a\rb")).toBe("a\rb");
    expect(splitLines("\uFEFFa\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb\n\n")).toEqual(["a", "b", ""]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("sliceLines", () => {
  const lines = splitLines(SOURCE);

  it("takes the whole text, one line, or an inclusive range", () => {
    expect(sliceLines(lines)).toBe(SOURCE.slice(0, -1));
    expect(sliceLines(lines, { start: 2 })).toBe("export const FETCH_TIMEOUT_MS = 10_000;");
    expect(sliceLines(lines, { start: 1, end: 3 })).toBe(lines.slice(0, 3).join("\n"));
  });

  it("throws LineRangeError, a ToolError, past the end", () => {
    expect(() => sliceLines(lines, { start: 1, end: 9 }, "src/limits.ts")).toThrow(LineRangeError);
    expect(() => sliceLines(lines, { start: 1, end: 9 }, "src/limits.ts")).toThrow(ToolError);
    expect(() => sliceLines(lines, { start: 1, end: 9 }, "src/limits.ts")).toThrow(
      "src/limits.ts has 7 lines; line 9 is out of range.",
    );
    expect(() => sliceLines(lines, { start: 9 })).toThrow("the source has 7 lines; line 9 is out of range.");
  });

  it("throws LineRangeError for a range that ends before it starts, instead of slicing nothing", () => {
    // Both bounds in range, so the past-the-end check alone let this through as "".
    expect(() => sliceLines(lines, { start: 5, end: 3 }, "src/limits.ts")).toThrow(LineRangeError);
    expect(() => sliceLines(lines, { start: 5, end: 3 }, "src/limits.ts")).toThrow(
      "src/limits.ts range 5-3 ends before it starts.",
    );
  });
});

describe("hashLines, hashRange and isKeyedPin", () => {
  it("reproduce cite's golden pins", () => {
    expect(hashLines("")).toBe(PIN_EMPTY);
    expect(hashRange(SOURCE, { start: 2 })).toBe(PIN_L2);
    expect(hashRange(SOURCE, { start: 1, end: 3 })).toBe(PIN_1_3);
    expect(hashRange(SOURCE)).toBe(PIN_WHOLE);
  });

  it("hold across CRLF and a BOM", () => {
    expect(hashRange(variants["CRLF"] ?? "", { start: 2 })).toBe(PIN_L2);
    expect(hashRange(variants["BOM"] ?? "", { start: 1, end: 3 })).toBe(PIN_1_3);
    expect(hashRange(variants["TRAILING_WS"] ?? "", { start: 2 })).not.toBe(PIN_L2);
  });

  it("key the pin only when a key is passed", () => {
    expect(hashLines("x", KEY)).toBe(keyedPin("x", KEY));
    expect(isKeyedPin(hashLines("x", KEY))).toBe(true);
    expect(isKeyedPin(hashLines("x"))).toBe(false);
  });

  it("throws LineRangeError from hashRange past the end", () => {
    expect(() => hashRange(variants["SHRUNK"] ?? "", { start: 1, end: 7 })).toThrow(LineRangeError);
  });
});

describe("pinOfLines", () => {
  it("pins a range plainly, and is undefined outside the lines", () => {
    const lines = splitLines(SOURCE);
    expect(pinOfLines(lines, { start: 2, end: 2 })).toBe(PIN_L2);
    expect(pinOfLines(lines, { start: 1, end: 8 })).toBeUndefined();
    expect(pinOfLines(lines, { start: 0, end: 1 })).toBeUndefined();
  });

  it("is undefined for a reversed range rather than the pin of an empty span", () => {
    const lines = splitLines(SOURCE);
    expect(pinOfLines(lines, { start: 5, end: 3 })).toBeUndefined();
    expect(pinOfLines(lines, { start: 5, end: 3 })).not.toBe(PIN_EMPTY);
  });
});

describe("findWindows", () => {
  it("keeps its limits", () => {
    expect(MOVE_WINDOW_LINES).toBe(2000);
    expect(MOVE_BUDGET_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_RANGE_LINES).toBe(5000);
  });

  it("finds a moved window, with and without the original lines", () => {
    const moved = splitLines(variants["MOVED"] ?? "");
    const line2 = splitLines(SOURCE)[1] ?? "";
    expect(findWindows(moved, 1, PIN_L2, undefined, { around: 2 })).toEqual({ starts: [4], truncated: false });
    expect(findWindows(moved, 1, PIN_L2, undefined, { original: [line2] })).toEqual({
      starts: [4],
      truncated: false,
    });
    expect(findWindows(moved, 1, keyedPin(line2, KEY), KEY, { around: 2 })).toEqual({
      starts: [4],
      truncated: false,
    });
  });

  it("searches the band around the original position before the rest of the file", () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `l${String(i + 1).padStart(4, "0")}`);
    lines[0] = "TTTTT";
    lines[2599] = "TTTTT";
    const pin = hashLines("TTTTT");
    // The band is 600..3000 (±2000 around 2600, clipped): 2401 five-byte windows.
    expect(findWindows(lines, 1, pin, undefined, { around: 2600 })).toEqual({
      starts: [2600, 1],
      truncated: false,
    });
    expect(findWindows(lines, 1, pin, undefined, { around: 2600, budget: 2401 * 5 })).toEqual({
      starts: [2600],
      truncated: true,
    });
  });

  it("finds nothing for a window longer than the text", () => {
    expect(findWindows(["a"], 2, PIN_L2, undefined)).toEqual({ starts: [], truncated: false });
  });
});

describe("parseLines, lineSpec and spellLines", () => {
  it("round-trip one line and a range", () => {
    expect(parseLines(9)).toEqual({ start: 9, end: 9 });
    expect(parseLines("9-12")).toEqual({ start: 9, end: 12 });
    expect(parseLines("9")).toEqual({ start: 9, end: 9 });
    expect(lineSpec({ start: 9, end: 9 })).toBe(9);
    expect(lineSpec({ start: 9, end: 12 })).toBe("9-12");
    expect(spellLines({ start: 9, end: 12 })).toBe("9-12");
    for (const spec of [9, "9-12"]) {
      const parsed = parseLines(spec);
      expect(parsed === undefined ? undefined : lineSpec(parsed)).toBe(spec);
    }
  });

  it("refuses what is not a line or a forward range", () => {
    expect(parseLines(0)).toBeUndefined();
    expect(parseLines(1.5)).toBeUndefined();
    expect(parseLines("12-9")).toBeUndefined();
    expect(parseLines("a")).toBeUndefined();
  });
});

describe("toFileLines and toBodyLines", () => {
  it("translate between body and file lines, and back", () => {
    expect(toFileLines({ start: 3, end: 4 }, 13)).toEqual({ start: 15, end: 16 });
    expect(toBodyLines({ start: 15, end: 16 }, 13)).toEqual({ start: 3, end: 4 });
    expect(toFileLines({ start: 3, end: 4 }, 1)).toEqual({ start: 3, end: 4 });
  });
});

describe("splitPageArgument", () => {
  it("reads a trailing :L or :L1-L2 as lines", () => {
    expect(splitPageArgument("page.md:12-31")).toEqual({ page: "page.md", lines: { start: 12, end: 31 } });
    expect(splitPageArgument("docs/limits.md:9")).toEqual({ page: "docs/limits.md", lines: { start: 9, end: 9 } });
  });

  it("keeps a colon that is not a line suffix in the path", () => {
    expect(splitPageArgument("C:/docs/limits.md:9")).toEqual({
      page: "C:/docs/limits.md",
      lines: { start: 9, end: 9 },
    });
    expect(splitPageArgument("C:/docs/limits.md")).toEqual({ page: "C:/docs/limits.md" });
  });

  it("leaves an argument with no suffix alone", () => {
    expect(splitPageArgument("page.md")).toEqual({ page: "page.md" });
    expect(splitPageArgument(":9")).toEqual({ page: ":9" });
  });

  it("maps the stdin marker back to -", () => {
    expect(splitPageArgument(`${STDIN_LINES_MARKER}:9`)).toEqual({ page: "-", lines: { start: 9, end: 9 } });
    expect(splitPageArgument("-:14-18")).toEqual({ page: "-", lines: { start: 14, end: 18 } });
  });

  it("throws LineRangeError for an end before the start", () => {
    expect(() => splitPageArgument("page.md:9-3")).toThrow(LineRangeError);
    expect(() => splitPageArgument("page.md:9-3")).toThrow(
      'Invalid range "page.md:9-3": end line 3 is before start line 9.',
    );
  });
});
