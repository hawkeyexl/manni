import type { TestRunResult } from "../commands/run.js";

/**
 * Doc Detective's results object, verbatim, so a script written against its
 * schema reads manni's output unchanged. `null` when it found no tests.
 */
export function renderJson(result: TestRunResult): string {
  return JSON.stringify(result.results, null, 2);
}
