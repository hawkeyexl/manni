/**
 * The one normalization every reader applies to what it read, so that two
 * sets saying the same thing in different constructs compare equal (see
 * `TermRecord`). Also the pieces every reader shares: the id rule, the
 * skipped-entry notice, and the empty result.
 */
import { slugOf } from "../id.js";
import {
  TERM_AUX_FIELDS,
  TERM_DESIGNATION_FIELDS,
  TERM_FIELDS,
  TERM_LIST_FIELDS,
  type Term,
  type TermAuxField,
  type TermAuxRecord,
  type TermDesignation,
  type TermField,
  type TermInput,
  type TermLink,
  type TermListField,
  type TermLocation,
  type TermReadResult,
  type TermRecord,
  type TermTransaction,
} from "../../types.js";

/** A reader's answer for a file that holds none of its entries. */
export function nothing(): TermReadResult {
  return { terms: [], notices: [] };
}

/**
 * A scalar as a non-empty trimmed string, or `undefined`. A number counts,
 * because YAML and the attribute channels type `id: 42` as one.
 */
export function textOf(value: unknown): string | undefined {
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else return undefined;
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A string or a list of them as a non-empty list of non-empty trimmed strings, or `undefined`. */
export function listOf(value: unknown): string[] | undefined {
  const items = Array.isArray(value) ? (value as unknown[]) : [value];
  const list = items.map(textOf).filter((item): item is string => item !== undefined);
  return list.length === 0 ? undefined : list;
}

/** Runs of whitespace, line breaks included, as one space: markup's text as a reader sees it. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isListField(field: TermField): field is TermListField {
  return (TERM_LIST_FIELDS as readonly TermField[]).includes(field);
}

function isAuxField(field: TermField): field is TermAuxField {
  return (TERM_AUX_FIELDS as readonly TermField[]).includes(field);
}

/** A YAML or JSON mapping: an object that is neither a list nor a date. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** A list's items, or a single value as the one item of its own list. */
function itemsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [value];
}

/**
 * A value `recordOf` left out of a record, and why. The reader that holds the
 * value's line turns each into a notice with `issueNotice`, so a malformed
 * value is reported rather than lost.
 */
export interface RecordIssue {
  /** JSON-Pointer segments from the record's root to the value. */
  path: (string | number)[];
  /** What was left out: `see`, `subject-field in concept-entry`, `designations item "PAL"`. */
  what: string;
  /** Why, as a sentence with no full stop. */
  why: string;
}

