/** Deterministic trace-grader contract. */
import type { Trace } from "../trace/types.js";
import type { EvalPlan } from "../core/plan.js";
import type { Severity } from "../evals/extract.js";

export interface Finding {
  evalName: string;
  /** Path (or name) of the artifact the eval came from. */
  artifact: string;
  message: string;
  severity: Severity;
}

export interface GradeResult {
  findings: Finding[];
  /** Set when the grader could not apply (e.g. no cost data in the trace). */
  skipped?: string;
  /** Set when the criterion's options are invalid — maps to outcome `error`. */
  error?: string;
}

export interface TraceGraderContext {
  trace: Trace;
  plan: EvalPlan;
  /**
   * Root artifact resolution walked from, when the run pinned one. The command
   * grader runs checks here so a repo-relative script path in an artifact
   * resolves the way its author wrote it; absent, the trace's own cwd is used.
   */
  projectRoot?: string;
}

export interface TraceGrader {
  kind: string;
  /**
   * Ground-check `options` without a trace: a message when invalid, undefined
   * when usable. `grade()` calls this first, and criteria authoring (`fill`)
   * calls it before proposing a criterion. Optional so consumer-registered
   * graders stay source-compatible; a kind without it cannot be proposed.
   */
  validateOptions?(this: void, options: Record<string, unknown>): string | undefined;
  grade(ctx: TraceGraderContext): GradeResult | Promise<GradeResult>;
}
