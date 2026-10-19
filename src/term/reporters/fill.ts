/**
 * `manni term fill`'s output: one line per entry and a summary, or the report
 * as JSON.
 */
import type { FillEntry, FillReport } from "../commands/fill.js";
import { plural } from "../commands/run.js";

const DONE: Record<FillEntry["action"], string> = { create: "created", fill: "filled", skip: "skipped", exists: "exists" };
const WOULD: Record<FillEntry["action"], string> = { create: "would create", fill: "would fill", skip: "skipped", exists: "exists" };

function detail(entry: FillEntry, threshold: number): string {
  if (entry.reason !== undefined) return entry.reason;
  const { status, confidence } = entry.definition;
  if (entry.action === "exists") return "the file is already there";
  switch (status) {
    case "carried":
      return "definition from graph: block";
    case "drafted":
      return `definition drafted (${(confidence ?? 0).toFixed(2)})`;
    case "below-threshold": {
      const under = `confidence ${(confidence ?? 0).toFixed(2)} is under ${String(threshold)}`;
      return entry.action === "create" ? `stub, ${under}` : under;
    }
    case "missing":
      return "stub, no definition";
  }
}

export function renderFillPretty(report: FillReport): string {
  const words = report.dryRun ? WOULD : DONE;
  const actionWidth = Math.max(0, ...report.entries.map((e) => words[e.action].length));
  const fileWidth = Math.max(0, ...report.entries.map((e) => e.file.length)) + 3;
  const labelWidth = Math.max(0, ...report.entries.map((e) => e.label.length)) + 3;
  const lines = report.entries.map((e) =>
    `${words[e.action].padEnd(actionWidth)} ${e.file.padEnd(fileWidth)}${e.label.padEnd(labelWidth)}${detail(e, report.threshold)}`,
  );
  const { created, filled, skipped, withoutDefinition } = report.summary;
  // A skip is counted only when there is one, so a clean run reads as it did.
  const skips = skipped > 0 ? `, ${String(skipped)} skipped` : "";
  lines.push(
    report.dryRun
      ? `${plural(created, "term")} would be created, ${String(filled)} would be filled, ${String(withoutDefinition)} left without a definition${skips}`
      : `${plural(created, "term")} created, ${String(filled)} filled, ${String(withoutDefinition)} left without a definition${skips}`,
  );
  return lines.join("\n");
}

export function renderFillJson(report: FillReport): string {
  return JSON.stringify({ entries: report.entries, summary: report.summary }, null, 2);
}
