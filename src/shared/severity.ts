/**
 * The one severity scale every manni tool speaks. Least to most severe.
 *
 * Three values, chosen to match the sinks every tool writes to and the
 * linters that sit beside it. GitHub annotations are `error`, `warning` and
 * `notice`; so are ESLint's and Vale's levels, and pa11y's. A flag or config
 * key that two domains both have carries the same name and the same values,
 * and this is where the values for `severity` are defined once.
 *
 * A domain whose source speaks another scale maps onto this one and keeps
 * the source's value in a field of its own, so nothing is lost for lookup.
 * a11y is the first case: axe reports four impacts, the analyzer folds them
 * onto these three, and each finding still carries axe's word as `impact`.
 */
export const SEVERITIES = ["notice", "warning", "error"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** The list the way a usage message spells it: `notice | warning | error`. */
export const SEVERITY_LIST: string = SEVERITIES.join(" | ");

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}

/** `true` when `severity` is at or above `min`. */
export function meetsSeverity(severity: Severity, min: Severity): boolean {
  return SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(min);
}
