import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseDocevalsConfig } from "../helpers/config.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { commandGrader } from "../../../src/docevals/graders/command.js";
import { freshnessGrader } from "../../../src/docevals/graders/native/freshness.js";
import {
  countSyllables,
  extractProse,
  fleschKincaidGrade,
  readingLevelGrader,
} from "../../../src/docevals/graders/native/reading-level.js";
import { parseMarkdownlintOutput } from "../../../src/docevals/graders/tools/markdownlint.js";
import { docDetectiveGrader, lastJsonBlob } from "../../../src/docevals/graders/tools/doc-detective.js";
import type { ExecFn, ExecResult, GraderTarget } from "../../../src/docevals/graders/types.js";

const CONFIG = parseDocevalsConfig("version: 1\n", "/fake/manni.config.yaml");

function makeTarget(frontmatterYaml: string, body = "Body."): GraderTarget {
  const content = `---\n${frontmatterYaml}\n---\n${body}`;
  const page: PageFile = {
    file: "docs/page.md",
    absPath: "/fake/docs/page.md",
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
  const plan = resolvePage(page, CONFIG);
  if (plan.evals.length === 0) throw new Error("fixture resolved no evals");
  return { plan, eval: plan.evals[0]! };
}

function fakeExec(result: Partial<ExecResult>): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = [];
  const exec: ExecFn = (cmd) => {
    calls.push(cmd);
    return Promise.resolve({
      code: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      ...result,
    });
  };
  return { exec, calls };
}

describe("commandGrader", () => {
  const fm = [
    "evals:",
    "  - id: check",
    "    assertion: Something.",
    "    grader: command",
    '    command: ["node", "check.mjs", "{file}"]',
  ].join("\n");

  it("passes on exit 0 with no findings", async () => {
    const { exec, calls } = fakeExec({ code: 0 });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings).toEqual([]);
    expect(calls[0]).toEqual(["node", "check.mjs", "/fake/docs/page.md"]);
  });

  it("fails on nonzero exit with the output tail", async () => {
    const { exec } = fakeExec({ code: 1, stderr: "missing heading" });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/Exit code 1: missing heading/);
    expect(findings[0]?.severity).toBe("error");
  });

  it("honors successExitCodes", async () => {
    const target = makeTarget(
      fm.replace("grader: command", "grader: command\n    success-exit-codes: [0, 3]"),
    );
    const { exec } = fakeExec({ code: 3 });
    const findings = await commandGrader.grade({
      targets: [target],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings).toEqual([]);
  });

  it("reports spawn errors", async () => {
    const { exec } = fakeExec({ code: null, spawnError: "ENOENT" });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.message).toMatch(/Failed to run command "node": ENOENT/);
  });

  it("reports timeouts", async () => {
    const { exec } = fakeExec({ code: null, timedOut: true });
    const findings = await commandGrader.grade({
      targets: [makeTarget(fm)],
      config: CONFIG,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.message).toMatch(/timed out/);
  });
});

