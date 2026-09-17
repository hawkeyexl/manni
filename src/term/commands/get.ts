/**
 * `manni term get <term>`: one entry, matched by id, else by label without
 * case, else by alt-label without case. A miss is a usage error that says how
 * big the set is and, when some id or label is a few edits away, which one,
 * because a typo is the likely cause.
 */
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

/**
 * The name nearest `query` by edit distance, the first on a tie, when it is
 * within `max(2, floor(query.length / 3))` edits; `undefined` otherwise. A
 * name further off than that is not a typo of `query`, and suggesting it
 * points at an unrelated entry.
 */
export function closestName(query: string, names: readonly string[]): string | undefined {
  const limit = Math.max(2, Math.floor(query.length / 3));
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const name of names) {
    const distance = editDistance(query, name);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return bestDistance <= limit ? best : undefined;
}

export async function runGet(opts: GetOptions): Promise<Term> {
  const { set } = await loadTerms(opts);
  const found = findTerm(set.terms, opts.term);
  if (found !== undefined) return found;
  const nearest = closestName(
    opts.term,
    set.terms.flatMap((t) => [t.id, t.record.label]),
  );
  const hint = nearest === undefined ? "." : `; did you mean "${nearest}"?`;
  throw new TermError(`no term "${opts.term}". ${plural(set.terms.length, "term")}${hint}`);
}