/** `/designations/0/term` for `["designations", 0, "term"]`. */
export function pointerOf(path: readonly (string | number)[]): string {
  return path.map((segment) => `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

/** The notice for one `RecordIssue`, on the line the reader found for it. */
export function issueNotice(input: TermInput, line: number, label: string, issue: RecordIssue): string {
  return `${input.file}:${line}: ignored ${issue.what} on "${label}": ${issue.why}.`;
}

/** Where a nested value sits, as an issue names it: `""` at the root, ` in concept-entry` below it. */
type Where = string;

/**
 * A one-value field as text. A value that is present but is not text (a list,
 * a mapping, a boolean) is left out and reported. An empty string is text with
 * nothing in it and is simply absent, as `TermRecord` defines.
 */
function oneValue(
  value: unknown,
  key: string,
  path: (string | number)[],
  where: Where,
  issues: RecordIssue[] | undefined,
): string | undefined {
  const text = textOf(value);
  if (text !== undefined || value === undefined || value === null || typeof value === "string") return text;
  const article = /^[aeiou]/.test(key) ? "an" : "a";
  const holds = Array.isArray(value)
    ? "holds one value, not a list"
    : typeof value === "object"
      ? "holds text, not a mapping"
      : "holds text";
  issues?.push({ path, what: `${key}${where}`, why: `${article} ${key} ${holds}` });
  return undefined;
}

/** A YAML timestamp as the text it was written as, when a parser made it a `Date`. */
function dateText(value: unknown): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return textOf(value);
  const iso = value.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/**
 * The items of a mapping-list field, each built by `build` or reported with
 * `why`. A null or empty item is nothing, as an empty label is; any other item
 * `build` refuses is reported.
 */
function mappedItems<T>(
  value: unknown,
  key: string,
  path: (string | number)[],
  where: Where,
  issues: RecordIssue[] | undefined,
  why: string,
  build: (item: unknown) => T | undefined,
): T[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list: T[] = [];
  itemsOf(value).forEach((item, i) => {
    const built = build(item);
    if (built !== undefined) list.push(built);
    else if (item !== null && item !== undefined && typeof item !== "string") {
      issues?.push({ path: Array.isArray(value) ? [...path, i] : path, what: `${key} item${where}`, why });
    }
  });
  return list.length === 0 ? undefined : list;
}

function linkOf(item: unknown): TermLink | undefined {
  const bare = textOf(item);
  if (bare !== undefined) return { target: bare };
  if (!isMapping(item)) return undefined;
  const target = textOf(item["target"]);
  if (target === undefined) return undefined;
  const text = textOf(item["text"]);
  return text === undefined ? { target } : { target, text };
}

function transactionOf(item: unknown): TermTransaction | undefined {
  if (!isMapping(item)) return undefined;
  const type = textOf(item["type"]);
  if (type === undefined) return undefined;
  const transaction: TermTransaction = { type };
  const date = dateText(item["date"]);
  if (date !== undefined) transaction.date = date;
  const responsibility = textOf(item["responsibility"]);
  if (responsibility !== undefined) transaction.responsibility = responsibility;
  return transaction;
}

/** Set one aux field on `target` from its raw value, normalized, at any level. */
function setAux(
  target: TermAuxRecord,
  field: TermAuxField,
  value: unknown,
  path: (string | number)[],
  where: Where,
  issues: RecordIssue[] | undefined,
): void {
  switch (field) {
    case "definition":
    case "subject-field": {
      const text = oneValue(value, field, path, where, issues);
      if (text !== undefined) target[field] = text;
      return;
    }
    case "cross-references":
    case "external-cross-references":
    case "graphics": {
      const why = `a ${field} item is text or a mapping with a target`;
      const links = mappedItems(value, field, path, where, issues, why, linkOf);
      if (links !== undefined) target[field] = links;
      return;
    }
    case "transactions": {
      const why = "a transactions item is a mapping with a type";
      const transactions = mappedItems(value, field, path, where, issues, why, transactionOf);
      if (transactions !== undefined) target[field] = transactions;
      return;
    }
    default: {
      const list = listOf(value);
      if (list !== undefined) target[field] = list;
    }
  }
}

function conceptEntryOf(value: unknown, issues: RecordIssue[] | undefined): TermAuxRecord | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isMapping(value)) {
    issues?.push({ path: ["concept-entry"], what: "concept-entry", why: "a concept-entry holds a mapping of fields" });
    return undefined;
  }
  const entry: TermAuxRecord = {};
  for (const field of TERM_AUX_FIELDS) {
    setAux(entry, field, value[field], ["concept-entry", field], " in concept-entry", issues);
  }
  return Object.keys(entry).length === 0 ? undefined : entry;
}

/**
 * The `designations` items, each naming one of `names`. An item that names
 * none of them describes no designation this term has, and is reported.
 */
function designationsOf(
  value: unknown,
  names: readonly string[],
  issues: RecordIssue[] | undefined,
): TermDesignation[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list: TermDesignation[] = [];
  itemsOf(value).forEach((item, i) => {
    const path: (string | number)[] = Array.isArray(value) ? ["designations", i] : ["designations"];
    const term = isMapping(item) ? textOf(item["term"]) : undefined;
    if (!isMapping(item) || term === undefined) {
      issues?.push({ path, what: "designations item", why: "a designations item is a mapping with a term" });
      return;
    }
    if (!names.includes(term)) {
      issues?.push({ path, what: `designations item "${term}"`, why: "it names no label, alt-label or hidden-label" });
      return;
    }
    const where = ` in designations item "${term}"`;
    const designation: TermDesignation = { term };
    for (const key of TERM_DESIGNATION_FIELDS) {
      const text = oneValue(item[key], key, [...path, key], where, issues);
      if (text !== undefined) designation[key] = text;
    }
    const comments = listOf(item["transfer-comments"]);
    if (comments !== undefined) designation["transfer-comments"] = comments;
    for (const field of TERM_AUX_FIELDS) setAux(designation, field, item[field], [...path, field], where, issues);
    list.push(designation);
  });
  return list.length === 0 ? undefined : list;
}

/**
 * The record for raw field values, normalized, or `undefined` when there is no
 * label to make one. Keys the vocabulary does not name are ignored, at every
 * level. A value present in a shape its field cannot hold is left out and,
 * when `issues` is given, reported there.
 */
export function recordOf(raw: Partial<Record<TermField, unknown>>, issues?: RecordIssue[]): TermRecord | undefined {
  const label = textOf(raw.label);
  if (label === undefined) return undefined;
  const record: TermRecord = { label };
  for (const field of TERM_FIELDS) {
    const value = raw[field];
    if (field === "label") continue;
    if (isListField(field) || field === "tbx-markup") {
      const list = listOf(value);
      if (list !== undefined) record[field] = list;
    } else if (isAuxField(field)) {
      setAux(record, field, value, [field], "", issues);
    } else if (field === "concept-entry") {
      const entry = conceptEntryOf(value, issues);
      if (entry !== undefined) record[field] = entry;
    } else if (field === "designations") {
      // The label fields precede `designations` in TERM_FIELDS, so they are already normalized.
      const names = [label, ...(record["alt-labels"] ?? []), ...(record["hidden-labels"] ?? [])];
      const designations = designationsOf(value, names, issues);
      if (designations !== undefined) record[field] = designations;
    } else {
      const text = oneValue(value, field, [field], "", issues);
      if (text !== undefined) record[field] = text;
    }
  }
  return record;
}

/** The field lines worth keeping: those of fields the record actually carries. */
export function linesFor(
  record: TermRecord,
  lines: Partial<Record<TermField, number | undefined>>,
): Partial<Record<TermField, number>> {
  const kept: Partial<Record<TermField, number>> = {};
  for (const field of TERM_FIELDS) {
    const line = lines[field];
    if (line !== undefined && record[field] !== undefined) kept[field] = line;
  }
  return kept;
}

/** The record's id, else the construct's own identifier, else the label's slug. */
export function idFor(record: TermRecord, recordId: unknown, constructId?: unknown): string {
  return textOf(recordId) ?? textOf(constructId) ?? slugOf(record.label);
}

/**
 * `language` from the file's metadata, when it carries one. An XML file says
 * it with `xml:lang` on its root, which is where DITA and DocBook put it.
 */
export function languageOf(input: TermInput): string | undefined {
  return textOf(input.metadata["language"]) ?? textOf(input.metadata["xml:lang"]);
}

/** Whether the file's metadata channel declares `type: <type>`. */
export function declares(input: TermInput, type: string): boolean {
  const value = input.metadata["type"];
  return typeof value === "string" && value.trim() === type;
}

/** The notice for an entry with no term text. */
export function skipped(input: TermInput, line: number, label: string): string {
  return `${input.file}:${line}: skipped a ${label} entry with no term.`;
}

export interface EntryParts {
  record: TermRecord;
  /** The entry's own `language`, which a manifest entry may carry. The file's applies otherwise. */
  language?: unknown;
  recordId?: unknown;
  constructId?: unknown;
  construct: TermLocation["construct"];
  line: number;
  lines: Partial<Record<TermField, number | undefined>>;
  span?: { start: number; end: number };
}

/** A `Term` assembled from what a reader read, with the id, language and location rules applied. */
export function termOf(input: TermInput, parts: EntryParts): Term {
  const language = textOf(parts.language) ?? languageOf(input);
  const location: TermLocation = {
    file: input.file,
    ...(input.path === undefined ? {} : { path: input.path }),
    construct: parts.construct,
    line: parts.line,
    fieldLines: linesFor(parts.record, parts.lines),
    ...(parts.span === undefined ? {} : { span: parts.span }),
  };
  return {
    id: idFor(parts.record, parts.recordId, parts.constructId),
    record: parts.record,
    ...(language === undefined ? {} : { language }),
    location,
  };
}
