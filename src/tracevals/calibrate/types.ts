/**
 * The calibration report contract (ADR 01022).
 *
 * A calibration run measures the tool against a human's answers, so its shape
 * is deliberately not the shape of a verdict report: the leading numbers are
 * the two kinds of mistake and the volume of deferrals, not a pass rate.
 */
import type { ArtifactType } from "../artifacts/types.js";
import type { BatchReport, Outcome } from "../types.js";
import type { EvalLabel, LabelOutcome } from "./labels.js";

/** The judge knobs a sweep varies. Everything else is held fixed. */
export interface JudgeSetting {
  ensembleRuns: number;
  zones: { autoPass: number; autoFail: number };
}

/**
 * How one label met one result. `agree` and the five disagreement kinds are
 * exhaustive over (expected × actual).
 */
export type JoinKind =
  | "agree"
  /** Labelled fail, judged pass. The expensive error. */
  | "false-pass"
  /** Labelled pass, judged fail. Erodes trust fastest. */
  | "false-fail"
  /** Labelled pass or fail, routed to a human instead. Deferred, not wrong. */
  | "review"
  /** Labelled ambiguous, decided anyway. */
  | "missed-review"
  /** The eval errored: never agreement, by the same rule that governs runs. */
  | "error"
  /** The eval was skipped: no evidence either way, so not a denominator row. */
  | "skipped";

export interface CalibrationCounts {
  /** Labels joined to a result. */
  labels: number;
  /** `labels` minus skipped — the agreement denominator. */
  scored: number;
  agree: number;
  falsePass: number;
  falseFail: number;
  review: number;
  missedReview: number;
  errored: number;
  skipped: number;
  /**
   * `needs-review` across **every** eval in the corpus, labelled or not. This
   * is the operational cost of the review band; the labelled `review` count
   * above is the accuracy question. They are different numbers and collapsing
   * them hides whichever one you were not looking at.
   */
  reviewVolume: number;
  /** Rows whose cached ensemble was too small to score at this setting. */
  insufficient: number;
  /** `agree / scored`, or `null` when nothing was scored. */
  agreement: number | null;
}

/** One labelled result that did not agree, with the evidence behind it. */
export interface Disagreement {
  trace: string;
  artifactType: ArtifactType;
  artifactName: string;
  evalName: string;
  grader: string;
  expected: LabelOutcome;
  actual: Outcome;
  kind: JoinKind;
  note?: string;
  skipReason?: string;
  /** Present for judged evals — the arithmetic behind the verdict. */
  consensus?: {
    votes: { pass: number; fail: number; partial: number; error: number };
    agreement: number;
    meanConfidence: number;
    runs: number;
  };
}

/** One row of a sweep: a setting, and what the corpus looks like under it. */
export interface SweepCell {
  /** Which knob this row varies. `baseline` holds every knob at its config. */
  axis: "baseline" | "ensembleRuns" | "zones.autoPass" | "zones.autoFail";
  /** The value of that knob on this row. */
  value: number;
  setting: JudgeSetting;
  counts: CalibrationCounts;
}

/** A `--max-*` threshold that was set, and whether the run cleared it. */
export interface CalibrationGate {
  name: "falsePass" | "falseFail" | "review";
  limit: number;
  actual: number;
  exceeded: boolean;
}

export interface CalibrationReport {
  labelsFile: string;
  /** Trace files evaluated, in batch order. */
  corpus: string[];
  /** The knobs the headline numbers were computed at. */
  setting: JudgeSetting;
  counts: CalibrationCounts;
  disagreements: Disagreement[];
  /** Labelled results that produced no evidence, kept out of the denominator. */
  unscored: Disagreement[];
  /** Present with `--sweep`; the baseline row is always first. */
  sweep?: SweepCell[];
  gates: CalibrationGate[];
  /** The underlying batch, so a reader can see the verdicts behind the count. */
  batch: BatchReport;
  warnings: string[];
  /** `0` measured cleanly; `1` a threshold was exceeded or a trace was lost. */
  exitCode: 0 | 1;
  costUsd: number;
  durationMs: number;
}

export type { EvalLabel, LabelOutcome };
