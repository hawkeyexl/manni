/**
 * What `fill` shows the model for one candidate's `value`.
 *
 * A merged subschema is correct, and a poor thing to send. A local provider
 * compiles the response schema into a grammar, and node-llama-cpp's compiler
 * ignores `allOf`, `if`/`then`/`else`, `pattern` and `not`. It turns an untyped
 * node into a rule that accepts only `null`, and `format: uri` into one that
 * accepts only `""`. Since `mergeSubschemas` joins two schemas' views of one
 * property with `allOf`, most properties under a stacked schema set could only
 * be answered `null`.
 *
 * So the model is shown a **projection**: a plain, typed node that every
 * grammar compiler reads the same way. It is a hint, never the rule. The full
 * subschema still checks each answer (see `fill.ts`), which is what lets this
 * module drop what it cannot express rather than approximate it.
 *
 * The rules, numbered as the plan that introduced them numbers them:
 *
 *  1. A `$ref` is replaced by its target from the envelope's definitions. A
 *     cycle stops at the second visit, as an untyped node.
 *  2. An `allOf` is merged into one node: types, `enum` and `const` intersect,
 *     `properties` merge key by key, `required` is the union, `items` merge.
 *  3. An `anyOf` or `oneOf` keeps its branches, each projected. The keywords
 *     beside it are carried into every branch.
 *  4. Kept: `type`, `enum`, `const`, `properties`, `required`, `items`,
 *     `additionalProperties: false`, `description`, `pattern`, the length,
 *     bound and item-count keywords, and a `date`, `date-time` or `time`
 *     format. The strictest bound wins; two different patterns (or formats)
 *     leave neither. Everything else is dropped, a tuple-form `items` array
 *     included: the list is sent as a plain array.
 *  5. An untyped node is sent as any non-null JSON value, one branch per type,
 *     each carrying the keywords that constrain it.
 *  6. When no value can pass, the candidate is reported as unsatisfiable and
 *     never asked.
 *  7. The projection is wrapped as `oneOf: [<projection>, {type: "null"}]`, so
 *     a model can decline under a grammar that makes every key required.
 *
 * After projection, `withOffer` puts the values `fill` offers for a field
 * that names a glossary term or a page (`fill-hints.ts`) on the field's
 * strings. It works on the emitted schema, so it never changes what a rule
 * above decides.
 *
 * Alternatives are written `oneOf`, never `anyOf`, wherever they come from.
 * node-llama-cpp's compiler reads `oneOf` and ignores `anyOf`, which it
 * compiles to `null` as it does an untyped node. Nothing validates against
 * this schema, so `oneOf`'s "exactly one" never judges an answer: the full
 * subschema does that.
 */

import { toJsonText } from "../core/json-text.js";

/** The envelope's definition blocks, as `collectDefs` builds them. */
export interface ProjectionDefs {
  $defs: Record<string, unknown>;
  definitions: Record<string, unknown>;
}

export type Projection =
  | { schema: Record<string, unknown> }
  /** Rule 6: no value satisfies the subschema, so the model is not asked. */
  | { unsatisfiable: true };

/** Project one candidate's merged subschema, wrapped per rule 7. */
export function projectValue(subschema: unknown, defs: ProjectionDefs): Projection {
  const shape = project(subschema, defs, new Set());
  if (shape === undefined) return { unsatisfiable: true };
  return { schema: { oneOf: [emit(shape), { type: "null" }] } };
}

// ---------------------------------------------------------------------------
// The working form
// ---------------------------------------------------------------------------

/** Rule 5's order, which is also the order an untyped node's branches take. */
const ANY_TYPES = ["string", "number", "boolean", "array", "object"] as const;
const JSON_TYPES = new Set<string>([...ANY_TYPES, "integer", "null"]);
/** Formats a grammar compiler renders as the format rather than as `""`. */
const DATE_FORMATS = new Set(["date", "date-time", "time"]);

/** A marker for "two branches disagree, so the model sees neither". */
const CONFLICT = Symbol("conflict");
type Agreed = string | typeof CONFLICT;

type BoundKey = "minLength" | "maxLength" | "minimum" | "maximum" | "minItems" | "maxItems";
const LOWER_BOUNDS: readonly BoundKey[] = ["minLength", "minimum", "minItems"];
const UPPER_BOUNDS: readonly BoundKey[] = ["maxLength", "maximum", "maxItems"];

/**
 * One node, normalized. Every field absent means "unconstrained". A function
 * that returns `Shape | undefined` uses `undefined` for rule 6: nothing passes.
 */
