/** A parsed JSON value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The schema without `$id`, `title` or any `description`, which are prose.
 *
 * Shared by the suites that compare a registered built-in with the draft it
 * was cut from. Registration rewrites an id, a title and descriptions, and
 * nothing else may differ, so what survives this is the schema's shape.
 */
export function withoutProse(node: Json, top = true): Json {
  if (Array.isArray(node)) return node.map((item) => withoutProse(item, false));
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(
          ([k]) => k !== "description" && !(top && (k === "$id" || k === "title")),
        )
        .map(([k, v]) => [k, withoutProse(v, false)]),
    );
  }
  return node;
}
