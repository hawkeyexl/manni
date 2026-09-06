/**
 * Per-eval `weight` and its effect on a suite's pass rate.
 *
 * Weight changes how much an outcome moves the suite total; it never changes
 * the outcome itself. That split is the whole design: the binary per-eval
 * verdict is what SARIF, JUnit and the findings baseline consume, and a
 * weighted *score* leaking into it would change all three. So every test here
 * asserts the outcomes are untouched alongside the rate that moved.
 *
 * The denominator is the graded set — pass + fail + error — exactly as it was
 * before weights existed. `needs-review` and `skipped` stay out of both halves.
 *
 * Two freshness evals against fixed dates, so nothing needs a provider or a
 * subprocess.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";

const BODY = "\n# Install\n\nRun the installer.\n";

/**
 * One page, one suite, one passing and one failing deterministic eval.
 * `weights` names the weight to write on each config eval; omitting one leaves
 * the key off entirely, which is how the default-of-1 path gets exercised.
 */
function scaffold(weights: { passes?: number; fails?: number } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-weight-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "last-reviewed: 2020-01-01",
      "evals:",
      "  - use: always-passes",
      "  - use: always-fails",
      "---",
      BODY,
    ].join("\n"),
  );
  const weightLine = (n: number | undefined) =>
    n === undefined ? [] : [`      weight: ${String(n)}`];
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      "  defaults:",
      "    suite: reference",
      "  evals:",
      "    always-passes:",
      "      assertion: The page was reviewed within the last century.",
      "      grader: tool:freshness",
      "      options:",
      "        max-age-days: 100000",
      "      severity: error",
      ...weightLine(weights.passes),
      "    always-fails:",
      "      assertion: The page was reviewed in the last day.",
      "      grader: tool:freshness",
      "      options:",
      "        max-age-days: 1",
      "      severity: error",
      ...weightLine(weights.fails),
      "  suites:",
      "    reference:",
      "      target-pass-rate: 0.6",
      "      evals: [always-passes, always-fails]",
      "",
    ].join("\n"),
  );
  return root;
}

const run = (root: string) => runEvals({ cwd: root, generate: false });

describe("weighted suite scoring", () => {
  it("is inert when no eval declares a weight", async () => {
    const report = await run(scaffold());
    // One pass, one fail, both at the implicit weight of 1.
    expect(report.suites[0]?.passRate).toBeCloseTo(0.5, 10);
    expect(report.suites[0]?.meetsTarget).toBe(false);
  });

  it("counts a heavier failure for more", async () => {
    const report = await run(scaffold({ fails: 2 }));
    // 1 / (1 + 2) — the failure now costs twice what the pass earns.
    expect(report.suites[0]?.passRate).toBeCloseTo(1 / 3, 10);
    expect(report.suites[0]?.meetsTarget).toBe(false);
  });

  it("counts a heavier pass for more, and can carry a suite over its target", async () => {
    const report = await run(scaffold({ passes: 3 }));
    // 3 / (3 + 1) = 0.75, over the 0.6 target the unweighted 0.5 missed.
    expect(report.suites[0]?.passRate).toBeCloseTo(0.75, 10);
    expect(report.suites[0]?.meetsTarget).toBe(true);
  });

  it("accepts a fractional weight, for a secondary check", async () => {
    const report = await run(scaffold({ fails: 0.5 }));
    // 1 / 1.5 — a spec-literal check that reports without dominating.
    expect(report.suites[0]?.passRate).toBeCloseTo(2 / 3, 10);
    expect(report.suites[0]?.meetsTarget).toBe(true);
  });

  it("never changes an eval's own outcome", async () => {
    const heavy = await run(scaffold({ fails: 10 }));
    const light = await run(scaffold({ fails: 0.1 }));
    const outcomes = (r: Awaited<ReturnType<typeof run>>) =>
      Object.fromEntries(r.evalResults.map((e) => [e.evalName, e.outcome]));
    expect(outcomes(heavy)).toEqual({
      "always-passes": "pass",
      "always-fails": "fail",
    });
    // Identical outcomes at a 100x weight difference: only the rate moved.
    expect(outcomes(light)).toEqual(outcomes(heavy));
    expect(heavy.suites[0]?.passed).toBe(1);
    expect(heavy.suites[0]?.failed).toBe(1);
    expect(heavy.suites[0]?.total).toBe(2);
  });
});
