/**
 * A finding's **rule identity**: `manni:lint/<job>/<rule>`.
 *
 * One id, in one place, for every consumer that files or correlates findings -
 * the SARIF `ruleId`, the JUnit `<failure type>`, the GitHub annotation's
 * `title`, and the `ruleId` the JSON reporter carries beside `type`. A rule id
 * is durable by contract: rename one and every historical alert in a
 * dashboard closes, then reopens as new.
 *
 * Three segments rather than cite's two. The job is what makes a second lint
 * tool possible without collisions: a prose job will report
 * `manni:lint/prose/Google.Passive`, keeping Vale's own rule name because that
 * is the name Vale's documentation uses, and nothing about it can be confused
 * with a structure rule. Proposal 0050 records the shape, and warns that
 * anything parsing family rule ids must not assume two segments.
 *
 * The rule half is derived from the finding's `type` rather than authored
 * beside it. `type` is already the machine-readable name the JSON reporter
 * publishes - manni docevals' grader reads it - so a hand-maintained second
 * table would be one more thing to keep in step, and the derivation cannot
 * drift. `_error` is dropped because it says only that a finding is a finding;
 * `heading_pattern_error` is the rule "heading-pattern".
 */
import type { LintJob } from "./config.js";

/** Every lint rule id starts here. */
export const RULE_ID_PREFIX = "manni:lint";

/** The tool that performs the structure job, reported beside every finding. */
export const TOOL_NAME = "manni";

/** The job every finding in this pipeline reports under. */
export const STRUCTURE_JOB: LintJob = "structure";

/**
 * `heading_pattern_error` -> `heading-pattern`; `parse_error` -> `parse`.
 *
 * Only a trailing `_error` is dropped, so a rule that is genuinely *about*
 * errors keeps the word.
 */
export function ruleName(type: string): string {
  return type.replace(/_error$/, "").replace(/_/g, "-");
}

/** `manni:lint/<job>/<rule>` for one finding `type`. */
export function ruleId(type: string, job: LintJob = STRUCTURE_JOB): string {
  return `${RULE_ID_PREFIX}/${job}/${ruleName(type)}`;
}
