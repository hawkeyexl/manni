/**
 * Integration: full pipeline (deterministic + judge) over the fixture corpus
 * with a scripted MockProvider — no live API, no cache reuse across tests.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { parseConfig } from "../../../src/docevals/core/config.js";
import { readFileSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("full run with mock judge", () => {
  it("judges ai evals, keeps deterministic outcomes, and reports usage", async () => {
    // Cache dir isolated per test run.
    const cacheRoot = mkdtempSync(join(tmpdir(), "manni docevals-e2e-"));
    const configText = readFileSync(join(ROOT, "manni.config.yaml"), "utf8");
    // The repo's own config file is already a complete moose config, so it
    // parses as-is rather than through the nesting helper.
    const config = parseConfig(
      configText.replace("cache-dir: .manni/docevals/cache", `cache-dir: ${JSON.stringify(join(cacheRoot, "cache"))}`),
      join(ROOT, "manni.config.yaml"),
    );

    const provider = new MockProvider([mockVerdict("pass", 0.95)]);
    const judge = makeJudge({ provider, root: ROOT });

    const report = await runEvals({
      cwd: ROOT,
      generate: false,
      judge: async (targets, _config, options) =>
        judge(targets, config, options),
    });

    const byKey = new Map(
      report.evalResults.map((r) => [`${r.file} ${r.evalName}`, r] as const),
    );

    // AI evals judged with consensus attached.
    const judged = byKey.get(
      "test/docevals/fixtures/pages/docs/get-started/concepts.md defines-core-terms",
    );
    expect(judged?.outcome).toBe("pass");
    expect(judged?.consensus?.zone).toBe("auto-pass");
    expect(judged?.consensus?.runs).toHaveLength(3);

    // Deterministic outcomes unchanged.
    expect(
      byKey.get("test/docevals/fixtures/pages/docs/actions/goTo.mdx fresh-enough")?.outcome,
    ).toBe("fail");

    // Token accounting present (mock usage tokens counted).
    expect(report.usage.judgedEvals).toBeGreaterThan(5);
    expect(report.usage.totalTokens).toBeGreaterThan(0);

    // The block is `usage`, not `cost`, and carries no dollar figure (ADR
    // 01019). `--format json` serializes the whole report, so this pair of
    // names is a public output contract that TypeScript alone cannot pin:
    // a stray runtime key would type-check and still break every parser.
    expect(report).not.toHaveProperty("cost");
    expect(report.usage).not.toHaveProperty("totalUsd");

    // Suite summaries include judged results.
    const tutorial = report.suites.find((s) => s.suite === "tutorial");
    expect(tutorial?.passed).toBeGreaterThan(0);
    expect(tutorial?.meetsTarget).toBe(true);
  }, 60000);
});
