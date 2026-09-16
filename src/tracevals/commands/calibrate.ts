/**
 * `manni tracevals calibrate <traces...> --labels <file>` (ADR 01022).
 *
 * The tool could report what it decided; it could not report whether it was
 * right. This command runs the batch (ADR 01018), joins the results against a
 * human's answers, and reports the three numbers the calibration page used to
 * ask people to count by hand — false passes, false fails, and review volume —
 * plus which eval disagreed.
 *
 * `--sweep` costs no inference beyond the one run it already made: a judged
 * eval's consensus carries the whole `JudgeRun[]`, so a different zone
 * threshold or a smaller ensemble is arithmetic over verdicts already on disk.
 * Read-only throughout — labels, traces, and artifacts are never written.
 */
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { discoverConfig } from "../core/config.js";
import { renderCalibration, type ReportFormat } from "../reporters/index.js";
import { TracevalsError, type EvalResult } from "../types.js";
import { loadLabels, type EvalLabel } from "../calibrate/labels.js";
import { joinLabels, score, type AmbiguousLabel } from "../calibrate/score.js";
import type {
  CalibrationGate,
  CalibrationReport,
  JudgeSetting,
  SweepCell,
} from "../calibrate/types.js";
import {
  resolveBatchTraces,
  runBatch,
  type BatchCommandOptions,
} from "./batch.js";

export interface CalibrateCommandOptions extends BatchCommandOptions {
  /** Overrides `calibrate.labels`; resolved against the working directory. */
  labels?: string;
  /** Re-score the corpus across the configured grid. */
  sweep?: boolean;
  /** Thresholds; undefined defers to the config, which defaults to no gate. */
  maxFalsePass?: number;
  maxFalseFail?: number;
  maxReview?: number;
}

export interface CalibrateCommandResult {
  report: CalibrationReport;
  rendered: string;
}

/** Largest ensemble the sweep needs cached, so every cell can be re-scored. */
function sweepDepth(grid: number[], baseline: number): number {
  return Math.max(baseline, ...grid);
}

