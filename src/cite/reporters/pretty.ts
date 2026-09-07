/**
 * Pretty output for `check` and `update`. Marks: ✓ current, ↕ warning,
 * ✗ error, · skipped; a file line is ✓ / ⚠ (warnings only) / ✗. Diffs and
 * commit subjects print only under `showDiff`; a resolved path only under
 * `reveal`. Colour via `shouldColor`; never under `--no-color`/`NO_COLOR`.
 */
import type { CheckRun, UpdateRun } from "../types.js";
import { notImplemented } from "../core/not-implemented.js";

export interface PrettyOptions {
  color: boolean;
  quiet?: boolean;
  showDiff?: boolean;
  reveal?: boolean;
}

export function renderCheckPretty(run: CheckRun, opts: PrettyOptions): string {
  return notImplemented("renderCheckPretty", run, opts);
}

export function renderUpdatePretty(run: UpdateRun, opts: PrettyOptions): string {
  return notImplemented("renderUpdatePretty", run, opts);
}
