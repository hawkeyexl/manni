/**
 * A term manifest: a YAML or JSON mapping of id to entry, for terms held
 * outside any document. Each entry is the terminology fields with no
 * envelope, plus the entry's own `language` when it has one. The line of each
 * entry and each field is kept, so a finding names the entry's own line
 * (proposal 0052, after 0037's sidecar).
 *
 * A write edits the entries it was handed in place: YAML through the `yaml`
 * Document API, so comments, key order and other entries survive; JSON by
 * rewriting the file with two-space indentation. An entry the file lacks is
 * appended, and an entry the file holds but the write was not handed is left
 * alone, because removing a term is not a write-back.
 */
import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, stringify as stringifyYaml, type Node, type YAMLMap } from "yaml";
import { errorMessage } from "../../../shared/errors.js";
import { TermError } from "../../errors.js";
import {
  TERM_FIELDS,
  type Term,
  type TermField,
  type TermInput,
  type TermReader,
  type TermReadResult,
  type TermRecord,
} from "../../types.js";
import { issueNotice, recordOf, skipped, textOf, termOf, type RecordIssue } from "./normalize.js";

const LABEL = "manifest";
const FIELDS: ReadonlySet<string> = new Set(TERM_FIELDS);

function isField(key: string): key is TermField {
  return FIELDS.has(key);
}

/** What an entry holds: core's `language`, then the terminology fields. */
type EntryKey = "language" | TermField;
const ENTRY_KEYS: readonly EntryKey[] = ["language", ...TERM_FIELDS];

function isEntryKey(key: string): key is EntryKey {
  return key === "language" || isField(key);
}

function read(input: TermInput): TermReadResult {
  if ((input.path ?? input.file).toLowerCase().endsWith(".json")) {
    try {
      JSON.parse(input.content);
    } catch (error) {
      throw new TermError(`${input.file}: could not be parsed as JSON: ${errorMessage(error)}`);
    }
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(input.content, { lineCounter, prettyErrors: false });
  const [firstError] = doc.errors;
  if (firstError !== undefined) {
    throw new TermError(`${input.file}: could not be parsed as YAML: ${firstError.message}`);
  }
  const lineOf = (node: Node | null | undefined): number | undefined => {
    const range = node?.range;
    return range === undefined || range === null ? undefined : lineCounter.linePos(range[0]).line;
  };

  const root = doc.contents;
  // An empty file holds no entries; it is not a malformed one.
  if (root === null) return { terms: [], notices: [] };
  if (!isMap(root)) {
    throw new TermError(`${input.file}: a term manifest is a mapping of id to entry.`);
  }

  const terms: Term[] = [];
  const notices: string[] = [];
  for (const pair of root.items) {
    const keyNode = isScalar(pair.key) ? pair.key : undefined;
    const id = textOf(keyNode?.value);
    const line = lineOf(keyNode) ?? 1;
    if (id === undefined) {
      throw new TermError(`${input.file}:${line}: an entry's key is its id, and must be a non-empty string.`);
    }
    const value = pair.value;
    if (!isMap(value)) {
      throw new TermError(`${input.file}:${line}: entry "${id}" is not a mapping of fields.`);
    }
    const raw: Partial<Record<TermField, unknown>> = {};
    const lines: Partial<Record<TermField, number | undefined>> = {};
    for (const field of value.items) {
      const fieldKey = isScalar(field.key) ? field.key : undefined;
      const name = fieldKey?.value;
      if (typeof name !== "string" || !isField(name)) continue;
      const fieldValue: unknown = field.value;
      raw[name] = isNode(fieldValue) ? fieldValue.toJSON() : fieldValue;
      lines[name] = lineOf(fieldKey);
    }
    const issues: RecordIssue[] = [];
    const record = recordOf(raw, issues);
    if (record === undefined) {
      notices.push(skipped(input, line, LABEL));
      continue;
    }
    for (const issue of issues) {
      // A nested value's own line; a top-level field's is its key's.
      const nested = issue.path.length > 1 ? value.getIn(issue.path, true) : undefined;
      const [top] = issue.path;
      const topLine = typeof top === "string" && isField(top) ? lines[top] : undefined;
      notices.push(issueNotice(input, (isNode(nested) ? lineOf(nested) : undefined) ?? topLine ?? line, record.label, issue));
    }
    const language: unknown = value.get("language");
    terms.push(termOf(input, { record, recordId: id, construct: "manifest", line, lines, language }));
  }
  return { terms, notices };
}

/** What a term says under each entry key: its language and its record's fields. */
function entryValues(language: string | undefined, record: Partial<TermRecord>): Partial<Record<EntryKey, unknown>> {
  return { ...record, ...(language === undefined ? {} : { language }) };
}

/** A term as a manifest entry: its language, then its fields in the vocabulary's order. */
function entryOf(term: Term): Record<string, unknown> {
  const values = entryValues(term.language, term.record);
  const entry: Record<string, unknown> = {};
  for (const key of ENTRY_KEYS) {
    const value = values[key];
    if (value !== undefined) entry[key] = value;
  }
  return entry;
}

/** What an entry currently holds, as a reader normalizes it; no fields when it has no label. */
function currentValues(value: unknown): Partial<Record<EntryKey, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const entry = value as Record<string, unknown>;
  const raw: Partial<Record<TermField, unknown>> = {};
  for (const field of TERM_FIELDS) raw[field] = entry[field];
  return entryValues(textOf(entry["language"]), recordOf(raw) ?? {});
}