interface Shape {
  types?: string[];
  values?: unknown[];
  properties?: Map<string, Shape>;
  required?: string[];
  closed?: boolean;
  items?: Shape;
  description?: string;
  pattern?: Agreed;
  format?: Agreed;
  bounds?: Partial<Record<BoundKey, number>>;
  /** Alternatives. The other fields have already been carried into each. */
  branches?: Shape[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Projecting a schema into a Shape
// ---------------------------------------------------------------------------

function project(
  node: unknown,
  defs: ProjectionDefs,
  seen: ReadonlySet<string>,
): Shape | undefined {
  if (node === false) return undefined;
  if (!isObject(node)) return {};
  // `branchesOf` in fill.ts writes a `false` branch as `{not: {}}`. Every
  // other `not` is dropped (rule 4), but this one says "nothing passes", and
  // dropping it would ask the model for a property it cannot fill.
  if (node.not === true || (isObject(node.not) && Object.keys(node.not).length === 0)) {
    return undefined;
  }

  const own = ownShape(node, defs, seen);
  if (own === undefined) return undefined;

  const parts: Shape[] = [own];
  if (typeof node.$ref === "string") {
    const target = followRef(node.$ref, defs, seen);
    if (target === undefined) return undefined;
    parts.push(target);
  }
  if (Array.isArray(node.allOf)) {
    for (const branch of node.allOf) {
      const projected = project(branch, defs, seen);
      if (projected === undefined) return undefined;
      parts.push(projected);
    }
  }
  let acc: Shape | undefined = parts.reduce<Shape | undefined>(
    (held, part) => (held === undefined ? undefined : merge(held, part)),
    {},
  );
  // A node with both keywords distributes one over the other, so the shapes
  // multiply: two branches each give four. Nested alternatives compound the
  // same way. Metadata schemas stay shallow, so this is left unbounded.
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const branches = node[keyword];
    if (acc === undefined || !Array.isArray(branches)) continue;
    const projected = branches
      .map((branch) => project(branch, defs, seen))
      .filter((shape): shape is Shape => shape !== undefined);
    acc = distribute(acc, projected);
  }
  return acc === undefined ? undefined : possible(acc);
}

/** Which pair of bounds constrains each type, lower then upper. */
const BOUND_PAIRS: Readonly<Record<string, readonly [BoundKey, BoundKey]>> = {
  string: ["minLength", "maxLength"],
  number: ["minimum", "maximum"],
  integer: ["minimum", "maximum"],
  array: ["minItems", "maxItems"],
};

/**
 * Rule 6 for bounds: a type whose own lower bound exceeds its upper bound
 * admits no value, so it leaves the shape. A shape with no type left admits
 * nothing. Bounds judge only the type they constrain: `minLength` over
 * `maxLength` rules out strings and leaves a number free. An enum's values
 * are already typed, so its bounds are left to the full check.
 */
function possible(shape: Shape): Shape | undefined {
  if (shape.branches !== undefined) {
    const kept = shape.branches
      .map(possible)
      .filter((branch): branch is Shape => branch !== undefined);
    return alternatives(kept, shape.description);
  }
  if (shape.values !== undefined) return shape;
  const bounds = shape.bounds ?? {};
  const contradicts = (type: string): boolean => {
    const pair = BOUND_PAIRS[type];
    if (pair === undefined) return false;
    const low = bounds[pair[0]];
    const high = bounds[pair[1]];
    return low !== undefined && high !== undefined && low > high;
  };
  const types = shape.types ?? [...ANY_TYPES];
  const allowed = types.filter((type) => !contradicts(type));
  if (allowed.length === 0) return undefined;
  return allowed.length === types.length ? shape : { ...shape, types: allowed };
}

/** Rule 1: a local pointer into the envelope's definitions, followed once. */
function followRef(
  ref: string,
  defs: ProjectionDefs,
  seen: ReadonlySet<string>,
): Shape | undefined {
  if (seen.has(ref)) return {};
  const target = resolvePointer(ref, defs);
  // A ref this module cannot follow is untyped here; the full check still
  // resolves it.
  if (target === undefined) return {};
  return project(target, defs, new Set([...seen, ref]));
}

function resolvePointer(ref: string, defs: ProjectionDefs): unknown {
  const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
  const block = match?.[1];
  const rest = match?.[2];
  if (rest === undefined) return undefined;
  let at: unknown = block === "$defs" ? defs.$defs : defs.definitions;
  for (const raw of rest.split("/")) {
    const segment = decodeSegment(raw);
    if (Array.isArray(at)) {
      at = /^\d+$/.test(segment) ? at[Number(segment)] : undefined;
    } else if (isObject(at) && Object.hasOwn(at, segment)) {
      at = at[segment];
    } else {
      return undefined;
    }
  }
  return at;
}

/**
 * One JSON Pointer segment, as a URI fragment writes it. A `$ref` is a URI,
 * so RFC 6901 section 6 applies: percent-decode the fragment first, then
 * undo `~1` and `~0`. `%7E1` therefore reads as `/`, exactly as `~1` does.
 */
function decodeSegment(raw: string): string {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // A stray `%` is a literal one.
  }
  return text.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** The kept keywords (rule 4) of one node, without its combinators. */
function ownShape(
  node: Record<string, unknown>,
  defs: ProjectionDefs,
  seen: ReadonlySet<string>,
): Shape | undefined {
  const shape: Shape = {};
  const declared = typeof node.type === "string" ? [node.type] : node.type;
  if (Array.isArray(declared)) {
    shape.types = declared.filter(
      (t): t is string => typeof t === "string" && JSON_TYPES.has(t),
    );
    if (shape.types.length === 0) return undefined;
  }
  if (Array.isArray(node.enum)) {
    const listed: unknown[] = node.enum;
    shape.values = [...listed];
  }
  if (Object.hasOwn(node, "const")) {
    shape.values = intersectValues(shape.values, [node.const]);
  }
  if (shape.values !== undefined) {
    shape.values = typedValues(shape.values, shape.types);
    if (shape.values.length === 0) return undefined;
  }
  if (Array.isArray(node.required)) {
    shape.required = node.required.filter((k): k is string => typeof k === "string");
  }
  if (isObject(node.properties)) {
    shape.properties = new Map();
    for (const [key, sub] of Object.entries(node.properties)) {
      const projected = project(sub, defs, seen);
      if (projected !== undefined) shape.properties.set(key, projected);
      else if (shape.required?.includes(key) === true) return undefined;
    }
  }
  if (node.additionalProperties === false) shape.closed = true;
  if (isObject(node.items) || typeof node.items === "boolean") {
    const items = project(node.items, defs, seen);
    if (items === undefined) {
      // Nothing may be an item, so only the empty list passes.
      shape.bounds = { maxItems: 0 };
    } else {
      shape.items = items;
    }
  }
  if (typeof node.description === "string") shape.description = node.description;
  if (typeof node.pattern === "string") shape.pattern = node.pattern;
  if (typeof node.format === "string" && DATE_FORMATS.has(node.format)) {
    shape.format = node.format;
  }
  for (const key of [...LOWER_BOUNDS, ...UPPER_BOUNDS]) {
    const value = node[key];
    if (typeof value === "number") {
      shape.bounds = tighten(shape.bounds, { [key]: value });
    }
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Merging two Shapes (the allOf of rule 2)
// ---------------------------------------------------------------------------

function merge(a: Shape, b: Shape): Shape | undefined {
  if (a.branches !== undefined || b.branches !== undefined) {
    const results: Shape[] = [];
    for (const x of a.branches ?? [a]) {
      for (const y of b.branches ?? [b]) {
        const merged = merge(x, y);
        if (merged !== undefined) results.push(merged);
      }
    }
    return alternatives(results, a.description ?? b.description);
  }

  const out: Shape = {};
  const types = intersectTypes(a.types, b.types);
  if (types !== undefined) {
    if (types.length === 0) return undefined;
    out.types = types;
  }
  const values = intersectValues(a.values, b.values);
  if (values !== undefined) {
    out.values = typedValues(values, out.types);
    if (out.values.length === 0) return undefined;
  }
  const required = union(a.required, b.required);
  if (required !== undefined) out.required = required;
  if (a.properties !== undefined || b.properties !== undefined) {
    out.properties = new Map(a.properties);
    for (const [key, shape] of b.properties ?? []) {
      const held = out.properties.get(key);
      if (held === undefined) {
        out.properties.set(key, shape);
        continue;
      }
      const merged = mergedPart(held, shape);
      if (merged !== undefined) out.properties.set(key, merged);
      else if (required?.includes(key) === true) return undefined;
      else out.properties.delete(key);
    }
  }
  if (a.closed === true || b.closed === true) out.closed = true;
  let bounds = tighten(a.bounds, b.bounds);
  if (a.items !== undefined && b.items !== undefined) {
    const items = mergedPart(a.items, b.items);
    // Nothing may be an item, so only the empty list passes.
    if (items === undefined) bounds = tighten(bounds, { maxItems: 0 });
    else out.items = items;
  } else {
    const items = a.items ?? b.items;
    if (items !== undefined) out.items = items;
  }
  if (bounds !== undefined) out.bounds = bounds;
  const description = a.description ?? b.description;
  if (description !== undefined) out.description = description;
  const pattern = agree(a.pattern, b.pattern);
  if (pattern !== undefined) out.pattern = pattern;
  const format = agree(a.format, b.format);
  if (format !== undefined) out.format = format;
  return out;
}

/**
 * A property or item two branches both define, merged and then judged by
 * rule 6's bounds check, which otherwise runs only on a node `project` built.
 */
function mergedPart(a: Shape, b: Shape): Shape | undefined {
  const merged = merge(a, b);
  return merged === undefined ? undefined : possible(merged);
}

/** Rule 3: carry a node's keywords into each of its alternatives. */
function distribute(held: Shape, branches: Shape[]): Shape | undefined {
  const results = branches
    .map((branch) => merge(withoutDescription(held), branch))
    .filter((shape): shape is Shape => shape !== undefined);
  return alternatives(results, held.description);
}

function alternatives(results: Shape[], description: string | undefined): Shape | undefined {
  const [only] = results;
  if (only === undefined) return undefined;
  if (results.length === 1) {
    return description === undefined ? only : { ...only, description };
  }
  return { branches: results, ...(description !== undefined ? { description } : {}) };
}

function withoutDescription(shape: Shape): Shape {
  const { description: _dropped, ...rest } = shape;
  return rest;
}

function intersectTypes(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const out: string[] = [];
  for (const t of a) {
    if (b.includes(t)) out.push(t);
    // `integer` is the common member of `number` and `integer`.
    else if (t === "number" && b.includes("integer")) out.push("integer");
    else if (t === "integer" && b.includes("number")) out.push("integer");
  }
  return [...new Set(out)];
}

function intersectValues(
  a: unknown[] | undefined,
  b: unknown[] | undefined,
): unknown[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const inB = new Set(b.map(canonical));
  return a.filter((value) => inB.has(canonical(value)));
}

/** The values that have one of the declared types. */
function typedValues(values: unknown[], types: string[] | undefined): unknown[] {
  if (types === undefined) return values;
  return values.filter((value) => types.some((t) => hasType(value, t)));
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isObject(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    default:
      return typeof value === type;
  }
}

function union(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return [...new Set([...a, ...b])];
}

function agree(a: Agreed | undefined, b: Agreed | undefined): Agreed | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a === b ? a : CONFLICT;
}

/** The strictest of two sets of bounds. */
function tighten(
  a: Shape["bounds"],
  b: Shape["bounds"],
): Shape["bounds"] {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const out: Partial<Record<BoundKey, number>> = { ...a };
  for (const key of LOWER_BOUNDS) {
    const x = a[key];
    const y = b[key];
    if (y !== undefined) out[key] = x === undefined ? y : Math.max(x, y);
  }
  for (const key of UPPER_BOUNDS) {
    const x = a[key];
    const y = b[key];
    if (y !== undefined) out[key] = x === undefined ? y : Math.min(x, y);
  }
  return out;
}

/**
 * Key-order-independent text, so equal enum values compare equal.
 *
 * Exported for `fill.ts`, which needs the same comparison over schema
 * branches and already-taken values, and would otherwise carry a second,
 * independently-drifting copy.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`);
    return `{${entries.join(",")}}`;
  }
  return toJsonText(value) ?? `(${typeof value})`;
}

// ---------------------------------------------------------------------------
// Emitting a Shape as JSON Schema
// ---------------------------------------------------------------------------

function emit(shape: Shape): Record<string, unknown> {
  const described = shape.description === undefined ? {} : { description: shape.description };
  if (shape.branches !== undefined) {
    return { ...described, oneOf: shape.branches.map(emit) };
  }
  const values = shape.values;
  if (values !== undefined) {
    const [only] = shape.types ?? [];
    const typed = shape.types?.length === 1 && only !== undefined ? { type: only } : {};
    const [single] = values;
    return {
      ...typed,
      ...(values.length === 1 ? { const: single } : { enum: values }),
      ...described,
    };
  }
  const types = shape.types ?? [...ANY_TYPES];
  const [only] = types;
  if (types.length === 1 && only !== undefined) {
    return { ...typed(shape, only), ...described };
  }
  return { ...described, oneOf: types.map((t) => typed(shape, t)) };
}

/** One type's node, with the keywords that constrain that type (rule 5). */
function typed(shape: Shape, type: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type };
  const bounds = shape.bounds ?? {};
  const put = (key: BoundKey): void => {
    const value = bounds[key];
    if (value !== undefined) out[key] = value;
  };
  switch (type) {
    case "string":
      if (typeof shape.pattern === "string") out.pattern = shape.pattern;
      if (typeof shape.format === "string") out.format = shape.format;
      put("minLength");
      put("maxLength");
      break;
    case "number":
    case "integer":
      put("minimum");
      put("maximum");
      break;
    case "array":
      if (shape.items !== undefined) out.items = emit(shape.items);
      put("minItems");
      put("maxItems");
      break;
    case "object":
      if (shape.properties !== undefined) {
        out.properties = Object.fromEntries(
          [...shape.properties].map(([key, sub]) => [key, emit(sub)]),
        );
      }
      if (shape.required !== undefined) out.required = shape.required;
      if (shape.closed === true) out.additionalProperties = false;
      // An object that names no properties takes any. Said outright, because
      // node-llama-cpp reads a bare `{type: "object"}` as `{}` alone.
      else if (shape.properties === undefined) out.additionalProperties = true;
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Offering values on the emitted schema
// ---------------------------------------------------------------------------

/** The values offered for one field, and whether they are the only ones allowed. */
export interface ValueOffer {
  values: readonly string[];
  /** True replaces the field's strings with the values; false offers them beside a free string. */
  firm: boolean;
}

/**
 * Offer values on the field at `path` below a projected `value` schema. The
 * path is followed through object `properties`, and every alternative of a
 * `oneOf` is followed. At the field, each string node, and each list's items,
 * takes the offer: the values as an `enum` when it is firm, or `oneOf` of that
 * `enum` and the string as it was when it is not. A string already limited to
 * an `enum` or a `const` keeps its own values.
 */
export function withOffer(
  schema: Record<string, unknown>,
  path: readonly string[],
  offer: ValueOffer,
): Record<string, unknown> {
  return single(offerAt(schema, path, offer));
}

/**
 * What one node becomes under the offer, as alternatives. A string under a
 * soft offer becomes two, which a `oneOf` above it takes as two of its own
 * branches rather than as a nested `oneOf`. So a `oneOf` grows by one
 * branch for each of its branches that holds the field, and only those.
 */
function offerAt(
  node: Record<string, unknown>,
  path: readonly string[],
  offer: ValueOffer,
): Record<string, unknown>[] {
  const branches = node.oneOf;
  if (Array.isArray(branches)) {
    return [
      {
        ...node,
        oneOf: branches.flatMap((branch: unknown) => (isObject(branch) ? offerAt(branch, path, offer) : [branch])),
      },
    ];
  }
  const [head, ...rest] = path;
  if (head !== undefined) {
    const properties = node.properties;
    const field = isObject(properties) ? properties[head] : undefined;
    if (node.type !== "object" || !isObject(properties) || !isObject(field)) return [node];
    return [{ ...node, properties: { ...properties, [head]: single(offerAt(field, rest, offer)) } }];
  }
  if (node.type === "array") {
    // A list with no items is a list of strings here: the reference fields are
    // string lists whose projection left `items` out. Any other `items`, such
    // as `true`, is not narrowed, since the offer would over-restrict it.
    if (node.items === undefined) {
      return [{ ...node, items: single(offerAt({ type: "string" }, [], offer)) }];
    }
    if (!isObject(node.items)) return [node];
    return [{ ...node, items: single(offerAt(node.items, [], offer)) }];
  }
  if (node.type !== "string" || Object.hasOwn(node, "enum") || Object.hasOwn(node, "const")) {
    return [node];
  }
  const listed = { type: "string", enum: [...offer.values] };
  if (!offer.firm) return [listed, node];
  return [typeof node.description === "string" ? { ...listed, description: node.description } : listed];
}

/** One node from alternatives: the only one, or a `oneOf` of them all. */
function single(alternatives: Record<string, unknown>[]): Record<string, unknown> {
  // An empty list would emit `{ oneOf: [] }`, which admits nothing.
  /* c8 ignore next -- offerAt always returns at least the node it was given. */
  if (alternatives.length === 0) throw new Error("Internal error: an offer produced no alternatives.");
  const [only] = alternatives;
  return alternatives.length === 1 && only !== undefined ? only : { oneOf: alternatives };
}
