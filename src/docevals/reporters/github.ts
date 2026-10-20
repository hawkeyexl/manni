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
import { judgedLines, resultGuidance } from "./judged.js";

export function renderGithub(report: EngineReport): string {
  const lines: string[] = [];
  for (const r of report.evalResults) {
    const entry = declaringEntry(r);
    const entryProps = [
      `file=${escapeProperty(entry.file)}`,
      entry.line !== undefined ? `line=${String(entry.line)}` : undefined,
    ];
    const guidance = resultGuidance(r);
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
      lines.push(`::${level} ${props}::${escapeData([f.message, ...guidance].join("\n"))}`);
    }
    const entryAnnotation = (level: string, text: string[]): void => {
      const props = [...entryProps, `title=${escapeProperty(`manni docevals: ${r.evalName}`)}`]
        .filter(Boolean)
        .join(",");
      lines.push(`::${level} ${props}::${escapeData([...text, ...guidance].join("\n"))}`);
    };
    // A judged failure, or an eval awaiting review. A review is a warning:
    // it fails the run only under --fail-on-review, and without this line
    // nothing in the log says why it did.
    const judged = judgedLines(r);
    if (judged.length > 0) {
      entryAnnotation(r.outcome === "fail" ? "error" : "warning", judged);
    }
    // An errored eval with no findings has nothing above to say it ran.
    // Left out, it shows only in the summary table, which a collapsed step
    // hides. SARIF reports it the same way; one with findings already did.
    if (r.outcome === "error" && (r.findings ?? []).length === 0) {
      entryAnnotation("error", [r.skipReason ?? "eval errored"]);
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