/** The keys whose value differs between what the file holds and what the term says. */
function changedKeys(current: Partial<Record<EntryKey, unknown>>, term: Term): EntryKey[] {
  const next = entryValues(term.language, term.record);
  return ENTRY_KEYS.filter((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]));
}

function applyJson(input: TermInput, terms: readonly Term[]): string {
  let data: unknown;
  try {
    data = JSON.parse(input.content);
  } catch (error) {
    throw new TermError(`${input.file}: could not be parsed as JSON: ${errorMessage(error)}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new TermError(`${input.file}: a term manifest is a mapping of id to entry.`);
  }
  const root = data as Record<string, unknown>;
  let changed = false;
  for (const term of terms) {
    const existing = root[term.id];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      if (existing !== undefined) {
        throw new TermError(`${input.file}: entry "${term.id}" is not a mapping of fields.`);
      }
      root[term.id] = entryOf(term);
      changed = true;
      continue;
    }
    const entry = existing as Record<string, unknown>;
    const keys = changedKeys(currentValues(entry), term);
    if (keys.length === 0) continue;
    const values = entryValues(term.language, term.record);
    // Rebuilt rather than mutated, so a field keeps its place and a removed one is simply not copied.
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (!isEntryKey(key) || !keys.includes(key)) next[key] = value;
      else if (values[key] !== undefined) next[key] = values[key];
    }
    for (const key of keys) {
      if (values[key] !== undefined && !(key in next)) next[key] = values[key];
    }
    root[term.id] = next;
    changed = true;
  }
  if (!changed) return input.content;
  const text = `${JSON.stringify(root, null, 2)}\n`;
  return input.content.includes("\r\n") ? text.replaceAll("\n", "\r\n") : text;
}

/** Each top-level entry's `[start, end)` in the text it was parsed from: its key through its value. */
function entryRanges(root: YAMLMap): Map<string, { start: number; end: number }> {
  const ranges = new Map<string, { start: number; end: number }>();
  for (const pair of root.items) {
    if (!isScalar(pair.key)) continue;
    const id = textOf(pair.key.value);
    const start = pair.key.range?.[0];
    const end = isNode(pair.value) ? pair.value.range?.[1] : pair.key.range?.[1];
    if (id !== undefined && start !== undefined && end !== undefined) ranges.set(id, { start, end });
  }
  return ranges;
}

/** Edit the keys of `entry` that differ from `term`. Returns whether anything changed. */
function editEntry(doc: ReturnType<typeof parseDocument>, entry: YAMLMap, term: Term): boolean {
  const keys = changedKeys(currentValues(entry.toJSON()), term);
  const values = entryValues(term.language, term.record);
  for (const key of keys) {
    const value = values[key];
    if (value === undefined) {
      entry.delete(key);
    } else if (Array.isArray(value)) {
      // A list keeps the style it was written in.
      const previous = entry.get(key, true);
      const node = doc.createNode(value);
      node.flow = isSeq(previous) && previous.flow === true;
      entry.set(key, node);
    } else if (typeof value === "object" && value !== null) {
      entry.set(key, doc.createNode(value));
    } else {
      // A scalar set in place keeps its quoting and its comments.
      entry.set(key, value);
    }
  }
  return keys.length > 0;
}

/**
 * The document is edited through the Document API and stringified, and only
 * the entries that changed are taken from that text: every other byte of the
 * file stays as it was written, since stringifying reflows what it did not
 * touch (flow-list spacing, comment spacing).
 */
function applyYaml(input: TermInput, terms: readonly Term[]): string {
  const { content } = input;
  const doc = parseDocument(content, { prettyErrors: false });
  const [firstError] = doc.errors;
  if (firstError !== undefined) {
    throw new TermError(`${input.file}: could not be parsed as YAML: ${firstError.message}`);
  }
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const root = doc.contents;
  if (root === null) {
    // An empty manifest: every entry is new, and there is nothing to keep.
    if (terms.length === 0) return content;
    const entries = Object.fromEntries(terms.map((term) => [term.id, entryOf(term)]));
    return stringifyYaml(entries, { lineWidth: 0 }).replaceAll("\n", eol);
  }
  if (!isMap(root)) {
    throw new TermError(`${input.file}: a term manifest is a mapping of id to entry.`);
  }
  const wholeFile = root.flow === true;
  const before = entryRanges(root);

  const changed: string[] = [];
  const added: string[] = [];
  for (const term of terms) {
    const pair = root.items.find((item) => isScalar(item.key) && textOf(item.key.value) === term.id);
    if (pair === undefined) {
      root.add(doc.createPair(term.id, entryOf(term)));
      added.push(term.id);
      continue;
    }
    if (!isMap(pair.value)) {
      throw new TermError(`${input.file}: entry "${term.id}" is not a mapping of fields.`);
    }
    if (editEntry(doc, pair.value, term)) changed.push(term.id);
  }
  if (changed.length === 0 && added.length === 0) return content;

  const text = doc.toString({ lineWidth: 0 });
  if (wholeFile) return text.replaceAll("\n", eol);

  const written = parseDocument(text).contents;
  const after = isMap(written) ? entryRanges(written) : new Map<string, { start: number; end: number }>();
  const entryText = (id: string): string => {
    const range = after.get(id);
    if (range === undefined) throw new TermError(`${input.file}: could not write entry "${id}".`);
    return text.slice(range.start, range.end).replaceAll("\n", eol);
  };

  let next = content;
  const edits = changed
    .map((id) => ({ id, range: before.get(id) }))
    .sort((a, b) => (b.range?.start ?? 0) - (a.range?.start ?? 0));
  for (const { id, range } of edits) {
    if (range === undefined) throw new TermError(`${input.file}: could not write entry "${id}".`);
    next = next.slice(0, range.start) + entryText(id) + next.slice(range.end);
  }
  if (added.length > 0) {
    if (next !== "" && !next.endsWith("\n")) next += eol;
    next += added.map((id) => `${entryText(id)}${eol}`).join("");
  }
  return next;
}

function isJson(input: TermInput): boolean {
  return (input.path ?? input.file).toLowerCase().endsWith(".json");
}

export const manifestReader: TermReader = {
  construct: "manifest",
  label: LABEL,
  formats: ["manifest"],
  read,
  apply: (input, terms) => (isJson(input) ? applyJson(input, terms) : applyYaml(input, terms)),
};
