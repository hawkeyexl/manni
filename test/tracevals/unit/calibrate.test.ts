/**
 * `manni tracevals calibrate` (ADR 01022).
 *
 * The load-bearing assertions: the three headline numbers are computed from a
 * real batch over the committed corpus, a label that matched nothing is loud
 * rather than silently absent, and — the claim the whole feature rests on — a
 * sweep re-scores cached verdicts and a second sweep asks the provider
 * nothing at all.
 */
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { runCalibrate } from "../../../src/tracevals/commands/calibrate.js";
import { makeTraceJudge } from "../../../src/tracevals/judge/trace-judge.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

const fixture = (rel: string) =>
  fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));

const traceA = fixture("traces/claude-session.jsonl");
const traceB = fixture("traces/claude-session-sidecar.jsonl");
const project = fixture("project");
const home = fixture("home");
const labels = fixture("project/tracevals/labels.yaml");

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(join(".tmp", "calibrate-"));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function calibrate(overrides: Record<string, unknown> = {}) {
  return runCalibrate({
    traces: [traceA, traceB],
    project,
    labels,
    provider: "mock",
    noCache: true,
    env: { MOOSE_TRACEVALS_HOME: home },
    ...overrides,
  });
}

describe("runCalibrate", () => {
  it("reports the three numbers the manual procedure asked people to count", async () => {
    const { report } = await calibrate();
    expect(report.counts.labels).toBe(10);
    // Labelled fail, judged pass. The expensive error.
    expect(report.counts.falsePass).toBe(1);
    // Labelled pass, judged fail. Erodes trust fastest.
    expect(report.counts.falseFail).toBe(1);
    // And the volume of deferrals across the whole corpus.
    expect(report.counts.reviewVolume).toBe(1);
  });

  it("keeps labels whose eval never armed out of the denominator", async () => {
    const { report } = await calibrate();
    expect(report.counts.skipped).toBe(2);
    expect(report.counts.scored).toBe(8);
    expect(report.counts.agree).toBe(5);
    expect(report.counts.agreement).toBeCloseTo(0.625);
    expect(report.unscored).toHaveLength(2);
    expect(report.unscored[0]?.skipReason).toMatch(/trigger not met/);
  });

  it("names which eval disagreed, not just how many", async () => {
    const { report } = await calibrate();
    const fp = report.disagreements.find((d) => d.kind === "false-pass");
    expect(fp?.artifactName).toBe("AGENTS.md");
    expect(fp?.evalName).toBe("eval-1");
    expect(fp?.expected).toBe("fail");
    expect(fp?.actual).toBe("pass");
    expect(fp?.note).toMatch(/four packages/);
    // The arithmetic behind the verdict travels with the disagreement.
    expect(fp?.consensus?.runs).toBe(3);

    const ff = report.disagreements.find((d) => d.kind === "false-fail");
    expect(ff?.evalName).toBe("forbidden-tool");
    // A deterministic grader disagreeing is still a calibration finding.
    expect(ff?.grader).toBe("tool-usage");

    const missed = report.disagreements.find((d) => d.kind === "missed-review");
    expect(missed?.evalName).toBe("eval-5");
  });

  it("measures without gating: disagreement alone is exit 0", async () => {
    const { report } = await calibrate();
    expect(report.counts.falsePass + report.counts.falseFail).toBeGreaterThan(0);
    expect(report.exitCode).toBe(0);
    expect(report.gates).toEqual([]);
  });

  it("gates only when a threshold is asked for", async () => {
    const { report } = await calibrate({ maxFalsePass: 0 });
    expect(report.exitCode).toBe(1);
    expect(report.gates).toEqual([
      { name: "falsePass", limit: 0, actual: 1, exceeded: true },
    ]);

    const generous = await calibrate({ maxFalsePass: 5, maxFalseFail: 5 });
    expect(generous.report.exitCode).toBe(0);
    expect(generous.report.gates.every((g) => !g.exceeded)).toBe(true);
  });

  it("refuses a label that matched no result rather than dropping it", async () => {
    const bad = join(tmpDir, "typo.yaml");
    await writeFile(
      bad,
      `version: 1
labels:
  - trace: ${JSON.stringify(traceA)}
    artifact: fix-bug
    eval: forbiden-tool
    expected: fail
`,
      "utf-8",
    );
    await expect(calibrate({ labels: bad })).rejects.toThrow(TracevalsError);
    await expect(calibrate({ labels: bad })).rejects.toThrow(/forbiden-tool/);
  });

  it("refuses a label naming a trace outside the corpus, before running", async () => {
    const bad = join(tmpDir, "off-corpus.yaml");
    await writeFile(
      bad,
      `version: 1
labels:
  - trace: nowhere.jsonl
    artifact: fix-bug
    eval: forbidden-tool
    expected: fail
`,
      "utf-8",
    );
    await expect(calibrate({ labels: bad })).rejects.toThrow(
      /not in the corpus/,
    );
  });

  /**
   * A calibration run's whole product is a measurement. When every label joins
   * to a `skipped` result — `--deterministic-only` over ai-graded labels, or a
   * budget exhausted on trace 1 — `scored` is 0, `agreement` is null, and each
   * `--max-*` threshold reads "0 of at most N, not exceeded". Exit 0 would
   * then certify a corpus nobody measured, which is the same silent green
   * `resolveBatchTraces` refuses for an empty selector.
   */
  describe("a measurement that measured nothing", () => {
    /** Every label names an `ai` eval, so `--deterministic-only` skips them all. */
    async function unscorable(): Promise<string> {
      const file = join(tmpDir, "all-skipped.yaml");
      await writeFile(
        file,
        `version: 1
labels:
  - trace: ${JSON.stringify(traceA)}
    artifact: AGENTS.md
    eval: eval-1
    expected: fail
  - trace: ${JSON.stringify(traceB)}
    artifact: AGENTS.md
    eval: eval-1
    expected: pass
`,
        "utf-8",
      );
      return file;
    }

    it("never exits 0, threshold or no threshold", async () => {
      const labelsFile = await unscorable();
      const { report } = await calibrate({
        labels: labelsFile,
        deterministicOnly: true,
      });
      expect(report.counts.labels).toBe(2);
      expect(report.counts.scored).toBe(0);
      expect(report.counts.agreement).toBeNull();
      expect(report.exitCode).toBe(1);
    });

    it("keeps the thresholds honest and says why the run is red", async () => {
      const labelsFile = await unscorable();
      const { report } = await calibrate({
        labels: labelsFile,
        deterministicOnly: true,
        maxFalsePass: 0,
      });
      // The gate itself did not trip — 0 false passes is 0 false passes. What
      // is wrong is the denominator behind it, and the report has to say so
      // rather than let a vacuous "not exceeded" stand in for a clean run.
      expect(report.gates).toEqual([
        { name: "falsePass", limit: 0, actual: 0, exceeded: false },
      ]);
      expect(report.exitCode).toBe(1);
      expect(
        report.warnings.some((w) => /no labelled eval produced evidence/.test(w)),
      ).toBe(true);
    });

    it("still exits 0 when at least one label was scored", async () => {
      const { report } = await calibrate();
      expect(report.counts.scored).toBeGreaterThan(0);
      expect(report.exitCode).toBe(0);
    });
  });

  /**
   * The corpus was judged in part. `calibrate` wraps `runBatch`, which shares
   * one budget across every trace (ADR 01018), so a budget that runs out on
   * trace 2 of 50 leaves the remaining labels `unscored`. Some labels still
   * scored, so the `scored === 0` floor above does not catch it — but the
   * number is computed over the corpus the run stopped measuring, which is the
   * same incompleteness that already makes a lost trace exit 1.
   */
  it("fails when the shared judge budget cut the corpus short", async () => {
    const priced = () => ({
      ...mockVerdict("pass", 0.95),
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    const { report } = await calibrate({
      judge: makeTraceJudge({
        provider: new MockProvider(Array.from({ length: 40 }, priced)),
        runs: 1,
        noCache: true,
        // Enough for exactly one judged eval at $1 apiece.
        maxCostUsd: 1,
        pricing: { inputPerMTok: 1, outputPerMTok: 0 },
      }),
    });
    // Deterministic labels still scored, so this is not the empty-denominator
    // case — the corpus was measured, just not all of it.
    expect(report.counts.scored).toBeGreaterThan(0);
    expect(report.exitCode).toBe(1);
    expect(report.warnings.some((w) => /never judged/.test(w))).toBe(true);
  });

  it("fails the run when a trace in the corpus could not be evaluated", async () => {
    const broken = join(tmpDir, "not-a-trace.jsonl");
    await writeFile(broken, "not a trace\n", "utf-8");
    const { report } = await calibrate({ traces: [traceA, traceB, broken] });
    // The measurement is incomplete, so the number is not trustworthy.
    expect(report.exitCode).toBe(1);
    expect(report.batch.summary.tracesErrored).toBe(1);
  });
});

describe("--sweep", () => {
  it("re-scores every axis from one run's verdicts", async () => {
    const { report } = await calibrate({ sweep: true });
    const sweep = report.sweep ?? [];
    expect(sweep[0]?.axis).toBe("baseline");
    expect(new Set(sweep.map((c) => c.axis))).toEqual(
      new Set(["baseline", "ensembleRuns", "zones.autoPass", "zones.autoFail"]),
    );
    // The baseline row of a sweep reports what the configured setting gives,
    // even though the corpus was judged at the grid's largest ensemble.
    expect(sweep[0]?.setting.ensembleRuns).toBe(3);
    expect(sweep[0]?.counts.falsePass).toBe(1);

    // Raising the auto-pass floor above the mock's confidence converts the
    // false pass into a deferral: the whole point of a sweep.
    const strict = sweep.find(
      (c) => c.axis === "zones.autoPass" && c.value === 0.95,
    );
    expect(strict?.counts.falsePass).toBe(0);
    // Relational, not a magic number: the claim is that a stricter floor moves
    // the false pass into the review band, so review volume must rise above
    // the baseline row. An absolute count here goes stale the moment the
    // fixture corpus grows another judged eval.
    expect(strict?.counts.reviewVolume).toBeGreaterThan(
      sweep[0]?.counts.reviewVolume ?? 0,
    );
    // Nothing was scored against an ensemble the cache could not supply.
    expect(sweep.every((c) => c.counts.insufficient === 0)).toBe(true);
  });

  it("shows the arithmetic of the setting it scored, not of the deeper run", async () => {
    // The corpus is judged at the grid's largest ensemble (5), but the
    // headline numbers are the configured 3. Reporting 5 runs of evidence
    // beside a 3-run verdict would not add up for anyone checking it.
    const { report } = await calibrate({ sweep: true });
    const fp = report.disagreements.find((d) => d.kind === "false-pass");
    expect(fp?.consensus?.runs).toBe(3);
  });

  // The claim the feature rests on. A sweep must not multiply inference by the
  // size of the grid, and a second sweep must cost nothing at all.
  it("asks the provider nothing on a second sweep", async () => {
    const cacheDir = join(tmpDir, "sweep-cache");
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const judgeFor = () =>
      makeTraceJudge({ provider, runs: 5, cacheDir, zones: { autoPass: 0.8, autoFail: 0.8 } });

    const first = await calibrate({
      sweep: true,
      noCache: false,
      judge: judgeFor(),
    });
    const afterFirst = provider.requests.length;
    expect(afterFirst).toBeGreaterThan(0);
    const cells = (first.report.sweep ?? []).length;
    expect(cells).toBeGreaterThan(10);
    // The grid's largest ensemble, judged once — not once per sweep cell.
    // Stated as an invariant rather than a count, so adding a judged eval to
    // the fixture cannot turn a passing claim into a failing number: calls
    // must be whole ensembles, and far fewer than one ensemble per cell.
    expect(afterFirst % 5).toBe(0);
    expect(afterFirst).toBeLessThan(cells * 5);

    // A fresh judge over the same cache directory: the replay has to come off
    // disk, not out of an in-process memo.
    const second = await calibrate({
      sweep: true,
      noCache: false,
      judge: judgeFor(),
    });
    expect(provider.requests.length).toBe(afterFirst);
    expect(second.report.counts).toEqual(first.report.counts);
  });
});
