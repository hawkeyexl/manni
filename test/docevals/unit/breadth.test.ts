import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { extractJson } from "@hawkeyexl/inference";
import {
  collectFailures,
  lastJsonBlob,
} from "../../../src/docevals/graders/tools/doc-detective.js";
import {
  cosineSimilarity,
  differentiationGrader,
  wordFrequencies,
} from "../../../src/docevals/graders/native/differentiation.js";
import { valeGrader } from "../../../src/docevals/graders/tools/vale.js";
import { renderMarkdown } from "../../../src/docevals/reporters/markdown.js";
import { renderGithub } from "../../../src/docevals/reporters/github.js";
import { runCalibrate, loadGoldenCases } from "../../../src/docevals/commands/calibrate.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";
import type { ExecFn, GraderTarget } from "../../../src/docevals/graders/types.js";
import type { EvalResult } from "../../../src/docevals/types.js";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });
  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
  it("recovers an embedded object", () => {
    expect(extractJson('Here you go: {"a": 1} hope that helps')).toEqual({ a: 1 });
  });
  it("throws when no JSON exists", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("doc-detective output parsing", () => {
  it("collects FAIL entries recursively", () => {
    const blob = {
      specs: [
        {
          tests: [
            {
              steps: [
                { stepId: "a", result: "PASS" },
                { stepId: "b", result: "FAIL", resultDescription: "link broken" },
              ],
            },
          ],
        },
      ],
    };
    const failures = collectFailures(blob);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ description: "b", detail: "link broken" });
  });

  it("finds the trailing JSON blob in mixed stdout", () => {
    const stdout = 'Running tests...\nDone.\n{"summary": {"passed": 3}}';
    expect(lastJsonBlob(stdout)).toEqual({ summary: { passed: 3 } });
  });
});

describe("differentiation", () => {
  it("cosine similarity behaves", () => {
    const a = wordFrequencies("the quick brown fox");
    expect(cosineSimilarity(a, a)).toBeCloseTo(1);
    expect(cosineSimilarity(a, wordFrequencies("completely unrelated words entirely"))).toBe(0);
  });

  function target(file: string, body: string, config = DIFF_CONFIG): GraderTarget {
    const content = `---\ntitle: x\neval-suite: s\n---\n${body}`;
    const page: PageFile = {
      file,
      absPath: `/fake/${file}`,
      content,
      body,
      frontmatter: extractFrontmatter(content, "markdown"),
    };
    const plan = resolvePage(page, config);
    return { plan, eval: plan.evals[0]! };
  }

  const DIFF_CONFIG = parseDocevalsConfig(
    [
      "version: 1",
      "evals:",
      "  distinct:",
      "    grader: tool:differentiation",
      "    options: { max-similarity: 0.9 }",
      "suites:",
      "  s: { evals: [distinct] }",
    ].join("\n"),
    "/fake/manni.config.yaml",
  );

  it("flags near-duplicate pages, passes distinct ones", async () => {
    const same =
      "The click action clicks an element on the page found by selector or display text.";
    const findings = await differentiationGrader.grade({
      targets: [
        target("docs/a.md", same),
        target("docs/b.md", same + " Extra word."),
        target(
          "docs/c.md",
          "Completely different content about configuring continuous integration pipelines for scheduled runs.",
        ),
      ],
      config: DIFF_CONFIG,
      root: "/fake",
      exec: () => {
        throw new Error("differentiation must not exec");
      },
    });
    const files = findings.map((f) => f.file).sort();
    expect(files).toEqual(["docs/a.md", "docs/b.md"]);
  });
});

describe("valeGrader", () => {
  it("parses vale JSON and applies the severity map", async () => {
    const config = parseDocevalsConfig(
      [
        "version: 1",
        "evals:",
        "  style:",
        "    grader: tool:vale",
        "    severity-map: { error: warning, suggestion: info }",
        "suites:",
        "  s: { evals: [style] }",
      ].join("\n"),
      "/fake/manni.config.yaml",
    );
    const content = "---\ntitle: x\neval-suite: s\n---\nBody.";
    const page: PageFile = {
      file: "docs/page.md",
      absPath: "/fake/docs/page.md",
      content,
      body: stripFrontmatterBlock(content),
      frontmatter: extractFrontmatter(content, "markdown"),
    };
    const plan = resolvePage(page, config);
    const valeOutput = JSON.stringify({
      "docs/page.md": [
        { Check: "Vale.Spelling", Message: "Did you mean 'docs'?", Line: 3, Span: [5, 8], Severity: "error" },
        { Check: "Style.Wordy", Message: "Too wordy", Line: 7, Severity: "suggestion" },
      ],
    });
    const exec: ExecFn = () =>
      Promise.resolve({ code: 1, stdout: valeOutput, stderr: "", timedOut: false });
    const findings = await valeGrader.grade({
      targets: [{ plan, eval: plan.evals[0]! }],
      config,
      root: "/fake",
      exec,
    });
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ ruleId: "Vale.Spelling", severity: "warning", line: 3 });
    expect(findings[1]).toMatchObject({ severity: "info" });
  });
});

