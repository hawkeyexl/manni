/**
 * JSON output. `{ summary, pages }` for check; the `UpdateRun` for update.
 * `resolvedPath`, `diff` and `commitsSince` are stripped from every citation:
 * output never says more than the page did.
 */
import type { CheckRun, UpdateRun } from "../types.js";
import { notImplemented } from "../core/not-implemented.js";

export function renderCheckJson(run: CheckRun): string {
  return notImplemented("renderCheckJson", run);
}

export function renderUpdateJson(run: UpdateRun): string {
  return notImplemented("renderUpdateJson", run);
}
