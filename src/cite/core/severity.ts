/**
 * Which rules fail a run, which only warn, and which are silent.
 *
 * Warnings never affect the exit code (docevals' rule; meta has no warnings).
 * `moved` is a warning because `cite update` fixes it mechanically, and a PR
 * job that failed on it would make the ratchet noisy; a repository that wants
 * it hard sets `severity: { moved: error }`.
 */
import { CITE_RULES, type CiteRule, type CiteSeverity } from "../types.js";

export const DEFAULT_SEVERITY: Readonly<Record<CiteRule, CiteSeverity>> = {
  current: "off",
  moved: "warning",
  "claim-ambiguous": "warning",
  "moved-ambiguous": "error",
  changed: "error",
  missing: "error",
  "never-true": "error",
  "claim-missing": "error",
  "statement-orphan": "error",
  "statement-invalid": "error",
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
