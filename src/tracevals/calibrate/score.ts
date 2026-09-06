/**
 * Joining labels to results, and re-scoring cached verdicts (ADR 01022).
 *
 * Everything here is pure: results and labels in, counts out. That is what
 * makes a sweep free. A judged eval's `ConsensusResult` carries the whole
 * `JudgeRun[]` it was built from, so a different zone threshold — or a smaller
 * ensemble — is a fresh call to `computeConsensus`/`zoneFor` over runs the
 * corpus already produced, not a fresh call to a provider.
 */
import { computeConsensus, zoneFor } from "@hawkeyexl/inference";
import type { BatchOutcome } from "../aggregate.js";
import type { EvalResult, Outcome } from "../types.js";
import { labelKey, type EvalLabel, type LabelOutcome } from "./labels.js";
import type {
  CalibrationCounts,
  Disagreement,
  JoinKind,
  JudgeSetting,
} from "./types.js";

/**
 * How one label met one result, over the full (expected × actual) grid.
 *
 * The order matters. `skipped` and `error` are tested *first*, so a labelled
 * eval that produced no evidence can never be counted as agreement — the same
 * rule that keeps an errored judge run from becoming a silent pass.
 */
export function classify(expected: LabelOutcome, actual: Outcome): JoinKind {
  if (actual === "skipped") return "skipped";
  if (actual === "error") return "error";
  if (actual === expected) return "agree";
  if (expected === "fail" && actual === "pass") return "false-pass";
  if (expected === "pass" && actual === "fail") return "false-fail";
  if (actual === "needs-review") return "review";
  return "missed-review";
}

export interface JoinedLabel {
  label: EvalLabel;
  result: EvalResult;
}

export interface JoinResult {
  joined: JoinedLabel[];
  /**
   * Labels that matched no result. Never silently dropped: a typo'd eval id
   * would otherwise deflate every count on the report by one.
   */
  unmatched: EvalLabel[];
  /**
   * Labels that omit `type:` over a name two artifact kinds both answer. Never
   * bound to one of them: a skill and the slash command that types it can share
   * a name in one trace, and picking whichever was indexed last would measure
   * agreement against a verdict belonging to something else — a false pass or
   * false fail reported with total confidence.
   */
  ambiguous: AmbiguousLabel[];
}

/** An untyped label and every result its name matched. */
export interface AmbiguousLabel {
  label: EvalLabel;
  candidates: EvalResult[];
}

/**
 * Match each label to the result its trace produced. The key is
 * `(trace file, artifact name, eval id)`, with the artifact *type* joining too
 * when the label states one — needed only for a skill and an agent sharing a
 * name, which is legal and does happen.
 */
export function joinLabels(
  outcomes: BatchOutcome[],
  labels: EvalLabel[],
): JoinResult {
  // Typed keys are unique by construction. Untyped ones are not: two artifact
  // kinds may answer the same name, so keep every candidate rather than
  // letting the last one indexed overwrite the rest.
  const byType = new Map<string, EvalResult>();
  const byName = new Map<string, EvalResult[]>();
  for (const outcome of outcomes) {
    if (!("report" in outcome)) continue;
    for (const result of outcome.report.evalResults) {
      byType.set(
        labelKey(
          outcome.file,
          result.artifactName,
          result.evalName,
          result.artifactType,
        ),
        result,
      );
      const key = labelKey(outcome.file, result.artifactName, result.evalName);
      const seen = byName.get(key);
      if (seen === undefined) byName.set(key, [result]);
      else seen.push(result);
    }
  }

  const joined: JoinedLabel[] = [];
  const unmatched: EvalLabel[] = [];
  const ambiguous: AmbiguousLabel[] = [];
  for (const label of labels) {
    if (label.type !== undefined) {
      const result = byType.get(
        labelKey(label.traceFile, label.artifact, label.eval, label.type),
      );
      if (result === undefined) unmatched.push(label);
      else joined.push({ label, result });
      continue;
    }
    const candidates =
      byName.get(labelKey(label.traceFile, label.artifact, label.eval)) ?? [];
    const kinds = new Set(candidates.map((r) => r.artifactType));
    if (candidates.length === 0) unmatched.push(label);
    else if (kinds.size > 1) ambiguous.push({ label, candidates });
    else joined.push({ label, result: candidates[0] as EvalResult });
  }
  return { joined, unmatched, ambiguous };
}

export interface Rescored {
  outcome: Outcome;
  /** The cache held fewer runs than the setting asks for. */
  insufficient: boolean;
  /**
   * The arithmetic **at this setting**, not at the setting the corpus was
   * judged with. A sweep judges deeper than most of its cells, so reporting
   * the full cached ensemble beside a re-scored verdict would show a reader
   * evidence that does not add up to the outcome next to it.
   */
  consensus?: Disagreement["consensus"];
}

/** The numbers a reader needs from a consensus, without the run bodies. */
const summarise = (
  consensus: NonNullable<EvalResult["consensus"]>,
): Disagreement["consensus"] => ({
  votes: consensus.votes,
  agreement: consensus.agreement,
  meanConfidence: consensus.meanConfidence,
  runs: consensus.runs.length,
});

