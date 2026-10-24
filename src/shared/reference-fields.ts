/**
 * The fields whose values name something else in the docset: a glossary term,
 * a page, or a strategy record. Stated once, so `term`, `strategy` and `meta`
 * read the same list. `term check` reads the concept fields as references
 * into the termbase, `meta fill` offers each kind its valid values, and
 * `meta get` names the records the record fields name.
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

/** The strategy record types (proposal 0102), parent first. */
export const RECORD_TYPES = ["audience", "persona", "journey"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/**
 * The fields whose values name strategy records, and the record type each
 * names. A page names its readers and jobs in the first three. A persona
 * names its audience in `audience:`, and a journey its personas in
 * `personas:`.
 */
export const RECORD_FIELDS = {
  audiences: "audience",
  personas: "persona",
  journeys: "journey",
  audience: "audience",
} as const satisfies Record<string, RecordType>;
export type RecordField = keyof typeof RECORD_FIELDS;

/** Whether `field` names records. */
export function isRecordField(field: string): field is RecordField {
  return Object.hasOwn(RECORD_FIELDS, field);
}

/** Whether `value` is a record type. */
export function isRecordType(value: unknown): value is RecordType {
  return typeof value === "string" && (RECORD_TYPES as readonly string[]).includes(value);
}

/** Whether two record ids are one id. Ids compare ignoring case. */
export function sameRecordId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The file name without its extension. No `node:path`, so a browser bundle can import this file. */
function stem(label: string): string {
  const name = label.split(/[\\/]/).at(-1) ?? label;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The record a page's own data declares, or `undefined` when its `type:` is
 * no record type. The id is the declared `id:`, or the file name without its
 * extension when the record declares none. `label` is the page's path.
 */
export function readRecord(data: Record<string, unknown>, label: string): { type: RecordType; id: string } | undefined {
  const type = data["type"];
  if (!isRecordType(type)) return undefined;
  const declared = data["id"];
  const id = typeof declared === "string" && declared.trim() !== "" ? declared : stem(label);
  return { type, id };
}

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
