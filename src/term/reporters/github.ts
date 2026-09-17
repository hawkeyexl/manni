/**
 * GitHub workflow commands, one per reported finding:
 * `::error file=<file>,line=<n>,title=<ruleId>::<message>`, with `::warning`
 * and `::notice` for the lower levels. Uses meta's escapes. A clean run is the
 * empty string, which the CLI prints nothing for.
 */
import { escapeWorkflowCommandMessage, escapeWorkflowCommandProperty } from "../../meta/internal.js";
import type { TermReport } from "../commands/findings.js";
import { displayPath } from "../commands/run.js";

export function renderFindingsGithub(report: TermReport): string {
  return report.findings
    .map((finding) => {
      const params = [`file=${escapeWorkflowCommandProperty(displayPath(finding.file, report.cwd))}`];
      if (finding.line !== undefined) params.push(`line=${String(finding.line)}`);
      params.push(`title=${escapeWorkflowCommandProperty(finding.ruleId)}`);
      return `::${finding.severity} ${params.join(",")}::${escapeWorkflowCommandMessage(finding.message)}`;
    })
    .join("\n");
}
