/**
 * Batch runs (ADR 01018). Adherence is a rate across sessions, not one verdict,
 * so `run` takes many traces and reports per-artifact and per-eval rates.
 *
 * The load-bearing assertions here are the two that cost real money or real
 * evidence if they regress: the judge cost budget spans the whole batch, and a
 * trace that cannot be parsed degrades to one entry instead of losing the rest.
 */
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { runBatch, parseSince, resolveBatchTraces } from "../../../src/tracevals/commands/batch.js";
import { aggregate, type BatchOutcome } from "../../../src/tracevals/aggregate.js";
import { makeTraceJudge } from "../../../src/tracevals/judge/trace-judge.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

const fixture = (rel: string) =>
  fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url));

const traceA = fixture("traces/claude-session.jsonl");
const traceB = fixture("traces/claude-session-sidecar.jsonl");
const project = fixture("project");
const home = fixture("home");

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(join(".tmp", "batch-"));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function batch(overrides: Record<string, unknown> = {}) {
  return runBatch({
    traces: [traceA, traceB],
    project,
    deterministicOnly: true,
    env: { MOOSE_TRACEVALS_HOME: home },
    ...overrides,
  });
}

describe("parseSince", () => {
  it("accepts minutes, hours, days, and weeks", () => {
    expect(parseSince("30m")).toBe(30 * 60_000);
    expect(parseSince("24h")).toBe(24 * 60 * 60_000);
    expect(parseSince("7d")).toBe(7 * 24 * 60 * 60_000);
    expect(parseSince("2w")).toBe(14 * 24 * 60 * 60_000);
  });

  it("rejects anything else as an operational error", () => {
    for (const bad of ["", "7", "d", "-1d", "7y", "1.5.2d", "seven days"]) {
      expect(() => parseSince(bad)).toThrow(TracevalsError);
    }
  });
});

