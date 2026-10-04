/**
 * What the CI formats (`github`, `sarif`, `junit`) render from.
 *
 * A single trace and a batch reach them as the same shape: the per-trace
 * reports, plus the traces that could not be evaluated at all and the
 * warnings that belong to no one trace. A CI reporter is about findings and
 * where they live, so it reads the per-trace results rather than the batch's
 * aggregate rates, which carry no message to annotate with.
 */
import type { BatchReport, EvalResult, RunReport } from "../types.js";
import { normalizeRoot, toPosix, underRoot } from "../../shared/sarif-location.js";

export interface CiOptions {
  /**
   * The directory locations are made relative to. Defaults to the working
   * directory, which is where a CI job runs from.
   */
  root?: string;
}

export interface CiInput {
  runs: readonly RunReport[];
  /** Traces a batch could not evaluate at all, by file. */
  traceErrors: readonly { file: string; error: string; durationMs: number }[];
  /** Warnings that belong to the batch rather than to one trace. */
  warnings: readonly string[];
  /** Forward-slashed, with one trailing slash. */
  root: string;
}

export function ciInputFromRun(report: RunReport, opts: CiOptions = {}): CiInput {
  return {
    runs: [report],
    traceErrors: [],
    warnings: [],
    root: normalizeRoot(opts.root ?? process.cwd()),
  };
}

export function ciInputFromBatch(
  batch: BatchReport,
  runs: readonly RunReport[],
  opts: CiOptions = {},
): CiInput {
  const traceErrors: { file: string; error: string; durationMs: number }[] = [];
  for (const t of batch.traces) {
    if (t.error !== undefined) {
      traceErrors.push({ file: t.file, error: t.error, durationMs: t.durationMs });
    }
  }
  return {
    runs,
    traceErrors,
    warnings: batch.warnings,
    root: normalizeRoot(opts.root ?? process.cwd()),
  };
}

/**
 * A path as a reader in the checkout names it: relative and forward-slashed
 * under the root, absolute and forward-slashed outside it.
 */
export function displayPath(file: string, root: string): string {
  const posix = toPosix(file);
  return underRoot(posix, root) ?? posix;
}

/** `tracevals/<grader>`: the rule a result is filed under. */
export function ruleIdFor(grader: string): string {
  return `tracevals/${grader}`;
}

/** The rule an unreadable trace is filed under. It names no grader. */
export const TRACE_RULE_ID = "tracevals/trace";

/** The message for a trace a batch could not evaluate. */
export function traceErrorText(error: string): string {
  return `trace could not be evaluated: ${error}`;
}

/** A judged failure, in the words docevals' reporters use. */
export function judgeFailText(result: EvalResult): string | undefined {
  if (result.outcome !== "fail" || !result.consensus) return undefined;
  const reasoning =
    result.consensus.runs.find((run) => run.verdict)?.verdict?.reasoning ?? "";
  return `AI judge: fail (confidence ${result.consensus.meanConfidence.toFixed(2)}). ${reasoning}`.trim();
}

/** Why an errored eval errored. */
export function errorText(result: EvalResult): string {
  return result.error ?? result.skipReason ?? "eval errored";
}
