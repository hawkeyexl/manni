/**
 * The single source of truth for `-f/--format` values.
 *
 * The same shape docevals' `reporters/format.ts` carries, and for the same
 * reason: the constant a command validates against and the type its renderer
 * accepts cannot drift, and an unknown value is a usage error (exit 2) rather
 * than a silent fall-through to the pretty renderer.
 */
import { TracevalsError } from "../types.js";

/** Formats `run` and `calibrate` can emit — one per module in this directory. */
export const REPORT_FORMATS = ["pretty", "json", "markdown"] as const;

/** Formats the summary commands (`list`, `fill`, `capture`) can emit. */
export const SUMMARY_FORMATS = ["pretty", "json"] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type SummaryFormat = (typeof SUMMARY_FORMATS)[number];

/**
 * Narrow a raw `--format` value to one of `allowed`, or throw.
 *
 * Matching is exact: no trimming, no case folding. A near-miss is a typo the
 * caller should see, not something to guess at. `flag` names whatever the
 * caller actually supplied, so the CLI passes `--format` and a library caller's
 * render entry point passes `format`.
 */
export function parseFormat<T extends string>(
  value: string,
  allowed: readonly T[],
  flag: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TracevalsError(
      `${flag} must be one of ${allowed.join(" | ")}, got "${value}"`,
    );
  }
  return value as T;
}
