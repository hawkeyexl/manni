/**
 * HTML reporter: one self-contained file a documentation owner can open.
 *
 * Every other format here is machine-facing (JSON, SARIF, JUnit) or
 * terminal-facing (human, markdown, github). The people the content strategy
 * names as corpus and standard owners are neither: they want to see which
 * pages failed, what the judge actually quoted, and whether the suite met its
 * target — and none of them are reading SARIF.
 *
 * Self-contained on purpose: no CDN, no external stylesheet, no fonts. The
 * file is meant to survive being attached to a PR, mailed, or opened from a CI
 * artifact directory, all of which strip or block external requests. It is
 * also why everything is inline rather than clever.
 */
import type { EngineReport } from "../core/engine.js";
import type { EvalResult } from "../types.js";

const OUTCOME_LABEL: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  "needs-review": "Needs review",
  skipped: "Skipped",
  error: "Error",
};

/** Escape for HTML text and quoted attribute values alike. */
function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

function suiteRows(report: EngineReport): string {
  return report.suites
    .map((s) => {
      // A filtered run measured part of the suite, so it has numbers and no
      // verdict — rendering it as a failure is what ADR 01018 forbids.
      const verdict = s.partial
        ? '<span class="v partial">partial</span>'
        : s.meetsTarget
          ? '<span class="v ok">met</span>'
          : '<span class="v bad">missed</span>';
      const criteria = s.criteria
        ? `${String(s.criteria.passed)}/${String(s.criteria.total)}` +
          (s.criteria.suspended > 0
            ? ` <span class="muted">(${String(s.criteria.suspended)} suspended)</span>`
            : "")
        : '<span class="muted">—</span>';
      return `<tr><th>${esc(s.suite)}</th><td>${String(s.passed)}</td><td>${String(
        s.failed + s.errored,
      )}</td><td>${String(s.needsReview)}</td><td>${String(s.skipped)}</td><td>${criteria}</td><td>${pct(
        s.passRate,
      )}</td><td>${pct(s.targetPassRate)}</td><td>${verdict}</td></tr>`;
    })
    .join("\n");
}

function evalBlock(r: EvalResult): string {
  const bits: string[] = [];
  bits.push(
    `<div class="eval ${esc(r.outcome)}">` +
      `<div class="eh"><span class="badge ${esc(r.outcome)}">${esc(
        OUTCOME_LABEL[r.outcome] ?? r.outcome,
      )}</span> <code>${esc(r.evalName)}</code>` +
      `<span class="muted"> · ${esc(r.grader)}${
        r.weight !== undefined && r.weight !== 1
          ? ` · weight ${String(r.weight)}`
          : ""
      }</span></div>`,
  );

  if (r.skipReason) bits.push(`<p class="reason">${esc(r.skipReason)}</p>`);

  // The judge's own words. This is the reason a docs owner opens the report at
  // all — a verdict without the quotation it rests on is not reviewable.
  const verdict = r.consensus?.runs.find((run) => run.verdict)?.verdict;
  if (verdict) {
    bits.push(
      `<p class="reason">${esc(verdict.reasoning)}</p>`,
      verdict.observed
        ? `<blockquote>${esc(verdict.observed)}</blockquote>`
        : "",
      `<p class="muted">consensus ${esc(r.consensus?.verdict ?? "")} · agreement ${pct(
        r.consensus?.agreement ?? 0,
      )} · confidence ${pct(r.consensus?.meanConfidence ?? 0)} · zone ${esc(
        r.consensus?.zone ?? "",
      )}</p>`,
    );
  }

  if (r.via === "human-review") {
    bits.push('<p class="note">Resolved by a recorded human review.</p>');
  }
  if (r.selfPreference) {
    bits.push(
      `<p class="warn">Judged by <code>${esc(r.selfPreference.model)}</code>, which also ` +
        (r.selfPreference.axis === "content"
          ? "generated this page. A model favors its own output."
          : "proposed this assertion. Have a human confirm it before trusting the verdict.") +
        "</p>",
    );
  }
  for (const f of r.findings ?? []) {
    bits.push(
      `<p class="finding"><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span> ` +
        `${esc(f.message)}${f.line ? ` <span class="muted">(line ${String(f.line)})</span>` : ""}</p>`,
    );
  }
  bits.push("</div>");
  return bits.filter(Boolean).join("\n");
}

