/** Shared result model and errors for manni tracevals. */
import type { ConsensusResult } from "@hawkeyexl/inference";
import type {
  AvailabilityReport,
  CoverageEntry,
} from "./artifacts/types.js";
import type { ArtifactType } from "./artifacts/types.js";
import type { ManifestReport } from "./capture/types.js";
import type { Finding } from "./graders/types.js";
import { ToolError } from "../shared/errors.js";

/**
 * Operational error: bad usage, unreadable input, unknown format. Exits 2.
 * A `ToolError`, so the shared bin runner prints it as one line.
 */
export class TracevalsError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "TracevalsError";
  }
}

export type Outcome = "pass" | "fail" | "error" | "needs-review" | "skipped";

export interface EvalResult {
  evalName: string;
  /** Path of the artifact the eval came from. */
  artifact: string;
  artifactName: string;
  artifactType: ArtifactType;
  grader: string;
  implicit: boolean;
  outcome: Outcome;
  /** Present for deterministic evals that produced findings. */
  findings?: Finding[];
  /** Present for judged evals. */
  consensus?: ConsensusResult;
  error?: string;
  skipReason?: string;
  costUsd?: number;
  /**
   * Set when the model that judged this eval also produced what it graded.
   *
   * `session` — the judge model is the model that ran the session. This is the
   * sharpest form of the bias in either manni tool: the judge is not being
   * asked about a document it happened to draft, it is being asked whether its
   * own behavior followed the rules. `criterion` — `eval-provenance` records
   * this model proposing this assertion, so the judge wrote the question.
   *
   * Reported, never fatal: bias skews a verdict, it does not stop one forming,
   * and erroring would punish a single-model setup with no second provider to
   * reach for.
   */
  selfPreference?: { axis: "session" | "criterion"; model: string };
  /**
   * The eval's weight in the run's pass rate. Never changes its own outcome —
   * the binary verdict is what the reporters and exit code consume.
   */
  weight?: number;
  durationMs: number;
}

export interface RunSummary {
  total: number;
  pass: number;
  fail: number;
  error: number;
  needsReview: number;
  skipped: number;
  /**
   * Weighted share of the graded set that passed, 1 when nothing was graded.
   *
   * The graded set is pass + fail + error; `needs-review` and `skipped` are in
   * neither half, so a session awaiting review neither helps nor hurts. Each
   * eval contributes its `weight` (1 unless it says otherwise), which is what
   * lets a secondary check report without dominating.
   *
   * Reported, never gated: manni tracevals has no suite targets to compare it
   * against, and inventing an exit-code rule around a number nobody configured
   * would be a gate no one asked for.
   */
  passRate: number;
}

export interface RunReport {
  trace: {
    file: string;
    source: string;
    sessionId?: string;
    cwd: string;
    model?: string;
    turnCount: number;
  };
  /** Trace + resolution warnings, surfaced in every format. */
  warnings: string[];
  coverage: CoverageEntry[];
  /**
   * Offered versus used (ADR 01016). An observation about the session's
   * configuration; it never contributes to `summary` or `exitCode`.
   */
  availability: AvailabilityReport;
  /**
   * The session manifest this run consulted (ADR 01024), when one was found.
   * Absent means no manifest existed, which is the ordinary case — every hash
   * check then reports `skipped` and staleness stays the mtime heuristic.
   * Like `availability`, an observation: never in `summary`, never in
   * `exitCode`.
   */
  manifest?: ManifestReport;
  evalResults: EvalResult[];
  summary: RunSummary;
  /** 0 pass, 1 any fail/error (and needs-review when failOnNeedsReview). */
  exitCode: 0 | 1;
  costUsd: number;
  durationMs: number;
}

/* -------------------------------------------------------------------------- *
 * Batch runs (ADR 01018)
 *
 * Adherence is a rate across sessions, not a single verdict. `BatchReport`
 * sits alongside `RunReport` rather than replacing it: naming one trace still
 * yields exactly the `RunReport` above, byte for byte.
 * -------------------------------------------------------------------------- */

/** Outcome tallies for one aggregate row. */
export interface AggregateCounts {
  pass: number;
  fail: number;
  error: number;
  needsReview: number;
  skipped: number;
}

/**
 * One artifact, or one eval within it, summed over every trace in the batch.
 *
 * Keyed by type and *name* rather than by path, so the same skill evaluated
 * across several projects is one rate — which is the fleet question this
 * report exists to answer. The paths it resolved from are kept in `artifacts`
 * so a reader can see when a row spans more than one.
 */
export interface AggregateRow {
  /** `<type>:<name>` for an artifact row, plus `::<evalName>` for an eval row. */
  key: string;
  artifactName: string;
  artifactType: ArtifactType;
  /** Distinct resolved paths this row was aggregated from, sorted. */
  artifacts: string[];
  /** Absent on artifact rows. */
  evalName?: string;
  /** The grader kinds seen for this row, sorted. Usually exactly one. */
  graders?: string[];
  /** Traces that produced at least one result for this row. */
  traces: number;
  /** Eval results contributing to this row. */
  total: number;
  counts: AggregateCounts;
  /** `total` minus `skipped` — the pass-rate denominator. */
  graded: number;
  /**
   * `pass / graded`, or `null` when nothing was graded. Skipped results are
   * excluded deliberately: a check that never armed is not evidence either
   * way, and folding it in would let an artifact nobody invoked report a
   * perfect score.
   */
  passRate: number | null;
  /** Traces where this row produced a `fail` or an `error`, in batch order. */
  failingTraces: string[];
  /** Traces where it produced a `needs-review`, in batch order. */
  reviewTraces: string[];
  /** Distinct skip reasons, sorted — an exhausted budget surfaces here. */
  skipReasons: string[];
}

/** One trace's place in the batch. */
export interface BatchTraceEntry {
  file: string;
  sessionId?: string;
  /**
   * Set when the trace could not be evaluated at all — unreadable, or not a
   * recognized format. One bad file in a corpus of fifty must not cost the
   * other forty-nine, so this is an entry rather than an aborted run.
   */
  error?: string;
  /** Absent when `error` is set. */
  summary?: RunSummary;
  warnings: string[];
  exitCode: 0 | 1;
  costUsd: number;
  durationMs: number;
}

export interface BatchSummary extends RunSummary {
  /** Traces selected, including any that errored. */
  traces: number;
  tracesPassed: number;
  /** Traces that produced a report with exit code 1. */
  tracesFailed: number;
  /** Traces that could not be evaluated at all. */
  tracesErrored: number;
}

export interface BatchReport {
  traces: BatchTraceEntry[];
  /** Per-artifact rates, sorted by `key`. */
  artifacts: AggregateRow[];
  /** Per-eval rates, sorted by `key`. */
  evals: AggregateRow[];
  /** Eval counts summed over every trace, plus the per-trace tallies. */
  summary: BatchSummary;
  /** Batch-level warnings: plugin loading and trace selection. */
  warnings: string[];
  /** `1` when any trace failed or errored. */
  exitCode: 0 | 1;
  costUsd: number;
  durationMs: number;
}
