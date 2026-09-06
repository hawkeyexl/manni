/** JSON reporter: the full engine report, machine-readable. */
import type { EngineReport } from "../core/engine.js";

export function renderJson(report: EngineReport): string {
  return JSON.stringify(report, null, 2);
}