describe("runBatch", () => {
  it("evaluates every trace and reports one entry each, in the given order", async () => {
    const { report } = await batch();
    expect(report.traces).toHaveLength(2);
    expect(report.traces[0]?.file).toBe(traceA);
    expect(report.traces[1]?.file).toBe(traceB);
    expect(report.summary.traces).toBe(2);
  });

  it("aggregates per-eval rates across traces", async () => {
    const { report } = await batch();
    // The fixture skill declares a tool-usage eval the first trace violates.
    const forbidden = report.evals.find((e) => e.evalName === "forbidden-tool");
    expect(forbidden).toBeDefined();
    expect(forbidden?.failingTraces).toContain(traceA);
    // A rate, not a verdict: skipped results are excluded from the denominator
    // because a check that never armed is not evidence either way.
    expect(forbidden?.passRate).not.toBeNull();
    expect(forbidden?.counts.fail).toBeGreaterThan(0);

    const passing = report.evals.find((e) => e.evalName === "used-read");
    expect(passing?.counts.pass).toBeGreaterThan(0);
    expect(passing?.failingTraces).toEqual([]);
  });

  it("aggregates per-artifact rows too", async () => {
    const { report } = await batch();
    const skill = report.artifacts.find((a) => a.artifactName === "fix-bug");
    expect(skill).toBeDefined();
    expect(skill?.artifactType).toBe("skill");
    // Only the traces that actually resolved it. The `fix-bug` skill is
    // invoked in the first fixture trace and not the second, so a row claiming
    // two would be counting a session the artifact had no part in.
    expect(skill?.traces).toBe(1);

    // Project rules resolve for every session, so that row spans the batch.
    const rules = report.artifacts.find(
      (a) => a.artifactType === "project-rules",
    );
    expect(rules?.traces).toBe(2);

    // The artifact row is the sum of its eval rows.
    const evalRows = report.evals.filter((e) => e.artifactName === "fix-bug");
    const summed = evalRows.reduce((n, e) => n + e.total, 0);
    expect(skill?.total).toBe(summed);
  });

  it("orders aggregate rows deterministically", async () => {
    const first = await batch();
    const second = await batch();
    expect(second.report.evals.map((e) => e.key)).toEqual(
      first.report.evals.map((e) => e.key),
    );
    const keys = first.report.evals.map((e) => e.key);
    expect([...keys].sort()).toEqual(keys);
  });

  it("exits 1 when any trace fails, and 0 when none do", async () => {
    const { report } = await batch();
    expect(report.exitCode).toBe(1);
    expect(report.summary.tracesFailed).toBeGreaterThan(0);

    // The sidecar fixture alone passes (CI asserts exit 0 for it).
    const clean = await batch({ traces: [traceB] });
    expect(clean.report.exitCode).toBe(0);
    expect(clean.report.summary.tracesFailed).toBe(0);
  });

  it("degrades an unparseable trace to one entry and keeps going", async () => {
    const bad = join(tmpDir, "not-a-trace.jsonl");
    await writeFile(bad, "this is not JSONL at all\n", "utf-8");

    const { report } = await batch({ traces: [bad, traceA, traceB] });
    expect(report.traces).toHaveLength(3);
    const failed = report.traces.find((t) => t.file === bad);
    expect(failed?.error).toBeTruthy();
    expect(failed?.exitCode).toBe(1);
    expect(report.summary.tracesErrored).toBe(1);
    // The other two still produced verdicts — one bad file in a corpus of 50
    // must not cost the other 49.
    expect(report.evals.some((e) => e.evalName === "forbidden-tool")).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("refuses a selector that matched no traces rather than passing green", async () => {
    // A gate that silently passes because nothing matched is the false green
    // this tool exists to avoid, so it is operational (exit 2), not exit 0.
    await expect(
      runBatch({
        allProjects: true,
        project,
        deterministicOnly: true,
        env: { MOOSE_TRACEVALS_HOME: join(tmpDir, "empty-home") },
      }),
    ).rejects.toThrow(TracevalsError);
  });

  it("rejects mixing named traces with a discovery selector", async () => {
    await expect(batch({ limit: 1 })).rejects.toThrow(TracevalsError);
  });

  describe("the judge cost budget", () => {
    // The single most important thing in this phase. `maxCostUsd` was enforced
    // inside one judge instance per run; a batch that built a fresh judge per
    // trace would silently bill N times the configured cap.
    const priced = () => ({
      ...mockVerdict("pass", 0.95),
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });

    it("spans the whole batch, not each trace", async () => {
      const { report } = await runBatch({
        traces: [traceA, traceB],
        project,
        env: { MOOSE_TRACEVALS_HOME: home },
        judge: makeTraceJudge({
          provider: new MockProvider(Array.from({ length: 40 }, priced)),
          runs: 1,
          noCache: true,
          // Enough for exactly one judged eval at $1 apiece.
          maxCostUsd: 1,
          pricing: { inputPerMTok: 1, outputPerMTok: 0 },
        }),
      });

      const judged = report.traces.reduce((n, t) => n + t.costUsd, 0);
      expect(judged).toBeCloseTo(1, 5);

      // And the exhausted budget is *reported*, with the reason naming it —
      // never a silent pass and never a silent absence.
      const budgetSkips = report.evals.filter((e) =>
        e.skipReasons.some((r) => /budget/.test(r)),
      );
      expect(budgetSkips.length).toBeGreaterThan(0);
    });

    it("reuses one judge across traces", async () => {
      const calls: number[] = [];
      await runBatch({
        traces: [traceA, traceB],
        project,
        env: { MOOSE_TRACEVALS_HOME: home },
        judge: async (plans) => {
          calls.push(plans.length);
          return plans.map((p) => ({
            evalName: p.evalName,
            artifact: p.artifact.path,
            artifactName: p.artifact.name,
            grader: p.grader,
            implicit: p.implicit,
            outcome: "pass" as const,
            costUsd: 0,
            durationMs: 0,
          }));
        },
      });
      // Once per trace that had judged evals — one instance, many calls.
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  /**
   * ADR 01018 shares one judge — and one budget — across the corpus. When that
   * budget runs out on trace 4 of 50, the remaining traces are still reported,
   * but every `ai` eval in them is `skipped`. Nothing failed and nothing
   * errored, so a batch scored on those two counts alone exits 0 having
   * judged almost none of the corpus. That is the same silent-green failure
   * `resolveBatchTraces` already refuses for an empty selector.
   */
  describe("a batch cut short by its own budget", () => {
    const BUDGET_SKIP = "judge cost budget exhausted ($0.5)";

    const evalResult = (
      evalName: string,
      outcome: "pass" | "skipped",
      skipReason?: string,
    ) => ({
      evalName,
      artifact: "C:\proj\SKILL.md",
      artifactName: "fix-bug",
      artifactType: "skill" as const,
      grader: outcome === "skipped" ? "ai" : "tool-usage",
      implicit: false,
      outcome,
      ...(skipReason !== undefined ? { skipReason } : {}),
      durationMs: 1,
    });

    /** A trace that passed every eval it was allowed to run. */
    const outcome = (file: string, judged: boolean): BatchOutcome => ({
      file,
      report: {
        trace: { file, source: "claude-code", cwd: "C:\proj", turnCount: 2 },
        warnings: [],
        coverage: [],
        availability: {
          recorded: false,
          skills: { offered: 0, used: 0, unused: 0 },
          agents: { offered: 0, used: 0, unused: 0 },
          listed: false,
        },
        evalResults: [
          evalResult("used-read", "pass"),
          judged
            ? evalResult("adherence", "pass")
            : evalResult("adherence", "skipped", BUDGET_SKIP),
        ],
        summary: {
          total: 2,
          pass: judged ? 2 : 1,
          fail: 0,
          error: 0,
          needsReview: 0,
          skipped: judged ? 0 : 1,
          passRate: 1,
        },
        exitCode: 0,
        costUsd: judged ? 0.5 : 0,
        durationMs: 1,
      },
    });

    it("is never green: an unjudged corpus is not a clean one", () => {
      const report = aggregate(
        [outcome("a.jsonl", true), outcome("b.jsonl", false), outcome("c.jsonl", false)],
        { durationMs: 5 },
      );
      // No trace failed and none errored — the old exit-code inputs are both 0.
      expect(report.summary.tracesFailed).toBe(0);
      expect(report.summary.tracesErrored).toBe(0);
      expect(report.exitCode).toBe(1);
    });

    it("says how much of the corpus went unjudged, and on how many traces", () => {
      const report = aggregate(
        [outcome("a.jsonl", true), outcome("b.jsonl", false), outcome("c.jsonl", false)],
        { durationMs: 5 },
      );
      expect(report.budget?.skippedEvals).toBe(2);
      expect(report.budget?.traces).toBe(2);
      expect(report.budget?.reason).toBe(BUDGET_SKIP);
      // And in the warnings, which every reporter already renders.
      expect(report.warnings.some((w) => /budget/.test(w))).toBe(true);
    });

    it("leaves a batch that stayed inside its budget exactly as it was", () => {
      const report = aggregate([outcome("a.jsonl", true)], { durationMs: 5 });
      expect(report.budget).toBeUndefined();
      expect(report.exitCode).toBe(0);
      expect(report.warnings).toEqual([]);
    });

    it("does not mistake an ordinary skip for an exhausted budget", () => {
      const base = outcome("d.jsonl", false);
      if (!("report" in base)) throw new Error("unreachable");
      const plain: BatchOutcome = {
        file: "d.jsonl",
        report: {
          ...base.report,
          evalResults: [
            evalResult("used-read", "pass"),
            evalResult("adherence", "skipped", "trigger not met"),
          ],
        },
      };
      const report = aggregate([plain], { durationMs: 5 });
      expect(report.budget).toBeUndefined();
      expect(report.exitCode).toBe(0);
    });
  });

  describe("--history", () => {
    it("appends one entry per trace", async () => {
      const historyDir = await mkdtemp(join(".tmp", "batch-history-"));
      try {
        await batch({ history: true, configDir: historyDir });
        const { loadHistory } = await import("../../../src/tracevals/history.js");
        const entries = await loadHistory(
          join(historyDir, ".manni", "tracevals", "history.jsonl"),
        );
        expect(entries).toHaveLength(2);
        expect(entries.map((e) => e.traceFile).sort()).toEqual(
          [traceA, traceB].sort(),
        );
      } finally {
        await rm(historyDir, { recursive: true, force: true });
      }
    });
  });
});

/**
 * `--limit` is applied inside `discoverTraces`, before the `--since` filter,
 * which reads like "5 newest overall, then narrowed to 7d" rather than
 * "5 newest within 7d". Those are the same set, and this pins why.
 *
 * `discoverTraces` sorts newest-first and only then slices, and a recency
 * floor keeps exactly a *prefix* of that order — so intersecting the first N
 * with the prefix, or taking the first N of the prefix, both yield
 * `t1..t min(N,K)`. Limiting early is also the cheaper half: a store holding
 * thousands of sessions never materialises them to answer `--limit 5`.
 *
 * If either property ever changes — a different sort key, or a `--since` that
 * is not a pure recency floor — the sets diverge and this test is what says so.
 */
describe("--limit combined with --since", () => {
  let home: string;
  const DAY = 86_400_000;

  beforeAll(async () => {
    await mkdir(".tmp", { recursive: true });
    home = await mkdtemp(join(".tmp", "limit-since-"));
    const proj = join(home, ".claude", "projects", "C--work-demo");
    await mkdir(proj, { recursive: true });
    // Three inside a 7d window, two well outside it.
    for (const [i, days] of [1, 2, 3, 30, 60].entries()) {
      const file = join(proj, `s${i}.jsonl`);
      const record = {
        type: "user",
        sessionId: `s${i}`,
        cwd: "/w",
        message: { role: "user", content: "hi" },
      };
      await writeFile(file, JSON.stringify(record) + "\n", "utf-8");
      const at = new Date(Date.now() - days * DAY);
      await utimes(file, at, at);
    }
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const names = (paths: string[]) =>
    paths.map((p) => p.split(/[\\/]/).pop()).sort();

  it("a limit wider than the window yields every in-window trace, not fewer", async () => {
    const got = await resolveBatchTraces({
      allProjects: true,
      since: "7d",
      limit: 5,
      env: { MOOSE_TRACEVALS_HOME: home },
    });
    expect(names(got)).toEqual(["s0.jsonl", "s1.jsonl", "s2.jsonl"]);
  });

  it("a limit narrower than the window yields the newest of the window", async () => {
    const got = await resolveBatchTraces({
      allProjects: true,
      since: "7d",
      limit: 2,
      env: { MOOSE_TRACEVALS_HOME: home },
    });
    expect(names(got)).toEqual(["s0.jsonl", "s1.jsonl"]);
  });
});
