/**
 * The report `check` returns, and the bridge from strategy findings to meta's
 * `ValidationResult`, so the SARIF and JUnit renderers and the baseline
 * ratchet work unchanged, as term's adapter does.
 *
 * FieldError: schema `manni:strategy`, keyword = the rule, instancePath
 * `/<field>` when the finding concerns one field and `""` when it concerns a
 * whole record. The subject is the record, the field and what the finding
 * says before its advice, with any `file:line` taken out, so a moved line or
 * a reworded fix moves no baseline.
 */
import {
  isErrorSeverity,
  type BaselineSummary,
  type FieldError,
  type FingerprintContext,
  type RunSummary,
  type ValidationResult,
} from "../../meta/index.js";
import { RULE_ID_PREFIX } from "../core/severity.js";
import type { StrategyFinding, StrategySet } from "../types.js";

export const FINDING_FORMATS = ["pretty", "json", "github", "sarif", "junit"] as const;
export type FindingFormat = (typeof FINDING_FORMATS)[number];

/** JUnit `classname` for the strategy tool's findings. */
export const JUNIT_CLASSNAME = "manni.strategy";

export interface StrategyReport {
  /** The findings reported: a baselined one is not among them. */
  findings: StrategyFinding[];
  /** The same findings as meta's results, for SARIF and JUnit. One per file. */
  results: ValidationResult[];
  /** Each error in `results` to the finding it came from. */
  origin: ReadonlyMap<FieldError, StrategyFinding>;
  summary: RunSummary;
  frame: FingerprintContext;
  /** Records in the set. */
  records: number;
  /** Values of audiences:, personas:, journeys: and audience: the run read. */
  references: number;
  baseline?: BaselineSummary;
  /** Findings before the baseline, for the line a recording run prints. */
  found: number;
  /** Where the run stood, for the paths the reporters print. */
  cwd: string;
  /** What finding files are relative to. */
  base: string;
}

const LINE_REFERENCE = /:\d+\b/g;

function toFieldError(finding: StrategyFinding): FieldError {
  const said = finding.key ?? finding.message;
  const subject = [finding.id ?? "", finding.field ?? "", said.replace(LINE_REFERENCE, "")].join("\u0000");
  const error: FieldError = {
    schema: RULE_ID_PREFIX,
    instancePath: finding.field === undefined ? "" : `/${finding.field}`,
    message: finding.message,
    keyword: finding.rule,
    subject,
    severity: finding.severity,
  };
  if (finding.line !== undefined) error.line = finding.line;
  return error;
}

/** One result per file: every record's file, every file a reference was read from, and every file a finding sits in. */
export function toResults(
  set: StrategySet,
  findings: readonly StrategyFinding[],
): { results: ValidationResult[]; origin: Map<FieldError, StrategyFinding> } {
  const origin = new Map<FieldError, StrategyFinding>();
  const byFile = new Map<string, FieldError[]>();
  for (const { file } of [...set.records, ...set.references]) if (!byFile.has(file)) byFile.set(file, []);
  for (const finding of findings) {
    const error = toFieldError(finding);
    origin.set(error, finding);
    byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), error]);
  }
  const results = [...byFile.keys()].sort().map((file): ValidationResult => {
    const errors = byFile.get(file) ?? [];
    return { file, format: "strategy", ok: !errors.some(isErrorSeverity), schemas: [RULE_ID_PREFIX], errors };
  });
  return { results, origin };
}

/** The run summary meta's renderers read, from results a baseline may have thinned. */
export function summarize(results: readonly ValidationResult[], baseline?: BaselineSummary): RunSummary {
  const failed = results.filter((r) => !r.ok).length;
  const count = (keep: (e: FieldError) => boolean): number => results.reduce((n, r) => n + r.errors.filter(keep).length, 0);
  const warnings = count((e) => e.severity === "warning");
  const notices = count((e) => e.severity === "notice");
  return {
    files: results.length,
    passed: results.length - failed,
    failed,
    errors: count(isErrorSeverity),
    ...(warnings > 0 ? { warnings } : {}),
    ...(notices > 0 ? { notices } : {}),
    ...(baseline ? { baseline } : {}),
  };
}

/** The findings still reported once a baseline has thinned the results, in report order. */
export function reportedFindings(
  results: readonly ValidationResult[],
  origin: ReadonlyMap<FieldError, StrategyFinding>,
  order: readonly StrategyFinding[],
): StrategyFinding[] {
  const kept = new Set<StrategyFinding>();
  for (const result of results) {
    for (const error of result.errors) {
      const finding = origin.get(error);
      if (finding !== undefined) kept.add(finding);
    }
  }
  return order.filter((finding) => kept.has(finding));
}
