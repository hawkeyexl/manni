/** Human (terminal) reporter. */
import pc from "picocolors";
import type { EvalResult } from "../types.js";
import type { EngineReport } from "../core/engine.js";

function outcomeTag(r: EvalResult): string {
  switch (r.outcome) {
    case "pass":
      return pc.green("pass");
    case "fail":
      return pc.red("FAIL");
    case "needs-review":
      return pc.yellow("review");
    case "skipped":
      return pc.dim("skip");
    case "error":
      return pc.red("ERROR");
  }
}

export function renderHuman(report: EngineReport): string {
  const lines: string[] = [];

  const byFile = new Map<string, EvalResult[]>();
  for (const r of report.evalResults) {
    const list = byFile.get(r.file) ?? [];
    list.push(r);
    byFile.set(r.file, list);
  }

  for (const [file, results] of [...byFile.entries()].sort()) {
    lines.push(pc.bold(file));
    for (const r of results) {
      const zone = r.consensus ? pc.dim(` [${r.consensus.zone}]`) : "";
      const via = r.via ? pc.dim(" (human-reviewed)") : "";
      const gen = r.generated ? pc.cyan(" (generated)") : "";
      lines.push(`  ${outcomeTag(r)} ${r.evalName}${zone}${via}${gen}`);
      if (r.skipReason && r.outcome !== "pass") {
        lines.push(pc.dim(`       ${r.skipReason}`));
      }
      for (const f of r.findings ?? []) {
        const loc = f.line != null ? `:${f.line}` : "";
        const rule = f.ruleId ? pc.dim(` [${f.ruleId}]`) : "";
        const sev =
          f.severity === "error"
            ? pc.red(f.severity)
            : f.severity === "warning"
              ? pc.yellow(f.severity)
              : pc.dim(f.severity);
        lines.push(`       ${sev}${loc}${rule} ${f.message}`);
      }
      if (r.consensus && r.outcome !== "pass") {
        const v = r.consensus;
        lines.push(
          pc.dim(
            `       votes pass:${v.votes.pass} fail:${v.votes.fail} partial:${v.votes.partial}` +
              (v.votes.error ? ` error:${v.votes.error}` : "") +
              ` — confidence ${v.meanConfidence.toFixed(2)}`,
          ),
        );
        const reasoning = v.runs.find((run) => run.verdict)?.verdict?.reasoning;
        if (reasoning) lines.push(pc.dim(`       ${reasoning}`));
      }
    }
  }

  for (const p of report.problems) {
    const tag = p.level === "error" ? pc.red("error") : pc.yellow("warn");
    const loc = p.line != null ? `:${p.line}` : "";
    lines.push(`${tag} ${p.file}${loc} ${p.message}`);
  }

  if (report.generated.length > 0) {
    lines.push("");
    lines.push(pc.cyan(`Generated ${report.generated.length} check script(s):`));
    for (const g of report.generated) lines.push(`  ${g}`);
  }

  lines.push("");
  lines.push(pc.bold("Suites"));
  for (const s of report.suites) {
    // A filtered run measured part of the suite, so it has numbers but no
    // verdict. Rendering that as "below target" would read as a failure the
    // run never established (ADR 01018).
    const status = s.partial
      ? pc.yellow("partial — filtered run, target not evaluated")
      : s.meetsTarget
        ? pc.green("ok")
        : pc.red("below target");
    const extras: string[] = [];
    if (s.needsReview > 0) extras.push(`${s.needsReview} to review`);
    if (s.skipped > 0) extras.push(`${s.skipped} skipped`);
    const extra = extras.length > 0 ? pc.dim(` (${extras.join(", ")})`) : "";
    lines.push(
      `  ${s.suite}: ${s.passed}/${s.passed + s.failed + s.errored} passed — ` +
        `${(s.passRate * 100).toFixed(0)}% vs target ${(s.targetPassRate * 100).toFixed(0)}% ${status}${extra}`,
    );
  }

  // What `--since` scoped the run to. The zero case gets its own line, in
  // yellow, because a clean-tree run is otherwise an indistinguishable green:
  // same exit code, same empty body, nothing saying that nothing ran.
  const sc = report.since;
  if (sc) {
    lines.push("");
    lines.push(
      sc.pagesSelected === 0
        ? pc.yellow(`No pages changed since ${sc.ref} — nothing was evaluated.`)
        : pc.dim(
            `Scoped to ${sc.pagesSelected} of ${sc.pagesTotal} page(s) changed since ${sc.ref}. ` +
              `Corpus-wide graders still saw every page.`,
          ),
    );
  }

  // The baseline's line in the summary. `removed` is the load-bearing number
  // on a re-record: an accidental --write-baseline over a narrowed glob
  // forgives everything it did not see, and nothing else in a CI log says so.
  const bl = report.baseline;
  if (bl) {
    lines.push("");
    if (bl.written) {
      lines.push(
        pc.dim(
          `Baseline ${bl.path}: recorded ${bl.written.total} finding(s) ` +
            `(+${bl.written.added}, -${bl.written.removed}).`,
        ),
      );
      if (bl.written.removed > 0) {
        lines.push(
          pc.yellow(
            `  ${bl.written.removed} previously recorded finding(s) are no longer in the baseline. ` +
              `If this run covered less of the corpus than the last one, they have just been forgiven.`,
          ),
        );
      }
    } else {
      lines.push(
        pc.dim(
          `Baseline ${bl.path}: ${bl.suppressed} finding(s) suppressed of ${bl.recorded} recorded` +
            (bl.stale > 0 ? `, ${bl.stale} no longer occur` : "") +
            ".",
        ),
      );
    }
  }

  if (report.usage.judgedEvals > 0) {
    lines.push("");
    lines.push(
      pc.dim(
        `Judged ${report.usage.judgedEvals} evals (${report.usage.cachedEvals} cached), ` +
          `${report.usage.totalTokens.toLocaleString()} tokens`,
      ),
    );
  }

  const reviews = report.evalResults.filter(
    (r) => r.outcome === "needs-review",
  );
  if (reviews.length > 0) {
    lines.push("");
    lines.push(
      pc.yellow(
        `${reviews.length} eval(s) need human review — run \`manni docevals review\` to record verdicts.`,
      ),
    );
  }

  return lines.join("\n");
}
