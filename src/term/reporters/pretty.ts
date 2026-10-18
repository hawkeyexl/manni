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
import { DEFAULT_LANGUAGE } from "../core/writers/render-util.js";
import {
  TERM_AUX_FIELDS,
  TERM_DESIGNATION_FIELDS,
  TERM_FIELDS,
  type Term,
  type TermDesignation,
  type TermField,
  type TermFinding,
  type TermLink,
  type TermRecord,
  type TermTransaction,
} from "../types.js";

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

/** A term's language as the reporters show it: a term with no language counts as `en`. */
function languageOf(term: Term): string {
  return term.language ?? DEFAULT_LANGUAGE;
}

export function renderListPretty(terms: readonly Term[]): string {
  const idWidth = Math.max(0, ...terms.map((t) => t.id.length)) + 3;
  const labelWidth = Math.max(0, ...terms.map((t) => t.record.label.length)) + 3;
  // The language column appears only when it tells the rows apart.
  const multilingual = new Set(terms.map((t) => languageOf(t).toLowerCase())).size > 1;
  const languageWidth = Math.max(0, ...terms.map((t) => languageOf(t).length)) + 3;
  const rows = terms.map((t) => {
    const language = multilingual ? languageOf(t).padEnd(languageWidth) : "";
    const alts = (t.record["alt-labels"] ?? []).join(", ");
    return `${t.id.padEnd(idWidth)}${language}${t.record.label.padEnd(labelWidth)}${alts}`.trimEnd();
  });
  return [...rows, plural(terms.length, "term")].join("\n");
}

// ---------------------------------------------------------------------------
// get

/** A root field `get` shows as one row of text. */
type RowField = Exclude<TermField, "label" | "concept-entry" | "designations" | "tbx-markup" | "tbx-elements">;

/** The order `get` shows root fields in: names first, then what they mean, the definition last. */
const GET_FIELDS: readonly RowField[] = [
  "alt-labels",
  "hidden-labels",
  "broader",
  "narrower",
  "related-terms",
  "see",
  "abstract",
  "scope-note",
  "subject-field",
  "contexts",
  "notes",
  "sources",
  "customer-subsets",
  "project-subsets",
  "cross-references",
  "external-cross-references",
  "graphics",
  "transactions",
  "definition",
];

/** The aux fields a block's line shows; its `tbx-elements` are counted on a row of their own. */
const SHOWN_AUX = TERM_AUX_FIELDS.filter((field) => field !== "tbx-elements");

/** The key column's narrowest width: the widest 1.0.0 field, `related-terms`, plus two. */
const MIN_KEY_WIDTH = 15;

function linkText(link: TermLink): string {
  return link.text === undefined ? link.target : `${link.text} (${link.target})`;
}

function transactionText(transaction: TermTransaction): string {
  return [transaction.type, transaction.date, transaction.responsibility].filter((part) => part !== undefined).join(" ");
}

/** One value as `get` prints it: a list joined with commas, a link as its text and target, a transaction as its parts. */
function valueText(value: string | readonly (string | TermLink | TermTransaction)[]): string {
  if (typeof value === "string") return value;
  return value
    .map((item) => (typeof item === "string" ? item : "target" in item ? linkText(item) : transactionText(item)))
    .join(", ");
}

/** `progressive lens: part-of-speech noun, term-type fullForm`, or `undefined` when it says nothing but its term. */
function designationLine(designation: TermDesignation): string | undefined {
  const parts: string[] = [];
  for (const key of TERM_DESIGNATION_FIELDS) {
    const value = designation[key];
    if (value !== undefined) parts.push(`${key} ${value}`);
  }
  const comments = designation["transfer-comments"];
  if (comments !== undefined) parts.push(`transfer-comments ${valueText(comments)}`);
  for (const key of SHOWN_AUX) {
    const value = designation[key];
    if (value !== undefined) parts.push(`${key} ${valueText(value)}`);
  }
  return parts.length === 0 ? undefined : `${designation.term}: ${parts.join(", ")}`;
}

/** `1 at the root, 1 on PAL, 1 in concept-entry`: where the record keeps elements no named field maps. */
function passThroughText(record: TermRecord): string | undefined {
  const parts: string[] = [];
  const count = (items: readonly string[] | undefined, where: string): void => {
    if (items !== undefined) parts.push(`${String(items.length)} ${where}`);
  };
  count(record["tbx-elements"], "at the root");
  for (const designation of record.designations ?? []) count(designation["tbx-elements"], `on ${designation.term}`);
  count(record["concept-entry"]?.["tbx-elements"], "in concept-entry");
  return parts.length === 0 ? undefined : parts.join(", ");
}

export interface GetPrettyOptions {
  color: boolean;
  cwd?: string;
  /** The entry in its other languages: the set's other terms with the same id. */
  others?: readonly Term[];
}