describe("reporters", () => {
  const report: EngineReport = {
    pages: 1,
    evalResults: [
      {
        evalName: "fresh-enough",
        type: "regression",
        grader: "tool:freshness",
        file: "docs/a.md",
        outcome: "fail",
        findings: [
          {
            evalName: "fresh-enough",
            file: "docs/a.md",
            ruleId: "freshness/stale",
            message: "Page last reviewed 900 days ago (max 365)",
            severity: "error",
            line: 4,
          },
        ],
        durationMs: 1,
      } satisfies EvalResult,
    ],
    suites: [
      {
        suite: "reference",
        total: 1,
        passed: 0,
        failed: 1,
        needsReview: 0,
        skipped: 0,
        errored: 0,
        passRate: 0,
        targetPassRate: 1,
        meetsTarget: false,
      },
    ],
    usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 0 },
    generated: [],
    exitCode: 1,
    problems: [],
  };

  it("markdown includes the suite table and findings", () => {
    const md = renderMarkdown(report);
    expect(md).toContain("| reference | 0 | 1 | 0 | 0% | 100% | ❌ |");
    expect(md).toContain("**fresh-enough**");
    expect(md).toContain("error:4: Page last reviewed");
  });

  it("github emits workflow annotations with escaped properties", () => {
    const gh = renderGithub(report);
    expect(gh).toContain(
      "::error file=docs/a.md,line=4,title=manni docevals%3A fresh-enough::Page last reviewed 900 days ago (max 365)",
    );
    expect(gh).toContain("## manni docevals results");
  });
});

describe("calibrate", () => {
  it("loads golden cases and scores agreement with an injected judge", async () => {
    const cases = loadGoldenCases(resolve(ROOT, "test/docevals/fixtures/golden"));
    expect(cases.length).toBeGreaterThanOrEqual(4);

    // Scripted judge: passes everything → full agreement (all cases expect pass).
    const passJudge = async (targets: GraderTarget[]) =>
      targets.map(
        (t): EvalResult => ({
          evalName: t.eval.name,
          type: t.eval.type,
          grader: t.eval.grader,
          file: t.plan.page.file,
          outcome: "pass",
          consensus: {
            runs: [],
            votes: { pass: 3, fail: 0, partial: 0, error: 0 },
            verdict: "pass",
            agreement: 1,
            meanConfidence: 0.95,
            zone: "auto-pass",
          },
          durationMs: 1,
        }),
      );
    const report = await runCalibrate({
      cwd: ROOT,
      golden: "test/docevals/fixtures/golden",
      judge: passJudge,
    });
    expect(report.total).toBe(cases.length);
    expect(report.agreementRate).toBe(1);
    expect(report.meetsThreshold).toBe(true);
    expect(report.falsePositives).toBe(0);
  });

  it("flags disagreement and false positives with a failing judge", async () => {
    const failJudge = async (targets: GraderTarget[]) =>
      targets.map(
        (t): EvalResult => ({
          evalName: t.eval.name,
          type: t.eval.type,
          grader: t.eval.grader,
          file: t.plan.page.file,
          outcome: "fail",
          consensus: {
            runs: [],
            votes: { pass: 0, fail: 3, partial: 0, error: 0 },
            verdict: "fail",
            agreement: 1,
            meanConfidence: 0.9,
            zone: "auto-fail",
          },
          durationMs: 1,
        }),
      );
    const report = await runCalibrate({
      cwd: ROOT,
      golden: "test/docevals/fixtures/golden",
      judge: failJudge,
    });
    expect(report.agreementRate).toBe(0);
    expect(report.meetsThreshold).toBe(false);
    expect(report.fpAlert).toBe(true);
  });
});
