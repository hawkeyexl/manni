/**
 * The judge's cache key and the key an outside caller computes must be the
 * same key.
 *
 * `scripts/check-docs-cache.mjs` answers "is this verdict already cached?"
 * without running the judge, and it used to answer it by reproducing the key
 * composition by hand. That went silently wrong the moment the judge started
 * prefixing the chunk budget: every key the script computed matched nothing,
 * which reads as "the entire committed cache is missing" and, under `--prune`,
 * as "every file is an orphan". Nothing failed — the numbers were just wrong.
 *
 * The script now builds keys from the judge's own exports. This pins that they
 * agree, by the only means that cannot drift: write a cache entry under the
 * externally-computed key, then run the judge against a provider that throws if
 * it is called. A hit proves the two compositions are identical; a miss reaches
 * the provider and fails loudly.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { cacheKey, judgeCacheBody } from "../../../src/docevals/judge/cache.js";
import { readTarget } from "../../../src/docevals/core/target.js";
import { resolveProviderIdentity } from "../../../src/docevals/judge/provider.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import type { InferenceProvider } from "@hawkeyexl/inference";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

/** A provider that fails the test if the judge ever reaches it. */
function neverCalled(): InferenceProvider {
  return {
    provider: () => "anthropic",
    modelName: () => "claude-sonnet-4-5",
    completeJSON: () => {
      throw new Error("cache miss: the judge did not find the precomputed key");
    },
  };
}

function target(body: string): { t: GraderTarget; config: ReturnType<typeof parseDocevalsConfig> } {
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
  const config = parseDocevalsConfig("version: 1\n", "/fake/manni.config.yaml");
  const plan = resolvePage(page, config);
  return { t: { plan, eval: plan.evals[0]! }, config };
}

describe("the judge and an outside caller agree on the cache key", () => {
  it("hits an entry written under an externally-computed key", async () => {
    const root = mkdtempSync(join(tmpdir(), "manni-docevals-agree-"));
    const { t, config } = target("Body under test.");

    // Exactly what scripts/check-docs-cache.mjs does, through the same exports.
    const identity = resolveProviderIdentity(config, {
      provider: t.eval.provider,
      model: t.eval.model,
    });
    const selected = readTarget(t.eval.target, t.plan);
    expect(selected.ok).toBe(true);
    const key = cacheKey(
      identity.provider,
      identity.model,
      t.eval.runs ?? config.judge.ensembleRuns,
      config.judge.temperature,
      judgeCacheBody(config.judge.chunkChars, selected.ok ? selected.text : ""),
      t.eval,
    );

    const dir = join(root, config.judge.cacheDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${key}.json`),
      JSON.stringify(
        Array.from({ length: config.judge.ensembleRuns }, () => ({
          verdict: {
            claim: "c",
            observed: "o",
            match: "pass",
            confidence: 0.95,
            reasoning: "r",
          },
          provider: identity.provider,
          model: identity.model,
          cached: false,
          durationMs: 1,
        })),
      ),
    );

    const judge = makeJudge({ provider: neverCalled(), root });
    const results = await judge([t], config, {});
    expect(results[0]?.outcome).toBe("pass");
    expect(results[0]?.consensus?.runs.every((r) => r.cached)).toBe(true);
  });
});
