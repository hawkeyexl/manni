/** Markdown report, suitable for PR comments and docs. */
import type { RunReport } from "../types.js";
import {
  availabilityLines,
  coverageLocation,
  coverageStaleness,
  manifestLines,
} from "./coverage.js";

/**
 * Escapes a value for a markdown table cell. Every cell needs this, not just
 * the free-text ones: `ref` is a skill name or `subagent_type` read straight
 * out of the trace, so an unescaped pipe there silently adds columns to a table
 * that ends up pasted into a pull request comment.
 */
const cell = (value: string): string => value.replace(/\|/g, "\\|");

export function renderMarkdown(report: RunReport): string {
  const lines: string[] = [];
  const t = report.trace;
  lines.push(`# manni tracevals report`);
  lines.push("");
  lines.push(`- **Trace**: \`${t.file}\``);
  lines.push(`- **Source**: ${t.source} (${t.model ?? "unknown model"})`);
  lines.push(`- **Project**: \`${t.cwd}\``);
  lines.push(`- **Turns**: ${t.turnCount}`);
  lines.push("");

  lines.push(`## Evals`);
  lines.push("");
  lines.push(`| Outcome | Artifact | Eval | Grader | Detail |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of report.evalResults) {
    const detail =
      r.error ??
      r.skipReason ??
      r.findings?.map((f) => f.message).join("; ") ??
      (r.consensus
        ? `votes p:${r.consensus.votes.pass} f:${r.consensus.votes.fail} e:${r.consensus.votes.error}`
        : "");
    lines.push(
      `| ${r.outcome} | ${cell(r.artifactName)} | ${cell(r.evalName)}${r.implicit ? " (implicit)" : ""} | ${cell(r.grader)} | ${cell(detail)} |`,
    );
  }
  lines.push("");

  lines.push(`## Artifact coverage`);
  lines.push("");
  lines.push(`| Resolved | Kind | Ref | Availability | Where |`);
  lines.push(`|---|---|---|---|---|`);
  for (const entry of report.coverage) {
    const location = cell(coverageLocation(entry));
    // Code-span only a real path; wrapping an empty string in backticks would
    // render an empty code span rather than an empty cell.
    const where =
      entry.resolved && entry.path !== undefined ? `\`${location}\`` : location;
    // An artifact that was offered and never used was never looked for, so
    // "no" under Resolved would be a claim about a search that never ran.
    const resolved =
      entry.availability === "offered-not-used"
        ? "n/a"
        : entry.resolved
          ? "yes"
          : "no";
    // Staleness is appended to the same cell rather than given a column of its
    // own: an extra column would be empty on almost every row of almost every
    // report, and Availability already claims the one column worth spending.
    const stale = coverageStaleness(entry);
    const cellText = stale
      ? `${where}${where ? " — " : ""}⚠ ${cell(stale)}`
      : where;
    lines.push(
      `| ${resolved} | ${cell(entry.kind)} | ${cell(entry.ref)} | ${cell(entry.availability ?? "")} | ${cellText} |`,
    );
  }
  lines.push("");

  if (report.manifest !== undefined) {
    // Only when there is one — see the human reporter (ADR 01024).
    lines.push(`## Session manifest`);
    lines.push("");
    for (const line of manifestLines(report.manifest)) {
      lines.push(`- ${cell(line)}`);
    }
    lines.push("");
  }

  lines.push(`## Availability`);
  lines.push("");
  for (const line of availabilityLines(report.availability)) {
    lines.push(`- ${line}`);
  }
  lines.push("");

  if (report.warnings.length > 0) {
    lines.push(`## Warnings`);
    lines.push("");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  const s = report.summary;
  lines.push(
    `**${s.total} eval(s)** — ${s.pass} pass, ${s.fail} fail, ${s.error} error, ${s.needsReview} needs-review, ${s.skipped} skipped.`,
  );
  return lines.join("\n");
}
