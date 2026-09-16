/**
 * A term manifest: a YAML or JSON mapping of id to entry, for terms held
 * outside any document. Each entry is the ten fields with no envelope. The
 * line of each entry and each field is kept, so a finding names the entry's
 * own line (proposal 0052, after 0037's sidecar).
 */
import { isMap, isNode, isScalar, LineCounter, parseDocument, type Node } from "yaml";
import { errorMessage } from "../../../shared/errors.js";
import { TermError } from "../../errors.js";
import {
  TERM_FIELDS,
  type Term,
  type TermField,
  type TermInput,
  type TermReader,
  type TermReadResult,
} from "../../types.js";
import { recordOf, skipped, textOf, termOf } from "./normalize.js";

const LABEL = "manifest";
const FIELDS: ReadonlySet<string> = new Set(TERM_FIELDS);

function isField(key: string): key is TermField {
  return FIELDS.has(key);
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
    const record = recordOf(raw);
    if (record === undefined) {
      notices.push(skipped(input, line, LABEL));
      continue;
    }
    terms.push(termOf(input, { record, recordId: id, construct: "manifest", line, lines }));
  }
  return { terms, notices };
}

export const manifestReader: TermReader = {
  construct: "manifest",
  label: LABEL,
  formats: ["manifest"],
  read,
};
