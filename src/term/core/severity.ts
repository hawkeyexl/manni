/**
 * Rule ids and levels for the term tool (proposal 0052). `check` findings are
 * `manni:term/<rule>`. A `lint` finding keeps Vale's own rule name,
 * `manni:term/prose/<Style.Rule>`, in the shape lint's proposal 0050 set for
 * its prose job, because that is the name Vale's documentation uses.
 */
import type { Severity } from "../../shared/severity.js";
import { TERM_RULES, type TermRule, type TermSeverity, type ValeSeverity } from "../types.js";

export const RULE_ID_PREFIX = "manni:term";

export const DEFAULT_SEVERITY: Readonly<Record<TermRule, TermSeverity>> = {
  "undefined-term": "error",
  "duplicate-id": "error",
  "label-collision": "error",
  "alt-label-collision": "error",
  "dangling-reference": "error",
  "broader-cycle": "error",
  "see-not-empty": "error",
  "asymmetric-hierarchy": "warning",
  "abstract-too-long": "notice",
  "unused-term": "notice",
};

export function ruleId(rule: TermRule): string {
  return `${RULE_ID_PREFIX}/${rule}`;
}

export function proseRuleId(check: string): string {
  return `${RULE_ID_PREFIX}/prose/${check}`;
}

export function isTermRule(value: string): value is TermRule {
  return (TERM_RULES as readonly string[]).includes(value);
}

/** The defaults with config's overrides laid over them. */
export function resolveSeverity(
  overrides?: Partial<Record<TermRule, TermSeverity>>,
): Record<TermRule, TermSeverity> {
  return { ...DEFAULT_SEVERITY, ...overrides };
}

/**
 * Vale's scale onto the family's. A finding keeps Vale's own value beside the
 * folded one, as an a11y violation keeps axe's `impact`.
 */
export function foldValeSeverity(severity: ValeSeverity): Severity {
  return severity === "suggestion" ? "notice" : severity;
}
