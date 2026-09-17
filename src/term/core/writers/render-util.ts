/** What every interchange writer shares: the dropped-field report and the shape guard. */
import { TermError } from "../../errors.js";
import {
  TERM_FIELDS,
  type DroppedField,
  type Term,
  type TermField,
  type TermShape,
  type TermTarget,
  type TermWriteFormat,
} from "../../types.js";

/** The language a term without one is written as. */
export const DEFAULT_LANGUAGE = "en";

/** One entry per term per field the term carries and `held` does not include, in term then field order. */
export function droppedFields(terms: readonly Term[], held: readonly TermField[]): DroppedField[] {
  const dropped: DroppedField[] = [];
  for (const term of terms) {
    for (const field of TERM_FIELDS) {
      if (term.record[field] !== undefined && !held.includes(field)) dropped.push({ id: term.id, field });
    }
  }
  return dropped;
}

/** Throws when a writer is asked for a shape it does not render. The command checks `shapes` first; this is the backstop. */
export function requireShape(format: TermWriteFormat, target: TermTarget, shape: TermShape): void {
  if (target.shape === shape) return;
  throw new TermError(
    shape === "file"
      ? `-f ${format} writes one file, not a directory. Pass -o <file>.`
      : `-f ${format} writes a styles directory, not a file. Pass -o <styles directory>.`,
  );
}
