/**
 * Warnings for the user: stderr, prefixed, and said once.
 *
 * stderr, because stdout belongs to the report (`--format json` has to stay
 * parseable). Once, because the same deprecated config file is discovered by
 * every command core a run touches, and a warning repeated five times reads as
 * five problems. Dedup is on the exact text, per process.
 */
import { programName } from "./program-name.js";

const said = new Set<string>();

export function warn(message: string): void {
  if (said.has(message)) return;
  said.add(message);
  process.stderr.write(`${programName()}: ${message}\n`);
}

/**
 * Diagnostics from a command core. Always stderr, never stdout: `json` and
 * `github` output has to stay parseable, and a note is not the report.
 * Unlike `warn`, said every time: a notice reports what a run did, not a
 * condition that holds.
 */
export function notice(message: string): void {
  process.stderr.write(`${programName()}: ${message}
`);
}

/** Forget what has been said, so a test can assert a warning fires again. */
export function resetWarnings(): void {
  said.clear();
}
