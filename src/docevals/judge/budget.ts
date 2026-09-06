/**
 * The turn-budget skip marker (ADR 01019), in one place.
 *
 * `judge.ts` produces the skip reason; `core/engine.ts` and `commands/
 * calibrate.ts` both have to tell a budget truncation apart from every other
 * reason an eval went unjudged, because that distinction is what stops a
 * partial run from reporting as a complete one. They did it by matching the
 * bare substring `"turn budget"` against a message written in a third file,
 * so a reword in the producer would have left both detectors matching nothing
 * — silently, since the tests that exercise truncation supply the skip reason
 * themselves rather than getting it from the judge.
 *
 * Kept in its own module rather than exported from `judge.ts`: the detectors
 * need the marker, not the judge, and `engine.ts` deliberately takes the judge
 * by injection.
 */

/** The substring every budget-truncation skip reason carries. */
export const TURN_BUDGET_SKIP = "turn budget";

/** The skip reason recorded for an eval the budget stopped before dispatch. */
export function turnBudgetSkipReason(maxTurns: number): string {
  return `judge ${TURN_BUDGET_SKIP} exhausted (${maxTurns})`;
}

/**
 * Whether a skip reason is the budget's doing rather than the judge's.
 *
 * A type predicate, not a plain boolean: a budget skip always carries a
 * reason, and callers interpolate it into the message they report.
 */
export function isTurnBudgetSkip(reason: string | undefined): reason is string {
  return reason !== undefined && reason.includes(TURN_BUDGET_SKIP);
}
