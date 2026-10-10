/**
 * The runtime-evals test set stays judgeable offline (test/tracevals/fixtures/
 * runtime-evals/). Every trace parses, every label names a rule the frozen
 * cache holds, every frozen rule has a label, and a run with the mock judge
 * reads every source from the cache without one extraction call. A prompt
 * version bump fails here, by name, before it silently empties a live run.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCheck } from "../../../src/tracevals/commands/check.js";
import type { TracevalsConfig } from "../../../src/tracevals/core/config.js";
import { RULES_PROMPT_VERSION } from "../../../src/tracevals/rules/prompt.js";
import { REQUIREMENTS_PROMPT_VERSION } from "../../../src/tracevals/rules/requests-prompt.js";
import {
  CORPUS,
  caseRules,
  corpusConfig,
  extractionGuard,
  extractionIdentity,
  homeEnv,
  loadCases,
  loadFrozen,
  ruleKeysOf,
  scratchConfigDir,
} from "../runtime-evals.js";

const REGENERATE = "regenerate it with `npm run build && node scripts/runtime-evals-freeze.mjs`, then relabel cases.json";
const LABELS = new Set(["followed", "not-followed", "not-applicable"]);

const cases = loadCases();
let config: TracevalsConfig;
let home: string;
let scratch: string;

beforeAll(async () => {
  config = await corpusConfig();
  home = await mkdtemp(join(tmpdir(), "runtime-evals-home-"));
  scratch = await scratchConfigDir();
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

describe("the runtime-evals frozen cache", () => {
  it("was frozen with the prompt versions this build extracts with", () => {
    const frozen = loadFrozen();
    expect(
      frozen.rulesPromptVersion,
      `RULES_PROMPT_VERSION is ${String(RULES_PROMPT_VERSION)}, and the frozen cache holds version ${String(frozen.rulesPromptVersion)}; ${REGENERATE}`,
    ).toBe(RULES_PROMPT_VERSION);
    expect(
      frozen.requirementsPromptVersion,
      `REQUIREMENTS_PROMPT_VERSION is ${String(REQUIREMENTS_PROMPT_VERSION)}, and the frozen cache holds version ${String(frozen.requirementsPromptVersion)}; ${REGENERATE}`,
    ).toBe(REQUIREMENTS_PROMPT_VERSION);
  });

  it("was frozen with the extraction model the corpus config names", () => {
    expect(loadFrozen().extraction, `the config names a different extraction model; ${REGENERATE}`).toEqual(
      extractionIdentity(config),
    );
  });
});

describe.each(cases.map((c) => [c.id, c] as const))("runtime-evals case %s", (_id, c) => {
  it("is described and labeled with known values", () => {
    expect(c.what).not.toBe("");
    expect(Object.keys(c.labels).length).toBeGreaterThan(0);
    for (const [key, entry] of Object.entries(c.labels)) {
      expect(LABELS.has(entry.label), `${key}: ${entry.label}`).toBe(true);
      expect(entry.why, key).not.toBe("");
    }
  });

  it("parses, and the frozen cache holds every in-scope source", async () => {
    const rules = await caseRules(c, config, home);
    expect(rules.trace.events.length).toBeGreaterThan(0);
    expect(rules.trace.warnings).toEqual([]);
    const missing = rules.sources.filter((s) => s.rules === undefined).map((s) => s.source.displayPath);
    expect(missing, `the frozen cache misses these sources; ${REGENERATE}`).toEqual([]);
  });

  it("labels exactly the rules the frozen cache yields", async () => {
    const keys = ruleKeysOf(await caseRules(c, config, home));
    const labeled = Object.keys(c.labels);
    expect(labeled.filter((k) => !keys.includes(k)), "labels for rules the frozen cache does not hold").toEqual([]);
    expect(keys.filter((k) => !labeled.includes(k)), "frozen rules with no label").toEqual([]);
  });

  it("runs on the mock judge with zero extraction calls", async () => {
    const guard = extractionGuard(config);
    const { report } = await runCheck({
      tracePath: join(CORPUS, c.trace),
      project: join(CORPUS, c.project),
      configDir: scratch,
      provider: "mock",
      runs: 1,
      env: homeEnv(home),
      extractor: guard,
    });
    expect(guard.calls).toBe(0);
    expect(report.extraction).toBeNull();
    expect(report.skipped === null || report.skipped === "not-applicable").toBe(true);
    expect(report.summary.rules).toBe(Object.keys(c.labels).length);
  });
});
