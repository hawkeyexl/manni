import { palette } from "../../shared/color.js";
import { guidanceLines } from "../../shared/guidance.js";
import type { ProceduresResult } from "../commands/procedures.js";
import type { TestFinding } from "../core/results.js";
import { findingMessage } from "./finding.js";
import { summaryLine } from "./summary.js";

/**
 * Each FAIL and WARNING step under its page, with its line, then the
 * test-level summary. The step's action and its guide follow, dim, under the
 * message. A run with neither prints the summary alone.
 */
export function renderPretty(result: ProceduresResult, opts: { color: boolean }): string {
  const c = palette(opts.color);
  const byFile = new Map<string, TestFinding[]>();
  for (const finding of result.findings) {
    const list = byFile.get(finding.file);
    if (list === undefined) byFile.set(finding.file, [finding]);
    else list.push(finding);
  }
  const width = Math.max(0, ...result.findings.map((f) => String(f.line ?? "").length));
  // The guidance lines sit under the message column: the line, the result, and their gaps.
  const indent = " ".repeat(2 + width + 2 + 7 + 2);
  const blocks = [...byFile].map(([file, findings]) =>
    [
      c.bold(file),
      ...findings.flatMap((f) => {
        const label = f.result.padEnd(7);
        const tag = f.result === "FAIL" ? c.red(label) : c.yellow(label);
        return [
          `  ${String(f.line ?? "").padStart(width)}  ${tag}  ${findingMessage(f)}`,
          ...guidanceLines(f.guidance).map((line) => c.dim(`${indent}${line}`)),
        ];
      }),
    ].join("\n"),
  );
  return [...blocks, summaryLine(result.tests)].join("\n\n");
}