export function renderGetPretty(term: Term, opts: GetPrettyOptions): string {
  const c = palette(opts.color);
  const { record } = term;
  const where = `${displayPath(term.location.file, opts.cwd ?? process.cwd())}:${String(term.location.line)}`;

  // Each row is a key and its lines, collected first so the key column fits the widest key shown.
  const rows: [string, string[]][] = [["id", [term.id]]];
  if (term.language !== undefined) rows.push(["language", [term.language]]);
  for (const field of GET_FIELDS) {
    const value = record[field];
    if (value !== undefined) rows.push([field, [valueText(value)]]);
  }
  const concept = record["concept-entry"];
  if (concept !== undefined) {
    const lines = SHOWN_AUX.flatMap((key) => {
      const value = concept[key];
      return value === undefined ? [] : [`${key}: ${valueText(value)}`];
    });
    if (lines.length > 0) rows.push(["concept-entry", lines]);
  }
  const designations = (record.designations ?? []).map(designationLine).filter((line) => line !== undefined);
  if (designations.length > 0) rows.push(["designations", designations]);
  if (record["tbx-markup"] !== undefined) rows.push(["tbx-markup", record["tbx-markup"]]);
  const passThrough = passThroughText(record);
  if (passThrough !== undefined) rows.push(["tbx-elements", [passThrough]]);
  const others = opts.others ?? [];
  if (others.length > 0) {
    rows.push(["other languages", [others.map((t) => `${languageOf(t)} (${t.record.label})`).join(", ")]]);
  }

  const keyWidth = Math.max(MIN_KEY_WIDTH, ...rows.map(([key]) => key.length + 2));
  const lines = [`${c.bold(record.label.padEnd(40))}${c.dim(where)}`];
  for (const [key, values] of rows) {
    values.forEach((value, i) => {
      const prefix = `  ${(i === 0 ? key : "").padEnd(keyWidth)}`;
      lines.push(...hanging(prefix, wrapWords(value, WIDTH - prefix.length)));
    });
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

const CASING_RULES = new Set(["Casing.yml", "Lowercase.yml", "SentenceStart.yml"]);

/** What each file of a Vale style holds: rule files by name, the acronym files together. */
function valeLines(report: WriteReport): string[] {
  const rows: [string, string][] = [];
  const acronyms: string[] = [];
  for (const file of report.files) {
    const name = baseName(file.path);
    // A casing rule swaps each label and alt-label, so what it counts is labels.
    if (CASING_RULES.has(name)) rows.push([name, plural(swapCount(file.content), "label")]);
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
  // One entry per term per field, so counting entries counts terms: an id in two languages is two terms.
  const counts = new Map<TermField, number>();
  for (const { field } of report.dropped) counts.set(field, (counts.get(field) ?? 0) + 1);
  const fields = [...counts.entries()]
    .map(([field, n]) => ({ field, n }))
    .sort((a, b) => a.n - b.n || TERM_FIELDS.indexOf(a.field) - TERM_FIELDS.indexOf(b.field));
  const parts = fields.map(({ field, n }, i) => `${field} on ${i === 0 ? plural(n, "term") : String(n)}`);
  return `  dropped from ${report.droppedFrom ?? report.format ?? "the render"}: ${parts.join(", ")}`;
}

/** `  dropped from tbx3: the headers of glossary.tbx, <stdin>`. */
function droppedHeadersLine(report: WriteReport): string | undefined {
  const files = report.droppedHeaders ?? [];
  if (files.length === 0) return undefined;
  const what = files.length === 1 ? "the header of" : "the headers of";
  return `  dropped from ${report.droppedFrom ?? report.format ?? "the render"}: ${what} ${files.join(", ")}`;
}

/** `  skipped 2 terms a definition list cannot read without a definition: varifocal, bifocal`. */
function skippedLine(report: WriteReport): string | undefined {
  if (report.skipped.length === 0) return undefined;
  const construct = report.droppedFrom ?? report.format ?? "the render";
  const count = plural(report.skipped.length, "term");
  return `  skipped ${count} ${construct} cannot read without a definition: ${report.skipped.join(", ")}`;
}

/** `  skipped 2 terms in another language than en: spectacle-lens (de), progressive-lens (de)`. */
function otherLanguagesLine(report: WriteReport): string | undefined {
  const other = report.otherLanguages;
  if (other === undefined || other.terms.length === 0) return undefined;
  const terms = other.terms.map(({ id, language }) => `${id} (${language})`).join(", ");
  return `  skipped ${plural(other.terms.length, "term")} in another language than ${other.written}: ${terms}`;
}

/**
 * `  kept the first language's value where languages differ: concept-entry.subject-field on 1 concept`.
 * Fields are counted in concepts, fewest first, as the dropped line counts terms.
 */
function conflictsLine(report: WriteReport): string | undefined {
  const conflicts = report.conflicts ?? [];
  if (conflicts.length === 0) return undefined;
  const ids = new Map<string, Set<string>>();
  for (const { id, field } of conflicts) {
    const set = ids.get(field) ?? new Set<string>();
    set.add(id);
    ids.set(field, set);
  }
  // A stable sort keeps fields of one count in the order they were first reported.
  const fields = [...ids.entries()].map(([field, set]) => ({ field, n: set.size })).sort((a, b) => a.n - b.n);
  const parts = fields.map(({ field, n }, i) => `${field} on ${i === 0 ? plural(n, "concept") : String(n)}`);
  return `  kept the first language's value where languages differ: ${parts.join(", ")}`;
}

/** The dropped, dropped-header, skipped and conflict lines, which a write and a dry run print alike. */
function renderNotes(report: WriteReport): string[] {
  return [
    droppedLine(report),
    droppedHeadersLine(report),
    skippedLine(report),
    otherLanguagesLine(report),
    conflictsLine(report),
  ].filter(
    (line) => line !== undefined,
  );
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
  const written = report.terms - report.skipped.length - (report.otherLanguages?.terms.length ?? 0);
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
