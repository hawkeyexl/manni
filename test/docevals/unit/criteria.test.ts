/**
 * Criteria — several evals scored as one unit.
 *
 * `claude plugin eval`'s unit is a *case*: one stimulus, several named graders,
 * one aggregate score. Ours is an *eval*: one assertion, one grader. A
 * criterion is the missing middle — "these three checks together are one
 * thing" — and it lives in `manni.config.yaml` rather than the page
 * vocabulary, because the vocabulary is docmeta's and this is our scoring
 * model, not a fact about a page.
 *
 * The rule that matters: a criterion contributes **one** weighted outcome to
 * its suite, and its members contribute none. Counting both would let a
 * three-eval criterion outvote three standalone evals purely by being written
 * as a group.
 *
 * Members keep their own results, so a report still says which one failed.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";

const BODY = "\n# Install\n\nRun the installer.\n";

interface Options {
  combine?: "all" | "any";
  weight?: number;
  /** Written into the suite; omit to leave the criterion unreferenced. */
  inSuite?: boolean;
}

/**
 * One page with three deterministic evals: `member-passes` and `member-fails`
 * form the criterion, `standalone-passes` sits beside it.
 */
function scaffold(opts: Options = {}): string {
  const { combine, weight, inSuite = true } = opts;
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-criteria-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "last-reviewed: 2020-01-01",
      "evals:",
      "  - use: member-passes",
      "  - use: member-fails",
      "  - use: standalone-passes",
      "---",
      BODY,
    ].join("\n"),
  );
  const freshness = (name: string, days: number) => [
    `    ${name}:`,
    "      assertion: A freshness check.",
    "      grader: tool:freshness",
    "      options:",
    `        max-age-days: ${String(days)}`,
    "      severity: error",
  ];
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
      ...freshness("member-passes", 100000),
      ...freshness("member-fails", 1),
      ...freshness("standalone-passes", 100000),
      "  criteria:",
      "    install-path-is-complete:",
      "      evals: [member-passes, member-fails]",
      ...(combine ? [`      combine: ${combine}`] : []),
      ...(weight === undefined ? [] : [`      weight: ${String(weight)}`]),
      "  suites:",
      "    reference:",
      "      target-pass-rate: 0.9",
      "      evals: [member-passes, member-fails, standalone-passes]",
      ...(inSuite ? ["      criteria: [install-path-is-complete]"] : []),
      "",
    ].join("\n"),
  );
  return root;
}

const run = (root: string, options: Record<string, unknown> = {}) =>
  runEvals({ cwd: root, generate: false, ...options });

describe("criteria", () => {
  it("without a criterion, three evals each count once", async () => {
    const report = await run(scaffold({ inSuite: false }));
    // 2 pass, 1 fail.
    expect(report.suites[0]?.passRate).toBeCloseTo(2 / 3, 10);
  });

  it("scores members as one unit, not three votes", async () => {
    const report = await run(scaffold());
    // The criterion fails (one member failed) and the standalone passes:
    // 1 of 2, not 2 of 3.
    expect(report.suites[0]?.passRate).toBeCloseTo(0.5, 10);
    expect(report.suites[0]?.criteria).toEqual({
      total: 1,
      passed: 0,
      failed: 1,
      suspended: 0,
    });
  });

  it("combine: any passes when one member passes", async () => {
    const report = await run(scaffold({ combine: "any" }));
    expect(report.suites[0]?.passRate).toBeCloseTo(1, 10);
    expect(report.suites[0]?.criteria?.passed).toBe(1);
  });

  it("carries its own weight into the rate", async () => {
    const report = await run(scaffold({ weight: 3 }));
    // Failing criterion at weight 3, passing standalone at 1.
    expect(report.suites[0]?.passRate).toBeCloseTo(0.25, 10);
  });

  it("keeps every member's own result in the report", async () => {
    const report = await run(scaffold());
    const byName = Object.fromEntries(
      report.evalResults.map((r) => [r.evalName, r.outcome]),
    );
    expect(byName).toEqual({
      "member-passes": "pass",
      "member-fails": "fail",
      "standalone-passes": "pass",
    });
  });

  it("still counts a member's own outcome when the criterion is suspended", async () => {
    // The trap: members are excluded from the standalone tally because a
    // criterion speaks for them. If a suspended criterion also contributes
    // nothing, a failing member moves the rate by *nothing* and the suite
    // silently reports a higher pass rate than it earned.
    const report = await run(scaffold(), {
      evalNames: ["member-fails", "standalone-passes"],
    });
    expect(report.suites[0]?.criteria?.suspended).toBe(1);
    // 0 of 2: the failing member still counts, alongside the passing
    // standalone. Before the fix this was 1/1 = 100%.
    expect(report.suites[0]?.passRate).toBeCloseTo(0.5, 10);
  });

  it("suspends a criterion whose members were not all run", async () => {
    // ADR 01018's rule, one level down: a filtered run measured part of the
    // criterion, so it reports the members and withholds the verdict rather
    // than calling a half-measured group passed.
    const report = await run(scaffold(), {
      evalNames: ["member-passes", "standalone-passes"],
    });
    expect(report.suites[0]?.criteria).toEqual({
      total: 1,
      passed: 0,
      failed: 0,
      suspended: 1,
    });
    // The *criterion* is out of the rate — but its graded members are not:
    // `member-passes` ran and counts on its own, so the rate is over the two
    // evals that actually happened. The run is partial anyway.
    expect(report.suites[0]?.passRate).toBeCloseTo(1, 10);
    expect(report.suites[0]?.partial).toBe(true);
  });
});
