/**
 * Aggregate rendering for a batch run (ADR 01018).
 *
 * A batch answers a different question from a single run — "how often does this
 * hold?" rather than "did it hold?" — so the lead is the rate table, not the
 * eval list. The outlier traces are named inline: a rate with no way back to
 * the session that produced it is a number nobody can act on.
 */
import pc from "picocolors";
import type { BatchReportWithBudget } from "../aggregate.js";
import type { AggregateRow } from "../types.js";

/**
 * `BatchReportWithBudget` rather than `BatchReport`: `budget` is optional, so
 * a plain report is still accepted, and a report that carries one is rendered
 * rather than silently dropped.
 */
type Report = BatchReportWithBudget;

/**
 * One line, and never a quiet one. An exhausted budget means the rates below
 * it were computed over a corpus the tool stopped looking at, so it belongs
 * beside the headline — the warnings block at the foot carries the same fact,
 * but a reader scanning the rates would never reach it.
 */
function budgetLine(report: Report): string | undefined {
  const b = report.budget;
  if (b === undefined) return undefined;
  return `${b.skippedEvals} eval(s) across ${b.traces} trace(s) were never judged — ${b.reason}`;
}

/** Escapes a value for a markdown table cell; see the note in markdown.ts. */
const cell = (value: string): string => value.replace(/\|/g, "\\|");

/** `null` means nothing was graded — say so rather than printing `0%`. */
function rate(row: AggregateRow): string {
  return row.passRate === null
    ? "—"
    : `${Math.round(row.passRate * 1000) / 10}%`;
}

function detail(row: AggregateRow): string {
  const parts: string[] = [];
  const c = row.counts;
  parts.push(
    `${c.pass} pass, ${c.fail} fail, ${c.error} error, ${c.needsReview} review, ${c.skipped} skip`,
  );
  return parts.join(" · ");
}

/** Keep a long outlier list readable without hiding that it was truncated. */
function names(files: string[], limit = 3): string {
  const shown = files.slice(0, limit).map((f) => basename(f));
  return files.length > limit
    ? `${shown.join(", ")} +${files.length - limit} more`
    : shown.join(", ");
}

/** Last path segment, separator-agnostic so Windows and POSIX agree. */
function basename(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] ?? file;
}

/**
 * The traces that make a row less than 100%, labelled by which kind they are.
 * A rate with no route back to the session that produced it is a number nobody
 * can act on — and a review-only row would otherwise read as an unexplained 0%.
 */
function outliers(row: AggregateRow): string {
  const parts: string[] = [];
  if (row.failingTraces.length > 0) {
    parts.push(`fail: ${names(row.failingTraces)}`);
  }
  if (row.reviewTraces.length > 0) {
    parts.push(`review: ${names(row.reviewTraces)}`);
  }
  return parts.join("; ");
}