describe("freshnessGrader", () => {
  const exec = fakeExec({}).exec;
  const graderConfig = parseDocevalsConfig(
    [
      "version: 1",
      "evals:",
      "  fresh:",
      "    grader: tool:freshness",
      "    options: { max-age-days: 365 }",
      "    severity: warning",
      "suites:",
      "  s: { evals: [fresh] }",
    ].join("\n"),
    "/fake/manni.config.yaml",
  );

  function freshTarget(frontmatter: string): GraderTarget {
    const content = `---\n${frontmatter}\neval-suite: s\n---\nBody.`;
    const page: PageFile = {
      file: "docs/page.md",
      absPath: "/fake/docs/page.md",
      content,
      body: "Body.",
      frontmatter: extractFrontmatter(content, "markdown"),
    };
    const plan = resolvePage(page, graderConfig);
    return { plan, eval: plan.evals[0]! };
  }

  it("passes for a recent date", async () => {
    const recent = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const findings = await freshnessGrader.grade({
      targets: [freshTarget(`title: x\nlast-reviewed: ${recent}`)],
      config: graderConfig,
      root: "/fake",
      exec,
    });
    expect(findings).toEqual([]);
  });

  it("flags stale dates with the eval severity and a line number", async () => {
    const findings = await freshnessGrader.grade({
      targets: [freshTarget("title: x\nlast-reviewed: 2020-01-01")],
      config: graderConfig,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.ruleId).toBe("freshness/stale");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.line).toBe(3);
  });

  it("flags a missing field", async () => {
    const findings = await freshnessGrader.grade({
      targets: [freshTarget("title: x")],
      config: graderConfig,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.ruleId).toBe("freshness/missing");
  });

  it("flags unparseable dates", async () => {
    const findings = await freshnessGrader.grade({
      targets: [freshTarget("title: x\nlast-reviewed: whenever")],
      config: graderConfig,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.ruleId).toBe("freshness/invalid");
  });
});

describe("reading level", () => {
  it("counts syllables approximately", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("documentation")).toBeGreaterThanOrEqual(4);
  });

  it("strips code and markup from prose", () => {
    const prose = extractProse(
      "# Title\n\nSome text with `code` and a [link](https://x.test).\n\n```js\nconst x = 1;\n```\n",
    );
    expect(prose).not.toContain("const x");
    expect(prose).not.toContain("https://");
    expect(prose).toContain("link");
  });

  it("returns null for too-short prose", () => {
    expect(fleschKincaidGrade("Short.")).toBeNull();
  });

  it("scores simple prose lower than complex prose", () => {
    const simple = Array(10)
      .fill("The cat sat on the mat. The dog ran to the park. We like it here.")
      .join(" ");
    const complex = Array(10)
      .fill(
        "Notwithstanding organizational considerations, comprehensive implementation methodologies necessitate extraordinarily sophisticated administrative infrastructure.",
      )
      .join(" ");
    const simpleGrade = fleschKincaidGrade(simple)!;
    const complexGrade = fleschKincaidGrade(complex)!;
    expect(simpleGrade).toBeLessThan(6);
    expect(complexGrade).toBeGreaterThan(12);
  });

  it("grader flags pages above maxGrade", async () => {
    const graderConfig = parseDocevalsConfig(
      [
        "version: 1",
        "evals:",
        "  readable:",
        "    grader: tool:reading-level",
        "    options: { max-grade: 5 }",
        "    severity: warning",
        "suites:",
        "  s: { evals: [readable] }",
      ].join("\n"),
      "/fake/manni.config.yaml",
    );
    const body = Array(10)
      .fill(
        "Notwithstanding organizational considerations, comprehensive implementation methodologies necessitate extraordinarily sophisticated administrative infrastructure.",
      )
      .join(" ");
    const content = `---\ntitle: x\neval-suite: s\n---\n${body}`;
    const page: PageFile = {
      file: "docs/page.md",
      absPath: "/fake/docs/page.md",
      content,
      body,
      frontmatter: extractFrontmatter(content, "markdown"),
    };
    const plan = resolvePage(page, graderConfig);
    const findings = await readingLevelGrader.grade({
      targets: [{ plan, eval: plan.evals[0]! }],
      config: graderConfig,
      root: "/fake",
      exec: fakeExec({}).exec,
    });
    expect(findings[0]?.ruleId).toBe("reading-level/grade");
  });
});

