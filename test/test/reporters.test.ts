/**
 * The three formats of `manni test run`. Shapes, not totals: each test builds
 * its result from the findings it asserts on.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TestRunResult } from "../../src/test/commands/run.js";
import { renderGithub } from "../../src/test/reporters/github.js";
import { renderJson } from "../../src/test/reporters/json.js";
import { renderPretty } from "../../src/test/reporters/pretty.js";
import { collectFindings, parseResults } from "../../src/test/core/results.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CWD = join("/", "repo");
const ADVICE = "Fix the step, fix the procedure it documents, or report a product regression.";
const RUNSHELL = {
  id: "Doc Detective",
  rule: "runShell",
  description: null,
  guide: "https://docs.doc-detective.com/docs/actions/runshell",
};

/** A recorded results file, with `__CWD__` filled in, read the way the core reads it. */
function results(fixture: string) {
  const text = readFileSync(join(FIXTURES, fixture), "utf8").replaceAll("__CWD__", CWD.replace(/\\/g, "/"));
  const parsed = parseResults(text);
  if (parsed === undefined || parsed === null) throw new Error(`${fixture} is not a results object`);
  return parsed;
}

const failing: TestRunResult = {
  results: { summary: {}, specs: [] },
  findings: [
    {
      file: "docs/guide.md",
      line: 12,
      result: "FAIL",
      description: "Returned exit code 1. Expected one of [0].",
      action: "runShell",
      guidance: RUNSHELL,
    },
    {
      file: "docs/guide.md",
      line: 30,
      result: "WARNING",
      description: "Took 4100ms; the timeout is 3000ms.",
      action: "runShell",
      guidance: RUNSHELL,
    },
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
  it("groups findings under their file, with line, result, advice and guidance, then the summary", () => {
    expect(renderPretty(failing, { color: false })).toBe(
      [
        "docs/guide.md",
        `  12  FAIL     Returned exit code 1. Expected one of [0]. ${ADVICE}`,
        "               Doc Detective runShell",
        "               Guide: https://docs.doc-detective.com/docs/actions/runshell",
        "  30  WARNING  Took 4100ms; the timeout is 3000ms.",
        "               Doc Detective runShell",
        "               Guide: https://docs.doc-detective.com/docs/actions/runshell",
        "",
        "2 tests: 0 passed, 1 failed, 1 warning, 0 skipped",
      ].join("\n"),
    );
  });

  it("prints the plan's layout for fail.md", () => {
    const run: TestRunResult = {
      ...failing,
      findings: collectFindings(results("results-fail.json"), CWD),
      tests: { pass: 1, fail: 1, warning: 0, skipped: 0 },
    };
    expect(renderPretty(run, { color: false }).split("\n").slice(0, 4)).toEqual([
      "docs/fail.md",
      `  4  FAIL     Returned exit code 1. Expected one of [0]. ${ADVICE}`,
      "              Doc Detective runShell",
      "              Guide: https://docs.doc-detective.com/docs/actions/runshell",
    ]);
  });

  it("heads the guidance with the step's own description when it has one", () => {
    const run: TestRunResult = {
      ...failing,
      findings: collectFindings(results("results-fail-described.json"), CWD),
    };
    expect(renderPretty(run, { color: false }).split("\n").slice(0, 4)).toEqual([
      "docs/settings.md",
      `  9  FAIL     Couldn't find element. ${ADVICE}`,
      "              Doc Detective click: The Settings button opens the settings page.",
      "              Guide: https://docs.doc-detective.com/docs/actions/click",
    ]);
  });

  it("treats an empty step description as none, so the head line ends in the action", () => {
    const text = readFileSync(join(FIXTURES, "results-fail-described.json"), "utf8")
      .replaceAll("__CWD__", CWD.replace(/\\/g, "/"))
      .replace('"The Settings button opens the settings page."', '""');
    const parsed = parseResults(text);
    if (parsed === undefined || parsed === null) throw new Error("not a results object");
    const findings = collectFindings(parsed, CWD);
    expect(findings[0]?.guidance?.description).toBeNull();
    const run: TestRunResult = { ...failing, findings };
    expect(renderPretty(run, { color: false }).split("\n")[2]).toBe("              Doc Detective click");
  });

  it("links a compound action to its lowercased page, as Doc Detective names them", () => {
    const text = readFileSync(join(FIXTURES, "results-fail-described.json"), "utf8")
      .replaceAll("__CWD__", CWD.replace(/\\/g, "/"))
      .replace('"click": "Settings"', '"dragAndDrop": { "source": "#a", "target": "#b" }');
    const parsed = parseResults(text);
    if (parsed === undefined || parsed === null) throw new Error("not a results object");
    const [finding] = collectFindings(parsed, CWD);
    expect(finding?.guidance?.rule).toBe("dragAndDrop");
    expect(finding?.guidance?.guide).toBe("https://docs.doc-detective.com/docs/actions/draganddrop");
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
    expect(renderPretty(noLine, { color: false }).split("\n")[1]).toBe(`    FAIL     x. ${ADVICE}`);
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
  it("writes one workflow command per step, with advice and guidance, then the summary", () => {
    const guidance =
      "%0ADoc Detective runShell%0AGuide: https://docs.doc-detective.com/docs/actions/runshell";
    expect(renderGithub(failing)).toBe(
      [
        `::error file=docs/guide.md,line=12,title=Doc Detective::Returned exit code 1. Expected one of [0]. ${ADVICE}${guidance}`,
        `::warning file=docs/guide.md,line=30,title=Doc Detective::Took 4100ms; the timeout is 3000ms.${guidance}`,
        "2 tests: 0 passed, 1 failed, 1 warning, 0 skipped",
      ].join("\n"),
    );
  });

  it("prints the plan's annotation for fail.md", () => {
    const run: TestRunResult = {
      ...failing,
      findings: collectFindings(results("results-fail.json"), CWD),
    };
    expect(renderGithub(run).split("\n")[0]).toBe(
      `::error file=docs/fail.md,line=4,title=Doc Detective::Returned exit code 1. Expected one of [0]. ${ADVICE}` +
        "%0ADoc Detective runShell%0AGuide: https://docs.doc-detective.com/docs/actions/runshell",
    );
  });

  it("leaves file= off a step whose page Doc Detective did not name", () => {
    const unknown: TestRunResult = {
      ...failing,
      findings: [{ file: "", line: 3, result: "FAIL", description: "broke" }],
    };
    expect(renderGithub(unknown).split("\n")[0]).toBe(
      `::error line=3,title=Doc Detective::broke. ${ADVICE}`,
    );
  });

  it("escapes the file property and the message", () => {
    const odd: TestRunResult = {
      ...failing,
      findings: [{ file: "docs/a,b.md", line: 1, result: "FAIL", description: "100%\nbroken" }],
    };
    expect(renderGithub(odd).split("\n")[0]).toBe(
      `::error file=docs/a%2Cb.md,line=1,title=Doc Detective::100%25%0Abroken. ${ADVICE}`,
    );
  });

  it("omits line= for a step with no location", () => {
    const noLine: TestRunResult = {
      ...failing,
      findings: [{ file: "a.md", result: "FAIL", description: "x" }],
    };
    expect(renderGithub(noLine).split("\n")[0]).toBe(
      `::error file=a.md,title=Doc Detective::x. ${ADVICE}`,
    );
  });

  it("keeps a warning's text as Doc Detective wrote it, with no advice", () => {
    const run: TestRunResult = {
      ...failing,
      findings: collectFindings(results("results-warning.json"), CWD),
    };
    expect(renderGithub(run).split("\n")[0]).toBe(
      "::warning file=docs/warn.md,line=7,title=Doc Detective::Returned exit code 0. Command took longer than the 1000ms timeout." +
        "%0ADoc Detective runShell%0AGuide: https://docs.doc-detective.com/docs/actions/runshell",
    );
  });
});

describe("renderJson", () => {
  it("is Doc Detective's results object, verbatim", () => {
    const results = { runId: "r", summary: { tests: { pass: 1 } }, specs: [{ specId: "a.md" }] };
    expect(JSON.parse(renderJson({ ...passing, results }))).toEqual(results);
  });

  it("adds no guidance key to a failing run's object", () => {
    const recorded = results("results-fail.json");
    const text = renderJson({ ...failing, results: recorded, findings: collectFindings(recorded, CWD) });
    expect(JSON.parse(text)).toEqual(recorded);
    expect(text).not.toContain("guidance");
  });

  it("is null for a run that found no tests, as Doc Detective writes it", () => {
    expect(renderJson({ ...passing, results: null })).toBe("null");
  });
});

describe("collectFindings", () => {
  it("reports a URL input as Doc Detective names it, and a file relative to cwd", () => {
    const step = { result: "FAIL", resultDescription: "broke", location: { line: 2 } };
    const spec = (contentPath: string) => ({
      contentPath,
      tests: [{ contexts: [{ steps: [step] }] }],
    });
    const cwd = join("/", "repo");
    const files = collectFindings(
      { summary: {}, specs: [spec("https://example.com/guide.md"), spec(join(cwd, "docs", "a.md"))] },
      cwd,
    ).map((f) => f.file);
    expect(files).toEqual(["https://example.com/guide.md", "docs/a.md"]);
  });

  it("names the step's action and links its guide", () => {
    expect(collectFindings(results("results-fail.json"), CWD)).toEqual([
      {
        file: "docs/fail.md",
        line: 4,
        result: "FAIL",
        description: "Returned exit code 1. Expected one of [0]",
        action: "runShell",
        guidance: RUNSHELL,
      },
    ]);
  });

  it("carries the step's own description as the guidance description", () => {
    const [finding] = collectFindings(results("results-fail-described.json"), CWD);
    expect(finding?.action).toBe("click");
    expect(finding?.guidance).toEqual({
      id: "Doc Detective",
      rule: "click",
      description: "The Settings button opens the settings page.",
      guide: "https://docs.doc-detective.com/docs/actions/click",
    });
  });

  it("gives a step with no known action a guidance with no rule and no guide", () => {
    const step = { result: "FAIL", resultDescription: "broke", description: "Does a thing.", mystery: {} };
    const [finding] = collectFindings(
      { summary: {}, specs: [{ contentPath: join(CWD, "a.md"), tests: [{ contexts: [{ steps: [step] }] }] }] },
      CWD,
    );
    expect(finding?.action).toBeUndefined();
    expect(finding?.guidance).toEqual({
      id: "Doc Detective",
      rule: null,
      description: "Does a thing.",
      guide: null,
    });
  });

  it("reports one finding for a step that fails the same way in two contexts", () => {
    const findings = collectFindings(results("results-fail-two-contexts.json"), CWD);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: "docs/fail.md", line: 4, action: "runShell" });
  });
});
