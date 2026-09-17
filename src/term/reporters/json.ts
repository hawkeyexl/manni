/**
 * JSON output for every `manni term` command. A term is the object
 * `write -f json` writes: its id, its language when it has one, and every field
 * in the vocabulary's order, so what `list -f json` prints can be read back as
 * a render.
 */
import { displayPath } from "../commands/run.js";
import type { FormatRow } from "../commands/formats.js";
import type { TermReport } from "../commands/findings.js";
import { TERM_FIELDS, type Term } from "../types.js";

export function termEntry(term: Term): Record<string, unknown> {
  const entry: Record<string, unknown> = { id: term.id };
  if (term.language !== undefined) entry["language"] = term.language;
  for (const field of TERM_FIELDS) {
    const value = term.record[field];
    if (value !== undefined) entry[field] = value;
  }
  return entry;
}

export function renderListJson(terms: readonly Term[]): string {
  return JSON.stringify({ terms: terms.map(termEntry) }, null, 2);
}

export function renderGetJson(term: Term): string {
  return JSON.stringify(termEntry(term), null, 2);
}

export function renderFindingsJson(report: TermReport): string {
  const count = (severity: string): number => report.findings.filter((f) => f.severity === severity).length;
  return JSON.stringify(
    {
      findings: report.findings.map((finding) => ({ ...finding, file: displayPath(finding.file, report.cwd) })),
      summary: {
        terms: report.terms,
        references: report.references,
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

export function renderFormatsJson(rows: readonly FormatRow[]): string {
  return JSON.stringify({ formats: rows }, null, 2);
}
