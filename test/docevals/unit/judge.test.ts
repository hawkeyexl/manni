import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeConsensus, zoneFor } from "@hawkeyexl/inference";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { recordReview } from "../../../src/docevals/core/reviews.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import type { JudgeRun } from "../../../src/docevals/types.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

const ZONES = { autoPass: 0.8, autoFail: 0.8 };

function run(match: "pass" | "fail" | "partial", confidence: number): JudgeRun {
  return {
    verdict: {
      claim: "c",
      observed: "o",
      match,
      confidence,
      reasoning: "r",
    },
    provider: "mock",
    model: "m",
    cached: false,
    durationMs: 1,
  };
}

function errorRun(): JudgeRun {
  return { error: "boom", provider: "mock", model: "m", cached: false, durationMs: 1 };
}

describe("consensus + zones matrix", () => {
  it("unanimous confident pass → auto-pass", () => {
    const c = computeConsensus([run("pass", 0.95), run("pass", 0.9), run("pass", 0.92)]);
    expect(c.verdict).toBe("pass");
    expect(c.agreement).toBe(1);
    expect(zoneFor(c, ZONES)).toBe("auto-pass");
  });

  it("unanimous confident fail → auto-fail", () => {
    const c = computeConsensus([run("fail", 0.9), run("fail", 0.95), run("fail", 0.88)]);
    expect(c.verdict).toBe("fail");
    expect(zoneFor(c, ZONES)).toBe("auto-fail");
  });

  it("split votes → human-review", () => {
    const c = computeConsensus([run("pass", 0.95), run("fail", 0.95), run("pass", 0.95)]);
    expect(c.verdict).toBe("pass");
    expect(c.agreement).toBeCloseTo(2 / 3);
    expect(zoneFor(c, ZONES)).toBe("human-review");
  });

  it("unanimous but low confidence → human-review", () => {
    const c = computeConsensus([run("pass", 0.5), run("pass", 0.6), run("pass", 0.7)]);
    expect(zoneFor(c, ZONES)).toBe("human-review");
  });

  it("partial counts as fail for the binary verdict", () => {
    const c = computeConsensus([run("partial", 0.9), run("partial", 0.9), run("pass", 0.9)]);
    expect(c.verdict).toBe("fail");
    expect(c.votes.partial).toBe(2);
    expect(zoneFor(c, ZONES)).toBe("human-review");
  });

  it("an errored run blocks auto zones", () => {
    const c = computeConsensus([run("pass", 0.95), run("pass", 0.95), errorRun()]);
    expect(c.votes.error).toBe(1);
    expect(zoneFor(c, ZONES)).toBe("human-review");
  });

  it("all runs errored → fail verdict, human-review", () => {
    const c = computeConsensus([errorRun(), errorRun(), errorRun()]);
    expect(c.verdict).toBe("fail");
    expect(c.meanConfidence).toBe(0);
    expect(zoneFor(c, ZONES)).toBe("human-review");
  });

  it("a tie is not a pass", () => {
    const c = computeConsensus([run("pass", 0.9), run("fail", 0.9)]);
    expect(c.verdict).toBe("fail");
  });
});

// --- judge stage ---

function makeTarget(body: string, name = "claim-check"): GraderTarget {
  const content = [
    "---",
    "title: x",
    "evals:",
    `  - id: ${name}`,
    "    assertion: The page satisfies the claim.",
    "    examples: { pass: yes, fail: no }",
    "---",
    body,
  ].join("\n");
  const page: PageFile = {
    file: "docs/page.md",
    absPath: "/fake/docs/page.md",
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
  const config = parseDocevalsConfig("version: 1\n", "/fake/manni.config.yaml");
  const plan = resolvePage(page, config);
  return { plan, eval: plan.evals[0]! };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "manni-docevals-judge-"));
}

