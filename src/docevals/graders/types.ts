/**
 * Grader contract for deterministically graded evals (command and tool:*).
 * A grader receives every (page, eval) target that resolved to its kind and
 * returns normalized findings. AI grading lives in src/judge, not here.
 */
import type { ExecFn } from "@hawkeyexl/inference";
import type { Finding } from "../types.js";
import type { DocevalsConfig } from "../core/config.js";
import type { OptionCheck, Options } from "./options.js";
import type { ResolvedEval, ResolvedPagePlan } from "../core/resolve.js";

/** One (page, eval) pair a grader must grade. */
export interface GraderTarget {
  plan: ResolvedPagePlan;
  eval: ResolvedEval;
}

// The exec seam is shared with the inference layer's subprocess provider, so
// these types live there now. Re-exported so grader code keeps importing them
// from one place.
export type { ExecFn, ExecOptions, ExecResult } from "@hawkeyexl/inference";

export interface GraderContext {
  targets: GraderTarget[];
  config: DocevalsConfig;
  /** Discovery root; page paths are relative to it. */
  root: string;
  exec: ExecFn;
}

export interface Grader {
  /** Registry kind, e.g. "command", "tool:markdownlint", "tool:freshness". */
  kind: string;
  /**
   * Reject option sets this grader cannot honour, before anything runs.
   *
   * The published vocabulary leaves `options` open on purpose, so this is the
   * "validated by the grader at run time" half of that contract. Without it a
   * misspelled key falls through to a default and the eval silently checks
   * something its author never wrote. Returns a message, or undefined when the
   * options are fine.
   */
  validateOptions?(options: Options): OptionCheck;
  /**
   * Targets other than `body` this grader can actually read.
   *
   * Declared by the grader rather than listed in the engine, so adding a
   * grader that reads `target` is a change in one file. Absent means "body
   * only", which is every grader that predates `target` — and the engine
   * turns any other request into an error rather than letting the grader
   * quietly measure the whole page (ADR 01033).
   */
  targets?: readonly string[];
  /**
   * batch: one external invocation covers all targets;
   * per-file: one invocation per target;
   * corpus: needs every page at once (cross-page checks).
   */
  mode: "batch" | "per-file" | "corpus";
  grade(ctx: GraderContext): Promise<Finding[]>;
}

/**
 * Split targets into groups that share an eval configuration. Batch and
 * corpus graders run one invocation per group so that (a) two same-kind evals
 * on one page each get their own run and correct finding attribution, and
 * (b) per-page option overrides are honored instead of the first target's
 * options being applied to everyone.
 */
/**
 * A plain object with its keys in sorted order, recursively, so that
 * `JSON.stringify` describes the value rather than the order it was written
 * in. `undefined` passes through so an absent option stays absent in the key.
 */
function sortedForKey(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map(sortedForKey);
  if (typeof value !== "object") return value;
  const entries = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(entries).sort()) {
    out[k] = sortedForKey(entries[k]);
  }
  return out;
}

export function groupTargetsByEval(targets: GraderTarget[]): GraderTarget[][] {
  const groups = new Map<string, GraderTarget[]>();
  for (const t of targets) {
    const key = JSON.stringify([
      t.eval.name,
      // Key order, not just content: `resolve.ts` rebuilds `options` per page
      // by spread, so insertion order follows each page's own YAML. Two pages
      // declaring the same options in a different order used to hash
      // differently and land in separate groups — which for a corpus grader
      // means each group holds one target, `gradeGroup` returns [] below two,
      // and no findings is recorded as a pass. Sorting makes the key describe
      // the configuration rather than how it happened to be typed.
      sortedForKey(t.eval.options),
      t.eval.timeoutMs ?? null,
      t.eval.severity,
      sortedForKey(t.eval.severityMap) ?? null,
    ]);
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  return [...groups.values()];
}
