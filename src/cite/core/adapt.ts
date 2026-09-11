/**
 * Findings → meta's `ValidationResult`, so the github/sarif/junit reporters
 * and the baseline ratchet work unchanged.
 *
 * FieldError: schema "manni:cite" (matches BUILTIN_ID, so canonicalSchemaRef
 * leaves it alone), keyword = rule, instancePath "/citations/N" for a
 * frontmatter entry or "" for an inline one, subject = id ?? integrity (stable
 * across a move and a line shift; changes only on re-mint), line, severity.
 * `ok` is true iff no error-severity finding.
 *
 * Every message is spelled from the page's own `src`. `resolvedPath`,
 * `commitsSince` and `diff` never enter a message: they are pretty-only
 * fields, shown under `--reveal` and `--show-diff`.
 */
import { isErrorSeverity, type FieldError, type ValidationResult } from "../../meta/index.js";
import type {
  CitationFinding,
  CitationResult,
  CitationStatus,
  CiteRule,
  CiteSeverity,
  PageCitationReport,
} from "../types.js";
import { parseSrc } from "./range.js";
import { RULE_ID_PREFIX, ruleId } from "./severity.js";

/** The seven characters a person reads a commit by. */
function short(commit: string): string {
  return commit.slice(0, 7);
}

function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/** Whether the page spelled this source encrypted. */
function citesEncrypted(src: string): boolean {
  try {
    return parseSrc(src).encrypted;
  } catch {
    return false;
  }
}

/**
 * Why an encrypted source is missing, in words that never name the path. A
 * plain path names its own file, so the bare status says the rest.
 */
function missingMessage(result: CitationResult): string {
  if (!citesEncrypted(result.citation.src)) return "missing";
  switch (result.missingReason) {
    case "no-key":
      return "missing (no encryption key is available to decrypt it)";
    case "undecryptable":
      return "missing (does not decrypt under the current key)";
    case "untracked":
      return "missing (no tracked file matches; wrong --root?)";
    case "unreadable":
    case undefined:
      return "missing";
  }
}

/** The one place a finding's message is composed, per rule. */
export function messageFor(result: CitationResult): string {
  switch (result.status) {
    case "current":
      return "current";
    case "skipped":
      return "skipped";
    case "moved":
      return `moved -> ${result.newSrc ?? "?"}`;
    case "moved-ambiguous": {
      const candidates = result.candidates ?? [];
      return `moved, ${plural(candidates.length, "candidate")} (${candidates.join(", ")}); widen the range`;
    }
    case "changed": {
      if (result.commit === undefined) return "changed";
      const at = short(result.commit);
      if (result.historyAvailable === false) {
        return `changed (history unavailable: commit ${at} not found; fetch-depth: 0)`;
      }
      if (result.commitsSince === undefined) return `changed since ${at}`;
      return `changed since ${at}, ${plural(result.commitsSince.length, "commit")}`;
    }
    case "never-true":
      return result.commit === undefined
        ? "never true: the pin does not match at the recorded commit"
        : `never true: the pin does not match at ${short(result.commit)}`;
    case "missing":
      return missingMessage(result);
  }
}

/** The rule a status reports under, or undefined for a status that is not a finding. */
function ruleOf(status: CitationStatus): CiteRule | undefined {
  return status === "skipped" ? undefined : status;
}

/** Findings for classified results under a severity table; `off` rules produce none. */
export function findingsFor(
  results: readonly CitationResult[],
  severity: Readonly<Record<CiteRule, CiteSeverity>>,
): CitationFinding[] {
  const out: CitationFinding[] = [];
  for (const result of results) {
    const rule = ruleOf(result.status);
    if (rule === undefined) continue;
    const level = severity[rule];
    if (level === "off") continue;
    const finding: CitationFinding = {
      rule,
      ruleId: ruleId(rule),
      severity: level,
      message: messageFor(result),
    };
    const line = result.origin.anchorLine ?? result.origin.line;
    if (line !== undefined) finding.line = line;
    if (result.citation.id !== undefined) finding.id = result.citation.id;
    finding.src = result.citation.src;
    if (result.newSrc !== undefined) finding.newSrc = result.newSrc;
    if (result.origin.kind === "frontmatter") finding.index = result.origin.index;
    out.push(finding);
  }
  return out;
}

/**
 * The integrity of the citation a finding is about, for the fingerprint
 * subject of an entry with no id. A frontmatter finding names its index; an
 * inline one is matched by the line it anchors to or sits on.
 */
function integrityFor(finding: CitationFinding, results: readonly CitationResult[]): string | undefined {
  for (const result of results) {
    const { origin } = result;
    if (finding.index !== undefined) {
      if (origin.kind === "frontmatter" && origin.index === finding.index) return result.citation.integrity;
      continue;
    }
    if (origin.kind !== "inline" || finding.line === undefined) continue;
    if (origin.anchorLine === finding.line || origin.line === finding.line) return result.citation.integrity;
  }
  return undefined;
}

export function toValidationResult(report: PageCitationReport): ValidationResult {
  const errors: FieldError[] = report.findings.map((finding) => {
    const error: FieldError = {
      schema: RULE_ID_PREFIX,
      instancePath: finding.index === undefined ? "" : `/citations/${String(finding.index)}`,
      message: finding.message,
      keyword: finding.rule,
      severity: finding.severity,
    };
    const subject = finding.id ?? integrityFor(finding, report.citations);
    if (subject !== undefined) error.subject = subject;
    if (finding.line !== undefined) error.line = finding.line;
    return error;
  });
  return {
    file: report.file,
    format: report.format,
    ok: !errors.some(isErrorSeverity),
    schemas: [RULE_ID_PREFIX],
    errors,
  };
}
