import type { ResultCounts } from "../core/results.js";

/** `2 tests: 1 passed, 1 failed, 0 warnings, 0 skipped`, test-level counts. */
export function summaryLine(tests: ResultCounts): string {
  const total = tests.pass + tests.fail + tests.warning + tests.skipped;
  const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;
  return `${plural(total, "test")}: ${String(tests.pass)} passed, ${String(tests.fail)} failed, ${plural(tests.warning, "warning")}, ${String(tests.skipped)} skipped`;
}
