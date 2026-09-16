/**
 * Fold N single-trace reports into rates (ADR 01018).
 *
 * "Is this skill working?" is a question about many sessions, and the answer is
 * a proportion. Everything here is pure — reports in, rows out — so the shape
 * of the aggregate is testable without running anything.
 */
import type {
  AggregateCounts,
  AggregateRow,
  BatchReport,
  BatchSummary,
  BatchTraceEntry,
  EvalResult,
  RunReport,
} from "./types.js";

/** A trace that produced a report, or one that could not be read at all. */
export type BatchOutcome =
  | { file: string; report: RunReport }
  | { file: string; error: string; durationMs: number };

/**
 * The prefix `src/judge/trace-judge.ts` writes on an eval it declined to judge
 * because the shared budget was gone.
 *
 * Matching on the reason string rather than on a flag is deliberate, and it is
 * the narrowest seam available: the budget lives inside one judge instance,
 * the skip is the only trace of it that reaches a report, and the wording is
 * already load-bearing — the reason is what a reader sees and what the CI
 * dogfood step greps for.
 */
const BUDGET_EXHAUSTED = /^judge cost budget exhausted/;

/**
 * What an exhausted budget cost this batch: how many evals it left unjudged,
 * across how many traces, and the reason as the judge stated it.
 *
 * Reported separately from the skip counts because the two mean different
 * things. An eval skipped for a trigger that never armed produced no evidence
 * *about the session*; an eval skipped for an exhausted budget produced no
 * evidence *about anything* — the tool simply stopped looking.
 */
export interface BatchBudget {
  /** Evals left unjudged, summed over every trace. */
  skippedEvals: number;
  /** Traces that carried at least one such skip. */
  traces: number;
  /** The judge's own wording, budget figure included. */
  reason: string;
}

/**
 * `BatchReport` plus the budget block.
 *
 * Declared here rather than in `types.ts` for the same reason `BatchOutcome`
 * is: the field exists because of how the batch is *folded*, and every
 * consumer reaches it through `aggregate`. `budget` is optional, so a plain
 * `BatchReport` is still assignable — nothing downstream has to change to
 * ignore it.
 */
export interface BatchReportWithBudget extends BatchReport {
  budget?: BatchBudget;
}

const zero = (): AggregateCounts => ({
  pass: 0,
  fail: 0,
  error: 0,
  needsReview: 0,
  skipped: 0,
});

function tally(counts: AggregateCounts, outcome: EvalResult["outcome"]): void {
  if (outcome === "needs-review") counts.needsReview += 1;
  else counts[outcome] += 1;
}

/** Byte-comparison sort, so ordering does not depend on the runner's locale. */
const byKey = (a: { key: string }, b: { key: string }): number =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

interface Accumulator {
  key: string;
  artifactName: string;
  artifactType: AggregateRow["artifactType"];
  evalName?: string;
  artifacts: Set<string>;
  graders: Set<string>;
  traces: Set<string>;
  counts: AggregateCounts;
  failingTraces: string[];
  reviewTraces: string[];
  skipReasons: Set<string>;
}

function accumulate(
  into: Map<string, Accumulator>,
  key: string,
  result: EvalResult,
  file: string,
  withEvalName: boolean,
): void {
  let row = into.get(key);
  if (row === undefined) {
    row = {
      key,
      artifactName: result.artifactName,
      artifactType: result.artifactType,
      ...(withEvalName ? { evalName: result.evalName } : {}),
      artifacts: new Set(),
      graders: new Set(),
      traces: new Set(),
      counts: zero(),
      failingTraces: [],
      reviewTraces: [],
      skipReasons: new Set(),
    };
    into.set(key, row);
  }
  row.artifacts.add(result.artifact);
  row.graders.add(result.grader);
  row.traces.add(file);
  tally(row.counts, result.outcome);
  if (result.outcome === "fail" || result.outcome === "error") {
    if (!row.failingTraces.includes(file)) row.failingTraces.push(file);
  }
  if (result.outcome === "needs-review" && !row.reviewTraces.includes(file)) {
    row.reviewTraces.push(file);
  }
  if (result.outcome === "skipped" && result.skipReason !== undefined) {
    row.skipReasons.add(result.skipReason);
  }
}

function finish(row: Accumulator, withGraders: boolean): AggregateRow {
  const c = row.counts;
  const total = c.pass + c.fail + c.error + c.needsReview + c.skipped;
  const graded = total - c.skipped;
  return {
    key: row.key,
    artifactName: row.artifactName,
    artifactType: row.artifactType,
    artifacts: [...row.artifacts].sort(),
    ...(row.evalName !== undefined ? { evalName: row.evalName } : {}),
    ...(withGraders ? { graders: [...row.graders].sort() } : {}),
    traces: row.traces.size,
    total,
    counts: { ...c },
    graded,
    passRate: graded > 0 ? c.pass / graded : null,
    failingTraces: [...row.failingTraces],
    reviewTraces: [...row.reviewTraces],
    skipReasons: [...row.skipReasons].sort(),
  };
}

