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
import type { CheckRun } from "../types.js";

export function renderGithub(run: CheckRun): string {
  const lines: string[] = [];
  for (const page of run.results) {
    if (page.error !== undefined) {
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
      lines.push(`::error title=${title}::${msg}`);
    }
  }
  return lines.join("\n");
}
