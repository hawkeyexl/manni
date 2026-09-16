/**
 * A term page: one term per file, its record in the file's metadata channel.
 * Every extractor already reads that channel, so this reader works in every
 * format meta reads, and is told apart from any other page by `type: term`.
 *
 * It writes back through the same extractor: a field that changed is set, a
 * field that became absent is removed, and nothing outside the ten
 * terminology fields is touched.
 */
import { extractorByName } from "../../../meta/internal.js";
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
import { declares, ignoredFields, ignoredNotice, nothing, recordOf, skipped, termOf } from "./normalize.js";
import { sameFields } from "./splice.js";

const LABEL = "page";

function read(input: TermInput): TermReadResult {
  if (!declares(input, "term")) return nothing();
  const raw: Partial<Record<TermField, unknown>> = {};
  const lines: Partial<Record<TermField, number | undefined>> = {};
  for (const field of TERM_FIELDS) {
    raw[field] = input.metadata[field];
    lines[field] = input.lineFor(`/${field}`);
  }
  const record = recordOf(raw);
  if (record === undefined) return { terms: [], notices: [skipped(input, 1, LABEL)] };
  return {
    terms: [termOf(input, { record, recordId: input.metadata["id"], construct: "page", line: 1, lines })],
    notices: ignoredFields(raw).map(({ field, list }) =>
      ignoredNotice(input, lines[field] ?? 1, record.label, field, list),
    ),
  };
}

function apply(input: TermInput, terms: readonly Term[]): string {
  const [term] = terms;
  if (term === undefined) return input.content;
  const [current] = read(input).terms;
  if (current === undefined) {
    throw new TermError(`${input.file}: is not a term page any more. Read the file again before writing it.`);
  }

  const patch: Record<string, unknown> = {};
  const deletions: TermField[] = [];
  for (const field of TERM_FIELDS) {
    if (sameFields(current.record, term.record, [field])) continue;
    const value = term.record[field];
    if (value === undefined) deletions.push(field);
    else patch[field] = value;
  }
  if (Object.keys(patch).length === 0 && deletions.length === 0) return input.content;

  const extractor = extractorByName(input.format);
  if (extractor?.apply === undefined) {
    throw new TermError(`${input.file}: manni cannot write ${input.format} metadata.`);
  }
  const filePath = input.path ?? input.file;
  let next: string;
  try {
    next = extractor.apply(input.content, patch, { deletions, filePath });
  } catch (error) {
    throw new TermError(`${input.file}: ${errorMessage(error)}`);
  }
  // A writer that cannot remove a key ignores the request; say so rather than
  // report a write that left the field in place.
  const written = extractor.extract(next, filePath).data;
  for (const field of deletions) {
    if (written[field] !== undefined) {
      throw new TermError(`${input.file}: could not remove ${field} from its ${input.format} metadata. Remove it by hand.`);
    }
  }
  return next;
}

export const pageReader: TermReader = {
  construct: "page",
  label: LABEL,
  formats: ["markdown", "mdx", "asciidoc", "rst", "html", "xml"],
  read,
  apply,
};
