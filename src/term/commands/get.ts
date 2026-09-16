/**
 * `manni term get <term>`: one entry, matched by id, else by label without
 * case. A miss is a usage error that says how big the set is and which id is
 * nearest, because a typo in an id is the likely cause.
 */
import { TermError } from "../errors.js";
import type { Term } from "../types.js";
import { loadTerms, plural, type TermCommandOptions } from "./run.js";

export const GET_FORMATS = ["pretty", "json"] as const;
export type GetFormat = (typeof GET_FORMATS)[number];

export interface GetOptions extends TermCommandOptions {
  /** The `<term>` argument: an id or a label. */
  term: string;
}

/** The entry `query` names: an exact id first, then a label compared without case. */
export function findTerm(terms: readonly Term[], query: string): Term | undefined {
  const folded = query.toLowerCase();
  return terms.find((t) => t.id === query) ?? terms.find((t) => t.record.label.toLowerCase() === folded);
}

/** Levenshtein distance. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min((row[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** The id nearest `query` by edit distance, the first on a tie; `undefined` for no ids. */
export function closestId(query: string, ids: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const distance = editDistance(query, id);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

export async function runGet(opts: GetOptions): Promise<Term> {
  const { set } = await loadTerms(opts);
  const found = findTerm(set.terms, opts.term);
  if (found !== undefined) return found;
  const nearest = closestId(
    opts.term,
    set.terms.map((t) => t.id),
  );
  const hint = nearest === undefined ? "" : `; did you mean "${nearest}"?`;
  throw new TermError(`no term "${opts.term}". ${plural(set.terms.length, "term")}${hint === "" ? "." : hint}`);
}
