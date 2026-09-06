/**
 * Four guards against a run reporting success while having checked nothing.
 *
 * Each of these was found by reviewing the `--since` / local-judge stack, and
 * each has the same shape: no exception, no red, just a green run whose
 * coverage quietly went to zero. They are collected here because the shape
 * matters more than the module — this is the failure mode the whole tool
 * exists to prevent, so the guards deserve to be readable together.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFilesSince } from "../../../src/docevals/core/since.js";
import { applyBaseline, fingerprint, type Baseline } from "../../../src/docevals/core/baseline.js";
import { VerdictCache } from "../../../src/docevals/judge/cache.js";
import { groupTargetsByEval, type GraderTarget } from "../../../src/docevals/graders/types.js";
import { DocevalsError, type EvalResult, type JudgeRun } from "../../../src/docevals/types.js";
import type { ExecFn } from "../../../src/docevals/graders/types.js";

/** An exec that fails the test if git is ever actually invoked. */
const neverRuns: ExecFn = (cmd) => {
  throw new Error(`git should not have been spawned: ${cmd.join(" ")}`);
};

describe("changedFilesSince rejects refs that would silently scope out the corpus", () => {
  // Git reads an omitted left side of `A...B` as HEAD, so `--since ""` diffs
  // HEAD against HEAD: exit 0, empty diff, every eval scoped away, exit 0.
  // The blank arrives by accident — `--since "${{ github.base_ref }}"` renders
  // empty on a push event.
  it("refuses a blank ref before spawning git", async () => {
    await expect(changedFilesSince("", "/repo", neverRuns)).rejects.toThrow(DocevalsError);
    await expect(changedFilesSince("   ", "/repo", neverRuns)).rejects.toThrow(DocevalsError);
  });

  // `--output=x` sends the diff to a file and leaves stdout empty, which reads
  // as "nothing changed". `--` does not help: the left side of `A...B` is
  // parsed before any separator.
  it("refuses a ref that git would read as an option", async () => {
    await expect(changedFilesSince("--output=x", "/repo", neverRuns)).rejects.toThrow(
      /read by git as an option/,
    );
  });
});

describe("a baseline never forgives the absence of a verdict", () => {
  function result(findings: EvalResult["findings"]): EvalResult {
    return {
      evalName: "lint",
      type: "regression",
      grader: "tool:markdownlint",
      file: "docs/a.md",
      outcome: "fail",
      findings,
      durationMs: 1,
    };
  }

  // ADR 01022: a diagnostic finding means the grader reached no verdict, and
  // that fails the eval at any severity. applyBaseline recomputes the outcome
  // when it suppresses some but not all findings — and recomputing on severity
  // alone turned "the grader could not run" into `pass`, which is the one thing
  // a baseline must not do. It suppresses known findings, never a missing
  // verdict.
  it("keeps an eval failing when only a diagnostic finding survives", () => {
    const diagnostic = {
      evalName: "lint",
      file: "docs/a.md",
      ruleId: "markdownlint/unreadable",
      message: "could not parse tool output",
      severity: "warning" as const,
      diagnostic: true,
    };
    const real = {
      evalName: "lint",
      file: "docs/a.md",
      ruleId: "MD040",
      message: "fenced code language",
      severity: "error" as const,
    };
    const baseline: Baseline = { version: 1, generatedWith: "test", entries: {} };
    const applied = applyBaseline([result([diagnostic, real])], baseline, { base: process.cwd() });
    // The error finding is not baselined here, so nothing is suppressed and the
    // outcome is untouched. The interesting case is the next one.
    expect(applied.results[0]?.outcome).toBe("fail");
  });

  it("does not turn a suppressed-error + diagnostic result into a pass", () => {
    const diagnostic = {
      evalName: "lint",
      file: "docs/a.md",
      ruleId: "markdownlint/unreadable",
      message: "could not parse tool output",
      severity: "warning" as const,
      diagnostic: true,
    };
    const real = {
      evalName: "lint",
      file: "docs/a.md",
      ruleId: "MD040",
      message: "fenced code language",
      severity: "error" as const,
    };
    const r = result([diagnostic, real]);
    // Baseline holds the error finding only, so `fresh` keeps the diagnostic
    // and the recompute fires.
    const baseline: Baseline = {
      version: 1,
      generatedWith: "test",
      entries: { "docs/a.md": [fingerprint(real)] },
    };
    const applied = applyBaseline([r], baseline, { base: process.cwd() });
    expect(applied.results[0]?.outcome).toBe("fail");
  });
});

describe("VerdictCache treats an unusable entry as a miss, not a verdict", () => {
  function root(): string {
    return mkdtempSync(join(tmpdir(), "manni-docevals-vc-"));
  }
  function verdictRun(): JudgeRun {
    return {
      verdict: { claim: "c", observed: "o", match: "pass", confidence: 0.95, reasoning: "r" },
      provider: "mock",
      model: "m",
      cached: false,
      durationMs: 1,
    };
  }

  // Guarding only the write cannot heal an entry this class did not write, and
  // those exist: the errored ensembles behind ADR 01038 were on disk before it
  // and had to be removed by hand. CI replays the committed cache with no
  // provider, so a poisoned entry there is a verdict no run can dislodge.
  it("declines to replay an entry containing an errored run", () => {
    const dir = root();
    try {
      // Write a poisoned entry through the *base* class, standing in for an
      // entry an older version — or a hand edit — left behind.
      const raw = new VerdictCache(dir, true, "test");
      Object.getPrototypeOf(Object.getPrototypeOf(raw)).set.call(raw, "k", [
        { error: "VRAM", provider: "mock", model: "m", cached: false, durationMs: 0 },
      ]);
      expect(new VerdictCache(dir, true, "test").get("k")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still replays an entry where every run produced a verdict", () => {
    const dir = root();
    try {
      const cache = new VerdictCache(dir, true, "test");
      cache.set("k", [verdictRun(), verdictRun(), verdictRun()]);
      expect(cache.get("k")).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("grader grouping keys on configuration, not on how it was typed", () => {
  function target(file: string, options: Record<string, unknown>): GraderTarget {
    return {
      plan: { page: { file } },
      eval: { name: "distinct", options, severity: "error" },
    } as unknown as GraderTarget;
  }

  // `resolve.ts` rebuilds `options` per page by spread, so insertion order
  // follows each page's own YAML. Splitting on order put a corpus grader's
  // targets in separate groups — and below two targets it returns no findings,
  // which the engine records as a pass. The check stops running and nothing says so.
  it("puts identically-configured targets in one group whatever the key order", () => {
    const groups = groupTargetsByEval([
      target("a.md", { scope: "docs/**", "max-similarity": 0.9 }),
      target("b.md", { "max-similarity": 0.9, scope: "docs/**" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("still separates targets whose configuration genuinely differs", () => {
    const groups = groupTargetsByEval([
      target("a.md", { "max-similarity": 0.9 }),
      target("b.md", { "max-similarity": 0.8 }),
    ]);
    expect(groups).toHaveLength(2);
  });
});
