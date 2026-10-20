/**
 * "Did you mean": the name a typo was most likely meant to be. `term get`
 * suggests an entry by it, and `term check` suggests a label for a name that
 * resolves to nothing.
 */

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
