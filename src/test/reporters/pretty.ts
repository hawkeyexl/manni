import { palette } from "../../shared/color.js";
import type { TestRunResult } from "../commands/run.js";
import type { TestFinding } from "../core/results.js";
import { summaryLine } from "./summary.js";

/**
 * Each FAIL and WARNING step under its page, with its line, then the
 * test-level summary. A run with neither prints the summary alone.
 */
export function renderPretty(result: TestRunResult, opts: { color: boolean }): string {
  const c = palette(opts.color);
  const byFile = new Map<string, TestFinding[]>();
  for (const finding of result.findings) {
    const list = byFile.get(finding.file);
    if (list === undefined) byFile.set(finding.file, [finding]);
    else list.push(finding);
  }
  const width = Math.max(0, ...result.findings.map((f) => String(f.line ?? "").length));
  const blocks = [...byFile].map(([file, findings]) =>
    [
      c.bold(file),
      ...findings.map((f) => {
        const label = f.result.padEnd(7);
        const tag = f.result === "FAIL" ? c.red(label) : c.yellow(label);
        return `  ${String(f.line ?? "").padStart(width)}  ${tag}  ${f.description}`;
      }),
    ].join("\n"),
  );
  return [...blocks, summaryLine(result.tests)].join("\n\n");
}
