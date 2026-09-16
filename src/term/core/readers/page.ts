/**
 * A term page: one term per file, its record in the file's metadata channel.
 * Every extractor already reads that channel, so this reader works in every
 * format meta reads, and is told apart from any other page by `type: term`.
 */
import { TERM_FIELDS, type TermField, type TermInput, type TermReader, type TermReadResult } from "../../types.js";
import { declares, nothing, recordOf, skipped, termOf } from "./normalize.js";

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
    notices: [],
  };
}

export const pageReader: TermReader = {
  construct: "page",
  label: LABEL,
  formats: ["markdown", "mdx", "asciidoc", "rst", "html", "xml"],
  read,
};
