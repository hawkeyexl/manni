/**
 * Rebuilds the frozen rules cache of the runtime-evals test set. It reaches a
 * real model, so it runs only when MANNI_RUNTIME_EVALS_FREEZE=1, which
 * scripts/runtime-evals-freeze.mjs sets. Extraction goes through the isolated
 * Claude CLI, under the identity the corpus config names, into cache/rules,
 * which it empties first so the cache holds exactly what the cases need.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extraction } from "../../../src/tracevals/commands/conformance.js";
import { RulesCache } from "../../../src/tracevals/rules/cache.js";
import { RULES_PROMPT_VERSION } from "../../../src/tracevals/rules/prompt.js";
import { REQUIREMENTS_PROMPT_VERSION } from "../../../src/tracevals/rules/requests-prompt.js";
import {
  CORPUS,
  IsolatedClaudeCli,
  caseRules,
  corpusConfig,
  extractionIdentity,
  loadCases,
  type Frozen,
} from "../runtime-evals.js";

const freeze = process.env.MANNI_RUNTIME_EVALS_FREEZE === "1";

describe.skipIf(!freeze)("runtime evals freeze", () => {
  it("extracts every case's sources into the frozen cache", { timeout: 60 * 60_000 }, async () => {
    const config = await corpusConfig();
    const id = extractionIdentity(config);
    const extractor = new IsolatedClaudeCli(id.model);
    expect({ provider: extractor.provider(), model: extractor.modelName() }).toEqual(id);

    const cacheDir = join(CORPUS, config.judge.cacheDir);
    await rm(join(cacheDir, "rules"), { recursive: true, force: true });
    await mkdir(join(cacheDir, "rules"), { recursive: true });
    const ex = await extraction(config, new RulesCache(join(cacheDir, "rules")), extractor);
    const home = await mkdtemp(join(tmpdir(), "runtime-evals-home-"));
    try {
      for (const c of loadCases()) {
        const { sources } = await caseRules(c, config, home);
        const counts: string[] = [];
        for (const { source } of sources) {
          const { rules } = await ex.rulesOf(source);
          counts.push(`${source.displayPath} ${String(rules.length)}`);
        }
        console.log(`${c.id}: ${counts.join(", ")}`);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
    // Every key the cases read now hits, under the config's identity.
    for (const c of loadCases()) {
      const { sources } = await caseRules(c, config, home);
      expect(sources.filter((s) => s.rules === undefined).map((s) => s.source.displayPath), c.id).toEqual([]);
    }
    const frozen: Frozen = {
      extraction: id,
      rulesPromptVersion: RULES_PROMPT_VERSION,
      requirementsPromptVersion: REQUIREMENTS_PROMPT_VERSION,
    };
    await writeFile(join(cacheDir, "frozen.json"), `${JSON.stringify(frozen, null, 2)}\n`, "utf-8");
    console.log(`${String(extractor.calls)} extraction calls, $${extractor.costUsd.toFixed(4)} as the CLI reports it`);
  });
});
