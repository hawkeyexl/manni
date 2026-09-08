/**
 * `--format json`: the `CheckRun` as it is, pretty-printed. Key order is the
 * order the types declare, so the envelope is stable from run to run.
 */
import type { CheckRun } from "../types.js";

export function renderJson(run: CheckRun): string {
  return JSON.stringify(run, null, 2);
}
