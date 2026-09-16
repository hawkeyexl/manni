/**
 * The report `check` and `lint` share, and the bridge from term findings to
 * meta's `ValidationResult`, so the SARIF and JUnit renderers and the baseline
 * ratchet work unchanged, as cite's adapter does for citations.
 *
 * FieldError: schema `manni:term` (a builtin-shaped ref, so fingerprints and
 * rule ids never depend on where the command ran), keyword = the rule id after
 * `manni:term/`, instancePath `/<field>` for a lint finding and `""` otherwise.
 * The subject is the entry and what the finding says about it, with any
 * `file:line` taken out: a line moves when a page is edited above the entry,
 * and a moved finding is not a new one.
 *
 * A check finding names its field too, but the field stays out of its
 * instancePath and subject. Both are hashed into the fingerprint, and baselines
 * recorded a check finding's fingerprint before it named a field. Its message
 * already opens with the field, and SARIF and JUnit text drop meta's field
 * label, so nothing a reader sees is lost.
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
import type { TermFinding, TermSet } from "../types.js";

export const FINDING_FORMATS = ["pretty", "json", "github", "sarif", "junit"] as const;
export type FindingFormat = (typeof FINDING_FORMATS)[number];

/** JUnit `classname` for the term tool's findings. */
export const JUNIT_CLASSNAME = "manni.term";

/** What `check` and `lint` return. */
export interface TermReport {
  /** The findings reported: a baselined one is not among them. */
  findings: TermFinding[];
  /** The same findings as meta's results, for SARIF and JUnit. One per file. */
  results: ValidationResult[];
  summary: RunSummary;
  frame: FingerprintContext;
  /** Entries in the set. */
  terms: number;
  /** `concepts:` values the run read. */
  references: number;
  /** How a baseline shaped the run, when one did. */
  baseline?: BaselineSummary;
  /** Findings before the baseline, for the line a recording run prints. */
  found: number;
  /** Where the run stood, for the paths the reporters print. */
  cwd: string;
}

const LINE_REFERENCE = /:\d+\b/g;

function toFieldError(finding: TermFinding): FieldError {
  const keyword = finding.ruleId.startsWith(`${RULE_ID_PREFIX}/`)
    ? finding.ruleId.slice(RULE_ID_PREFIX.length + 1)
    : finding.ruleId;
  const field = finding.tool === undefined ? undefined : finding.field;
  const subject = [finding.id ?? "", field ?? "", finding.message.replace(LINE_REFERENCE, "")].join("\u0000");
  const error: FieldError = {
    schema: RULE_ID_PREFIX,
    instancePath: field === undefined ? "" : `/${field}`,
    message: finding.message,
    keyword,
    subject,
    severity: finding.severity,
  };
  if (finding.line !== undefined) error.line = finding.line;
  return error;
}

/**
 * One result per file: every file a term was read from, clean or not, and
 * every file a finding sits in. `origin` maps each error back to its finding.
 */
export function toResults(
  set: TermSet,
  findings: readonly TermFinding[],
): { results: ValidationResult[]; origin: Map<FieldError, TermFinding> } {
  const origin = new Map<FieldError, TermFinding>();
  const byFile = new Map<string, FieldError[]>();
  for (const term of set.terms) {
    if (!byFile.has(term.location.file)) byFile.set(term.location.file, []);
  }
  for (const finding of findings) {
    const error = toFieldError(finding);
    origin.set(error, finding);
    const list = byFile.get(finding.file) ?? [];
    list.push(error);
    byFile.set(finding.file, list);
  }
  const results = [...byFile.keys()].sort().map((file): ValidationResult => {
    const errors = byFile.get(file) ?? [];
    return { file, format: "term", ok: !errors.some(isErrorSeverity), schemas: [RULE_ID_PREFIX], errors };
  });
  return { results, origin };
}

/** The run summary meta's renderers read, from results a baseline may have thinned. */
export function summarize(results: readonly ValidationResult[], baseline?: BaselineSummary): RunSummary {
  const failed = results.filter((r) => !r.ok).length;
  const count = (keep: (e: FieldError) => boolean): number =>
    results.reduce((n, r) => n + r.errors.filter(keep).length, 0);
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

/** The findings still reported once a baseline has thinned the results. */
export function reportedFindings(
  results: readonly ValidationResult[],
  origin: ReadonlyMap<FieldError, TermFinding>,
): TermFinding[] {
  const kept: TermFinding[] = [];
  for (const result of results) {
    for (const error of result.errors) {
      const finding = origin.get(error);
      if (finding !== undefined) kept.push(finding);
    }
  }
  return kept.sort(compareFindings);
}

function compareFindings(a: TermFinding, b: TermFinding): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  const lineA = a.line ?? 0;
  const lineB = b.line ?? 0;
  if (lineA !== lineB) return lineA - lineB;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}