export function renderBatchHuman(report: Report): string {
  const lines: string[] = [];
  const s = report.summary;
  lines.push(pc.bold(`manni tracevals — ${s.traces} trace(s)`));
  lines.push(
    pc.dim(
      `${s.tracesPassed} passed · ${s.tracesFailed} failed · ${s.tracesErrored} unreadable`,
    ),
  );
  const cutShort = budgetLine(report);
  if (cutShort !== undefined) {
    lines.push(pc.red(`${pc.bold("BUDGET EXHAUSTED")}  ${cutShort}`));
  }
  lines.push("");

  lines.push(pc.bold("Eval pass rates"));
  if (report.evals.length === 0) {
    lines.push(pc.dim("  no evals were planned for any trace"));
  }
  for (const row of report.evals) {
    const label =
      row.passRate === null
        ? pc.dim(rate(row).padStart(6))
        : row.passRate === 1
          ? pc.green(rate(row).padStart(6))
          : pc.red(rate(row).padStart(6));
    lines.push(
      `  ${label}  ${row.artifactName} › ${row.evalName ?? ""} ${pc.dim(`(${row.traces} trace(s))`)}`,
    );
    lines.push(`          ${pc.dim(detail(row))}`);
    if (row.failingTraces.length > 0) {
      lines.push(`          ${pc.red(`failing: ${names(row.failingTraces)}`)}`);
    }
    if (row.reviewTraces.length > 0) {
      lines.push(
        `          ${pc.yellow(`review: ${names(row.reviewTraces)}`)}`,
      );
    }
    for (const reason of row.skipReasons) {
      lines.push(`          ${pc.dim(`skipped: ${reason}`)}`);
    }
  }

  lines.push("");
  lines.push(pc.bold("Artifact pass rates"));
  for (const row of report.artifacts) {
    lines.push(
      `  ${rate(row).padStart(6)}  ${row.artifactType}: ${row.artifactName} ${pc.dim(detail(row))}`,
    );
  }

  lines.push("");
  lines.push(pc.bold("Traces"));
  for (const t of report.traces) {
    if (t.error !== undefined) {
      lines.push(`  ${pc.red("ERROR ")} ${basename(t.file)}`);
      lines.push(`          ${pc.red(t.error)}`);
      continue;
    }
    const mark = t.exitCode === 0 ? pc.green("PASS  ") : pc.red("FAIL  ");
    const ts = t.summary;
    lines.push(
      `  ${mark} ${basename(t.file)} ${pc.dim(
        `${ts?.pass ?? 0} pass, ${ts?.fail ?? 0} fail, ${ts?.error ?? 0} error, ${ts?.needsReview ?? 0} review, ${ts?.skipped ?? 0} skip`,
      )}`,
    );
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push(pc.bold("Warnings"));
    for (const warning of report.warnings) {
      lines.push(`  ${pc.yellow("!")} ${warning}`);
    }
  }

  lines.push("");
  lines.push(
    pc.bold(
      `${s.total} eval(s) across ${s.traces} trace(s): ${pc.green(`${s.pass} pass`)}, ${
        s.fail > 0 ? pc.red(`${s.fail} fail`) : `${s.fail} fail`
      }, ${s.error} error, ${s.needsReview} needs-review, ${s.skipped} skipped`,
    ),
  );
  if (report.costUsd > 0) {
    lines.push(pc.dim(`judge cost $${report.costUsd.toFixed(4)}`));
  }
  return lines.join("\n");
}

export function renderBatchMarkdown(report: Report): string {
  const lines: string[] = [];
  const s = report.summary;
  lines.push(`# manni tracevals batch report`);
  lines.push("");
  lines.push(`- **Traces**: ${s.traces}`);
  lines.push(
    `- **Outcome**: ${s.tracesPassed} passed, ${s.tracesFailed} failed, ${s.tracesErrored} unreadable`,
  );
  const cutShort = budgetLine(report);
  if (cutShort !== undefined) lines.push(`- **Budget**: ${cutShort}`);
  lines.push("");

  lines.push(`## Eval pass rates`);
  lines.push("");
  lines.push(`| Rate | Artifact | Eval | Grader | Traces | Outcomes | Outliers |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const row of report.evals) {
    lines.push(
      `| ${rate(row)} | ${cell(row.artifactName)} | ${cell(row.evalName ?? "")} | ${cell(
        (row.graders ?? []).join(", "),
      )} | ${row.traces} | ${cell(detail(row))} | ${cell(outliers(row))} |`,
    );
  }
  lines.push("");

  lines.push(`## Artifact pass rates`);
  lines.push("");
  lines.push(`| Rate | Kind | Artifact | Traces | Outcomes |`);
  lines.push(`|---|---|---|---|---|`);
  for (const row of report.artifacts) {
    lines.push(
      `| ${rate(row)} | ${cell(row.artifactType)} | ${cell(row.artifactName)} | ${row.traces} | ${cell(detail(row))} |`,
    );
  }
  lines.push("");

  lines.push(`## Traces`);
  lines.push("");
  lines.push(`| Result | Trace | Evals | Detail |`);
  lines.push(`|---|---|---|---|`);
  for (const t of report.traces) {
    const result = t.error !== undefined ? "error" : t.exitCode === 0 ? "pass" : "fail";
    const evals =
      t.summary === undefined
        ? ""
        : `${t.summary.pass}/${t.summary.total} pass`;
    lines.push(
      `| ${result} | \`${cell(t.file)}\` | ${evals} | ${cell(t.error ?? "")} |`,
    );
  }
  lines.push("");

  if (report.warnings.length > 0) {
    lines.push(`## Warnings`);
    lines.push("");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  lines.push(
    `**${s.total} eval(s)** across ${s.traces} trace(s) — ${s.pass} pass, ${s.fail} fail, ${s.error} error, ${s.needsReview} needs-review, ${s.skipped} skipped.`,
  );
  return lines.join("\n");
}
