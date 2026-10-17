/**
 * Joining a multilingual set on `id` (proposal 0084): one term per language,
 * and what a render that writes one entry per id does with the values the
 * entry holds once. The merge goes field by field, an absent value says
 * nothing, and the first term in set order wins. Every field where a later
 * term disagrees is a `MergeConflict`, which the write report prints.
 */
import { isDeepStrictEqual } from "node:util";
import type { MergeConflict, Term } from "../../types.js";

/** The terms grouped by id, groups in order of first appearance, each in set order. */
export function conceptGroups(terms: readonly Term[]): Term[][] {
  const groups = new Map<string, Term[]>();
  for (const term of terms) {
    const group = groups.get(term.id);
    if (group === undefined) groups.set(term.id, [term]);
    else group.push(term);
  }
  return [...groups.values()];
}

/**
 * `values` merged field by field: each key takes its first defined value. A
 * key where a later value differs is reported as a conflict on `id`, its
 * field spelled `prefix` + key (`concept-entry.` + `subject-field`), in the
 * order the merged keys first appear.
 */
export function mergeFirst<T extends object>(
  id: string,
  values: readonly (T | undefined)[],
  prefix = "",
): { merged: Partial<T>; conflicts: MergeConflict[] } {
  const merged: Record<string, unknown> = {};
  const conflicted = new Set<string>();
  for (const value of values) {
    if (value === undefined) continue;
    for (const [key, field] of Object.entries(value)) {
      if (field === undefined) continue;
      if (!(key in merged)) merged[key] = field;
      else if (!isDeepStrictEqual(merged[key], field)) conflicted.add(key);
    }
  }
  return {
    merged: merged as Partial<T>,
    conflicts: Object.keys(merged)
      .filter((key) => conflicted.has(key))
      .map((key) => ({ id, field: `${prefix}${key}` })),
  };
}
