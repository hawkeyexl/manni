#!/usr/bin/env node
/**
 * Rebuilds the frozen rules cache of the runtime-evals test set
 * (test/tracevals/fixtures/runtime-evals/). It runs the gated freeze test,
 * which extracts every case's sources through an isolated, logged-in Claude
 * CLI under the identity the corpus config names, and records the prompt
 * versions in cache/frozen.json.
 *
 * A changed RULES_PROMPT_VERSION or REQUIREMENTS_PROMPT_VERSION invalidates
 * every entry, and the rule ids can move, so relabel cases.json after it.
 *
 * Usage: node scripts/runtime-evals-freeze.mjs
 */
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "npx",
  ["vitest", "run", "test/tracevals/integration/runtime-evals.freeze.test.ts"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, MANNI_RUNTIME_EVALS_FREEZE: "1" },
  },
);
process.exit(result.status ?? 2);
