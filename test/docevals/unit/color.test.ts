/**
 * Colour is the caller's decision, never the reporter's. The CLI decides it
 * once per stream (`shouldColor`, from `src/shared/color.ts`) and passes it
 * down, so a reporter never reads the environment and a pipe in CI stays
 * plain text.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, REPORT_FORMATS } from "../../../src/docevals/reporters/index.js";
import { renderPretty } from "../../../src/docevals/reporters/pretty.js";
import { renderList, runList } from "../../../src/docevals/commands/list.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";
import {
  renderCalibration,
  type CalibrationReport,
} from "../../../src/docevals/commands/calibrate.js";
import { renderFill, type FillReport } from "../../../src/docevals/commands/fill.js";
import { renderReviews } from "../../../src/docevals/commands/review.js";
import type { ReviewEntry } from "../../../src/docevals/core/reviews.js";

const PAGES = resolve(import.meta.dirname, "../fixtures/pages");
const ESC = "\u001b[";

const REPORT: EngineReport = {
  pages: 1,
  evalResults: [
    {
      evalName: "no-todo-markers",
      suite: "reference",
      type: "regression",
      grader: "tool:regex",
      file: "docs/goTo.mdx",
      outcome: "fail",
      findings: [
        {
          evalName: "no-todo-markers",
          file: "docs/goTo.mdx",
          ruleId: "regex/found",
          message: "Pattern /TBD/ found in body, expected absent",
          severity: "error",
          line: 14,
        },
      ],
      durationMs: 1,
    },
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
  problems: [],
  exitCode: 1,
};

describe("docevals colour is passed in, not detected", () => {
  it("renderPretty emits no escapes with colour off", () => {
    expect(renderPretty(REPORT, { color: false })).not.toContain(ESC);
  });

  it("renderPretty emits escapes with colour on", () => {
    expect(renderPretty(REPORT, { color: true })).toContain(ESC);
  });

  it("render defaults to no colour for a library caller", () => {
    expect(render(REPORT, "pretty")).not.toContain(ESC);
  });

  it("keeps every other format colour-free even with colour on", () => {
    for (const format of REPORT_FORMATS.filter((f) => f !== "pretty")) {
      expect(render(REPORT, format, { color: true }), format).not.toContain(ESC);
    }
  });

  it("renderList follows the colour it is given", async () => {
    const run = await runList(["docs/actions/goTo.mdx"], { cwd: PAGES });
    expect(renderList(run, "pretty", { color: false })).not.toContain(ESC);
    expect(renderList(run, "pretty", { color: true })).toContain(ESC);
    expect(renderList(run, "json", { color: true })).not.toContain(ESC);
  });

  it("renderCalibration follows the colour it is given", () => {
    const report: CalibrationReport = {
      cases: [
        {
          file: "docs/goTo.mdx",
          eval: "no-future-promises",
          expected: "pass",
          reviewed: true,
          judged: "pass",
          agrees: true,
        },
      ],
      total: 1,
      agreements: 1,
      agreementRate: 1,
      falsePositives: 0,
      falsePositiveRate: 0,
      falseNegatives: 0,
      meetsThreshold: true,
      expectedPass: 1,
      expectedFail: 0,
      balanced: false,
      fpAlert: false,
      unreviewed: 0,
      stale: 0,
      budgetSkipped: 0,
      unjudged: 0,
    };
    expect(renderCalibration(report, { color: false })).not.toContain(ESC);
    expect(renderCalibration(report, { color: true })).toContain(ESC);
  });

  it("renderFill follows the colour it is given", () => {
    const report: FillReport = {
      results: [
        {
          file: "docs/goTo.mdx",
          status: "nothing-proposed",
          written: [],
          belowThreshold: [],
          capped: [],
          duplicates: [],
          cached: false,
        },
      ],
      threshold: 0.7,
      turns: 1,
      exitCode: 0,
    };
    expect(renderFill(report, "pretty", { color: false })).not.toContain(ESC);
    expect(renderFill(report, "pretty", { color: true })).toContain(ESC);
  });

  it("renderReviews follows the colour it is given", () => {
    const reviews: ReviewEntry[] = [
      {
        file: "docs/goTo.mdx",
        evalName: "no-future-promises",
        contentHash: "0".repeat(64),
        verdict: "pass",
      },
    ];
    expect(renderReviews(reviews, { color: false })).not.toContain(ESC);
    expect(renderReviews(reviews, { color: true })).toContain(ESC);
  });
});