export async function runCalibrate(
  options: CalibrateCommandOptions,
): Promise<CalibrateCommandResult> {
  const start = Date.now();
  const { config, dir: configDir } = await discoverConfig(
    options.configDir ?? process.cwd(),
  );

  // A flag overrides the config rather than bypassing it (CLAUDE.md,
  // "Config <-> CLI flags"). An explicit --labels is a working-directory path,
  // the way every other path argument on the CLI is; the config default is a
  // project path and resolves against the config file's directory.
  const labelsFile =
    options.labels !== undefined
      ? resolve(options.labels)
      : resolve(configDir, config.calibrate.labels);
  const labels = await loadLabels(labelsFile);

  // Resolve the corpus once and hand the list to the batch, so the membership
  // check below cannot disagree with what actually ran.
  const corpus = (await resolveBatchTraces(options)).map((f) => resolve(f));
  assertLabelsInCorpus(labels, corpus, labelsFile);

  const baseline: JudgeSetting = {
    ensembleRuns: options.runs ?? config.judge.ensembleRuns,
    zones: config.judge.zones,
  };
  const grid = config.calibrate.sweep;
  // With --sweep the corpus is judged once at the deepest ensemble the grid
  // asks for, and every cell — the baseline included — is re-scored from those
  // runs. Judging at the configured depth instead would make the larger cells
  // unscoreable, and judging per cell would multiply the bill by the grid.
  const depth =
    options.sweep === true
      ? sweepDepth(grid.ensembleRuns, baseline.ensembleRuns)
      : baseline.ensembleRuns;

  const batch = await runBatch({
    ...options,
    traces: corpus,
    allProjects: undefined,
    since: undefined,
    limit: undefined,
    runs: depth,
    // The calibration report is the deliverable; rendering the batch as well
    // would write the wrong thing to --output.
    format: "json",
    output: undefined,
  });

  const all: EvalResult[] = [];
  for (const outcome of batch.outcomes) {
    if ("report" in outcome) all.push(...outcome.report.evalResults);
  }
  const { joined, unmatched, ambiguous } = joinLabels(batch.outcomes, labels);
  assertNoUnmatched(unmatched, batch, labelsFile);
  assertNoAmbiguous(ambiguous, labelsFile);

  // Without a sweep the reported outcomes are used verbatim, so the headline
  // numbers are exactly the verdicts `run` produced. With one, the corpus was
  // judged deeper than the configured ensemble, so the baseline row has to be
  // re-scored back down to it.
  const scored = score(
    { joined, all },
    options.sweep === true ? baseline : undefined,
  );

  const sweep =
    options.sweep === true
      ? buildSweep({ joined, all }, baseline, grid)
      : undefined;

  const gates = buildGates(scored.counts, {
    falsePass: options.maxFalsePass ?? config.calibrate.maxFalsePass,
    falseFail: options.maxFalseFail ?? config.calibrate.maxFalseFail,
    review: options.maxReview ?? config.calibrate.maxReview,
  });

  const warnings = [...batch.report.warnings];
  if (scored.counts.insufficient > 0) {
    warnings.push(
      `${scored.counts.insufficient} labelled eval(s) had fewer cached runs than the setting asks for and were left at their reported outcome`,
    );
  }

  // A measurement that measured nothing must not report a pass.
  //
  // Every label joining to a `skipped` result — `--deterministic-only` over
  // ai-graded labels, a budget exhausted on the first trace — leaves `scored`
  // at 0, `agreement` at null, and each threshold reading "0 of at most N, not
  // exceeded". The gates are not lying; the denominator behind them is empty.
  // Saying so is the report's job, and exit 0 would say the opposite.
  const measuredNothing = scored.counts.scored === 0;
  if (measuredNothing) {
    warnings.push(
      `no labelled eval produced evidence: ${scored.counts.labels} label(s) all joined to a skipped result, ` +
        `so agreement and every --max-* threshold are computed over an empty denominator`,
    );
  }

  const report: CalibrationReport = {
    labelsFile,
    corpus,
    setting: baseline,
    counts: scored.counts,
    disagreements: scored.disagreements,
    unscored: scored.unscored,
    ...(sweep !== undefined ? { sweep } : {}),
    gates,
    batch: batch.report,
    warnings,
    // A calibration run is a measurement, not a gate: disagreement is the
    // finding, not a failure. Exit 1 only when a threshold was asked for and
    // missed, or when the measurement itself is incomplete — a trace lost, the
    // shared judge budget cut the corpus short, or nothing scored at all. An
    // incomplete number presented as a clean one is worse than no number.
    exitCode:
      gates.some((g) => g.exceeded) ||
      batch.report.summary.tracesErrored > 0 ||
      batch.report.budget !== undefined ||
      measuredNothing
        ? 1
        : 0,
    costUsd: batch.report.costUsd,
    durationMs: Date.now() - start,
  };

  const rendered = renderCalibration(report, options.format ?? "human");
  if (options.output) await writeFile(options.output, rendered, "utf-8");
  return { report, rendered };
}

/**
 * Every label must name a trace this run evaluates. Checked before the batch,
 * because the alternative is paying for a corpus and then being told the file
 * was misspelled.
 */
function assertLabelsInCorpus(
  labels: EvalLabel[],
  corpus: string[],
  labelsFile: string,
): void {
  const known = new Set(corpus);
  const missing = [...new Set(labels.filter((l) => !known.has(l.traceFile)).map((l) => l.trace))];
  if (missing.length === 0) return;
  throw new TracevalsError(
    `${labelsFile}: label(s) name trace(s) not in the corpus: ${missing.join(", ")}. ` +
      `The corpus is: ${corpus.map((f) => basename(f)).join(", ")}`,
  );
}

/**
 * A label that matched nothing is an error, not a quiet omission.
 *
 * It has to be: a typo'd eval id contributes to no count, so the report would
 * read as a cleaner corpus than it is — the same silent-nothing failure the
 * empty-selector rule exists to prevent (ADR 01018).
 */
