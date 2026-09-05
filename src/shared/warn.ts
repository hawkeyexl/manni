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

/** Forget what has been said, so a test can assert a warning fires again. */
export function resetWarnings(): void {
  said.clear();
}
