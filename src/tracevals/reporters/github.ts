/**
 * GitHub Actions reporter: workflow commands for inline PR annotations,
 * followed by the markdown summary (suitable for $GITHUB_STEP_SUMMARY).
 *
 * docevals' shape. An annotation lands on the entry that declares the eval,
 * in the artifact or in the manifest that supplied it, since that is what
 * someone edits to change the outcome. The trace it was graded against goes at
 * the end of the message, because a workflow command has nowhere else to
 * carry it.
 */
import {
  escapeWorkflowCommandMessage as escapeData,
  escapeWorkflowCommandProperty as escapeProperty,
} from "../../shared/github.js";
import {
  displayPath,
  errorText,
  judgeFailText,
  locationPath,
  traceErrorText,
  type CiInput,
} from "./ci.js";

const TITLE = "manni tracevals";

function annotation(
  level: string,
  message: string,
  props: { file?: string; line?: number; title: string },
): string {
  const parts = [
    props.file !== undefined ? `file=${escapeProperty(props.file)}` : undefined,
    props.line !== undefined ? `line=${String(props.line)}` : undefined,
    `title=${escapeProperty(props.title)}`,
  ].filter((p) => p !== undefined);
  return `::${level} ${parts.join(",")}::${escapeData(message)}`;
}

export function renderGithub(input: CiInput, summary: string): string {
  const lines: string[] = [];
  for (const run of input.runs) {
    const trace = ` (trace: ${displayPath(run.trace.file, input.root)})`;
    for (const r of run.evalResults) {
      // A trace finding has no line of its own in the artifact, so every
      // annotation lands on the entry that declares the eval.
      const at = {
        file: locationPath(r.location, input.root),
        ...(r.location.line === undefined ? {} : { line: r.location.line }),
        title: `${TITLE}: ${r.evalName}`,
      };
      for (const f of r.findings ?? []) {
        // The family scale is GitHub's annotation levels, word for word.
        lines.push(annotation(f.severity, f.message + trace, at));
      }
      const judged = judgeFailText(r);
      if (judged !== undefined) {
        lines.push(annotation("error", judged + trace, at));
      }
      // An errored eval has neither findings nor a verdict. Left out, it
      // shows in the log only inside the summary table, which a collapsed
      // step hides.
      if (r.outcome === "error") {
        lines.push(annotation("error", errorText(r) + trace, at));
      }
    }
    for (const w of run.warnings) {
      // Plugin-loading warnings are prepended to every report in a batch and
      // also carried once at batch level; say them once.
      if (input.warnings.includes(w)) continue;
      lines.push(annotation("warning", w + trace, { title: TITLE }));
    }
  }
  for (const t of input.traceErrors) {
    lines.push(
      annotation("error", traceErrorText(t.error), {
        file: displayPath(t.file, input.root),
        title: TITLE,
      }),
    );
  }
  for (const w of input.warnings) {
    lines.push(annotation("warning", w, { title: TITLE }));
  }
  lines.push("", summary);
  return lines.join("\n");
}
