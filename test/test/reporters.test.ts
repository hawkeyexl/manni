/**
 * The three formats of `manni test run`. Shapes, not totals: each test builds
 * its result from the findings it asserts on.
 */
import { describe, expect, it } from "vitest";
import type { TestRunResult } from "../../src/test/commands/run.js";
import { renderGithub } from "../../src/test/reporters/github.js";
import { renderJson } from "../../src/test/reporters/json.js";
import { renderPretty } from "../../src/test/reporters/pretty.js";

const failing: TestRunResult = {
  results: { summary: {}, specs: [] },
  findings: [
    { file: "docs/guide.md", line: 12, result: "FAIL", description: "Returned exit code 1. Expected one of [0]." },
    { file: "docs/guide.md", line: 30, result: "WARNING", description: "Took 4100ms; the timeout is 3000ms." },
  ],
  tests: { pass: 0, fail: 1, warning: 1, skipped: 0 },
  exitCode: 1,
};

const passing: TestRunResult = {
  results: { summary: {}, specs: [] },
  findings: [],
  tests: { pass: 14, fail: 0, warning: 0, skipped: 0 },
  exitCode: 0,
};

describe("renderPretty", () => {
  it("groups findings under their file, with line and result, then the summary", () => {
    expect(renderPretty(failing, { color: false })).toBe(
      [
        "docs/guide.md",
        "  12  FAIL     Returned exit code 1. Expected one of [0].",
        "  30  WARNING  Took 4100ms; the timeout is 3000ms.",
        "",
        "2 tests: 0 passed, 1 failed, 1 warning, 0 skipped",
      ].join("\n"),
    );
  });

  it("prints only the summary when nothing failed or warned", () => {
    expect(renderPretty(passing, { color: false })).toBe(
      "14 tests: 14 passed, 0 failed, 0 warnings, 0 skipped",
    );
  });

  it("puts a blank line between files", () => {
    const two: TestRunResult = {
      ...failing,
      findings: [
        { file: "a.md", line: 1, result: "FAIL", description: "x" },
        { file: "b.md", line: 2, result: "FAIL", description: "y" },
      ],
    };
    const lines = renderPretty(two, { color: false }).split("\n");
    expect(lines.indexOf("b.md") - lines.indexOf("a.md")).toBe(3);
    expect(lines[lines.indexOf("b.md") - 1]).toBe("");
  });

  it("leaves the line column blank for a step with no location", () => {
    const noLine: TestRunResult = {
      ...failing,
      findings: [{ file: "a.md", result: "FAIL", description: "x" }],
    };
    expect(renderPretty(noLine, { color: false }).split("\n")[1]).toMatch(/^ +FAIL {5}x$/);
  });

  it("colors only when asked", () => {
    expect(renderPretty(failing, { color: false })).not.toContain("\u001b[");
    expect(renderPretty(failing, { color: true })).toContain("\u001b[");
  });

  it("says test and warning in the singular for one", () => {
    const one: TestRunResult = {
      ...passing,
      tests: { pass: 0, fail: 0, warning: 1, skipped: 0 },
    };
    expect(renderPretty(one, { color: false })).toBe(
      "1 test: 0 passed, 0 failed, 1 warning, 0 skipped",
    );
  });

  it("counts zero tests for a run that found none", () => {
    const empty: TestRunResult = {
      results: null,
      findings: [],
      tests: { pass: 0, fail: 0, warning: 0, skipped: 0 },
      exitCode: 0,
    };
    expect(renderPretty(empty, { color: false })).toBe(
      "0 tests: 0 passed, 0 failed, 0 warnings, 0 skipped",
    );
  });
});

describe("renderGithub", () => {
  it("writes one workflow command per step, then the summary", () => {
    expect(renderGithub(failing)).toBe(
      [
        "::error file=docs/guide.md,line=12,title=Doc Detective::Returned exit code 1. Expected one of [0].",
        "::warning file=docs/guide.md,line=30,title=Doc Detective::Took 4100ms; the timeout is 3000ms.",
        "2 tests: 0 passed, 1 failed, 1 warning, 0 skipped",
      ].join("\n"),
    );
  });

  it("leaves file= off a step whose page Doc Detective did not name", () => {
    const unknown: TestRunResult = {
      ...failing,
      findings: [{ file: "", line: 3, result: "FAIL", description: "broke" }],
    };
    expect(renderGithub(unknown).split("\n")[0]).toBe("::error line=3,title=Doc Detective::broke");
  });

  it("escapes the file property and the message", () => {
    const odd: TestRunResult = {
      ...failing,
      findings: [{ file: "docs/a,b.md", line: 1, result: "FAIL", description: "100%\nbroken" }],
    };
    expect(renderGithub(odd).split("\n")[0]).toBe(
      "::error file=docs/a%2Cb.md,line=1,title=Doc Detective::100%25%0Abroken",
    );
  });

  it("omits line= for a step with no location", () => {
    const noLine: TestRunResult = {
      ...failing,
      findings: [{ file: "a.md", result: "FAIL", description: "x" }],
    };
    expect(renderGithub(noLine).split("\n")[0]).toBe("::error file=a.md,title=Doc Detective::x");
  });
});

describe("renderJson", () => {
  it("is Doc Detective's results object, verbatim", () => {
    const results = { runId: "r", summary: { tests: { pass: 1 } }, specs: [{ specId: "a.md" }] };
    expect(JSON.parse(renderJson({ ...passing, results }))).toEqual(results);
  });

  it("is null for a run that found no tests, as Doc Detective writes it", () => {
    expect(renderJson({ ...passing, results: null })).toBe("null");
  });
});