export function renderHtml(report: EngineReport): string {
  const byFile = new Map<string, EvalResult[]>();
  for (const r of report.evalResults) {
    const list = byFile.get(r.file) ?? [];
    list.push(r);
    byFile.set(r.file, list);
  }

  const pages = [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, results]) => {
      const failed = results.filter(
        (r) => r.outcome === "fail" || r.outcome === "error",
      ).length;
      return (
        `<section><h3>${esc(file)}` +
        (failed > 0 ? ` <span class="badge fail">${String(failed)}</span>` : "") +
        `</h3>${results.map(evalBlock).join("\n")}</section>`
      );
    })
    .join("\n");

  const problems = report.problems.length
    ? `<h2>Problems</h2><ul class="problems">${report.problems
        .map(
          (p) =>
            `<li class="${esc(p.level)}"><code>${esc(p.file)}</code>${
              p.line ? `:${String(p.line)}` : ""
            } — ${esc(p.message)}</li>`,
        )
        .join("")}</ul>`
    : "";

  const bl = report.baseline;
  const baseline = bl
    ? `<p class="note">Baseline <code>${esc(bl.path)}</code>: ${String(
        bl.recorded,
      )} recorded, ${String(bl.suppressed)} suppressed${
        bl.stale > 0 ? `, ${String(bl.stale)} stale` : ""
      }.</p>`
    : "";

  // A dark-mode block rather than a fixed palette: the file gets opened in
  // whatever the reader already uses, and a white sheet in a dark editor is
  // the kind of small rudeness that stops people opening it twice.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>manni docevals results</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e2e2e2;--ok:#137333;--bad:#b3261e;--warn:#8a6100;--card:#fafafa}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--fg:#e6e6e6;--muted:#9aa0a6;--line:#2c2f36;--ok:#7ee2a8;--bad:#ff8a80;--warn:#ffca7a;--card:#1d2026}}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1.25rem;background:var(--bg);color:var(--fg);
font:15px/1.55 ui-sans-serif,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
main{max-width:60rem;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 .25rem}
h2{font-size:1.1rem;margin:2rem 0 .5rem;padding-bottom:.25rem;border-bottom:1px solid var(--line)}
h3{font-size:.95rem;margin:1.5rem 0 .5rem;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid var(--line)}
thead th{color:var(--muted);font-weight:600}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
.muted{color:var(--muted)}
.eval{border:1px solid var(--line);border-left-width:3px;border-radius:6px;background:var(--card);padding:.6rem .8rem;margin:.4rem 0}
.eval.fail,.eval.error{border-left-color:var(--bad)}
.eval.pass{border-left-color:var(--ok)}
.eval.needs-review{border-left-color:var(--warn)}
.badge{display:inline-block;padding:.05rem .4rem;border-radius:4px;font-size:.75rem;font-weight:600;border:1px solid var(--line)}
.badge.pass{color:var(--ok)}.badge.fail,.badge.error{color:var(--bad)}
blockquote{margin:.4rem 0;padding:.3rem .7rem;border-left:2px solid var(--line);color:var(--muted)}
.reason{margin:.3rem 0}
.warn{color:var(--warn);margin:.3rem 0}
.note{color:var(--muted);margin:.3rem 0}
.finding{margin:.2rem 0}
.sev{font-size:.75rem;text-transform:uppercase;font-weight:600;margin-right:.35rem}
.sev.error{color:var(--bad)}.sev.warning{color:var(--warn)}.sev.info{color:var(--muted)}
.v.ok{color:var(--ok)}.v.bad{color:var(--bad)}.v.partial{color:var(--muted)}
.problems li.error{color:var(--bad)}.problems li.warning{color:var(--warn)}
</style></head><body><main>
<h1>manni docevals results</h1>
<p class="muted">${String(report.pages)} page(s) · ${String(
    report.evalResults.length,
  )} eval(s) · exit ${String(report.exitCode)}</p>
${baseline}
<h2>Suites</h2>
<table><thead><tr><th>Suite</th><th>Pass</th><th>Fail</th><th>Review</th><th>Skip</th><th>Criteria</th><th>Rate</th><th>Target</th><th></th></tr></thead>
<tbody>
${suiteRows(report)}
</tbody></table>
${problems}
<h2>Pages</h2>
${pages}
</main></body></html>
`;
}
