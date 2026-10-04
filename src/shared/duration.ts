/**
 * `--newer-than <duration>`: a window of time back from now, shared by every
 * domain that selects its inputs by age.
 *
 * Deliberately strict. A duration this refuses is a usage error, because the
 * alternative (reading `7y` as zero, or as "everything") silently changes what
 * a gate looked at.
 */

const UNITS: Readonly<Record<string, number>> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

/** The usage error for a value that is not a duration. */
export function durationMessage(value: string): string {
  return `--newer-than must be a duration such as 30m, 24h, 7d or 2w, got "${value}"`;
}

/**
 * `7d` to milliseconds. A count, which may carry a fraction, then one unit:
 * `m` minutes, `h` hours, `d` days or `w` weeks. `makeError` builds the
 * domain's own `ToolError` subclass, so the refusal exits 2 under its name.
 */
export function parseDuration(
  text: string,
  makeError: (message: string) => Error,
): number {
  const match = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(text.trim());
  const count = match?.[1];
  const unit = match?.[2];
  const ms = unit === undefined ? undefined : UNITS[unit];
  if (count === undefined || ms === undefined) {
    throw makeError(durationMessage(text));
  }
  return Number(count) * ms;
}
