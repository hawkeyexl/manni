/** Human-readable terminal report. */
import pc from "picocolors";
import type { EvalResult, RunReport } from "../types.js";
import type { CoverageEntry } from "../artifacts/types.js";
import {
  availabilityLines,
  availabilityTag,
  coverageLocation,
  coverageStaleness,
  manifestLines,
} from "./coverage.js";

const OUTCOME_LABEL: Record<EvalResult["outcome"], string> = {
  pass: "PASS",
  fail: "FAIL",
  error: "ERROR",
  "needs-review": "REVIEW",
  skipped: "SKIP",
};

function colorFor(outcome: EvalResult["outcome"]): (s: string) => string {
  switch (outcome) {
    case "pass":
      return pc.green;
    case "fail":
    case "error":
      return pc.red;
    case "needs-review":
      return pc.yellow;
    default:
      return pc.dim;
  }
}

/**
 * `✓` resolved, `·` offered and never used (nothing was looked for, so it is
 * not an unresolved reference), `○` referenced but not found.
 */
function coverageMark(entry: CoverageEntry): string {
  if (entry.resolved) return pc.green("✓");
  if (entry.availability === "offered-not-used") return pc.dim("·");
  return pc.yellow("○");
}

export function renderHuman(report: RunReport): string {
  const lines: string[] = [];
  const t = report.trace;
  lines.push(pc.bold(`manni tracevals — ${t.file}`));
  lines.push(
    pc.dim(
      `${t.source} · ${t.model ?? "unknown model"} · ${t.turnCount} turn(s) · ${t.cwd}`,
    ),
  );
  lines.push("");

  for (const result of report.evalResults) {
    const paint = colorFor(result.outcome);
    const label = paint(OUTCOME_LABEL[result.outcome].padEnd(6));
    const name = `${result.artifactName} › ${result.evalName}`;
    lines.push(`  ${label} ${name}${result.implicit ? pc.dim(" (implicit)") : ""}`);
    for (const finding of result.findings ?? []) {
      if (result.outcome !== "pass" || finding.severity !== "error") {
        lines.push(`         ${pc.dim(`[${finding.severity}]`)} ${finding.message}`);
      }
    }
    if (result.error) lines.push(`         ${pc.red(result.error)}`);
    if (result.skipReason) lines.push(`         ${pc.dim(result.skipReason)}`);
    if (result.consensus && result.outcome !== "pass") {
      const v = result.consensus.votes;
      lines.push(
        `         ${pc.dim(`votes pass:${v.pass} fail:${v.fail} partial:${v.partial} error:${v.error} · confidence ${result.consensus.meanConfidence.toFixed(2)}`)}`,
      );
      const observed = result.consensus.runs.find((r) => r.verdict)?.verdict
        ?.observed;
      if (observed) lines.push(`         ${pc.dim(observed)}`);
    }
  }

  lines.push("");
  lines.push(pc.bold("Artifact coverage"));
  for (const entry of report.coverage) {
    const tag = availabilityTag(entry);
    const location = coverageLocation(entry);
    const stale = coverageStaleness(entry);
    // Joined from the non-empty parts: an aggregated entry has no location, and
    // interpolating one anyway leaves a double space before the note. The two
    // markers are independent — a row can be both offered-but-unused and stale.
    lines.push(
      [
        `  ${coverageMark(entry)} ${entry.kind}: ${entry.ref}`,
        tag === undefined ? "" : pc.yellow(`[${tag}]`),
        location ? pc.dim(location) : "",
        stale ? pc.yellow(`⚠ ${stale}`) : "",
      ]
        .filter((part) => part !== "")
        .join(" "),
    );
  }

  if (report.manifest !== undefined) {
    // Only when there is one: a line saying "no manifest" on every run of every
    // project that has not adopted `capture` is noise, and the per-row skipped
    // content check already carries the machine-readable answer (ADR 01024).
    lines.push("");
    lines.push(pc.bold("Session manifest"));
    for (const line of manifestLines(report.manifest)) {
      lines.push(`  ${pc.dim(line)}`);
    }
  }

  lines.push("");
  lines.push(pc.bold("Availability"));
  for (const line of availabilityLines(report.availability)) {
    lines.push(`  ${pc.dim(line)}`);
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push(pc.bold("Warnings"));
    for (const warning of report.warnings) {
      lines.push(`  ${pc.yellow("!")} ${warning}`);
    }
  }

  const s = report.summary;
  lines.push("");
  lines.push(
    pc.bold(
      `${s.total} eval(s): ${pc.green(`${s.pass} pass`)}, ${
        s.fail > 0 ? pc.red(`${s.fail} fail`) : `${s.fail} fail`
      }, ${s.error} error, ${s.needsReview} needs-review, ${s.skipped} skipped`,
    ),
  );
  // Only when it says something the counts do not. With every weight at 1 the
  // rate is just pass/graded, which the line above already shows; printing it
  // anyway would be a second way to read the same number.
  const weighted = report.evalResults.some(
    (r) => r.weight !== undefined && r.weight !== 1,
  );
  if (weighted) {
    lines.push(
      pc.dim(`weighted pass rate ${(s.passRate * 100).toFixed(0)}%`),
    );
  }
  if (report.costUsd > 0) {
    lines.push(pc.dim(`judge cost $${report.costUsd.toFixed(4)}`));
  }
  return lines.join("\n");
}