describe("makeJudge", () => {
  const config = parseDocevalsConfig("version: 1\n", "/fake/manni.config.yaml");

  it("runs the ensemble and auto-passes unanimous confident verdicts", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge = makeJudge({ provider, root: tempRoot() });
    const results = await judge([makeTarget("Body.")], config, {});
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("pass");
    expect(results[0]?.consensus?.runs).toHaveLength(3);
    expect(results[0]?.consensus?.zone).toBe("auto-pass");
    expect(provider.requests).toHaveLength(3);
  });

  it("includes assertion, anchors, and body in the prompt", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge = makeJudge({ provider, root: tempRoot() });
    await judge([makeTarget("Distinctive body text.")], config, {});
    const req = provider.requests[0]!;
    expect(req.user).toContain("The page satisfies the claim.");
    expect(req.user).toContain("Distinctive body text.");
    expect(req.user).toContain("A passing page: yes");
    expect(req.temperature).toBe(0);
  });

  it("caches ensembles and replays them", async () => {
    const root = tempRoot();
    const provider1 = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge1 = makeJudge({ provider: provider1, root });
    await judge1([makeTarget("Same body.")], config, {});
    expect(provider1.requests).toHaveLength(3);

    const provider2 = new MockProvider([mockVerdict("fail", 0.95)]);
    const judge2 = makeJudge({ provider: provider2, root });
    const results = await judge2([makeTarget("Same body.")], config, {});
    // Cache hit: the second provider is never called, verdicts replay as pass.
    expect(provider2.requests).toHaveLength(0);
    expect(results[0]?.outcome).toBe("pass");
    expect(results[0]?.consensus?.runs.every((r) => r.cached)).toBe(true);
  });

  // An error is an infrastructure failure, not a verdict about the page. The
  // library's runEnsemble caches unconditionally, so without a guard here a
  // transient failure — VRAM exhaustion on a local model, a rate limit, a
  // dropped connection — is written to the cache and replayed forever. For a
  // committed cache that is fatal: the fixtures would encode an outage.
  it("does not cache an ensemble containing an errored run", async () => {
    const root = tempRoot();
    const provider1 = new MockProvider([
      { error: "A context size of 24 is too large for the available VRAM" },
    ]);
    const judge1 = makeJudge({ provider: provider1, root });
    const first = await judge1([makeTarget("Same body.")], config, {});
    expect(first[0]?.outcome).toBe("needs-review");
    // Not an exact count: the inference layer retries once when a response
    // fails validation, so an errored ensemble costs more calls than runs.
    expect(provider1.requests.length).toBeGreaterThanOrEqual(3);

    // The transient failure is over. A second run must re-ask, not replay.
    const provider2 = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge2 = makeJudge({ provider: provider2, root });
    const results = await judge2([makeTarget("Same body.")], config, {});
    expect(provider2.requests).toHaveLength(3);
    expect(results[0]?.outcome).toBe("pass");
  });

  it("still caches an ensemble where every run produced a verdict", async () => {
    const root = tempRoot();
    const provider1 = new MockProvider([mockVerdict("fail", 0.95)]);
    const judge1 = makeJudge({ provider: provider1, root });
    await judge1([makeTarget("Clean body.")], config, {});

    const provider2 = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge2 = makeJudge({ provider: provider2, root });
    const results = await judge2([makeTarget("Clean body.")], config, {});
    expect(provider2.requests).toHaveLength(0);
    expect(results[0]?.outcome).toBe("fail");
  });

  it("misses the cache when the body changes", async () => {
    const root = tempRoot();
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge = makeJudge({ provider, root });
    await judge([makeTarget("Version one.")], config, {});
    await judge([makeTarget("Version two.")], config, {});
    expect(provider.requests).toHaveLength(6);
  });

  it("bypasses the cache with noCache", async () => {
    const root = tempRoot();
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge = makeJudge({ provider, root });
    await judge([makeTarget("Body.")], config, { noCache: true });
    await judge([makeTarget("Body.")], config, { noCache: true });
    expect(provider.requests).toHaveLength(6);
  });

  it("retries invalid JSON once, then records an errored run", async () => {
    const provider = new MockProvider([
      { json: { nonsense: true } },
      { json: { nonsense: true } },
      mockVerdict("pass", 0.95),
      mockVerdict("pass", 0.95),
    ]);
    const judge = makeJudge({ provider, root: tempRoot() });
    const results = await judge([makeTarget("Body.")], config, {});
    // `?.` then `!` says "this may be undefined, and it isn't" in one
    // expression. Assert it instead, so a missing result fails here with a
    // readable message rather than a property access on undefined.
    const consensus = results[0]?.consensus;
    expect(consensus, "judge returned a consensus").toBeDefined();
    if (!consensus) return;
    expect(consensus.votes.error).toBe(1);
    expect(consensus.votes.pass).toBe(2);
    // Errored run blocks auto-pass.
    expect(results[0]?.outcome).toBe("needs-review");
    // 2 attempts for the first run + 1 each for the remaining two.
    expect(provider.requests).toHaveLength(4);
  });

  it("applies a persisted human review to needs-review outcomes", async () => {
    const root = tempRoot();
    const target = makeTarget("Reviewed body.");
    recordReview(root, {
      file: target.plan.page.file,
      evalName: target.eval.name,
      contentHash: (await import("../../../src/docevals/judge/cache.js")).sha256(
        target.plan.page.body,
      ),
      verdict: "pass",
    });
    // Split votes → needs-review → resolved by the review.
    const provider = new MockProvider([
      mockVerdict("pass", 0.95),
      mockVerdict("fail", 0.95),
      mockVerdict("pass", 0.95),
    ]);
    const judge = makeJudge({ provider, root });
    const results = await judge([target], config, {});
    expect(results[0]?.outcome).toBe("pass");
    expect(results[0]?.via).toBe("human-review");
  });

  it("ignores stale reviews (content hash mismatch)", async () => {
    const root = tempRoot();
    const target = makeTarget("Current body.");
    recordReview(root, {
      file: target.plan.page.file,
      evalName: target.eval.name,
      contentHash: "0".repeat(64),
      verdict: "pass",
    });
    const provider = new MockProvider([
      mockVerdict("pass", 0.95),
      mockVerdict("fail", 0.95),
      mockVerdict("pass", 0.95),
    ]);
    const judge = makeJudge({ provider, root });
    const results = await judge([target], config, {});
    expect(results[0]?.outcome).toBe("needs-review");
    expect(results[0]?.via).toBeUndefined();
  });

  it("honors the runs override", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge = makeJudge({ provider, root: tempRoot() });
    const results = await judge([makeTarget("Body.")], config, { runs: 5 });
    expect(results[0]?.consensus?.runs).toHaveLength(5);
  });
});
