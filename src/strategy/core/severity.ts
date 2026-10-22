/** Rule ids, default levels and guidance for `strategy check` (proposal 0102). */
import type { Guidance } from "../../shared/guidance.js";
import { STRATEGY_RULES, type StrategyRule, type StrategySeverity } from "../types.js";

export const RULE_ID_PREFIX = "manni:strategy";

export const DEFAULT_SEVERITY: Readonly<Record<StrategyRule, StrategySeverity>> = {
  "undefined-reference": "error",
  "duplicate-id": "error",
  "missing-parent": "warning",
  "orphan-record": "warning",
  "unserved-journey": "warning",
  "unused-record": "notice",
};

/** The rules reference, whose sections are anchored by rule name. */
export const RULES_URI = "https://hawkeyexl.github.io/manni/strategy/reference/rules/";

/**
 * When each rule fires, for the person who fixes it. The rules page's "Fires
 * when" column says the same, and a test holds the two equal.
 */
export const RULE_DESCRIPTIONS: Readonly<Record<StrategyRule, string>> = {
  "undefined-reference":
    "A page's audiences:, personas: or journeys:, or a record's audience: or persona:, names no record of that type.",
  "duplicate-id": "Two records share an id, ignoring case.",
  "missing-parent":
    "A page names a journey whose persona its personas: lacks, or a persona whose audience its audiences: lacks.",
  "orphan-record":
    "A persona names no audience, or a journey names no persona, while the set holds records of the parent type.",
  "unserved-journey": "No page names the journey in journeys:. Records do not count.",
  "unused-record": "No page and no record names an audience or a persona.",
};

export function guidanceFor(rule: StrategyRule): Guidance {
  return { id: RULE_ID_PREFIX, rule, description: RULE_DESCRIPTIONS[rule], guide: `${RULES_URI}#${rule}` };
}

export function ruleId(rule: StrategyRule): string {
  return `${RULE_ID_PREFIX}/${rule}`;
}

export function isStrategyRule(value: string): value is StrategyRule {
  return (STRATEGY_RULES as readonly string[]).includes(value);
}

/** The defaults with config's overrides laid over them. */
export function resolveSeverity(
  overrides?: Partial<Record<StrategyRule, StrategySeverity>>,
): Record<StrategyRule, StrategySeverity> {
  return { ...DEFAULT_SEVERITY, ...overrides };
}
