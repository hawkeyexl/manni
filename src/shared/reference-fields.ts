/**
 * The fields whose values name something else in the docset: a glossary term,
 * or a page. Stated once, so `term` and `meta` read the same list. `term check`
 * reads the concept fields as references into the termbase, and `meta fill`
 * offers each kind its valid values.
 *
 * A field is a path from the page root, so `graph.concepts` is
 * `["graph", "concepts"]`.
 */

/** A field, as the keys from the page root down to it. */
export type FieldPath = readonly string[];

/** The fields a page names the glossary terms it is about in. */
export const CONCEPT_FIELDS: readonly FieldPath[] = [["concepts"], ["graph", "concepts"]];

/** A term entry's fields that name other entries. */
export const TERM_RELATION_FIELDS = ["broader", "narrower", "related-terms", "see"] as const;

/** Every field whose values are glossary terms. */
export const TERM_FIELDS: readonly FieldPath[] = [
  ...CONCEPT_FIELDS,
  ...TERM_RELATION_FIELDS.map((field) => [field]),
];

/** Every field whose values are pages, by id or URL. */
export const PAGE_FIELDS: readonly FieldPath[] = [
  ["related-pages"],
  ["next-steps"],
  ["prerequisites"],
  ["replaced-by"],
  ["supersedes"],
];

/** The field's JSON Pointer: `/graph/concepts`. */
export function fieldPointer(path: FieldPath): string {
  return path.map((key) => `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

/** Whether two paths name the same field. */
export function samePath(a: FieldPath, b: FieldPath): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The value at `path` below `root`, or `undefined` when a key on the way is
 * missing or is not a mapping. An empty path is `root` itself.
 */
export function valueAt(root: unknown, path: FieldPath): unknown {
  let node = root;
  for (const key of path) {
    if (!isRecord(node) || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}
