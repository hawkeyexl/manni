/** Markdown reporter: PR-comment-friendly summary. */
import type { EngineReport } from "../core/engine.js";

const OUTCOME_ICON: Record<string, string> = {
  pass: "✅",
  fail: "❌",
  "needs-review": "🟡",
  skipped: "⏭️",
  error: "🛑",
};

export function renderMarkdown(report: EngineReport): string {
  const lines: string[] = ["## manni docevals results", ""];

  lines.push("| Suite | Passed | Failed | Review | Pass rate | Target | |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const s of report.suites) {
    lines.push(
      `| ${s.suite} | ${s.passed} | ${s.failed + s.errored} | ${s.needsReview} | ` +
        `${(s.passRate * 100).toFixed(0)}% | ${(s.targetPassRate * 100).toFixed(0)}% | ` +
        // A filtered run measured part of the suite: no verdict, so
        // neither mark. Rendering ❌ made every filtered run look failed
        // (ADR 01018).
        `${s.partial ? "➖ partial" : s.meetsTarget ? "✅" : "❌"} |`,
    );
  }

  // What `--since` scoped the run to. This matters most in the CI formats: a
  // clean-tree run is otherwise an empty table nobody can tell apart from a
  // corpus that passed (ADR 01040).
  const sc = report.since;
  if (sc) {
    lines.push("");
    lines.push(
      sc.pagesSelected === 0
        ? `> **No pages changed since \`${sc.ref}\` — nothing was evaluated.**`
        : `_Scoped to ${sc.pagesSelected} of ${sc.pagesTotal} page(s) changed since ` +
          `\`${sc.ref}\`. Corpus-wide graders still saw every page._`,
    );
  }

  // The baseline line belongs in the CI formats above all: `removed` is the
  // only signal that an over-narrow re-record just forgave findings, and
  // `renderGithub` delegates its summary here, so omitting it meant the
  // warning existed only in the format CI does not read.
  const bl = report.baseline;
  if (bl) {
    lines.push("");
    if (bl.written) {
      lines.push(
        `_Baseline \`${bl.path}\`: recorded ${bl.written.total} finding(s) ` +
          `(+${bl.written.added}, -${bl.written.removed})._`,
      );
      if (bl.written.removed > 0) {
        lines.push(
          "",
          `> **${bl.written.removed} previously recorded finding(s) are no longer in the baseline.** ` +
            "If this run covered less of the corpus than the last one, they have just been forgiven.",
        );
      }
    } else {
      lines.push(
        `_Baseline \`${bl.path}\`: ${bl.suppressed} finding(s) suppressed of ${bl.recorded} recorded` +
          (bl.stale > 0 ? `, ${bl.stale} no longer occur` : "") +
          "._",
      );
    }
  }

  const notable = report.evalResults.filter(
    (r) => r.outcome === "fail" || r.outcome === "error" || r.outcome === "needs-review",
  );
  if (notable.length > 0) {
    lines.push("", "### Findings", "");
    for (const r of notable) {
      const icon = OUTCOME_ICON[r.outcome] ?? "";
      lines.push(`- ${icon} **${r.evalName}** — \`${r.file}\``);
      for (const f of r.findings ?? []) {
        const loc = f.line != null ? `:${f.line}` : "";
        lines.push(`  - ${f.severity}${loc}: ${f.message}`);
      }
      if (r.consensus) {
        const v = r.consensus;
        const reasoning = v.runs.find((run) => run.verdict)?.verdict?.reasoning;
        lines.push(
          `  - votes pass:${v.votes.pass} fail:${v.votes.fail} partial:${v.votes.partial}, confidence ${v.meanConfidence.toFixed(2)} (${v.zone})`,
        );
        if (reasoning) lines.push(`  - ${reasoning}`);
      }
      if (r.skipReason && r.outcome === "error") lines.push(`  - ${r.skipReason}`);
    }
  }

  for (const p of report.problems) {
    lines.push(`- ⚠️ \`${p.file}\`${p.line != null ? `:${p.line}` : ""} ${p.message}`);
  }

  if (report.generated.length > 0) {
    lines.push("", "### Generated scripts", "");
    for (const g of report.generated) lines.push(`- \`${g}\``);
  }

  if (report.usage.judgedEvals > 0) {
    lines.push(
      "",
      `_Judged ${report.usage.judgedEvals} evals (${report.usage.cachedEvals} cached), ` +
        `${report.usage.totalTokens.toLocaleString()} tokens._`,
    );
  }
  return lines.join("\n");
}
