/**
 * `--format github`: one workflow-command annotation per `check` finding.
 *
 * `::error file=<first blamed doc>::<message> (<focus node>)`, with
 * `::warning` and `::notice` for the lower levels — the family scale is
 * GitHub's, so the level is the severity, exactly as a11y's and cite's
 * reporters have it.
 *
 * A SHACL finding carries no line number (stress test 5 of proposal 0051 says
 * why SARIF and JUnit are not here), and a finding about a shared node — a
 * concept, an agent, the scheme — may trace back to no document at all. Then
 * there is nothing to anchor to and the annotation goes out without `file=`,
 * which GitHub shows against the workflow run rather than dropping.
 *
 * Empty when the run is clean, so a clean CI step logs nothing.
 */
import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../shared/github.js";
import type { CheckReport } from "../commands/check.js";
import { compactIri } from "../core/load.js";

export function renderCheckGithub(report: CheckReport): string {
  const lines: string[] = [];
  for (const f of report.findings) {
    // The first, not all of them: one annotation lands on one file, and the
    // docs are sorted, so which one is stable across runs.
    const file = f.docs[0];
    const where =
      file === undefined ? "" : ` file=${escapeWorkflowCommandProperty(file)}`;
    const message = escapeWorkflowCommandMessage(
      `${f.message} (${compactIri(f.focusNode)})`,
    );
    lines.push(`::${f.severity}${where}::${message}`);
  }
  return lines.join("\n");
}
