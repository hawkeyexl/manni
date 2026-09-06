/**
 * `--format` validation (ADR 01007). An unrecognized format is a usage error —
 * exit 2 via DocevalsError — not a silent fallback to the human renderer.
 */
import { describe, it, expect } from "vitest";
import {
  parseFormat,
  REPORT_FORMATS,
  SUMMARY_FORMATS,
} from "../../../src/docevals/reporters/format.js";
import { render } from "../../../src/docevals/reporters/index.js";
import { renderList, type ListRun } from "../../../src/docevals/commands/list.js";
import { renderFill } from "../../../src/docevals/commands/fill.js";
import { DocevalsError } from "../../../src/docevals/types.js";
import type { FillReport } from "../../../src/docevals/commands/fill.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";

const EMPTY_REPORT: EngineReport = {
  pages: 0,
  evalResults: [],
  suites: [],
  usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 0 },
  generated: [],
  exitCode: 0,
  problems: [],
};

describe("parseFormat", () => {
  it("exposes the full reporter set for run", () => {
    expect([...REPORT_FORMATS]).toEqual([
      "human",
      "json",
      "markdown",
      "github",
      "sarif",
      "junit",
      "html",
    ]);
  });

  it("exposes the human/json pair for list and fill", () => {
    expect([...SUMMARY_FORMATS]).toEqual(["human", "json"]);
  });

  it("accepts every value in the allowed set", () => {
    for (const f of REPORT_FORMATS) {
      expect(parseFormat(f, REPORT_FORMATS, "--format")).toBe(f);
    }
    for (const f of SUMMARY_FORMATS) {
      expect(parseFormat(f, SUMMARY_FORMATS, "--format")).toBe(f);
    }
  });

  it("throws a DocevalsError for an unknown value", () => {
    expect(() => parseFormat("xml", SUMMARY_FORMATS, "--format")).toThrow(
      DocevalsError,
    );
  });

  it("names the flag, the received value, and the allowed set", () => {
    expect(() => parseFormat("xml", SUMMARY_FORMATS, "--format")).toThrow(
      '--format must be one of human | json, got "xml"',
    );
    expect(() => parseFormat("xml", REPORT_FORMATS, "--format")).toThrow(
      '--format must be one of human | json | markdown | github | sarif | junit | html, got "xml"',
    );
  });

  it("rejects a format valid for another command", () => {
    // `markdown` is a run format; list and fill must not silently accept it.
    expect(() => parseFormat("markdown", SUMMARY_FORMATS, "--format")).toThrow(
      DocevalsError,
    );
  });

  it("rejects case variants and surrounding whitespace rather than coercing", () => {
    expect(() => parseFormat("JSON", SUMMARY_FORMATS, "--format")).toThrow(
      DocevalsError,
    );
    expect(() => parseFormat(" json", SUMMARY_FORMATS, "--format")).toThrow(
      DocevalsError,
    );
  });

  it("rejects the empty string", () => {
    expect(() => parseFormat("", SUMMARY_FORMATS, "--format")).toThrow(
      DocevalsError,
    );
  });
});

describe("render dispatch", () => {
  it("renders every declared format to a string", () => {
    for (const f of REPORT_FORMATS) {
      expect(typeof render(EMPTY_REPORT, f)).toBe("string");
    }
  });

  it("throws instead of returning undefined for an unknown format", () => {
    // Reachable from library consumers, who are not behind the CLI parser.
    expect(() => render(EMPTY_REPORT, "xml" as never)).toThrow(DocevalsError);
  });

  it("reports the same message shape as every other guard", () => {
    // One generator, three call sites. A hand-written message here would drift
    // from parseFormat's the first time either is reworded.
    expect(() => render(EMPTY_REPORT, "xml" as never)).toThrow(
      'format must be one of human | json | markdown | github | sarif | junit | html, got "xml"',
    );
  });
});

/**
 * renderList, renderFill, and render are all exported from src/index.ts, so a
 * library caller reaches them without the CLI parser in front. All three must
 * reject an unknown format — a silent fall-through to the human renderer is
 * the exact defect ADR 01007 exists to remove, and it does not stop being one
 * because the caller is a library instead of the CLI.
 */
describe("summary renderers reject an unknown format", () => {
  const EMPTY_LIST: ListRun = { plans: [], exitCode: 0 };
  const EMPTY_FILL: FillReport = {
    results: [],
    threshold: 0.8,
    turns: 0,
    exitCode: 0,
  };

  it("renderList renders both declared formats", () => {
    for (const f of SUMMARY_FORMATS) {
      expect(typeof renderList(EMPTY_LIST, f)).toBe("string");
    }
  });

  it("renderFill renders both declared formats", () => {
    for (const f of SUMMARY_FORMATS) {
      expect(typeof renderFill(EMPTY_FILL, f)).toBe("string");
    }
  });

  it("renderList throws rather than silently emitting human output", () => {
    expect(() => renderList(EMPTY_LIST, "xml" as never)).toThrow(DocevalsError);
  });

  it("renderFill throws rather than silently emitting human output", () => {
    expect(() => renderFill(EMPTY_FILL, "xml" as never)).toThrow(DocevalsError);
  });

  // Same template as the CLI parser, but naming the parameter rather than the
  // flag — a library caller passed `format`, not `--format`. Only the noun
  // differs; asserting the literal here is what pins that.
  it("uses render's message template with the parameter name, not the flag", () => {
    expect(() => renderList(EMPTY_LIST, "xml" as never)).toThrow(
      'format must be one of human | json, got "xml"',
    );
    expect(() => renderFill(EMPTY_FILL, "xml" as never)).toThrow(
      'format must be one of human | json, got "xml"',
    );
  });

  it("rejects a run-only format, which would otherwise render as human", () => {
    expect(() => renderList(EMPTY_LIST, "markdown" as never)).toThrow(
      DocevalsError,
    );
    expect(() => renderFill(EMPTY_FILL, "markdown" as never)).toThrow(
      DocevalsError,
    );
  });
});
