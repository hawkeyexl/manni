/**
 * GitHub workflow commands, one per finding:
 * `::error file=<file>,line=<n>,title=<ruleId>::<id or src> (<src>): <message>`
 * with `::warning` for warning severity. Uses meta's escapes.
 */
import type { CheckRun } from "../types.js";
import { notImplemented } from "../core/not-implemented.js";

export function renderCheckGithub(run: CheckRun): string {
  return notImplemented("renderCheckGithub", run);
}
