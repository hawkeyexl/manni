/**
 * Findings → meta's `ValidationResult`, so the github/sarif/junit reporters
 * and the baseline ratchet work unchanged.
 *
 * FieldError: schema "manni:cite" (matches BUILTIN_ID, so canonicalSchemaRef
 * leaves it alone), keyword = rule, instancePath "/citations/N" for a
 * frontmatter entry or "" for an inline one, subject = id ?? integrity (stable
 * across a move and a line shift; changes only on re-mint), line, severity.
 * `ok` is true iff no error-severity finding.
 */
import type { ValidationResult } from "../../meta/index.js";
import type { CitationFinding, CiteRule, CiteSeverity, CitationResult, PageCitationReport } from "../types.js";
import { notImplemented } from "./not-implemented.js";

export function toValidationResult(report: PageCitationReport): ValidationResult {
  return notImplemented("toValidationResult", report);
}

/** Findings for classified results under a severity table; `off` rules produce none. */
export function findingsFor(
  results: readonly CitationResult[],
  severity: Readonly<Record<CiteRule, CiteSeverity>>,
): CitationFinding[] {
  return notImplemented("findingsFor", results, severity);
}

/** The one place a finding's message is composed, per rule. */
export function messageFor(result: CitationResult): string {
  return notImplemented("messageFor", result);
}
