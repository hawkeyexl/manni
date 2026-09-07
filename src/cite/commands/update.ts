/** `manni cite update`: rewrite moved entries; with `--accept`, re-mint changed ones. */
import type { UpdateOptions, UpdateRun } from "../types.js";
import { notImplemented } from "../core/not-implemented.js";

export function runUpdate(opts: UpdateOptions): Promise<UpdateRun> {
  return notImplemented("runUpdate", opts);
}
