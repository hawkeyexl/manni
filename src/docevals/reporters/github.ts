/**
 * GitHub Actions reporter: workflow commands for inline PR annotations,
 * followed by the markdown summary (suitable for $GITHUB_STEP_SUMMARY).
 */
import type { EngineReport } from "../core/engine.js";
import { renderMarkdown } from "./markdown.js";

function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function renderGithub(report: EngineReport): string {
  const lines: string[] = [];
  for (const r of report.evalResults) {
    for (const f of r.findings ?? []) {
      const level = f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "notice";
      const props = [
        `file=${escapeProperty(f.file)}`,
        f.line != null ? `line=${f.line}` : undefined,
        f.col != null ? `col=${f.col}` : undefined,
        `title=${escapeProperty(`manni docevals: ${f.evalName}`)}`,
      ]
        .filter(Boolean)
        .join(",");
      lines.push(`::${level} ${props}::${escapeData(f.message)}`);
    }
    if (r.outcome === "fail" && r.consensus) {
      const reasoning =
        r.consensus.runs.find((run) => run.verdict)?.verdict?.reasoning ?? "";
      lines.push(
        `::error file=${escapeProperty(r.file)},title=${escapeProperty(`manni docevals: ${r.evalName}`)}::${escapeData(
          `AI judge: fail (confidence ${r.consensus.meanConfidence.toFixed(2)}). ${reasoning}`,
        )}`,
      );
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
  const sc = report.since;
  if (sc) {
    lines.push(
      `::notice title=manni docevals::${escapeData(
        sc.pagesSelected === 0
          ? `No pages changed since ${sc.ref} — nothing was evaluated.`
          : `Scoped to ${sc.pagesSelected} of ${sc.pagesTotal} page(s) changed since ${sc.ref}. ` +
              `Corpus-wide graders still saw every page.`,
      )}`,
    );
  }
  lines.push("", renderMarkdown(report));
  return lines.join("\n");
}