/**
 * Identity for a row. Type and name rather than path: two projects declaring
 * the same skill are one rate, which is the whole point of running a batch.
 */
const artifactKey = (r: EvalResult): string =>
  `${r.artifactType}:${r.artifactName}`;

export function aggregate(
  outcomes: BatchOutcome[],
  options: { warnings?: string[]; durationMs: number },
): BatchReportWithBudget {
  const artifactRows = new Map<string, Accumulator>();
  const evalRows = new Map<string, Accumulator>();
  const traces: BatchTraceEntry[] = [];

  // An exhausted budget is a property of the run, not of any one trace, so it
  // is counted here rather than inside a row.
  let budgetSkips = 0;
  const budgetTraces = new Set<string>();
  let budgetReason = "";

  const summary: BatchSummary = {
    total: 0,
    pass: 0,
    fail: 0,
    error: 0,
    needsReview: 0,
    skipped: 0,
    passRate: 1,
    traces: outcomes.length,
    tracesPassed: 0,
    tracesFailed: 0,
    tracesErrored: 0,
  };
  let costUsd = 0;
  // Weighted over every trace's evals, not an average of the per-trace rates.
  // Averaging would give a 2-eval trace the same say as a 40-eval one, which
  // is the opposite of what a batch is for.
  let gradedWeight = 0;
  let passedWeight = 0;

  for (const outcome of outcomes) {
    if ("error" in outcome) {
      // A trace that never parsed has no summary to report and no evals to
      // aggregate — but it is still a trace that did not pass, so it counts
      // against the batch and against the exit code.
      traces.push({
        file: outcome.file,
        error: outcome.error,
        warnings: [],
        exitCode: 1,
        costUsd: 0,
        durationMs: outcome.durationMs,
      });
      summary.tracesErrored += 1;
      continue;
    }

    const { report } = outcome;
    traces.push({
      file: outcome.file,
      ...(report.trace.sessionId !== undefined
        ? { sessionId: report.trace.sessionId }
        : {}),
      summary: report.summary,
      warnings: report.warnings,
      exitCode: report.exitCode,
      costUsd: report.costUsd,
      durationMs: report.durationMs,
    });
    if (report.exitCode === 1) summary.tracesFailed += 1;
    else summary.tracesPassed += 1;
    costUsd += report.costUsd;

    summary.total += report.summary.total;
    summary.pass += report.summary.pass;
    summary.fail += report.summary.fail;
    summary.error += report.summary.error;
    summary.needsReview += report.summary.needsReview;
    summary.skipped += report.summary.skipped;

    for (const result of report.evalResults) {
      if (
        result.outcome === "skipped" &&
        result.skipReason !== undefined &&
        BUDGET_EXHAUSTED.test(result.skipReason)
      ) {
        budgetSkips += 1;
        budgetTraces.add(outcome.file);
        budgetReason = result.skipReason;
      }
      if (
        result.outcome === "pass" ||
        result.outcome === "fail" ||
        result.outcome === "error"
      ) {
        const weight = result.weight ?? 1;
        gradedWeight += weight;
        if (result.outcome === "pass") passedWeight += weight;
      }
      const base = artifactKey(result);
      accumulate(artifactRows, base, result, outcome.file, false);
      accumulate(
        evalRows,
        `${base}::${result.evalName}`,
        result,
        outcome.file,
        true,
      );
    }
  }

  // 1 when nothing was graded, matching the single-trace rule: a batch that
  // graded nothing has not failed anything.
  summary.passRate = gradedWeight === 0 ? 1 : passedWeight / gradedWeight;

  const budget: BatchBudget | undefined =
    budgetSkips > 0
      ? {
          skippedEvals: budgetSkips,
          traces: budgetTraces.size,
          reason: budgetReason,
        }
      : undefined;

  const warnings = [...(options.warnings ?? [])];
  if (budget !== undefined) {
    warnings.push(
      `${budget.reason}: ${budget.skippedEvals} eval(s) across ${budget.traces} of ` +
        `${outcomes.length} trace(s) were never judged — raise judge.maxCostUsd or narrow the corpus`,
    );
  }

  return {
    traces,
    artifacts: [...artifactRows.values()]
      .map((r) => finish(r, false))
      .sort(byKey),
    evals: [...evalRows.values()].map((r) => finish(r, true)).sort(byKey),
    summary,
    warnings,
    // A batch that ran out of money mid-corpus did not measure the corpus, and
    // "did not measure" must never render as "measured clean". Exit 1 rather
    // than 2: unlike an empty selector, the report is real and worth keeping —
    // the traces that were judged carry genuine verdicts, and throwing them
    // away to raise an operational error would cost more than it says.
    exitCode:
      summary.tracesFailed > 0 ||
      summary.tracesErrored > 0 ||
      budget !== undefined
        ? 1
        : 0,
    ...(budget !== undefined ? { budget } : {}),
    costUsd,
    durationMs: options.durationMs,
  };
}
