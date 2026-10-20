/**
 * `manni term get <term>`: one entry, matched by id, else by label without
 * case, else by alt-label without case. A miss is a usage error that says how
 * big the set is and, when some id or label is a few edits away, which one,
 * because a typo is the likely cause.
 */
import { closestName } from "../../shared/closest-name.js";
import { TermError } from "../errors.js";
import type { Term } from "../types.js";
import { loadTerms, plural, type TermCommandOptions } from "./run.js";

export const GET_FORMATS = ["pretty", "json"] as const;
export type GetFormat = (typeof GET_FORMATS)[number];

export interface GetOptions extends TermCommandOptions {
  /** The `<term>` argument: an id, a label or an alt-label. */
  term: string;
}

/**
 * The entry `query` names: an exact id first, then a label compared without
 * case, then an alt-label compared without case. Each pass takes the first
 * entry in set order.
 */
export function findTerm(terms: readonly Term[], query: string): Term | undefined {
  const folded = query.toLowerCase();
  return (
    terms.find((t) => t.id === query) ??
    terms.find((t) => t.record.label.toLowerCase() === folded) ??
    terms.find((t) => (t.record["alt-labels"] ?? []).some((alt) => alt.toLowerCase() === folded))
  );
}

export interface GetReport {
  term: Term;
  /** The set's other terms with the same id: the entry in its other languages, in set order. */
  others: Term[];
}

export async function runGet(opts: GetOptions): Promise<GetReport> {
  const { set } = await loadTerms(opts);
  const found = findTerm(set.terms, opts.term);
  if (found !== undefined) return { term: found, others: set.terms.filter((t) => t.id === found.id && t !== found) };
  const nearest = closestName(
    opts.term,
    set.terms.flatMap((t) => [t.id, t.record.label]),
  );
  const hint = nearest === undefined ? "." : `; did you mean "${nearest}"?`;
  throw new TermError(`no term "${opts.term}". ${plural(set.terms.length, "term")}${hint}`);
}