/**
 * What this result would have been at a different setting.
 *
 * A result with no `consensus` — deterministic, `human`, skipped, errored — is
 * returned untouched: zones and ensemble size do not reach it, and pretending
 * otherwise would make a sweep look like it moved things it cannot move.
 *
 * A smaller `ensembleRuns` re-scores the **first k** of the cached runs. That
 * is a sub-sample of the ensemble that was actually drawn, not a fresh k-run
 * ensemble; at temperature 0 the runs are independent samples of one prompt,
 * so it is an honest estimate, and the alternative is paying per grid cell.
 */
export function rescore(result: EvalResult, setting: JudgeSetting): Rescored {
  const consensus = result.consensus;
  if (consensus === undefined) {
    return { outcome: result.outcome, insufficient: false };
  }
  const runs = consensus.runs;
  if (runs.length < setting.ensembleRuns) {
    // Never scale up by guessing. Report the setting as unreachable and leave
    // the row at what it actually was.
    return { outcome: result.outcome, insufficient: true };
  }
  const slice = runs.slice(0, setting.ensembleRuns);
  const base = computeConsensus(slice);
  const zone = zoneFor(base, setting.zones);
  return {
    outcome:
      zone === "auto-pass" ? "pass" : zone === "auto-fail" ? "fail" : "needs-review",
    insufficient: false,
    consensus: {
      votes: base.votes,
      agreement: base.agreement,
      meanConfidence: base.meanConfidence,
      runs: slice.length,
    },
  };
}

const emptyCounts = (): CalibrationCounts => ({
  labels: 0,
  scored: 0,
  agree: 0,
  falsePass: 0,
  falseFail: 0,
  review: 0,
  missedReview: 0,
  errored: 0,
  skipped: 0,
  reviewVolume: 0,
  insufficient: 0,
  agreement: null,
});

export interface ScoreInput {
  joined: JoinedLabel[];
  /** Every eval result in the corpus, for the corpus-wide review volume. */
  all: EvalResult[];
}

export interface ScoreResult {
  counts: CalibrationCounts;
  disagreements: Disagreement[];
  unscored: Disagreement[];
}

/**
 * Score the joined corpus, optionally at a setting other than the one it ran
 * at. Omit `setting` and the reported outcomes are used verbatim, so the
 * headline numbers of a plain `calibrate` are exactly the verdicts `run`
 * would have produced — no re-derivation standing between the two commands.
 */
export function score(input: ScoreInput, setting?: JudgeSetting): ScoreResult {
  const counts = emptyCounts();
  const disagreements: Disagreement[] = [];
  const unscored: Disagreement[] = [];

  for (const result of input.all) {
    const outcome =
      setting === undefined ? result.outcome : rescore(result, setting).outcome;
    if (outcome === "needs-review") counts.reviewVolume += 1;
  }

  for (const { label, result } of input.joined) {
    const scored: Rescored =
      setting === undefined
        ? { outcome: result.outcome, insufficient: false }
        : rescore(result, setting);
    if (scored.insufficient) counts.insufficient += 1;
    const kind = classify(label.expected, scored.outcome);
    counts.labels += 1;

    const row: Disagreement = {
      trace: label.traceFile,
      artifactType: result.artifactType,
      artifactName: result.artifactName,
      evalName: result.evalName,
      grader: result.grader,
      expected: label.expected,
      actual: scored.outcome,
      kind,
      ...(label.note !== undefined ? { note: label.note } : {}),
      ...(result.skipReason !== undefined
        ? { skipReason: result.skipReason }
        : {}),
      // At the setting being scored, falling back to the run's own numbers
      // when nothing was re-scored.
      ...(() => {
        const c =
          scored.consensus ??
          (result.consensus !== undefined ? summarise(result.consensus) : undefined);
        return c !== undefined ? { consensus: c } : {};
      })(),
    };

    switch (kind) {
      case "skipped":
        counts.skipped += 1;
        unscored.push(row);
        break;
      case "agree":
        counts.agree += 1;
        counts.scored += 1;
        break;
      case "false-pass":
        counts.falsePass += 1;
        counts.scored += 1;
        disagreements.push(row);
        break;
      case "false-fail":
        counts.falseFail += 1;
        counts.scored += 1;
        disagreements.push(row);
        break;
      case "review":
        counts.review += 1;
        counts.scored += 1;
        disagreements.push(row);
        break;
      case "missed-review":
        counts.missedReview += 1;
        counts.scored += 1;
        disagreements.push(row);
        break;
      case "error":
        counts.errored += 1;
        counts.scored += 1;
        disagreements.push(row);
        break;
    }
  }

  counts.agreement = counts.scored > 0 ? counts.agree / counts.scored : null;
  // Byte comparison, so the ubuntu and windows legs order a report the same
  // way and two runs over one corpus stay diffable.
  const byRow = (a: Disagreement, b: Disagreement): number => {
    const ka = `${a.kind} ${a.trace} ${a.artifactName} ${a.evalName}`;
    const kb = `${b.kind} ${b.trace} ${b.artifactName} ${b.evalName}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  disagreements.sort(byRow);
  unscored.sort(byRow);
  return { counts, disagreements, unscored };
}