describe("docDetectiveGrader", () => {
  const ddConfig = parseDocevalsConfig(
    [
      "version: 1",
      "evals:",
      "  commands-work:",
      "    assertion: Documented commands run.",
      "    grader: tool:doc-detective",
      "    severity: error",
      "suites:",
      "  s: { evals: [commands-work] }",
    ].join("\n"),
    "/fake/manni.config.yaml",
  );

  function ddTarget(optionsYaml = ""): GraderTarget {
    const overrides = optionsYaml ? `\n${optionsYaml}` : "";
    const content = `---\ntitle: x\neval-suite: s${overrides}\n---\nBody.`;
    const page: PageFile = {
      file: "docs/page.md",
      absPath: "/fake/docs/page.md",
      content,
      body: "Body.",
      frontmatter: extractFrontmatter(content, "markdown"),
    };
    const plan = resolvePage(page, ddConfig);
    return { plan, eval: plan.evals[0]! };
  }

  // Doc Detective 4.x runs tests as its *default* command and rejects a `run`
  // subcommand with "Unknown argument: run" — so a stale default silently makes
  // every tool:doc-detective eval fail. Pin the argv.
  it("invokes doc-detective with no subcommand", async () => {
    const { exec, calls } = fakeExec({ code: 0, stdout: "[]" });
    await docDetectiveGrader.grade({
      targets: [ddTarget()],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    expect(calls[0]).toEqual([
      "npx",
      "--no-install",
      "doc-detective",
      "--input",
      "docs/page.md",
      "--exit-on-fail",
    ]);
  });

  it("honors an options.command override", async () => {
    const target = ddTarget(
      [
        "evals:",
        "  - id: commands-work",
        "    assertion: Documented commands run.",
        "    grader: tool:doc-detective",
        "    options:",
        '      command: ["doc-detective", "--config", ".doc-detective.json"]',
      ].join("\n"),
    );
    const { exec, calls } = fakeExec({ code: 0, stdout: "[]" });
    await docDetectiveGrader.grade({
      targets: [target],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    // --exit-on-fail survives the override: the grader cannot detect failures
    // without it, so it is not the user's to drop.
    expect(calls[0]).toEqual([
      "doc-detective",
      "--config",
      ".doc-detective.json",
      "--input",
      "docs/page.md",
      "--exit-on-fail",
    ]);
  });

  it("passes when no tests are present (empty results, exit 0)", async () => {
    const { exec } = fakeExec({ code: 0, stdout: "(WARNING) No tests detected.\n[]" });
    const findings = await docDetectiveGrader.grade({
      targets: [ddTarget()],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    expect(findings).toEqual([]);
  });

  it("reports one finding per failed step, not one per nesting level", async () => {
    const captured = readFileSync(
      new URL("../fixtures/tool-output/doc-detective-fail.json", import.meta.url),
      "utf8",
    );
    const { exec } = fakeExec({ code: 1, stdout: `running tests...\n${captured}` });
    const findings = await docDetectiveGrader.grade({
      targets: [ddTarget()],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("doc-detective/step");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toBe(
      "A step that fails on purpose.: Returned exit code 7. Expected one of [0]",
    );
  });

  // Regression for the silent-pass bug: this is what Doc Detective 4.x actually
  // produces on a failing step — no results JSON on stdout (it goes to a file),
  // a coloured human summary on stdout, and tens of KB of ajv schema warnings on
  // stderr. Before --exit-on-fail this exited 0 and the eval passed.
  it("reports a 4.x failure whose results JSON never reaches stdout", async () => {
    const stdout = [
      "\u001b[31mFailed: 1\u001b[0m",
      "",
      "\u001b[31mFailed Steps:\u001b[0m",
      "\u001b[31m1. windows/unknown - docs_page.md~b7ece155~sa4bacb43\u001b[0m",
      "   Error: Returned exit code 9. Expected one of [0]",
      "",
      "===============================",
      "",
      "See detailed results at /repo/.doc-detective/results/testResults-1.json",
    ].join("\n");
    const { exec } = fakeExec({
      code: 1,
      stdout,
      stderr: 'strict mode: missing type "object" for keyword "properties"\n'.repeat(50),
    });
    const findings = await docDetectiveGrader.grade({
      targets: [ddTarget()],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("doc-detective/step");
    // The message carries the step and its error, not the ajv noise.
    expect(findings[0]?.message).toContain("Returned exit code 9. Expected one of [0]");
    expect(findings[0]?.message).not.toContain("strict mode");
    // Colour codes are stripped; the literal bracketed value survives.
    expect(findings[0]?.message).not.toContain("\u001b[");
    expect(findings[0]?.message).toContain("[0]");
  });

  it("falls back to the exit code when output has no parseable failures", async () => {
    const { exec } = fakeExec({ code: 2, stdout: "", stderr: "Unknown argument: run" });
    const findings = await docDetectiveGrader.grade({
      targets: [ddTarget()],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/doc-detective exited 2: Unknown argument: run/);
  });

  it("reports spawn errors", async () => {
    const { exec } = fakeExec({ code: null, spawnError: "ENOENT" });
    const findings = await docDetectiveGrader.grade({
      targets: [ddTarget()],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    expect(findings[0]?.message).toMatch(/Failed to run doc-detective: ENOENT/);
  });

  // A timeout leaves code null; without its own branch that renders as the
  // meaningless "doc-detective exited null". Doc Detective can drive a browser,
  // so this is a realistic outcome, not a theoretical one.
  it("reports timeouts distinctly from a nonzero exit", async () => {
    const { exec } = fakeExec({ code: null, timedOut: true, stderr: "partial output" });
    const findings = await docDetectiveGrader.grade({
      targets: [ddTarget()],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/doc-detective timed out after \d+ms/);
    expect(findings[0]?.message).not.toContain("exited null");
  });

  it("truncates a long failure report on a line boundary", async () => {
    const stdout = [
      "Failed Steps:",
      ...Array.from({ length: 40 }, (_, n) => `${n + 1}. step-${n}\n   Error: something went wrong here`),
      "===============================",
    ].join("\n");
    const { exec } = fakeExec({ code: 1, stdout });
    const findings = await docDetectiveGrader.grade({
      targets: [ddTarget()],
      config: ddConfig,
      root: "/fake",
      exec,
    });
    const message = findings[0]?.message ?? "";
    expect(message).toContain("… (truncated)");
    // Every retained line is whole — no entry cut mid-sentence.
    for (const line of message.split("\n")) {
      if (line === "… (truncated)") continue;
      expect(stdout.split("\n")).toContain(line);
    }
  });
});

describe("lastJsonBlob", () => {
  it("finds the results blob when trailing output contains a brace", () => {
    // Regression: anchoring on the single last `}` in the string means any
    // trailing `{...}` — a {runId} path segment, an error line — makes every
    // candidate over-run the JSON, so parsing fails and the blob is lost.
    const stdout = [
      "running tests...",
      '{"specs":[{"result":"FAIL"}]}',
      "See per-run results at /out/.doc-detective/runs/{runId}/testResults.json",
    ].join("\n");
    expect(lastJsonBlob(stdout)).toEqual({ specs: [{ result: "FAIL" }] });
  });

  it("returns undefined when there is no JSON at all", () => {
    expect(lastJsonBlob("no braces here")).toBeUndefined();
    expect(lastJsonBlob("an opening { but no close")).toBeUndefined();
  });
});

describe("parseMarkdownlintOutput", () => {
  it("parses line and column forms", () => {
    const out = [
      "docs/a.md:12:3 MD013/line-length Line length [Expected: 80; Actual: 120]",
      "docs\\b.md:9 MD041/first-line-heading First line in a file should be a top-level heading",
      "Summary: 2 error(s)",
    ].join("\n");
    const items = parseMarkdownlintOutput(out);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      file: "docs/a.md",
      line: 12,
      col: 3,
      ruleId: "MD013/line-length",
    });
    expect(items[1]).toMatchObject({ file: "docs/b.md", line: 9, col: undefined });
  });

  // markdownlint-cli2 0.23 prints a severity token between the position and
  // the rule id. The regex predates it and matched nothing, so every finding
  // was dropped and every markdownlint eval passed on a page full of issues
  // — invisible until the tool was actually installed (ADR 01023).
  it("parses the severity token cli2 0.23 prints", () => {
    const out = [
      "docs/a.md:6:81 error MD013/line-length Line length [Expected: 80; Actual: 98]",
      "docs/a.md:12:1 error MD060/table-column-style Table column style [Table pipe ...]",
    ].join(String.fromCharCode(10));
    const items = parseMarkdownlintOutput(out);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      file: "docs/a.md",
      line: 6,
      col: 81,
      ruleId: "MD013/line-length",
    });
    expect(items[0]?.message).toBe("Line length [Expected: 80; Actual: 98]");
    expect(items[1]?.ruleId).toBe("MD060/table-column-style");
  });
});
