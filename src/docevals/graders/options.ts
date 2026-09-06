/**
 * Grader option validation.
 *
 * `options` is deliberately open in the published vocabulary — docmeta
 * describes it as "grader-specific options; validated by the grader at run
 * time", because a grader's options evolve on the grader's schedule and a
 * closed schema would version on every one. The cost of that openness is that
 * nothing catches a typo: `max-age-day: 30` used to fall straight through to
 * the default of 365, and the eval quietly checked something its author never
 * wrote. This module is the "validated by the grader" half actually happening.
 *
 * Ported from moose-tracevals' `src/graders/util.ts`, which solved it first —
 * the same reason `src/core/baseline.ts` was ported from docmeta. Combinators
 * rather than a JSON Schema per grader: they give messages that name the key,
 * and they express the cross-field constraints (ordered bounds, a criterion
 * that can never pass) that JSON Schema states badly.
 */

/** An option-validation outcome: a message when invalid, undefined when fine. */
export type OptionCheck = string | undefined;

export type Options = Record<string, unknown>;

/** First failing check, so callers read as a flat list of constraints. */
export function firstError(...checks: OptionCheck[]): OptionCheck {
  return checks.find((check) => check !== undefined);
}

/**
 * Rejects any key the grader does not know.
 *
 * This is the check the whole module exists for: every other constraint here
 * assumes the author spelled the key right in the first place.
 */
export function knownKeys(options: Options, allowed: readonly string[]): OptionCheck {
  const unknown = Object.keys(options).filter((k) => !allowed.includes(k));
  if (unknown.length === 0) return undefined;
  const listed = [...allowed].sort().join(", ");
  return `unknown option${unknown.length > 1 ? "s" : ""} ${unknown
    .map((k) => `"${k}"`)
    .join(", ")} — this grader accepts: ${listed}`;
}

export function requiredString(options: Options, key: string): OptionCheck {
  const value = options[key];
  if (typeof value !== "string" || value.length === 0) {
    return `options.${key} is required`;
  }
  return undefined;
}

export function optionalString(options: Options, key: string): OptionCheck {
  const value = options[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    return `options.${key} must be a non-empty string`;
  }
  return undefined;
}

export function optionalEnum(
  options: Options,
  key: string,
  allowed: readonly string[],
): OptionCheck {
  const value = options[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    return `options.${key} must be one of: ${allowed.join(", ")}`;
  }
  return undefined;
}

export function optionalNumber(
  options: Options,
  key: string,
  bounds: { min?: number; max?: number; integer?: boolean } = {},
): OptionCheck {
  const value = options[key];
  if (value === undefined) return undefined;
  // Number.isFinite also rejects NaN and both infinities.
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `options.${key} must be a finite number`;
  }
  if (bounds.integer === true && !Number.isInteger(value)) {
    return `options.${key} must be a whole number`;
  }
  if (bounds.min !== undefined && value < bounds.min) {
    return `options.${key} must be at least ${bounds.min}`;
  }
  if (bounds.max !== undefined && value > bounds.max) {
    return `options.${key} must be at most ${bounds.max}`;
  }
  return undefined;
}

export function optionalBoolean(options: Options, key: string): OptionCheck {
  if (options[key] !== undefined && typeof options[key] !== "boolean") {
    return `options.${key} must be a boolean`;
  }
  return undefined;
}

export function optionalStringArray(options: Options, key: string): OptionCheck {
  const value = options[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== "string" || v.length === 0)
  ) {
    return `options.${key} must be a list of non-empty strings`;
  }
  return undefined;
}
