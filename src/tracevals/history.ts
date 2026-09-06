/**
 * Run history: append-only JSONL of run summaries plus a comparison against
 * the previous run of the same trace, for spotting regressions after criteria
 * or artifact changes. History failures never abort a run.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvalResult, RunReport } from "./types.js";
import { programName } from "../shared/program-name.js";

export interface HistoryEval {
  artifact: string;
  evalName: string;
  outcome: EvalResult["outcome"];
}

export interface HistoryEntry {
  timestamp: string;
  traceFile: string;
  sessionId?: string;
  project: string;
  summary: RunReport["summary"];
  exitCode: number;
  costUsd: number;
  evals: HistoryEval[];
}

export interface HistoryComparison {
  previousTimestamp: string;
  regressions: HistoryEval[];
  improvements: HistoryEval[];
  added: string[];
  removed: string[];
}

export function entryFor(report: RunReport): HistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    traceFile: report.trace.file,
    ...(report.trace.sessionId !== undefined
      ? { sessionId: report.trace.sessionId }
      : {}),
    project: report.trace.cwd,
    summary: report.summary,
    exitCode: report.exitCode,
    costUsd: report.costUsd,
    evals: report.evalResults.map((r) => ({
      artifact: r.artifact,
      evalName: r.evalName,
      outcome: r.outcome,
    })),
  };
}

export async function appendHistory(
  file: string,
  report: RunReport,
): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(entryFor(report))}\n`, "utf-8");
  } catch (err) {
    console.warn(
      `${programName()}: could not write history at ${file} (${(err as Error).message}). Continuing.`,
    );
  }
}

export async function loadHistory(file: string): Promise<HistoryEntry[]> {
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as HistoryEntry);
    } catch {
      continue; // Corrupt line — skip, never fatal.
    }
  }
  return entries;
}

const GOOD = new Set<EvalResult["outcome"]>(["pass"]);
const BAD = new Set<EvalResult["outcome"]>(["fail", "error"]);

/** Compare against the most recent prior entry for the same session/trace. */
export function compareToLast(
  history: HistoryEntry[],
  report: RunReport,
): HistoryComparison | null {
  const key = report.trace.sessionId ?? report.trace.file;
  const previous = [...history]
    .reverse()
    .find((e) => (e.sessionId ?? e.traceFile) === key);
  if (!previous) return null;

  const keyOf = (e: HistoryEval) => `${e.artifact}::${e.evalName}`;
  const before = new Map(previous.evals.map((e) => [keyOf(e), e]));
  const current = entryFor(report).evals;
  const currentKeys = new Set(current.map(keyOf));

  const regressions: HistoryEval[] = [];
  const improvements: HistoryEval[] = [];
  const added: string[] = [];
  for (const e of current) {
    const prior = before.get(keyOf(e));
    if (!prior) {
      added.push(e.evalName);
      continue;
    }
    if (GOOD.has(prior.outcome) && BAD.has(e.outcome)) regressions.push(e);
    if (BAD.has(prior.outcome) && GOOD.has(e.outcome)) improvements.push(e);
  }
  const removed = previous.evals
    .filter((e) => !currentKeys.has(keyOf(e)))
    .map((e) => e.evalName);

  return {
    previousTimestamp: previous.timestamp,
    regressions,
    improvements,
    added,
    removed,
  };
}
