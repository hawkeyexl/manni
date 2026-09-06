import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { makeTraceJudge } from "../../../src/tracevals/judge/trace-judge.js";
import { cacheKey } from "../../../src/tracevals/judge/cache.js";
import { renderTrace } from "../../../src/tracevals/judge/render.js";
import { makePlan, makeTrace } from "../helpers.js";

let tmpDir: string;
beforeAll(async () => {
  // .tmp/ is gitignored, so a fresh checkout won't have it yet.
  await mkdir(".tmp", { recursive: true });
  tmpDir = await mkdtemp(join(".tmp", "judge-"));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const plan = makePlan({ grader: "ai" });

const leakyTrace = makeTrace({
  events: [{ kind: "user", text: "Fix the crash in app.ts", raw: {}, index: 0 }],
  userMessages: ["Fix the crash in app.ts"],
});

describe("makeTraceJudge", () => {
  it("passes on a unanimous high-confidence ensemble", async () => {
    const judge = makeTraceJudge({
      provider: new MockProvider([mockVerdict("pass", 0.95)]),
      runs: 3,
      noCache: true,
    });
    const [result] = await judge([plan], () => "trace text");
    expect(result?.outcome).toBe("pass");
    expect(result?.consensus?.zone).toBe("auto-pass");
    expect(result?.consensus?.votes.pass).toBe(3);
  });

  it("fails on a unanimous high-confidence fail", async () => {
    const judge = makeTraceJudge({
      provider: new MockProvider([mockVerdict("fail", 0.9)]),
      runs: 3,
      noCache: true,
    });
    const [result] = await judge([plan], () => "trace text");
    expect(result?.outcome).toBe("fail");
  });

  it("routes split ensembles to needs-review", async () => {
    const judge = makeTraceJudge({
      provider: new MockProvider([
        mockVerdict("pass", 0.9),
        mockVerdict("fail", 0.9),
        mockVerdict("pass", 0.9),
      ]),
      runs: 3,
      noCache: true,
    });
    const [result] = await judge([plan], () => "trace text");
    expect(result?.outcome).toBe("needs-review");
  });

  it("counts errored runs against consensus — never a silent pass", async () => {
    const judge = makeTraceJudge({
      provider: new MockProvider([
        mockVerdict("pass", 0.95),
        { error: "boom" },
        { error: "boom" },
        mockVerdict("pass", 0.95),
        { error: "boom" },
        { error: "boom" },
      ]),
      runs: 3,
      noCache: true,
    });
    const [result] = await judge([plan], () => "trace text");
    expect(result?.outcome).toBe("needs-review");
    expect(result?.consensus?.votes.error).toBeGreaterThan(0);
  });

  it("retries once on an invalid verdict, then records an errored run", async () => {
    const judge = makeTraceJudge({
      provider: new MockProvider([
        { json: { not: "a verdict" } },
        mockVerdict("pass", 0.95),
      ]),
      runs: 1,
      noCache: true,
    });
    const [result] = await judge([plan], () => "trace text");
    expect(result?.outcome).toBe("pass");
  });

  it("replays cached ensembles instead of re-asking the provider", async () => {
    const cacheDir = join(tmpDir, "cache");
    const first = makeTraceJudge({
      provider: new MockProvider([mockVerdict("pass", 0.95)]),
      runs: 2,
      cacheDir,
    });
    await first([plan], () => "same trace");

    const second = makeTraceJudge({
      provider: new MockProvider([mockVerdict("fail", 0.95)]),
      runs: 2,
      cacheDir,
    });
    const [result] = await second([plan], () => "same trace");
    expect(result?.outcome).toBe("pass");
    expect(result?.consensus?.runs.every((r) => r.cached)).toBe(true);
  });

  it("skips evals once the cost budget is exhausted", async () => {
    const judge = makeTraceJudge({
      provider: new MockProvider([mockVerdict("pass", 0.95)]),
      runs: 1,
      noCache: true,
      maxCostUsd: 0,
    });
    const [result] = await judge([plan], () => "trace text");
    expect(result?.outcome).toBe("skipped");
    expect(result?.skipReason).toContain("budget");
  });

  // The batch's money bug (ADR 01018). A judge instance is called once per
  // trace, so a per-call budget is no budget at all: 50 traces would cost 50x
  // the configured cap and every run would look like it respected it.
  it("spends one budget across successive calls, not one per call", async () => {
    const priced = (match: "pass" | "fail") => ({
      ...mockVerdict(match, 0.95),
      // 1M input tokens at $1/MTok, so exactly one call exhausts a $1 budget.
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    });
    const judge = makeTraceJudge({
      provider: new MockProvider([priced("pass"), priced("pass")]),
      runs: 1,
      noCache: true,
      maxCostUsd: 1,
      pricing: { inputPerMTok: 1, outputPerMTok: 0 },
    });

    const [first] = await judge([plan], () => "trace one");
    expect(first?.outcome).toBe("pass");
    expect(first?.costUsd).toBeCloseTo(1, 5);

    // Second trace, same judge. The budget is already gone.
    const [second] = await judge([plan], () => "trace two");
    expect(second?.outcome).toBe("skipped");
    expect(second?.skipReason).toContain("budget");
    expect(second?.costUsd).toBe(0);
  });
});

describe("cacheKey", () => {
  it("misses when the prompt version changes", () => {
    const a = cacheKey("mock", "m", 3, 0, "trace", plan, 1);
    const b = cacheKey("mock", "m", 3, 0, "trace", plan, 2);
    expect(a).not.toBe(b);
  });

  it("misses when the trace or plan changes", () => {
    const base = cacheKey("mock", "m", 3, 0, "trace", plan);
    expect(cacheKey("mock", "m", 3, 0, "other", plan)).not.toBe(base);
    expect(
      cacheKey("mock", "m", 3, 0, "trace", makePlan({ assertion: "different" })),
    ).not.toBe(base);
  });

  // Redaction rewrites the digest, and the digest is a key component — so the
  // cache does the right thing for free: a redacted run gets its own slot and
  // can never replay a verdict formed on unredacted text, while a redaction
  // that matched nothing keeps the existing entry.
  it("separates a redacted digest from the unredacted one", () => {
    const raw = renderTrace(leakyTrace);
    const scrubbed = renderTrace(leakyTrace, { redact: ["Fix the crash"] });
    expect(cacheKey("mock", "m", 3, 0, raw, plan)).not.toBe(
      cacheKey("mock", "m", 3, 0, scrubbed, plan),
    );
  });

  it("keeps the same entry when a pattern matched nothing", () => {
    const raw = renderTrace(leakyTrace);
    const unchanged = renderTrace(leakyTrace, { redact: ["nothing-matches-me"] });
    expect(cacheKey("mock", "m", 3, 0, raw, plan)).toBe(
      cacheKey("mock", "m", 3, 0, unchanged, plan),
    );
  });

  describe("per-eval provider override", () => {
    it("judges through the provider the eval names", async () => {
      const named = new MockProvider([mockVerdict("fail", 0.95)]);
      const judge = makeTraceJudge({
        // The default would pass; the override must be what actually runs.
        provider: new MockProvider([mockVerdict("pass", 0.95)]),
        providerFor: () => ({ provider: named }),
        runs: 3,
        noCache: true,
      });
      const [result] = await judge(
        [makePlan({ grader: "ai", provider: "mock-secondary" })],
        () => "trace text",
      );
      expect(result?.outcome).toBe("fail");
      expect(named.requests.length).toBe(3);
    });

    it("errors rather than silently judging with the wrong model", async () => {
      const judge = makeTraceJudge({
        provider: new MockProvider([mockVerdict("pass", 0.95)]),
        providerFor: () => {
          throw new Error("no such provider");
        },
        runs: 3,
        noCache: true,
      });
      const [result] = await judge(
        [makePlan({ grader: "ai", provider: "typo" })],
        () => "trace text",
      );
      expect(result?.outcome).toBe("error");
      expect(result?.error).toContain("typo");
      expect(result?.consensus).toBeUndefined();
    });

    it("errors when the run cannot construct providers by name at all", async () => {
      const judge = makeTraceJudge({
        provider: new MockProvider([mockVerdict("pass", 0.95)]),
        runs: 3,
        noCache: true,
      });
      const [result] = await judge(
        [makePlan({ grader: "ai", provider: "claude-cli" })],
        () => "trace text",
      );
      expect(result?.outcome).toBe("error");
    });
  });
});
