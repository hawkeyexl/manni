/**
 * Input discovery: expand globs to a stable, sorted, deduplicated list of
 * repo-relative forward-slash paths. Determinism starts here — the file list
 * order is independent of glob order and filesystem enumeration order.
 */
import fg from "fast-glob";
import { byCodeUnit } from "./sort.js";

export function discoverFiles(
  inputs: string[],
  exclude: string[],
  cwd: string,
): string[] {
  const matches = fg.sync(inputs, {
    cwd,
    ignore: exclude,
    onlyFiles: true,
    dot: false,
    unique: true,
  });
  return [...new Set(matches.map((m) => m.replace(/\\/g, "/")))].sort(
    byCodeUnit,
  );
}
