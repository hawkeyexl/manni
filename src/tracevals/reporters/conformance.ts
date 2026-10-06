/**
 * Pretty output for `check`, `prepare` and `release` (proposal 0079). JSON is
 * each report as it stands, so only prose lives here. Colour is the caller's
 * decision, made once by `colorFor`.
 */
import { palette } from "../../shared/color.js";
import type { CheckReport } from "../commands/check.js";
import type { PrepareReport } from "../commands/prepare.js";
import type { ReleaseReport } from "../commands/release.js";
import { GB } from "../rules/local.js";

const count = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** Findings grouped under their source, then the closing line. */
export function renderCheck(report: CheckReport, opts: { color?: boolean } = {}): string {
  const pc = palette(opts.color === true);
  const lines: string[] = [];
  for (const source of report.sources) {
    const findings = report.findings.filter((f) => f.source === source.path);
    if (findings.length === 0) continue;
    lines.push(source.path);
    for (const f of findings) {
      const mark = f.outcome === "fail" ? pc.red("✖") : pc.yellow("?");
      lines.push(`  ${mark} ${f.rule}  ${f.text}`);
      lines.push(`      ${pc.dim(`${f.observed} (${f.confidence.toFixed(2)})`)}`);
    }
  }
  for (const warning of report.warnings) lines.push(`${pc.yellow("!")} ${warning}`);
  if (lines.length > 0) lines.push("");
  lines.push(closing(report));
  return lines.join("\n");
}

function closing(report: CheckReport): string {
  const head = `Last turn of ${report.sessionId.slice(0, 8)}:`;
  const { summary } = report;
  const scope = `${count(summary.rules, "rule", "rules")} from ${count(summary.sources, "file", "files")}`;
  switch (report.skipped) {
    case "empty-turn":
      return `${head} nothing happened after the last prompt.`;
    case "no-sources":
      return `${head} no rule sources governed it.`;
    case "not-applicable":
      return `${head} ${scope}, none apply to this turn.`;
    case null: {
      const broken = summary.fail > 0 ? `${String(summary.fail)} broken` : "None broken";
      const review = summary.needsReview > 0 ? `, ${String(summary.needsReview)} needs review` : "";
      return `${head} ${scope}. ${broken}${review}.`;
    }
  }
}

export const NOT_SET_UP = "tracevals conformance is not set up; nothing to prepare.";

export function renderPrepare(report: PrepareReport): string {
  const lines: string[] = [];
  const said = new Set<string>();
  for (const m of report.models) {
    if (m.state === "hosted" || said.has(m.model)) continue;
    said.add(m.model);
    const name = `${m.model} (${m.provider})`;
    lines.push(
      m.state === "downloaded"
        ? `${name} downloaded, ${((m.bytes ?? 0) / GB).toFixed(2)} GB.`
        : `${name} is ${m.state}.`,
    );
  }
  const ex = report.extraction;
  if (ex !== null) {
    const files = (n: number): string =>
      `${count(n, "file", "files")} that ${n === 1 ? "applies" : "apply"} to every session`;
    if (ex.extracted > 0) {
      lines.push(
        `Extracted ${count(ex.rules, "rule", "rules")} from ${files(ex.extracted)}.` +
          (ex.cached > 0 ? ` ${String(ex.cached)} more ${ex.cached === 1 ? "was" : "were"} cached.` : ""),
      );
    } else if (ex.cached > 0) {
      lines.push(`${files(ex.cached)} ${ex.cached === 1 ? "is" : "are"} cached. Nothing to extract.`);
    } else {
      lines.push("No file applies to every session. Nothing to extract.");
    }
  }
  for (const warning of report.warnings) lines.push(warning);
  return lines.join("\n");
}

export const NO_HOST = "No model host is running.";

export function renderRelease(report: ReleaseReport): string {
  if (!report.hostStopped && report.released.length === 0 && report.unloaded.length === 0) {
    return NO_HOST;
  }
  const unloaded = report.unloaded.length > 0 ? `Unloaded ${report.unloaded.join(", ")}` : "";
  const stopped = report.hostStopped ? "stopped the model host" : "";
  const action = [unloaded, stopped].filter((s) => s !== "").join(" and ");
  const held = count(report.released.length, "session", "sessions");
  return `${action === "" ? "Released the lease" : action}. ${held} held it.`;
}
