/**
 * The one normalization every reader applies to what it read, so that two
 * sets saying the same thing in different constructs compare equal (see
 * `TermRecord`). Also the pieces every reader shares: the id rule, the
 * skipped-entry notice, and the empty result.
 */
import { slugOf } from "../id.js";
import {
  TERM_FIELDS,
  TERM_LIST_FIELDS,
  type Term,
  type TermField,
  type TermInput,
  type TermListField,
  type TermLocation,
  type TermReadResult,
  type TermRecord,
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

/**
 * The record for raw field values, normalized, or `undefined` when there is no
 * label to make one. Keys other than the ten fields are ignored.
 */
export function recordOf(raw: Partial<Record<TermField, unknown>>): TermRecord | undefined {
  const label = textOf(raw.label);
  if (label === undefined) return undefined;
  const record: TermRecord = { label };
  for (const field of TERM_FIELDS) {
    if (isListField(field)) {
      const list = listOf(raw[field]);
      if (list !== undefined) record[field] = list;
    } else if (field !== "label") {
      const text = textOf(raw[field]);
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

/** `language` from the file's metadata, when it carries one. */
export function languageOf(input: TermInput): string | undefined {
  return textOf(input.metadata["language"]);
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
  recordId?: unknown;
  constructId?: unknown;
  construct: TermLocation["construct"];
  line: number;
  lines: Partial<Record<TermField, number | undefined>>;
  span?: { start: number; end: number };
}

/** A `Term` assembled from what a reader read, with the id, language and location rules applied. */
export function termOf(input: TermInput, parts: EntryParts): Term {
  const language = languageOf(input);
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
