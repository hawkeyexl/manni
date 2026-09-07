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
 * The family scale (`src/shared/severity.ts`) was chosen to match GitHub's,
 * so the map is one-to-one and this is the identity. It stays a function,
 * and stays exported, because it is the seam: the translation from a
 * domain's severity to an output's levels happens here and nowhere else,
 * and a reporter for a sink with another scale (SARIF's `note`) would carry
 * its own. axe's four impacts were folded onto these three by the analyzer
 * (`severityOf`), before any reporter saw the finding. Proposal 0035,
 * stress test 10.
 */
export function annotationLevel(severity: Severity): AnnotationLevel {
  return severity;
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
