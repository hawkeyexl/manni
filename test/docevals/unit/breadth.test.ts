import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { extractJson } from "@hawkeyexl/inference";
import { renderMarkdown } from "../../../src/docevals/reporters/markdown.js";
import { renderGithub } from "../../../src/docevals/reporters/github.js";
import { runCalibrate, loadGoldenCases } from "../../../src/docevals/commands/calibrate.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";
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

describe("reporters", () => {
  const report: EngineReport = {
    pages: 1,
    evalResults: [
      {
        evalName: "no-todo-markers",
        type: "regression",
        grader: "tool:regex",
        file: "docs/a.md",
        outcome: "fail",
        findings: [
          {
            evalName: "no-todo-markers",
            file: "docs/a.md",
            ruleId: "regex/found",
            message: "Pattern /TODO/ found in body, expected absent",
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
    expect(md).toContain("**no-todo-markers**");
    expect(md).toContain("error:4: Pattern /TODO/ found");
  });

  it("github emits workflow annotations with escaped properties", () => {
    const gh = renderGithub(report);
    expect(gh).toContain(
      "::error file=docs/a.md,line=4,title=manni docevals%3A no-todo-markers::Pattern /TODO/ found in body, expected absent",
    );
    expect(gh).toContain("## manni docevals results");
  });
});

describe("calibrate", () => {
  it("loads golden cases and scores agreement with an injected judge", async () => {
    const cases = loadGoldenCases(resolve(ROOT, "test/docevals/fixtures/golden"));
    expect(cases.length).toBeGreaterThanOrEqual(4);

    // Scripted judge: passes everything → full agreement (all cases expect pass).
    const passJudge = (targets: GraderTarget[]) =>
      Promise.resolve(
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
        ),
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
    const failJudge = (targets: GraderTarget[]) =>
      Promise.resolve(
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
        ),
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
