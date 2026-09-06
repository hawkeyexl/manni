/**
 * `manni tracevals run <trace...>` — evaluate many traces in one process and
 * report rates rather than a single verdict (ADR 01018).
 *
 * `runRun` stays the single-trace path and is untouched; this wraps the seams
 * it exposes. The reason a wrapper is not enough on its own is money: the judge
 * carries the cost budget, so it is built **once** by `prepareRun` and shared
 * across every trace. Building one per trace would make `maxCostUsd` a cap on
 * the largest trace instead of on the run, and a fifty-trace batch would bill
 * fifty times the configured ceiling while every report claimed to respect it.
 */
import { writeFile } from "node:fs/promises";
import {
  aggregate,
  type BatchOutcome,
  type BatchReportWithBudget,
} from "../aggregate.js";
import { discoverTraces } from "../trace/discover.js";
import { renderBatch, type ReportFormat } from "../reporters/index.js";
import { TracevalsError, type RunReport } from "../types.js";
import type { HistoryComparison } from "../history.js";
import {
  prepareRun,
  runOne,
  type RunSharedOptions,
} from "./run.js";

export interface BatchCommandOptions extends RunSharedOptions {
  /** Traces named on the command line, evaluated in this order. */
  traces?: string[];
  /** Discover every project in the session store instead of naming traces. */
  allProjects?: boolean;
  /** Keep only traces modified within this duration, e.g. `7d`. */
  since?: string;
  /** Maximum traces to evaluate, applied after newest-first sorting. */
  limit?: number;
  format?: ReportFormat;
  output?: string;
}

export interface BatchCommandResult {
  /** Carries `budget` when the shared judge budget was exhausted mid-corpus. */
  report: BatchReportWithBudget;
  rendered: string;
  /** Per-trace reports in batch order; absent entries failed to parse. */
  reports: RunReport[];
  /**
   * File-to-report pairs in batch order, including the traces that failed to
   * parse. `reports` cannot carry that pairing — an entry drops out when a
   * trace errors, so the indices stop lining up with the corpus. `calibrate`
   * joins labels on the file, so it needs the pairing (ADR 01022).
   */
  outcomes: BatchOutcome[];
  /** `--history` comparisons, one per trace that had a previous run. */
  comparisons: HistoryComparison[];
}

const UNITS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

/**
 * `--since 7d` → milliseconds. Deliberately strict: a duration this rejects is
 * an operational error, because the alternative — treating `7y` as zero, or as
 * "everything" — silently changes which sessions a gate looked at.
 */
export function parseSince(text: string): number {
  const match = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(text.trim());
  const unit = match?.[2];
  if (match === null || unit === undefined) {
    throw new TracevalsError(
      `--since must be a duration like 30m, 24h, 7d, or 2w, got "${text}"`,
    );
  }
  return Number(match[1]) * (UNITS[unit] as number);
}

/** True when any flag asks the session store to choose the traces. */
function usesDiscovery(options: BatchCommandOptions): boolean {
  return (
    options.allProjects === true ||
    options.since !== undefined ||
    options.limit !== undefined
  );
}

/**
 * Which traces this invocation evaluates, in the order they are reported.
 *
 * Named traces keep argv order; discovered ones keep `discoverTraces`' own
 * newest-first order. Both are stable for a fixed corpus, which is what makes
 * two runs comparable.
 */
export async function resolveBatchTraces(
  options: BatchCommandOptions,
): Promise<string[]> {
  const named = options.traces ?? [];
  if (named.length > 0 && usesDiscovery(options)) {
    // Silently ignoring one or the other is the failure mode here: a
    // `--limit 5` that did nothing, or a named trace that was quietly dropped.
    throw new TracevalsError(
      "name traces or select them with --all-projects/--since/--limit, not both",
    );
  }
  if (named.length > 0) return named;

  const listings = await discoverTraces({
    ...(options.allProjects !== undefined
      ? { allProjects: options.allProjects }
      : {}),
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  });

  const kept =
    options.since === undefined
      ? listings
      : (() => {
          const floor = Date.now() - parseSince(options.since);
          return listings.filter((l) => l.mtimeMs >= floor);
        })();

  if (kept.length === 0) {
    // Never exit 0 here. A gate that goes green because its selector matched
    // nothing is the false pass this tool exists to prevent, and it is
    // indistinguishable from a clean corpus in every downstream consumer.
    const how = [
      options.allProjects === true ? "--all-projects" : `project ${options.project ?? process.cwd()}`,
      options.since !== undefined ? `--since ${options.since}` : undefined,
      options.limit !== undefined ? `--limit ${options.limit}` : undefined,
    ]
      .filter((s) => s !== undefined)
      .join(", ");
    throw new TracevalsError(
      `no traces matched (${how}); run \`manni tracevals list\` to see what the session store holds`,
    );
  }
  return kept.map((l) => l.file);
}

export async function runBatch(
  options: BatchCommandOptions,
): Promise<BatchCommandResult> {
  const start = Date.now();
  const files = await resolveBatchTraces(options);

  // Once for the whole batch: the judge (and its budget), the resolved config,
  // and the grader plugins.
  const context = await prepareRun(options);

  const outcomes: BatchOutcome[] = [];
  const reports: RunReport[] = [];
  const comparisons: HistoryComparison[] = [];

  // Sequential on purpose. The budget gate is a running total, so traces have
  // to be charged against it in a defined order for an exhausted budget to be
  // reproducible; concurrency would make which traces got judged a race.
  for (const file of files) {
    const traceStart = Date.now();
    try {
      const { report, comparison } = await runOne(
        { ...options, tracePath: file },
        context,
      );
      outcomes.push({ file, report });
      reports.push(report);
      if (comparison) comparisons.push(comparison);
    } catch (err) {
      // ADR 01003's spirit: degrade, never abort. One unreadable file in a
      // corpus of fifty must not cost the other forty-nine their verdicts.
      outcomes.push({
        file,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - traceStart,
      });
    }
  }

  const report = aggregate(outcomes, {
    warnings: context.warnings,
    durationMs: Date.now() - start,
  });

  const rendered = renderBatch(report, options.format ?? "human");
  if (options.output) {
    await writeFile(options.output, rendered, "utf-8");
  }
  return { report, rendered, reports, outcomes, comparisons };
}
