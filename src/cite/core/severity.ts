/**
 * Which rules fail a run, which only warn, and which are notices.
 *
 * Warnings and notices never affect the exit code (docevals' rule).
 * `source-moved` is a warning because `cite update` fixes it mechanically,
 * and a PR job that failed on it would make the ratchet noisy. `claim-moved`
 * is a notice: the text is found verbatim, so nothing drifted.
 * `claim-reanchored` is a notice for the same reason (proposal 0053): the
 * words the pin covered are found unchanged since the baseline, so only the
 * layout moved, and plain `cite update` re-pins it.
 * `claim-changed` is a warning, since it fires on any edit to a pinned
 * paragraph, a typo fix beside the cited sentence included. A repository that
 * wants either hard sets `severity: { claim-changed: error }`.
 * `marker-misplaced` is a warning too: it annotates the pull request, and one
 * `cite update` clears it, so a job that failed on it would block on a page
 * that was fine yesterday (proposal 0054, stress test 15).
 */
import { CITE_RULES, type CiteRule, type CiteSeverity } from "../types.js";

export const DEFAULT_SEVERITY: Readonly<Record<CiteRule, CiteSeverity>> = {
  "source-moved": "warning",
  "source-moved-ambiguous": "error",
  "source-changed": "error",
  "source-never-true": "error",
  "source-missing": "error",
  "claim-moved": "notice",
  "claim-moved-ambiguous": "warning",
  "claim-reanchored": "notice",
  "claim-changed": "warning",
  "marker-orphan": "error",
  "marker-invalid": "error",
  "marker-repeated": "warning",
  "marker-misplaced": "warning",
  "anchor-invalid": "error",
  "entry-invalid": "error",
  "quote-drift": "error",
};

export const RULE_ID_PREFIX = "manni:cite";

/** `manni:cite/<rule>`: the SARIF rule id and the JUnit failure type. */
export function ruleId(rule: CiteRule): string {
  return `${RULE_ID_PREFIX}/${rule}`;
}

export function isCiteRule(value: string): value is CiteRule {
  return (CITE_RULES as readonly string[]).includes(value);
}

/** The effective severity table: defaults with the config's overrides. */
export function resolveSeverity(
  overrides?: Partial<Record<CiteRule, CiteSeverity>>,
): Record<CiteRule, CiteSeverity> {
  return { ...DEFAULT_SEVERITY, ...(overrides ?? {}) };
}
