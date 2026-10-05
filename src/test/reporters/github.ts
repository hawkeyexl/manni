import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../shared/github.js";
import type { TestRunResult } from "../commands/run.js";
import { summaryLine } from "./summary.js";

/** One workflow command per FAIL or WARNING step, then the summary line. */
export function renderGithub(result: TestRunResult): string {
  const commands = result.findings.map((f) => {
    const level = f.result === "FAIL" ? "error" : "warning";
    const props = [
      ...(f.file === "" ? [] : [`file=${escapeWorkflowCommandProperty(f.file)}`]),
      ...(f.line === undefined ? [] : [`line=${String(f.line)}`]),
      "title=Doc Detective",
    ].join(",");
    return `::${level} ${props}::${escapeWorkflowCommandMessage(f.description)}`;
  });
  return [...commands, summaryLine(result.tests)].join("\n");
}
