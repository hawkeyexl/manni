/**
 * Human output for every `manni strategy` command. `list` is a tree, `get` a
 * key column, and `check` term's layout: findings grouped under a bold
 * `file:line`, each message wrapped under its own column with the rule's
 * guidance dim beneath it.
 */
import { palette, type Colors } from "../../shared/color.js";
import { guidanceLines } from "../../shared/guidance.js";
import type { Severity } from "../../shared/severity.js";
import type { StrategyReport } from "../commands/findings.js";
import type { RecordEntry } from "../commands/list.js";
import { displayPath, plural } from "../commands/run.js";
import { PARENTS, RECORD_TYPES, type StrategyFinding, type StrategyRecord } from "../types.js";

const WIDTH = 80;

/** A record's title, or its id when it has none. */
export function titleOf(record: StrategyRecord): string {
  return record.title ?? record.id;
}

/** `4 audiences, 4 personas, 74 journeys`. */
export function countsLine(records: readonly StrategyRecord[]): string {
  return RECORD_TYPES.map((type) => plural(records.filter((r) => r.type === type).length, type)).join(", ");
}

// ---------------------------------------------------------------------------
// list

export function renderListPretty(entries: readonly RecordEntry[]): string {
  const cell = (e: RecordEntry): string => `${"  ".repeat(e.depth)}${e.record.id}`;
  const recordWidth = Math.max("record".length, ...entries.map((e) => cell(e).length)) + 4;
  const pagesWidth = Math.max("pages".length, ...entries.map((e) => String(e.pages.length).length));
  const row = (record: string, pages: string, title: string): string =>
    `${record.padEnd(recordWidth)}${pages.padStart(pagesWidth)}  ${title}`.trimEnd();
  return [
    row("record", "pages", "title"),
    ...entries.map((e) => row(cell(e), String(e.pages.length), titleOf(e.record))),
    countsLine(entries.map((e) => e.record)),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// get

const KEY_WIDTH = 14;

/** Each record as `id  title`, the ids padded so the titles line up. */
function recordLines(records: readonly StrategyRecord[]): string[] {
  const width = Math.max(0, ...records.map((r) => r.id.length)) + 2;
  return records.map((r) => (r.title === undefined ? r.id : `${r.id.padEnd(width)}${r.title}`));
}

export function renderGetPretty(entry: RecordEntry, opts: { color: boolean }): string {
  const c = palette(opts.color);
  const { record } = entry;
  const rows: [string, string[]][] = [
    ["type", [record.type]],
    ["id", [record.id]],
  ];
  if (record.description !== undefined) rows.push(["description", [record.description]]);
  if (record.type !== "audience" && record.parent !== undefined) {
    const field = PARENTS[record.type];
    rows.push([field, entry.parent === undefined ? [record.parent.value] : recordLines([entry.parent])]);
  }
  if (entry.children.length > 0) rows.push([record.type === "audience" ? "personas" : "journeys", recordLines(entry.children)]);
  rows.push(["pages", entry.pages.length === 0 ? ["none"] : entry.pages]);

  const where = `${entry.file}:${String(record.line)}`;
  const lines = [`${c.bold(titleOf(record).padEnd(44))}  ${c.dim(where)}`];
  for (const [key, values] of rows) {
    values.forEach((value, i) => lines.push(`  ${(i === 0 ? key : "").padEnd(KEY_WIDTH)}${value}`));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// check

const RULE_WIDTH = 36;

/** Sentences packed into lines of at most `width`; a message that fits stays whole. */
function wrapSentences(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const lines: string[] = [];
  let line = "";
  for (const sentence of text.split(/(?<=[.?])\s+(?=\S)/)) {
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

function severityText(c: Colors, severity: Severity): string {
  const padded = severity.padEnd(7);
  if (severity === "error") return c.red(padded);
  if (severity === "warning") return c.yellow(padded);
  return c.cyan(padded);
}

function counts(findings: readonly StrategyFinding[]): string {
  const n = (severity: Severity): number => findings.filter((f) => f.severity === severity).length;
  const parts: string[] = [];
  if (n("error") > 0) parts.push(plural(n("error"), "error"));
  if (n("warning") > 0) parts.push(plural(n("warning"), "warning"));
  if (n("notice") > 0) parts.push(plural(n("notice"), "notice"));
  return parts.join(", ");
}

export function renderFindingsPretty(report: StrategyReport, opts: { color: boolean }): string {
  const c = palette(opts.color);
  const { baseline } = report;
  if (baseline?.written === true) {
    return `${c.green("✓")} ${plural(report.found, "finding")} recorded in ${baseline.path}`;
  }
  const baselined = baseline !== undefined && baseline.suppressed > 0 ? `, ${String(baseline.suppressed)} baselined` : "";
  const records = plural(report.records, "record");
  if (report.findings.length === 0) {
    return `${c.green("✓")} ${records}, ${plural(report.references, "reference")}, no findings${baselined}`;
  }

  const ruleWidth = Math.max(RULE_WIDTH, ...report.findings.map((f) => f.ruleId.length + 2));
  const prefixWidth = 2 + 7 + 1 + ruleWidth;
  const indent = " ".repeat(prefixWidth);
  const lines: string[] = [];
  let group: string | undefined;
  for (const finding of report.findings) {
    const file = displayPath(finding.file, report.cwd, report.base);
    const header = finding.line === undefined ? file : `${file}:${String(finding.line)}`;
    if (header !== group) {
      lines.push(c.bold(header));
      group = header;
    }
    wrapSentences(finding.message, WIDTH - prefixWidth).forEach((text, i) => {
      lines.push(
        i === 0 ? `  ${severityText(c, finding.severity)} ${finding.ruleId.padEnd(ruleWidth)}${text}` : `${indent}${text}`,
      );
    });
    for (const line of guidanceLines(finding.guidance)) lines.push(`${indent}${c.dim(line)}`);
  }
  lines.push("", `${counts(report.findings)} in ${records}${baselined}`);
  return lines.join("\n");
}
