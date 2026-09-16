/**
 * Judge cache key composition. The cache itself is the inference library's
 * `JsonCache`; what stays here is the part only manni tracevals can decide — what
 * invalidates an entry: provider, model, prompt version, run count,
 * temperature, the rendered trace, and the plan.
 */
import { buildCacheKey, sha256 } from "@hawkeyexl/inference";
import type { EvalPlan } from "../core/plan.js";
import { PROMPT_VERSION } from "./prompt.js";

export { sha256 };

export function cacheKey(
  provider: string,
  model: string,
  runs: number,
  temperature: number,
  renderedTrace: string,
  plan: EvalPlan,
  promptVersion: number = PROMPT_VERSION,
): string {
  const planFingerprint = JSON.stringify({
    assertion: plan.assertion,
    evidence: plan.evidence,
    examples: plan.examples,
    artifact: plan.artifact.content,
  });
  return buildCacheKey([
    provider,
    model,
    `v${promptVersion}`,
    `r${runs}`,
    `t${temperature}`,
    // Pre-hashed: traces and artifacts are large, and key parts stay short.
    sha256(renderedTrace),
    sha256(planFingerprint),
  ]);
}
