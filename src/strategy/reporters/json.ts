/**
 * JSON output for every `manni strategy` command. A record is the same object
 * in `list` and `get`: its fields, where it was read, its parent, and what
 * names it. Paths are relative to the working directory.
 */
import type { StrategyReport } from "../commands/findings.js";
import type { RecordEntry } from "../commands/list.js";
import { displayPath } from "../commands/run.js";
import { titleOf } from "./pretty.js";

export function recordJson(entry: RecordEntry): Record<string, unknown> {
  const { record } = entry;
  // `title` is never absent: an untitled record shows its id, as `list` does.
  const out: Record<string, unknown> = { id: record.id, type: record.type, title: titleOf(record) };
  if (record.description !== undefined) out["description"] = record.description;
  if (record.lifecycle !== undefined) out["lifecycle"] = record.lifecycle;
  out["file"] = entry.file;
  out["line"] = record.line;
  // A journey's `personas` is always a list. A persona's `audience` is one value, as it is written.
  const parents = record.parents.map((p) => p.value);
  if (record.type === "journey") out["personas"] = parents;
  if (record.type === "persona" && parents.length > 0) out["audience"] = parents.length === 1 ? parents[0] : parents;
  if (entry.steps !== undefined) {
    out["steps"] = entry.steps.map((step) => ({
      ...(step.stage === undefined ? {} : { stage: step.stage }),
      ...(step.doc === undefined ? {} : { doc: step.doc }),
      ...(step.exists === undefined ? {} : { exists: step.exists }),
      ...(step.note === undefined ? {} : { note: step.note }),
      ...(step.line === undefined ? {} : { line: step.line }),
      state: step.state,
      ...(step.page === undefined ? {} : { page: step.page }),
    }));
    if (entry.coverage !== undefined) out["coverage"] = entry.coverage;
  }
  const children = entry.children.map((r) => r.id);
  out["namedBy"] = {
    ...(record.type === "audience" ? { personas: children } : {}),
    ...(record.type === "persona" ? { journeys: children } : {}),
    pages: entry.pages,
  };
  return out;
}

/** Each record once, where the tree first reaches it. */
export function renderListJson(entries: readonly RecordEntry[]): string {
  const once = new Map(entries.map((entry) => [entry.record, entry]));
  return JSON.stringify({ records: [...once.values()].map(recordJson) }, null, 2);
}

export function renderGetJson(entry: RecordEntry): string {
  return JSON.stringify(recordJson(entry), null, 2);
}

export function renderFindingsJson(report: StrategyReport): string {
  const count = (severity: string): number => report.findings.filter((f) => f.severity === severity).length;
  return JSON.stringify(
    {
      // `key` is the baseline's identity for a finding, not something it says.
      findings: report.findings.map(({ key: _identity, ...finding }) => ({
        ...finding,
        file: displayPath(finding.file, report.cwd, report.base),
      })),
      summary: {
        records: report.records,
        // Only a run that read a borrowed record carries the key.
        ...(report.borrowed > 0 ? { borrowed: report.borrowed } : {}),
        references: report.references,
        // Only a set with steps carries the key, so a set without them prints as it always has.
        ...(report.steps > 0 ? { steps: report.steps } : {}),
        errors: count("error"),
        warnings: count("warning"),
        notices: count("notice"),
        ...(report.baseline === undefined ? {} : { baseline: report.baseline }),
      },
    },
    null,
    2,
  );
}
