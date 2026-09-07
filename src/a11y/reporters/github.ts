/**
 * `--format github`: one workflow-command annotation per finding.
 *
 * There is no file to anchor to, since the check ran against a URL, so the
 * annotation carries the rule id as its title and names the page in the
 * message. Empty when the run is clean, so a clean CI step logs nothing.
 */
import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../shared/github.js";
import type { CheckRun, Severity } from "../types.js";

/** The three levels a workflow command can carry. */
export type AnnotationLevel = "error" | "warning" | "notice";

/**
 * The annotation level for a finding of the given severity.
 *
 * The rule: a domain's `severity` carries its field's native values, and each
 * reporter translates to the output's own scale. Here the field is axe's
 * (`minor`, `moderate`, `serious`, `critical`) and the output is GitHub's
 * (`notice`, `warning`, `error`). Four steps onto three, so the top two share
 * `error`. A serious finding fails a floor the same way a critical one does,
 * and the two are kept apart everywhere else because a floor needs the line
 * between them. Proposal 0035, stress test 10.
 */
export function annotationLevel(severity: Severity): AnnotationLevel {
  switch (severity) {
    case "critical":
    case "serious":
      return "error";
    case "moderate":
      return "warning";
    case "minor":
      return "notice";
  }
}

export function renderGithub(run: CheckRun): string {
  const lines: string[] = [];
  for (const page of run.results) {
    if (page.error !== undefined) {
      // A page that did not load has no severity to translate. It is the most
      // serious thing a run can hold, so it is always an error.
      lines.push(
        `::error title=a11y/load::${escapeWorkflowCommandMessage(`${page.url}: ${page.error}`)}`,
      );
      continue;
    }
    for (const v of page.violations) {
      const n = v.nodes.length;
      const title = escapeWorkflowCommandProperty(`a11y/${v.id}`);
      const msg = escapeWorkflowCommandMessage(
        `${v.help} — ${n} node${n === 1 ? "" : "s"} on ${page.url} (${v.helpUrl})`,
      );
      lines.push(`::${annotationLevel(v.severity)} title=${title}::${msg}`);
    }
  }
  return lines.join("\n");
}
