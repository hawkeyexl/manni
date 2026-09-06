import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appendHistory,
  compareToLast,
  loadHistory,
} from "../../../src/tracevals/history.js";
import type { EvalResult, RunReport } from "../../../src/tracevals/types.js";

let tmpDir: string;
beforeAll(async () => {
  // .tmp/ is gitignored, so a fresh checkout won't have it yet.
  await mkdir(".tmp", { recursive: true });
  tmpDir = await mkdtemp(join(".tmp", "history-"));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function result(evalName: string, outcome: EvalResult["outcome"]): EvalResult {
  return {
    evalName,
    artifact: "C:\\p\\SKILL.md",
    artifactName: "fix-bug",
    artifactType: "skill",
    grader: "tool-usage",
    implicit: false,
    outcome,
    durationMs: 1,
  };
}

function report(results: EvalResult[]): RunReport {
  const summary = {
    total: results.length,
    pass: results.filter((r) => r.outcome === "pass").length,
    fail: results.filter((r) => r.outcome === "fail").length,
    error: results.filter((r) => r.outcome === "error").length,
    needsReview: results.filter((r) => r.outcome === "needs-review").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    passRate: 1,
  };
  return {
    trace: {
      file: "C:\\traces\\s.jsonl",
      source: "claude-code",
      sessionId: "abc",
      cwd: "C:\\p",
      turnCount: 1,
    },
    warnings: [],
    coverage: [],
    availability: {
      recorded: false,
      skills: { offered: 0, used: 0, unused: 0 },
      agents: { offered: 0, used: 0, unused: 0 },
      listed: false,
    },
    evalResults: results,
    summary,
    exitCode: summary.fail + summary.error > 0 ? 1 : 0,
    costUsd: 0,
    durationMs: 10,
  };
}

describe("history", () => {
  it("appends and loads entries round-trip", async () => {
    const file = join(tmpDir, "history.jsonl");
    await appendHistory(file, report([result("a", "pass")]));
    await appendHistory(file, report([result("a", "fail")]));
    const entries = await loadHistory(file);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.sessionId).toBe("abc");
    expect(entries[1]?.evals[0]?.outcome).toBe("fail");
  });

  it("returns an empty list for a missing file", async () => {
    expect(await loadHistory(join(tmpDir, "nope.jsonl"))).toEqual([]);
  });

  it("detects regressions, improvements, added, and removed evals", async () => {
    const file = join(tmpDir, "compare.jsonl");
    await appendHistory(
      file,
      report([result("stays", "pass"), result("regresses", "pass"), result("improves", "fail"), result("removed", "pass")]),
    );
    const next = report([
      result("stays", "pass"),
      result("regresses", "fail"),
      result("improves", "pass"),
      result("added", "pass"),
    ]);
    const comparison = compareToLast(await loadHistory(file), next);
    expect(comparison?.regressions).toEqual([
      expect.objectContaining({ evalName: "regresses" }),
    ]);
    expect(comparison?.improvements).toEqual([
      expect.objectContaining({ evalName: "improves" }),
    ]);
    expect(comparison?.added).toEqual(["added"]);
    expect(comparison?.removed).toEqual(["removed"]);
  });

  it("returns null when no prior entry matches the trace", async () => {
    expect(compareToLast([], report([result("a", "pass")]))).toBeNull();
  });
});
