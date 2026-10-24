import type { ProceduresResult } from "../commands/procedures.js";

/**
 * Doc Detective's results object, verbatim, so a script written against its
 * schema reads manni's output unchanged. `null` when it found no tests.
 */
export function renderJson(result: ProceduresResult): string {
  return JSON.stringify(result.results, null, 2);
}
