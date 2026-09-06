/**
 * Splitting long content instead of truncating it.
 *
 * The defect this replaces was silent: `fill` and `scriptgen` sliced at 6000
 * characters and appended a marker nothing downstream read, so a long page was
 * filled and script-generated from its first half with no signal that the rest
 * was never seen.
 *
 * For the judge the question is different — merging per-part *verdicts* is
 * unsound, because "documents X" needs OR across parts and "never promises X"
 * needs AND, and an assertion's text does not say which. So parts contribute
 * evidence and one judge answers once. These tests pin that a page which fits
 * is untouched, and that one which does not is read in parts.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { splitBody, looksLikeOverflow, DEFAULT_CHUNK_CHARS } from "../../../src/docevals/core/split.js";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

describe("splitBody", () => {
  it("returns content that fits, unchanged and unsplit", () => {
    const body = "line one\nline two\n";
    expect(splitBody(body, 100)).toEqual([body]);
  });

  it("cuts at a newline rather than mid-line", () => {
    const body = "aaaa\nbbbb\ncccc\n";
    const chunks = splitBody(body, 7);
    // 7 characters would land inside "bbbb"; the cut retreats to the newline.
    expect(chunks[0]).toBe("aaaa\n");
    expect(chunks.join("")).toBe(body);
  });

  it("loses nothing: the parts rejoin to the original", () => {
    const body = Array.from({ length: 500 }, (_, i) => `line ${String(i)}`).join("\n");
    const chunks = splitBody(body, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(body);
  });

  it("makes progress even on a line longer than the budget", () => {
    // No newline to retreat to, so the cut has to be a hard one — otherwise
    // the loop would never advance.
    const body = "x".repeat(50);
    const chunks = splitBody(body, 10);
    expect(chunks).toHaveLength(5);
    expect(chunks.join("")).toBe(body);
  });

  it("defaults to docmeta's budget, so the family agrees", () => {
    expect(DEFAULT_CHUNK_CHARS).toBe(12000);
  });
});

describe("looksLikeOverflow", () => {
  it("recognises the ways providers say 'too much context'", () => {
    for (const m of [
      "context length exceeded",
      "prompt is too long",
      "maximum context tokens reached",
      "Request too large",
    ]) {
      expect(looksLikeOverflow(m), m).toBe(true);
    }
  });

  it("does not mistake an unrelated failure for one", () => {
    expect(looksLikeOverflow("401 unauthorized")).toBe(false);
  });
});

// --- the judge's two-stage path ---

const config = parseDocevalsConfig(
  ["version: 1", "judge:", "  ensemble-runs: 1", "  chunk-chars: 200"].join("\n"),
  "/fake/manni.config.yaml",
);
const tempRoot = () => mkdtempSync(join(tmpdir(), "manni-docevals-split-"));

function target(body: string): GraderTarget {
  const content = [
    "---",
    "title: x",
    "evals:",
    "  - id: claim-check",
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
  const plan = resolvePage(page, config);
  const ev = plan.evals[0];
  if (!ev) throw new Error("no eval resolved");
  return { plan, eval: ev };
}

const evidence = { json: { supports: ["a quoted line"], contradicts: [] } };

describe("judging a page too long for one call", () => {
  it("judges a short page in one call, with no evidence stage", async () => {
    const p = new MockProvider([mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider: p, root: tempRoot() })(
      [target("Short body.")],
      config,
      {},
    );
    expect(p.requests).toHaveLength(1);
    expect(p.requests[0]?.system).toContain("meticulous technical documentation judge");
    expect(results[0]?.outcome).toBe("pass");
  });

  it("gathers evidence per part, then judges once", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Line ${String(i)} of the page.`).join("\n");
    const p = new MockProvider([evidence, evidence, evidence, mockVerdict("pass", 0.95)]);
    const results = await makeJudge({ provider: p, root: tempRoot() })(
      [target(long)],
      config,
      {},
    );
    const systems = p.requests.map((r) => r.system);
    const gathering = systems.filter((s) => s.includes("gathering evidence"));
    const judging = systems.filter((s) => s.includes("meticulous technical"));
    expect(gathering.length).toBeGreaterThan(1);
    // One verdict call, whatever the part count — the contract downstream
    // consumers depend on is unchanged.
    expect(judging).toHaveLength(1);
    expect(results[0]?.outcome).toBe("pass");
  });

  it("tells the judge it is reading extracts, not the page", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Line ${String(i)} of the page.`).join("\n");
    const p = new MockProvider([evidence, evidence, evidence, mockVerdict("pass", 0.95)]);
    await makeJudge({ provider: p, root: tempRoot() })([target(long)], config, {});
    const verdictCall = p.requests.find((r) => r.system.includes("meticulous technical"));
    expect(verdictCall?.user).toContain("read in");
    expect(verdictCall?.user).toContain("Absence of a quotation is weak evidence");
  });

  it("errors rather than judging on evidence it could not finish gathering", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Line ${String(i)} of the page.`).join("\n");
    // First part answers, the second fails. Judging on what was collected so
    // far would report a verdict about a page most of which was never read —
    // the silent wrong answer this stage exists to prevent (ADR 01022).
    let calls = 0;
    const flaky = {
      provider: () => "mock",
      modelName: () => "m",
      completeJSON: async () => {
        calls++;
        if (calls > 1) throw new Error("provider exploded");
        return { json: { supports: ["a quoted line"], contradicts: [] } };
      },
    } as unknown as MockProvider;

    const results = await makeJudge({ provider: flaky, root: tempRoot() })(
      [target(long)],
      config,
      {},
    );
    expect(results[0]?.outcome).toBe("error");
    expect(results[0]?.skipReason).toContain("gathering evidence from part 2");
  });
});
