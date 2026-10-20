/**
 * GitHub workflow commands, one per reported finding:
 * `::error file=<file>,line=<n>,title=<ruleId>::<message>`, with `::warning`
 * and `::notice` for the lower levels. The rule's guidance lines follow the
 * message after `%0A`. Uses meta's escapes. A clean run is the empty string,
 * which the CLI prints nothing for.
 */
import { escapeWorkflowCommandMessage, escapeWorkflowCommandProperty } from "../../meta/internal.js";
import { guidanceLines } from "../../shared/guidance.js";
import type { TermReport } from "../commands/findings.js";
import { displayPath } from "../commands/run.js";

export function renderFindingsGithub(report: TermReport): string {
  return report.findings
    .map((finding) => {
      const params = [`file=${escapeWorkflowCommandProperty(displayPath(finding.file, report.cwd))}`];
      if (finding.line !== undefined) params.push(`line=${String(finding.line)}`);
      params.push(`title=${escapeWorkflowCommandProperty(finding.ruleId)}`);
      const message = [finding.message, ...guidanceLines(finding.guidance)].join("\n");
      return `::${finding.severity} ${params.join(",")}::${escapeWorkflowCommandMessage(message)}`;
    })
    .join("\n");
}