function assertNoUnmatched(
  unmatched: EvalLabel[],
  batch: { outcomes: { file: string; report?: { evalResults: EvalResult[] } }[] },
  labelsFile: string,
): void {
  if (unmatched.length === 0) return;
  const lines = unmatched.map((label) => {
    const outcome = batch.outcomes.find((o) => o.file === label.traceFile);
    const results = outcome?.report?.evalResults ?? [];
    const sameArtifact = results.filter(
      (r) => r.artifactName === label.artifact,
    );
    const hint =
      sameArtifact.length > 0
        ? `that trace evaluated ${sameArtifact.map((r) => r.evalName).sort().join(", ")} for "${label.artifact}"`
        : `that trace resolved no artifact named "${label.artifact}" — it evaluated ${
            [...new Set(results.map((r) => r.artifactName))].sort().join(", ") ||
            "nothing"
          }`;
    return `  ${label.artifact} › ${label.eval} on ${basename(label.traceFile)} (${hint})`;
  });
  throw new TracevalsError(
    `${labelsFile}: label(s) matched no eval result:\n${lines.join("\n")}`,
  );
}

/**
 * A label that omits `type:` over a name two artifact kinds both answer cannot
 * be resolved, and must not be guessed. Binding it to whichever result was
 * indexed last would score agreement against a verdict belonging to a
 * different artifact — the report would read as measured when it is wrong,
 * which is the one thing this command exists not to do.
 *
 * Operational, like `assertNoUnmatched`: the labels file is under-specified,
 * so this is exit 2 (bad input), not exit 1 (a check failed).
 */
function assertNoAmbiguous(
  ambiguous: AmbiguousLabel[],
  labelsFile: string,
): void {
  if (ambiguous.length === 0) return;
  const lines = ambiguous.map(({ label, candidates }) => {
    const kinds = [...new Set(candidates.map((r) => r.artifactType))].sort();
    return `  ${label.artifact} › ${label.eval} on ${basename(label.traceFile)} matches ${kinds.join(" and ")} — add \`type:\` to say which`;
  });
  throw new TracevalsError(
    `${labelsFile}: label(s) name an artifact two kinds answer:\n${lines.join("\n")}`,
  );
}

function buildGates(
  counts: { falsePass: number; falseFail: number; reviewVolume: number },
  limits: { falsePass?: number; falseFail?: number; review?: number },
): CalibrationGate[] {
  const gates: CalibrationGate[] = [];
  const add = (
    name: CalibrationGate["name"],
    limit: number | undefined,
    actual: number,
  ): void => {
    if (limit === undefined) return;
    gates.push({ name, limit, actual, exceeded: actual > limit });
  };
  add("falsePass", limits.falsePass, counts.falsePass);
  add("falseFail", limits.falseFail, counts.falseFail);
  add("review", limits.review, counts.reviewVolume);
  return gates;
}

/**
 * One axis at a time, every other knob held at its configured value.
 *
 * A full cross-product would be dozens of rows and would answer a question
 * nobody asked; calibration is "move one knob, re-run, recount", and the
 * per-axis shape is what makes a row readable as *the effect of that knob*.
 */
function buildSweep(
  input: Parameters<typeof score>[0],
  baseline: JudgeSetting,
  grid: { ensembleRuns: number[]; autoPass: number[]; autoFail: number[] },
): SweepCell[] {
  const cell = (
    axis: SweepCell["axis"],
    value: number,
    setting: JudgeSetting,
  ): SweepCell => ({
    axis,
    value,
    setting,
    counts: score(input, setting).counts,
  });

  const cells: SweepCell[] = [
    cell("baseline", baseline.ensembleRuns, baseline),
  ];
  for (const runs of [...grid.ensembleRuns].sort((a, b) => a - b)) {
    cells.push(
      cell("ensembleRuns", runs, { ensembleRuns: runs, zones: baseline.zones }),
    );
  }
  for (const autoPass of [...grid.autoPass].sort((a, b) => a - b)) {
    cells.push(
      cell("zones.autoPass", autoPass, {
        ensembleRuns: baseline.ensembleRuns,
        zones: { autoPass, autoFail: baseline.zones.autoFail },
      }),
    );
  }
  for (const autoFail of [...grid.autoFail].sort((a, b) => a - b)) {
    cells.push(
      cell("zones.autoFail", autoFail, {
        ensembleRuns: baseline.ensembleRuns,
        zones: { autoPass: baseline.zones.autoPass, autoFail },
      }),
    );
  }
  return cells;
}

export type { ReportFormat };
