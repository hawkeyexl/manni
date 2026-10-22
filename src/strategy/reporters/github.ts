/**
 * GitHub workflow commands, one per reported finding:
 * `::warning file=<file>,line=<n>,title=<ruleId>::<message>`, the rule's
 * guidance after `%0A`. A clean run is the empty string, which the CLI prints
 * nothing for.
 */
import { escapeWorkflowCommandMessage, escapeWorkflowCommandProperty } from "../../meta/internal.js";
import { guidanceLines } from "../../shared/guidance.js";
import type { StrategyReport } from "../commands/findings.js";
import { displayPath } from "../commands/run.js";

export function renderFindingsGithub(report: StrategyReport): string {
  return report.findings
    .map((finding) => {
      const params = [`file=${escapeWorkflowCommandProperty(displayPath(finding.file, report.cwd, report.base))}`];
      if (finding.line !== undefined) params.push(`line=${String(finding.line)}`);
      params.push(`title=${escapeWorkflowCommandProperty(finding.ruleId)}`);
      const message = [finding.message, ...guidanceLines(finding.guidance)].join("\n");
      return `::${finding.severity} ${params.join(",")}::${escapeWorkflowCommandMessage(message)}`;
    })
    .join("\n");
}
