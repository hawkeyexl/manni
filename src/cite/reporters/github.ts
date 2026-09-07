/**
 * GitHub workflow commands, one per finding:
 * `::error file=<file>,line=<n>,title=<ruleId>::<id or src> (<src>): <message>`
 * with `::warning` for warning severity. Uses meta's escapes. A baselined
 * finding is not an annotation; a clean run is the empty string.
 */
import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../meta/internal.js";
import type { CheckRun, CitationFinding } from "../types.js";
import { resultFor, splitBaselined } from "./pretty.js";

/** `<id> (<src>): <message>`, or `<src>: <message>` when the entry has no id. */
function annotationMessage(finding: CitationFinding): string {
  const subject = finding.id ?? finding.src;
  if (subject === undefined) return finding.message;
  const where = finding.id !== undefined && finding.src !== undefined ? ` (${finding.src})` : "";
  return `${subject}${where}: ${finding.message}`;
}

export function renderCheckGithub(run: CheckRun): string {
  const lines: string[] = [];
  run.pages.forEach((page, index) => {
    const { reported } = splitBaselined(page, resultFor(run, index));
    for (const finding of reported) {
      const params = [`file=${escapeWorkflowCommandProperty(page.file)}`];
      if (finding.line !== undefined) params.push(`line=${String(finding.line)}`);
      params.push(`title=${escapeWorkflowCommandProperty(finding.ruleId)}`);
      lines.push(
        `::${finding.severity} ${params.join(",")}::${escapeWorkflowCommandMessage(annotationMessage(finding))}`,
      );
    }
  });
  return lines.join("\n");
}
