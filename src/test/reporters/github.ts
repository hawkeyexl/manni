import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../shared/github.js";
import { guidanceLines } from "../../shared/guidance.js";
import type { ProceduresResult } from "../commands/procedures.js";
import { findingMessage } from "./finding.js";
import { summaryLine } from "./summary.js";

/**
 * One workflow command per FAIL or WARNING step, then the summary line. The
 * step's action and its guide follow the message after `%0A`.
 */
export function renderGithub(result: ProceduresResult): string {
  const commands = result.findings.map((f) => {
    const level = f.result === "FAIL" ? "error" : "warning";
    const props = [
      ...(f.file === "" ? [] : [`file=${escapeWorkflowCommandProperty(f.file)}`]),
      ...(f.line === undefined ? [] : [`line=${String(f.line)}`]),
      "title=Doc Detective",
    ].join(",");
    const message = [findingMessage(f), ...guidanceLines(f.guidance)].join("\n");
    return `::${level} ${props}::${escapeWorkflowCommandMessage(message)}`;
  });
  return [...commands, summaryLine(result.tests)].join("\n");
}
