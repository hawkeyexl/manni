/**
 * GitHub Actions reporter: workflow commands for inline PR annotations,
 * followed by the markdown summary (suitable for $GITHUB_STEP_SUMMARY).
 */
import { scopeLine } from "./scope.js";
import type { EngineReport } from "../core/engine.js";
import {
  escapeWorkflowCommandMessage as escapeData,
  escapeWorkflowCommandProperty as escapeProperty,
} from "../../shared/github.js";
import { renderMarkdown } from "./markdown.js";
import { declaringEntry } from "./location.js";

export function renderGithub(report: EngineReport): string {
  const lines: string[] = [];
  for (const r of report.evalResults) {
    const entry = declaringEntry(r);
    const entryProps = [
      `file=${escapeProperty(entry.file)}`,
      entry.line !== undefined ? `line=${String(entry.line)}` : undefined,
    ];
    for (const f of r.findings ?? []) {
      // The family scale is GitHub's annotation levels, word for word.
      const level = f.severity;
      // A finding with a content line keeps it; one without lands on the
      // entry that declares the eval, which is what someone edits instead.
      const props = [
        ...(f.line != null
          ? [`file=${escapeProperty(f.file)}`, `line=${String(f.line)}`]
          : entryProps),
        f.line != null && f.col != null ? `col=${String(f.col)}` : undefined,
        `title=${escapeProperty(`manni docevals: ${f.evalName}`)}`,
      ]
        .filter(Boolean)
        .join(",");
      lines.push(`::${level} ${props}::${escapeData(f.message)}`);
    }
    if (r.outcome === "fail" && r.consensus) {
      const reasoning =
        r.consensus.runs.find((run) => run.verdict)?.verdict?.reasoning ?? "";
      const props = [...entryProps, `title=${escapeProperty(`manni docevals: ${r.evalName}`)}`]
        .filter(Boolean)
        .join(",");
      lines.push(
        `::error ${props}::${escapeData(
          `AI judge: fail (confidence ${r.consensus.meanConfidence.toFixed(2)}). ${reasoning}`,
        )}`,
      );
    }
    // An errored eval with no findings has nothing above to say it ran.
    // Left out, it shows only in the summary table, which a collapsed step
    // hides. SARIF reports it the same way; one with findings already did.
    if (r.outcome === "error" && (r.findings ?? []).length === 0) {
      const props = [...entryProps, `title=${escapeProperty(`manni docevals: ${r.evalName}`)}`]
        .filter(Boolean)
        .join(",");
      lines.push(`::error ${props}::${escapeData(r.skipReason ?? "eval errored")}`);
    }
  }
  for (const p of report.problems) {
    const level = p.level === "error" ? "error" : "warning";
    const props = [
      `file=${escapeProperty(p.file)}`,
      p.line != null ? `line=${p.line}` : undefined,
      `title=manni docevals`,
    ]
      .filter(Boolean)
      .join(",");
    lines.push(`::${level} ${props}::${escapeData(p.message)}`);
  }
  // The scope, as an annotation rather than only in the step summary: a
  // collapsed log still shows notices, and "nothing was evaluated" is the one
  // sentence that distinguishes a scoped clean run from a corpus that passed
  // (ADR 01040).
  const sc = scopeLine(report);
  if (sc) {
    lines.push(`::notice title=manni docevals::${escapeData(sc.text())}`);
  }
  lines.push("", renderMarkdown(report));
  return lines.join("\n");
}
