/** `manni cite check`: resolve targets, check every page, settle the baseline. */
import type { CheckOptions, CheckRun } from "../types.js";
import { notImplemented } from "../core/not-implemented.js";

export function runCheck(opts: CheckOptions): Promise<CheckRun> {
  return notImplemented("runCheck", opts);
}
