import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeConsensus, zoneFor } from "@hawkeyexl/inference";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { PROMPT_VERSION, renderReaders } from "../../../src/docevals/judge/prompt.js";
import { cacheKey, judgeCacheBody } from "../../../src/docevals/judge/cache.js";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { contentHash, recordReview } from "../../../src/docevals/core/reviews.js";
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
  const config = parseDocevalsConfig("", "/fake/manni.config.yaml");
  const plan = resolvePage(page, config);
  const ev = plan.evals[0];
  if (ev === undefined) throw new Error("fixture resolved no evals");
  return { plan, eval: ev };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "manni-docevals-judge-"));
}

describe("makeJudge", () => {
  const config = parseDocevalsConfig("", "/fake/manni.config.yaml");

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
    const req = provider.requests[0];
    if (req === undefined) throw new Error("the provider received no request");
    expect(req.user).toContain("The page satisfies the claim.");
    expect(req.user).toContain("Distinctive body text.");
    expect(req.user).toContain("A passing page: yes");
    expect(req.temperature).toBe(0);
  });

  it("sends the verdict schema under its manni name, at prompt version 4", async () => {
    // The schema is part of what the model is sent, so renaming it is a prompt
    // change: PROMPT_VERSION moves with it, and no verdict cached against the
    // old name replays.
    expect(PROMPT_VERSION).toBe(4);
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    await makeJudge({ provider, root: tempRoot() })([makeTarget("Body.")], config, {});
    expect(provider.requests[0]?.schema).toMatchObject({
      $id: "manni:docevals:verdict",
      title: "manni docevals judge verdict",
    });
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

// --- readers (proposal 0111) ---

const THEO = {
  id: "theo",
  data: {
    type: "persona",
    id: "theo",
    title: "Theo, Doc Contributor",
    description: "Theo is a developer or technical writer who opened a PR.",
    audience: "contributors",
    goals: ["Fix the one failing field."],
    pains: ["Error messages are terse.", "He does not know which schema fired."],
    citations: [{ claim: "never rendered" }],
  },
};
const MAYA = { id: "maya", data: { title: "Maya, Documentation Engineer", description: "Maya owns the pipeline." } };

function withReaders(target: GraderTarget, records: { id: string; data: Record<string, unknown> }[]): GraderTarget {
  target.eval.readers = {
    personas: records.map((r) => r.id),
    section: renderReaders(records),
    files: records.map((r) => `/fake/${r.id}.md`),
  };
  return target;
}

describe("renderReaders", () => {
  it("renders the framing, then each reader's descriptive fields in a fixed order", () => {
    expect(renderReaders([THEO, MAYA])).toBe(
      [
        "# Readers",
        "",
        "This page is written for the readers below. Where the assertion speaks of a reader, it means each of them. It holds only when it holds for every one. The readers add no requirement the assertion does not state.",
        "",
        "## Theo, Doc Contributor",
        "",
        "Theo is a developer or technical writer who opened a PR.",
        "",
        "Goals:",
        "- Fix the one failing field.",
        "Pains:",
        "- Error messages are terse.",
        "- He does not know which schema fired.",
        "",
        "## Maya, Documentation Engineer",
        "",
        "Maya owns the pipeline.",
      ].join("\n"),
    );
  });

  it("renders every descriptive field, and nothing structural", () => {
    const section = renderReaders([
      {
        id: "pat",
        data: {
          type: "persona",
          id: "pat",
          audience: "a",
          journeys: ["j"],
          lifecycle: "active",
          name: "Pat",
          role: "Writer",
          "team-context": "Docs team.",
          proficiency: ["Markdown."],
          prerequisites: ["A repo."],
          goals: ["Ship."],
          pains: ["Drift."],
          "content-types": ["Guides."],
          extra: "dropped",
          description: { not: "a string" },
        },
      },
    ]);
    expect(section).toContain(
      "## pat\n\nName: Pat\nRole: Writer\nTeam context: Docs team.\nProficiency:\n- Markdown.\nPrerequisites:\n- A repo.\nGoals:\n- Ship.\nPains:\n- Drift.\nContent types:\n- Guides.",
    );
    for (const absent of ["active", "dropped", "audience", "journeys", "a string", "[object"]) {
      expect(section).not.toContain(absent);
    }
  });
});

describe("makeJudge with readers", () => {
  const config = parseDocevalsConfig("", "/fake/manni.config.yaml");

  it("puts the section between # Anchors and # Page content, and tags the result", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider, root: tempRoot() })([withReaders(makeTarget("Body."), [THEO])], config, {});
    const user = provider.requests[0]?.user ?? "";
    const anchors = user.indexOf("# Anchors");
    const readers = user.indexOf("# Readers");
    const content = user.indexOf("# Page content");
    expect(anchors).toBeGreaterThan(-1);
    expect(readers).toBeGreaterThan(anchors);
    expect(content).toBeGreaterThan(readers);
    expect(user).toContain("## Theo, Doc Contributor");
    expect(user).not.toContain("never rendered");
    expect(results[0]?.personas).toEqual(["theo"]);
  });

  it("sends a not-opted-in eval today's prompt, and gives its result no personas", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider, root: tempRoot() })([makeTarget("Body.")], config, {});
    expect(provider.requests[0]?.user).toBe(
      "# Assertion\nThe page satisfies the claim.\n\n# Anchors\nA passing page: yes\nA failing page: no\n\n# Page content\n\nBody.",
    );
    expect(results[0]).not.toHaveProperty("personas");
  });

  it("renders two readers in the page's order", async () => {
    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    await makeJudge({ provider, root: tempRoot() })([withReaders(makeTarget("Body."), [MAYA, THEO])], config, {});
    const user = provider.requests[0]?.user ?? "";
    expect(user.indexOf("## Maya")).toBeLessThan(user.indexOf("## Theo"));
  });

  it("keeps the evidence prompts of a split page reader-free", async () => {
    const provider = new MockProvider([
      { json: { supports: ["a"], contradicts: [] } },
      { json: { supports: ["b"], contradicts: [] } },
      mockVerdict("pass", 0.95),
    ]);
    const body = ["Line one is long enough.", "Line two is long enough."].join("\n");
    await makeJudge({ provider, root: tempRoot() })([withReaders(makeTarget(body), [THEO])], config, {
      chunkChars: 30,
      runs: 1,
    });
    const last = provider.requests.at(-1);
    const evidence = provider.requests.slice(0, -1);
    expect(evidence.length).toBeGreaterThan(1);
    expect(evidence.every((r) => !r.user.includes("# Readers"))).toBe(true);
    expect(last?.user).toContain("# Readers");
  });

  it("re-judges an opted-in eval when a persona field changes, and replays every other key", async () => {
    const root = tempRoot();
    const first = new MockProvider([mockVerdict("pass", 0.95)]);
    await makeJudge({ provider: first, root })(
      [withReaders(makeTarget("Body."), [THEO]), makeTarget("Body.", "other")],
      config,
      {},
    );
    const edited = { ...THEO, data: { ...THEO.data, pains: ["Error messages are terse."] } };
    const second = new MockProvider([mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider: second, root })(
      [withReaders(makeTarget("Body."), [edited]), makeTarget("Body.", "other")],
      config,
      {},
    );
    expect(results[0]?.consensus?.runs.every((r) => r.cached)).toBe(false);
    expect(results[1]?.consensus?.runs.every((r) => r.cached)).toBe(true);
  });

  it("keys a reader-bearing eval apart, and leaves the reader-free key as it was", () => {
    const t = makeTarget("Body.");
    const body = judgeCacheBody(config.judge.chunkChars, "Body.");
    const without = cacheKey("mock", "m", 3, 0, body, t.eval);
    expect(cacheKey("mock", "m", 3, 0, body, t.eval, undefined)).toBe(without);
    expect(cacheKey("mock", "m", 3, 0, body, t.eval, renderReaders([THEO]))).not.toBe(without);
  });

  it("still applies a human review after a persona edit, because a review keys on the page body", async () => {
    const root = tempRoot();
    const target = withReaders(makeTarget("Reviewed body."), [THEO]);
    recordReview(root, {
      file: target.plan.page.file,
      evalName: target.eval.name,
      contentHash: contentHash(target.plan.page.body),
      verdict: "pass",
    });
    const edited = withReaders(makeTarget("Reviewed body."), [
      { ...THEO, data: { ...THEO.data, goals: ["Something else."] } },
    ]);
    const provider = new MockProvider([mockVerdict("pass", 0.95), mockVerdict("fail", 0.95), mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider, root })([edited], config, {});
    expect(results[0]?.outcome).toBe("pass");
    expect(results[0]?.via).toBe("human-review");
  });
});
