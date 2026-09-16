/**
 * Human output for every `manni term` command, in the shapes the ladder of
 * proposal 0052 prints. Columns are padded to their widest value; prose wraps
 * to 80 columns under its own column, so a long definition or message never
 * runs back to the left edge.
 */
import { palette, type Colors } from "../../shared/color.js";
import type { TermReport } from "../commands/findings.js";
import type { FormatRow } from "../commands/formats.js";
import { displayPath, plural } from "../commands/run.js";
import type { ValeWiring, WriteReport } from "../commands/write.js";
import type { Severity } from "../../shared/severity.js";
import { TERM_FIELDS, type Term, type TermField, type TermFinding } from "../types.js";

const WIDTH = 80;

/** Words packed into lines of at most `width` characters; a longer word stands alone. */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines.length === 0 ? [""] : lines;
}

/** Sentences packed into lines of at most `width`; a message that fits stays whole. */
function wrapSentences(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const lines: string[] = [];
  let line = "";
  for (const sentence of text.split(/(?<=\.)\s+(?=\S)/)) {
    if (line === "") line = sentence;
    else if (line.length + 1 + sentence.length <= width) line = `${line} ${sentence}`;
    else {
      lines.push(line);
      line = sentence;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

function hanging(first: string, lines: readonly string[]): string[] {
  const indent = " ".repeat(first.length);
  return lines.map((line, i) => `${i === 0 ? first : indent}${line}`.trimEnd());
}

// ---------------------------------------------------------------------------
// list

export function renderListPretty(terms: readonly Term[]): string {
  const idWidth = Math.max(0, ...terms.map((t) => t.id.length)) + 3;
  const labelWidth = Math.max(0, ...terms.map((t) => t.record.label.length)) + 3;
  const rows = terms.map((t) =>
    `${t.id.padEnd(idWidth)}${t.record.label.padEnd(labelWidth)}${(t.record["alt-labels"] ?? []).join(", ")}`.trimEnd(),
  );
  return [...rows, plural(terms.length, "term")].join("\n");
}

// ---------------------------------------------------------------------------
// get

/** The order `get` shows fields in: names first, then what they mean, the definition last. */
const GET_FIELDS: readonly TermField[] = [
  "alt-labels",
  "hidden-labels",
  "broader",
  "narrower",
  "related-terms",
  "see",
  "abstract",
  "scope-note",
  "definition",
];

const KEY_WIDTH = Math.max("language".length, ...TERM_FIELDS.map((f) => f.length)) + 2;

export function renderGetPretty(term: Term, opts: { color: boolean; cwd?: string }): string {
  const c = palette(opts.color);
  const where = `${displayPath(term.location.file, opts.cwd ?? process.cwd())}:${String(term.location.line)}`;
  const lines = [`${c.bold(term.record.label.padEnd(40))}${c.dim(where)}`];
  const row = (key: string, value: string): void => {
    const prefix = `  ${key.padEnd(KEY_WIDTH)}`;
    lines.push(...hanging(prefix, wrapWords(value, WIDTH - prefix.length)));
  };
  row("id", term.id);
  if (term.language !== undefined) row("language", term.language);
  for (const field of GET_FIELDS) {
    const value = term.record[field];
    if (value === undefined) continue;
    row(field, typeof value === "string" ? value : value.join(", "));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// check and lint

const RULE_WIDTH = 32;

function severityText(c: Colors, severity: Severity): string {
  const padded = severity.padEnd(6);
  if (severity === "error") return c.red(padded);
  if (severity === "warning") return c.yellow(padded);
  return c.cyan(padded);
}

function counts(findings: readonly TermFinding[]): string {
  const parts: string[] = [];
  const n = (severity: Severity): number => findings.filter((f) => f.severity === severity).length;
  if (n("error") > 0) parts.push(plural(n("error"), "error"));
  if (n("warning") > 0) parts.push(plural(n("warning"), "warning"));
  if (n("notice") > 0) parts.push(plural(n("notice"), "notice"));
  return parts.join(", ");
}

export interface FindingsPrettyOptions {
  color: boolean;
  /** Whether the clean line counts references: `check` reads them, `lint` does not. */
  references?: boolean;
}

export function renderFindingsPretty(report: TermReport, opts: FindingsPrettyOptions): string {
  const c = palette(opts.color);
  const { baseline } = report;
  if (baseline?.written === true) {
    return `${c.green("✓")} ${plural(report.found, "finding")} recorded in ${baseline.path}`;
  }
  const baselined = baseline !== undefined && baseline.suppressed > 0 ? `, ${String(baseline.suppressed)} baselined` : "";
  const terms = plural(report.terms, "term");

  if (report.findings.length === 0) {
    const references = opts.references === false ? "" : `, ${plural(report.references, "reference")}`;
    return `${c.green("✓")} ${terms}${references}, no findings${baselined}`;
  }

  const ruleWidth = Math.max(RULE_WIDTH, ...report.findings.map((f) => f.ruleId.length + 2));
  const lines: string[] = [];
  let group: string | undefined;
  for (const finding of report.findings) {
    const file = displayPath(finding.file, report.cwd);
    const header = finding.line === undefined ? file : `${file}:${String(finding.line)}`;
    if (header !== group) {
      lines.push(c.bold(header));
      group = header;
    }
    const prefixWidth = 2 + 6 + 1 + ruleWidth;
    const message = wrapSentences(finding.message, WIDTH - prefixWidth);
    const indent = " ".repeat(prefixWidth);
    message.forEach((text, i) => {
      lines.push(
        i === 0 ? `  ${severityText(c, finding.severity)} ${finding.ruleId.padEnd(ruleWidth)}${text}` : `${indent}${text}`,
      );
    });
  }
  lines.push("", `${counts(report.findings)} in ${terms}${baselined}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// write

function changeLine(change: WriteReport["changes"][number]): string {
  switch (change.action) {
    case "create":
      return `${change.path} would be created`;
    case "change":
      return `${change.path} would change`;
    case "remove":
      return `${change.path} would be removed`;
  }
}

/** A generated Vale rule file's `swap:` entries. */
function swapCount(content: string): number {
  const lines = content.split(/\r?\n/);
  const start = lines.indexOf("swap:");
  if (start === -1) return 0;
  return lines.slice(start + 1).filter((line) => line.startsWith("  ")).length;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** What each file of a Vale style holds: rule files by name, the acronym files together. */
function valeLines(report: WriteReport): string[] {
  const rows: [string, string][] = [];
  const acronyms: string[] = [];
  for (const file of report.files) {
    const name = baseName(file.path);
    // A casing rule swaps each label and alt-label, so what it counts is labels.
    if (name === "Casing.yml" || name === "Lowercase.yml") rows.push([name, plural(swapCount(file.content), "label")]);
    else if (name === "Deprecated.yml") rows.push([name, plural(swapCount(file.content), "swap")]);
    else acronyms.push(name);
  }
  if (acronyms.length > 0) rows.push([acronyms.join(", "), plural(acronyms.length, "acronym")]);
  const width = Math.max(0, ...rows.map(([name]) => name.length)) + 2;
  return rows.map(([name, what]) => `  ${name.padEnd(width)}${what}`);
}

/** `  dropped from a definition list: scope-note on 3 terms, hidden-labels on 12`. */
function droppedLine(report: WriteReport): string | undefined {
  if (report.dropped.length === 0) return undefined;
  const ids = new Map<TermField, Set<string>>();
  for (const { id, field } of report.dropped) {
    const set = ids.get(field) ?? new Set<string>();
    set.add(id);
    ids.set(field, set);
  }
  const fields = [...ids.entries()]
    .map(([field, set]) => ({ field, n: set.size }))
    .sort((a, b) => a.n - b.n || TERM_FIELDS.indexOf(a.field) - TERM_FIELDS.indexOf(b.field));
  const parts = fields.map(({ field, n }, i) => `${field} on ${i === 0 ? plural(n, "term") : String(n)}`);
  return `  dropped from ${report.droppedFrom ?? report.format ?? "the render"}: ${parts.join(", ")}`;
}

/** `  skipped 2 terms a definition list cannot read without a definition: varifocal, bifocal`. */
function skippedLine(report: WriteReport): string | undefined {
  if (report.skipped.length === 0) return undefined;
  const construct = report.droppedFrom ?? report.format ?? "the render";
  const count = plural(report.skipped.length, "term");
  return `  skipped ${count} ${construct} cannot read without a definition: ${report.skipped.join(", ")}`;
}

/** The dropped and skipped lines, which a write and a dry run print alike. */
function renderNotes(report: WriteReport): string[] {
  return [droppedLine(report), skippedLine(report)].filter((line) => line !== undefined);
}

function unchangedLine(report: WriteReport): string {
  return report.mode === "in-place" ? "Nothing to write" : `${report.target ?? ""} is up to date`;
}

export function renderWritePretty(report: WriteReport): string {
  if (report.check) {
    return report.changes.length > 0 ? report.changes.map(changeLine).join("\n") : unchangedLine(report);
  }
  if (report.dryRun) {
    const changes = report.changes.length > 0 ? report.changes.map(changeLine) : [unchangedLine(report)];
    return [...changes, ...renderNotes(report)].join("\n");
  }
  if (report.mode === "in-place") {
    return report.changes.length === 0 ? "Nothing to write" : `Wrote ${plural(report.changes.length, "file")}`;
  }
  const each = report.shape === "directory" && report.format !== "vale" ? ", one file each" : "";
  const written = report.terms - report.skipped.length;
  const lines = [`Wrote ${plural(written, "term")} to ${report.target ?? ""}${each}`];
  if (report.format === "vale") lines.push(...valeLines(report));
  lines.push(...renderNotes(report));
  return lines.join("\n");
}

/** The notice `write -f vale` prints when no section of Vale's config uses the style, or there is no section. */
export function renderValeWiring(wiring: ValeWiring): string {
  return [
    wiring.addSection
      ? `notice: ${wiring.rootIni} has no section with BasedOnStyles. Add one that uses the Terms style:`
      : `notice: no section of ${wiring.rootIni} uses the Terms style. Add it to BasedOnStyles:`,
    `  [${wiring.section}]`,
    `  BasedOnStyles = ${wiring.styles.join(", ")}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// formats

export function renderFormatsPretty(rows: readonly FormatRow[]): string {
  const formatWidth = Math.max(0, ...rows.map((r) => r.format.length)) + 3;
  const labelWidth = Math.max(0, ...rows.map((r) => r.label.length)) + 3;
  return rows
    .map((r) =>
      `${r.format.padEnd(formatWidth)}${r.label.padEnd(labelWidth)}${r.read ? "read  " : "      "}${r.write ? "write" : ""}`.trimEnd(),
    )
    .join("\n");
}
