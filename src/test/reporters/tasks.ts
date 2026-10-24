/**
 * `manni test tasks`'s three formats (plan §4.8): a block per run then a
 * total, the report as JSON, or a workflow command per eval that did not pass.
 */
import { palette, type Colors } from "../../shared/color.js";
import { escapeWorkflowCommandMessage, escapeWorkflowCommandProperty } from "../../shared/github.js";
import type { TaskRun, TasksReport } from "../commands/tasks.js";
import type { TaskEval } from "../core/task-types.js";

export type TasksFormat = "pretty" | "json" | "github";

const WIDTH = 78;

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/** `1 run: 0 passed, 1 failed · 1 warning`, zero failures and warnings left out. */
export function tasksTotal(summary: TasksReport["summary"]): string {
  let line = `${plural(summary.runs, "run")}: ${String(summary.passed)} passed`;
  if (summary.failed > 0) line += `, ${String(summary.failed)} failed`;
  if (summary.warnings > 0) line += ` · ${plural(summary.warnings, "warning")}`;
  return line;
}

export function renderTasks(report: TasksReport, format: TasksFormat, opts: { color: boolean }): string {
  if (format === "json") return renderJson(report);
  if (report.runs.length === 0) return "No tasks to run.";
  if (format === "github") return renderGithub(report);
  const c = palette(opts.color);
  return [...report.runs.map((run) => runBlock(run, c)), tasksTotal(report.summary)].join("\n\n");
}

function renderJson(report: TasksReport): string {
  const runs = report.runs.map(({ maxTurns: _maxTurns, ...run }) => run);
  return JSON.stringify({ runs, summary: report.summary, exitCode: report.exitCode }, null, 2);
}

const label = (run: TaskRun): string => `${run.journey ?? "task"} as ${run.persona ?? "newcomer"}`;

const at = (e: TaskEval): string => (e.location === null ? "(no location)" : `${e.location.file}:${String(e.location.line)}`);

function tag(e: TaskEval): string {
  if (e.outcome === "pass") return "PASS";
  if (e.outcome === "skipped") return "SKIP";
  if (e.severity === "warning") return "WARN";
  if (e.severity === "notice") return "NOTE";
  return e.outcome === "fail" ? "FAIL" : e.outcome === "error" ? "ERROR" : "REVIEW";
}

function paint(text: string, e: TaskEval, c: Colors): string {
  const t = tag(e);
  if (t === "PASS") return c.green(text);
  if (t === "WARN") return c.yellow(text);
  if (t === "NOTE" || t === "SKIP") return c.dim(text);
  return c.red(text);
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60))}m ${String(s % 60).padStart(2, "0")}s`;
}

/** `text` wrapped at the report's width, each line indented. */
function wrap(text: string, indent: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter((w) => w !== "")) {
      if (line !== "" && indent.length + line.length + 1 + word.length > WIDTH) {
        out.push(indent + line);
        line = word;
      } else {
        line = line === "" ? word : `${line} ${word}`;
      }
    }
    out.push(line === "" ? "" : indent + line);
  }
  return out;
}

/** What a judged eval's verdict says, or the grader's own message. */
function said(e: TaskEval): string | undefined {
  if (e.consensus !== undefined) {
    const verdict = `AI judge: ${e.outcome} (confidence ${e.consensus.meanConfidence.toFixed(2)}).`;
    return e.message === undefined ? verdict : `${verdict} ${e.message}`;
  }
  return e.message;
}

function runBlock(run: TaskRun, c: Colors): string {
  const title = run.journey === null && run.task.length > 60 ? `${run.task.slice(0, 60)}…` : run.task;
  const lines = [c.bold(`${run.journey ?? "task"} · ${title} · as ${run.persona ?? "newcomer"}`)];
  const field = (name: string, value: string): string => `  ${name.padEnd(10)}${value}`;
  lines.push(field("start", run.start));
  if (run.docs.length > 0) lines.push(field("docs", run.docs.join(", ")));
  if (run.changes.added.length > 0) lines.push(field("added", run.changes.added.join(", ")));
  if (run.changes.changed.length > 0) lines.push(field("changed", run.changes.changed.join(", ")));
  if (run.changes.removed.length > 0) lines.push(field("removed", run.changes.removed.join(", ")));
  lines.push(`  ${plural(run.turns, "turn")} · ${duration(run.durationMs)}`);

  const tagWidth = Math.max(4, ...run.evals.map((e) => tag(e).length));
  const idWidth = Math.max(0, ...run.evals.map((e) => e.id.length)) + 5;
  const detail = " ".repeat(2 + tagWidth + 1);
  for (const e of run.evals) {
    lines.push(`  ${paint(tag(e).padEnd(tagWidth), e, c)} ${e.id.padEnd(idWidth)}${c.dim(at(e))}`);
    if (e.outcome === "pass") continue;
    if (e.assertion !== undefined) lines.push(...wrap(e.assertion, detail));
    const message = said(e);
    if (message !== undefined) lines.push(...wrap(message, detail).map((l) => c.dim(l)));
  }
  if (run.stoppedAtLimit) lines.push(`  stopped at the ${String(run.maxTurns)}-turn limit`);
  if (run.account.trim() !== "") lines.push("  Account", ...wrap(run.account.trim(), "    "));
  if (run.kept !== null) lines.push(field("kept", run.kept));
  lines.push(field("trace", run.trace));
  return lines.join("\n");
}

function githubLine(run: TaskRun, e: TaskEval): string {
  const level = e.severity === "notice" ? "notice" : e.severity === "warning" ? "warning" : "error";
  const props = [
    ...(e.location === null
      ? []
      : [`file=${escapeWorkflowCommandProperty(e.location.file)}`, `line=${String(e.location.line)}`]),
    "title=manni test tasks",
  ].join(",");
  const what =
    e.id === "constraint" && e.outcome === "fail"
      ? `constraint "${e.assertion ?? ""}" not honored.`
      : `${e.id} ${e.outcome === "fail" ? "failed" : e.outcome === "error" ? "could not be graded" : "needs review"}.`;
  const message = [`${label(run)}: ${what}`, e.message].filter((m) => m !== undefined && m !== "").join(" ");
  return `::${level} ${props}::${escapeWorkflowCommandMessage(message)}`;
}

function renderGithub(report: TasksReport): string {
  const commands = report.runs.flatMap((run) =>
    run.evals.filter((e) => e.outcome !== "pass" && e.outcome !== "skipped").map((e) => githubLine(run, e)),
  );
  return [...commands, tasksTotal(report.summary)].join("\n");
}
