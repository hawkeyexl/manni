/**
 * The one command core behind `start`, `build` and `preview`: resolve the
 * verb to a plan, then run it. The three verbs differ only in the plan, which
 * `resolvePlan` owns, so they share this core rather than three copies of it.
 */
import { resolvePlan, type ResolveOptions } from "../core/detect.js";
import { runPlan } from "../core/run.js";
import type { Verb } from "../types.js";

/** Resolves the exit code, 0; anything operational throws `SiteError`. */
export async function runSite(verb: Verb, opts: ResolveOptions): Promise<number> {
  return runPlan(resolvePlan(verb, opts));
}
