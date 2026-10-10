/**
 * Rebuilds the frozen rules cache of the runtime-evals test set. It reaches a
 * real model, so it runs only when MANNI_RUNTIME_EVALS_FREEZE=1, which
 * scripts/runtime-evals-freeze.mjs sets. Extraction goes through the isolated
 * Claude CLI, under the identity the corpus config names, into cache/rules.
 * An entry already there is kept and never extracted again, so adding a case
 * leaves every other case's rules as they were. A prompt version is part of
 * the key, so a bump misses every entry. Entries no case reads are removed,
 * so the cache holds exactly what the cases need.
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    await mkdir(join(cacheDir, "rules"), { recursive: true });
    const ex = await extraction(config, new RulesCache(join(cacheDir, "rules")), extractor);
    const home = await mkdtemp(join(tmpdir(), "runtime-evals-home-"));
    const read = new Set<string>();
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
      // Every key the cases read now hits, under the config's identity.
      for (const c of loadCases()) {
        const { sources } = await caseRules(c, config, home);
        expect(sources.filter((s) => s.rules === undefined).map((s) => s.source.displayPath), c.id).toEqual([]);
        for (const s of sources) if (s.source.declaredRules === undefined) read.add(`${s.key}.json`);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
    // The cache writer ends a file without a newline, and the committed files end with one.
    for (const name of await readdir(join(cacheDir, "rules"))) {
      const file = join(cacheDir, "rules", name);
      if (!read.has(name)) {
        await rm(file);
        continue;
      }
      const text = await readFile(file, "utf-8");
      if (!text.endsWith("\n")) await writeFile(file, `${text}\n`, "utf-8");
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
