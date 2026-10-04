/**
 * The ordering primitive behind the determinism contract. Every sort that
 * reaches output — the file list, emitted subjects/predicates/objects, query
 * results — must go through this comparator so ordering never depends on
 * locale, ICU version, or platform, the way `String.prototype.localeCompare`
 * and `Array.prototype.sort`'s default string coercion do.
 */

/** Locale-independent code-unit comparison for stable sorting. */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
