/**
 * Judge cache key composition. The cache itself is the inference library's
 * `JsonCache`; what stays here is what only manni docevals can decide — what
 * invalidates an entry: provider, model, prompt version, run count,
 * temperature, the page body, and the resolved eval.
 */
import { buildCacheKey, JsonCache, sha256 } from "@hawkeyexl/inference";
import type { JudgeRun } from "../types.js";
import type { ResolvedEval } from "../core/resolve.js";
import { PROMPT_VERSION } from "./prompt.js";

export { sha256 };

/**
 * A judge cache that refuses to persist an ensemble containing an errored run.
 *
 * The library's `runEnsemble` caches unconditionally — it has no way to know
 * whether an error is a property of the request or of the moment. Here we do:
 * an error is an infrastructure failure (VRAM exhausted, rate limited,
 * connection dropped), never a verdict about the page. Writing one to the cache
 * turns a transient outage into a permanent answer, and `--no-cache` becomes
 * the only way out of a state nothing explains.
 *
 * That is worst for a committed cache, whose whole purpose is to let CI replay
 * real verdicts with no provider reachable. Caching an error there commits the
 * outage: every future run replays it, the evals sit in human-review forever,
 * and the fixtures look valid the entire time. This was not hypothetical — a
 * local run at concurrency 4 exhausted VRAM and wrote 65 errored ensembles into
 * `docs/.manni-docevals-cache/` (ADR 01038).
 *
 * Subclassed rather than wrapped because `JsonCache` has private fields, so a
 * structurally-identical object does not satisfy its type.
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

  /**
   * Reading applies the same predicate, which is what makes the property
   * total rather than merely forward-looking.
   *
   * Guarding only the write cannot heal an entry this class did not write —
   * and those exist: the 65 errored ensembles that prompted ADR 01038 were on
   * disk before it, and had to be deleted by hand. A committed cache is
   * exactly the population at risk, because CI replays it with no provider
   * reachable, so a poisoned entry there is a verdict no future run can
   * dislodge. Treating it as a miss costs one re-judge and converges;
   * inheriting `get` unchanged never does.
   *
   * The predicate also matches the library's own definition rather than ours:
   * `computeConsensus` counts a run with no `verdict` as an error vote, so an
   * entry with neither `verdict` nor `error` — reachable through a truncated
   * write to these hand-editable JSON files — would otherwise replay as a
   * permanent human-review with nothing explaining why.
   */
  override get(key: string): JudgeRun[] | undefined {
    const hit = super.get(key);
    if (hit === undefined) return undefined;
    return VerdictCache.usable(hit) ? hit : undefined;
  }
}

/**
 * The exact body string the judge keys on: the chunk budget, then the selected
 * text.
 *
 * Exported because anything that wants to know whether a verdict is cached has
 * to reproduce this byte for byte, and reproducing it by hand is how the
 * cache-completeness script silently computed keys that matched nothing —
 * `scripts/check-docs-cache.mjs` passed the raw page body while the judge had
 * started prefixing the budget. A helper both call is the only version of this
 * that cannot drift.
 */
export function judgeCacheBody(chunkChars: number, text: string): string {
  return `chunk${String(chunkChars)}\n${text}`;
}

export function cacheKey(
  provider: string,
  model: string,
  runs: number,
  temperature: number,
  body: string,
  ev: ResolvedEval,
): string {
  const evalFingerprint = JSON.stringify({
    assertion: ev.assertion,
    evidence: ev.evidence,
    examples: ev.examples,
    type: ev.type,
  });
  return buildCacheKey([
    provider,
    model,
    `v${PROMPT_VERSION}`,
    `r${runs}`,
    `t${temperature}`,
    // Pre-hashed: page bodies are large and key parts should stay short.
    sha256(body),
    sha256(evalFingerprint),
  ]);
}
