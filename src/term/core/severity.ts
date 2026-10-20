/**
 * Rule ids and levels for the term tool (proposal 0052). `check` findings are
 * `manni:term/<rule>`. A `lint` finding keeps Vale's own rule name,
 * `manni:term/prose/<Style.Rule>`, in the shape lint's proposal 0050 set for
 * its prose job, because that is the name Vale's documentation uses.
 */
import type { Guidance } from "../../shared/guidance.js";
import type { Severity } from "../../shared/severity.js";
import { TERM_RULES, type TermRule, type TermSeverity, type ValeSeverity } from "../types.js";

export const RULE_ID_PREFIX = "manni:term";

export const DEFAULT_SEVERITY: Readonly<Record<TermRule, TermSeverity>> = {
  "undefined-term": "error",
  "duplicate-id": "error",
  "label-collision": "error",
  "alt-label-collision": "error",
  "label-overlap": "error",
  "dangling-reference": "error",
  "broader-cycle": "error",
  "see-not-empty": "error",
  "missing-definition": "error",
  "conflicting-matches": "error",
  "asymmetric-hierarchy": "warning",
  "asymmetric-related": "warning",
  "related-in-hierarchy": "warning",
  "alt-label-reference": "warning",
  "ambiguous-alt-label": "warning",
  "deprecated-label": "warning",
  "abstract-too-long": "notice",
  "unused-term": "notice",
  "hierarchy-outside-termbase": "notice",
  "related-siblings": "notice",
  "orphan-term": "notice",
  "keyword-candidate": "notice",
};

/** The rules reference, whose sections are anchored by rule name. */
export const RULES_URI = "https://hawkeyexl.github.io/manni/term/reference/rules/";

/**
 * When each `check` rule fires, for the person who fixes it. The rules
 * page's "Fires when" column says the same, and a test holds the two equal.
 */
export const RULE_DESCRIPTIONS: Readonly<Record<TermRule, string>> = {
  "undefined-term": "A page's concepts: names no entry, by label, id or alt-label.",
  "duplicate-id": "Two entries in one language share an id, ignoring case.",
  "label-collision":
    "Two entries claim the same preferred label, ignoring case. Across languages, only when the spellings differ.",
  "alt-label-collision":
    "An entry's alt-label is another entry's preferred label, ignoring case. Across languages, only when the spellings differ.",
  "label-overlap":
    "An alt-label repeats the entry's own label, or a hidden-label repeats any name the entry or another entry goes by.",
  "dangling-reference": "A value of broader, narrower, related-terms or see names no entry, by label or by id.",
  "broader-cycle":
    "A chain of broader returns to where it started, across the terms and every page's graph: block.",
  "see-not-empty": "An entry with see also carries a definition.",
  "missing-definition": "An entry has neither a definition nor a see.",
  "conflicting-matches": "One IRI is listed under two of an entry's match fields.",
  "asymmetric-hierarchy": "A names B as broader, and B omits A from narrower, or the reverse.",
  "asymmetric-related": "A names B in related-terms, and B omits A.",
  "related-in-hierarchy":
    "A related-terms value is also above or below the entry in the hierarchy, at any depth.",
  "alt-label-reference": "A page's concepts: names an entry by one of its alt-labels.",
  "ambiguous-alt-label": "Two entries share an alt-label, ignoring case.",
  "deprecated-label":
    "The entry's own label is deprecated or superseded in its designations, and the entry has no see.",
  "abstract-too-long": "An abstract is longer than abstractMaxLength, 60 by default.",
  "unused-term": "No page's concepts: names the entry, or an entry in another language with its id.",
  "hierarchy-outside-termbase":
    "A page's graph: block gives a term a broader, narrower or related-concepts value that the term's own entry does not list.",
  "related-siblings": "Two related terms share a broader term.",
  "orphan-term": "An entry has no broader, narrower or related term, in a termbase that has a hierarchy.",
  "keyword-candidate": "A free keywords: value is on enough pages and names no term.",
};

/** The rule behind a `check` finding: when it fires, and its section of the rules page. */
export function guidanceFor(rule: TermRule): Guidance {
  return { id: RULE_ID_PREFIX, rule, description: RULE_DESCRIPTIONS[rule], guide: `${RULES_URI}#${rule}` };
}

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
