/**
 * The in-place write every body construct shares. The file is read again, and
 * an entry is rewritten only where the record it was handed differs from what
 * the file says, in a field the construct can hold. The rewrite replaces the
 * entry's span with the same text a render writes for it, indented where the
 * old entry sat and in the file's own line endings. So a write of unchanged
 * terms returns the file exactly as it was.
 */
import { TermError } from "../../errors.js";
import type { Term, TermField, TermInput, TermReadResult, TermRecord } from "../../types.js";
import { reindent } from "../writers/markup.js";

export interface EntryWrite {
  /** The fields the construct holds: a difference anywhere else is not written. */
  holds: readonly TermField[];
  /** Whether the construct holds the id, so a changed id is a change. */
  id: boolean;
  /** The entry's text at indentation zero, `\n`-joined. */
  serialize: (term: Term, input: TermInput) => string;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether two records say the same thing in `fields`. */
export function sameFields(a: TermRecord, b: TermRecord, fields: readonly TermField[]): boolean {
  return fields.every((field) => sameValue(a[field], b[field]));
}

/** The file's line ending: CRLF when it has one, else LF. */
export function lineEnding(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/** The whitespace that opens the line `offset` sits on. */
function indentAt(content: string, offset: number): string {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(content.slice(lineStart, offset))?.[0] ?? "";
}

export function applyEntries(
  input: TermInput,
  read: (input: TermInput) => TermReadResult,
  terms: readonly Term[],
  write: EntryWrite,
): string {
  const { content } = input;
  const current = read(input).terms;
  const eol = lineEnding(content);
  const edits: { start: number; end: number; text: string }[] = [];

  for (const term of terms) {
    const span = term.location.span;
    if (span === undefined) {
      throw new TermError(
        `${input.file}: term "${term.id}" cannot be written in place, because its entry has no position in the file.`,
      );
    }
    const found = current.find((t) => t.location.span?.start === span.start && t.location.span.end === span.end);
    if (found === undefined) {
      throw new TermError(
        `${input.file}: term "${term.id}" does not match an entry in the file. Read the file again before writing it.`,
      );
    }
    if (sameFields(found.record, term.record, write.holds) && (!write.id || found.id === term.id)) continue;
    const text = reindent(write.serialize(term, input), indentAt(content, span.start), eol);
    edits.push({ start: span.start, end: span.end, text });
  }

  let next = content;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  return next;
}
