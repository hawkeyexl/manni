/**
 * Judge cache key composition. The cache itself is the inference library's
 * `JsonCache`; what stays here is the part only manni tracevals can decide — what
 * invalidates an entry: provider, model, prompt version, run count,
 * temperature, the rendered trace, and the plan.
 */
import { JsonCache, buildCacheKey, sha256, type JudgeRun } from "@hawkeyexl/inference";
import type { EvalPlan } from "../core/plan.js";
import { PROMPT_VERSION } from "./prompt.js";

export { sha256 };

/**
 * A judge cache that refuses to persist an ensemble containing an errored run
 * (docevals ADR 01038, which found this the hard way and whose reasoning
 * applies here unchanged).
 *
 * The library's `runEnsemble` caches unconditionally — it has no way to know
 * whether an error is a property of the request or of the moment. Here we do:
 * an error is an infrastructure failure (VRAM exhausted, rate limited,
 * connection dropped), never a verdict about the session. Writing one to the
 * cache turns a transient outage into a permanent answer, and `--no-cache`
 * becomes the only way out of a state nothing explains.
 *
 * Reading applies the same predicate, which is what makes the property total
 * rather than merely forward-looking: guarding the write alone cannot heal an
 * entry written before this class existed, and treating such an entry as a
 * miss costs one re-judge and converges. The predicate matches the library's
 * own definition rather than ours, since `computeConsensus` counts a run with
 * no `verdict` as an error vote.
 *
 * Subclassed rather than wrapped because `JsonCache` has private fields, so a
 * structurally identical object does not satisfy its type.
 */
export class VerdictCache extends JsonCache<JudgeRun[]> {
  /** An ensemble is cacheable only if every run produced a verdict. */
  private static usable(runs: JudgeRun[]): boolean {
    return runs.every((r) => r.error === undefined && r.verdict !== undefined);
  }

  override set(key: string, value: JudgeRun[]): void {
    if (!VerdictCache.usable(value)) return;
    super.set(key, value);
  }

  override get(key: string): JudgeRun[] | undefined {
    const hit = super.get(key);
    if (hit === undefined) return undefined;
    return VerdictCache.usable(hit) ? hit : undefined;
  }
}

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
