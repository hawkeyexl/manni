/**
 * What a schema asks of the property a finding is about (proposal 0089).
 *
 * The property is found by walking the finding's instance path down the
 * schema, not by reading Ajv's `schemaPath`: an error reached through `$ref`
 * reports its path relative to the target (`#/$defs/w3cdtf/type`), which has
 * lost the property it was reached from.
 */
import type { Guidance } from "../../shared/guidance.js";
import { builtinGuide } from "./schema-registry.js";

/** The part of an Ajv error the walk reads. */
export interface GuidanceInput {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The text up to the first sentence end. A finding prints only this much,
 * because a built-in's description often goes on with notes for whoever
 * maintains the schema. `manni meta schemas show` prints the whole text.
 *
 * ponytail: a sentence ends at `.`, `!` or `?` followed by whitespace and a
 * capital, a code span, a quote or a bracket. A description that starts its
 * second sentence in lowercase is printed whole.
 */
export function firstSentence(text: string): string {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.split(/(?<=[.!?])\s+(?=[A-Z`"'([])/)[0] ?? flat;
}

/** The target of a `#/...` pointer from `root`, if it resolves. */
function localRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#")) return undefined;
  const pointer = ref.slice(1);
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) return undefined;
  let at: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(at)) at = at[Number(segment)] as unknown;
    else if (isRecord(at)) at = at[segment];
    else return undefined;
  }
  return at;
}

/**
 * `node` and every subschema that applies to the same value: a local `$ref`,
 * `allOf`, `anyOf`, `oneOf`, `then` and `else`, in that order.
 *
 * ponytail: a `$ref` to another schema, a built-in included, is not followed.
 * Follow it when a finding's guidance needs a property only a referenced
 * schema describes.
 */
function expand(
  root: unknown,
  node: unknown,
  out: Record<string, unknown>[] = [],
  seen = new Set<unknown>(),
): Record<string, unknown>[] {
  if (!isRecord(node) || seen.has(node)) return out;
  seen.add(node);
  out.push(node);
  if (typeof node.$ref === "string") expand(root, localRef(root, node.$ref), out, seen);
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    const branches = node[key];
    if (Array.isArray(branches)) for (const b of branches) expand(root, b, out, seen);
  }
  expand(root, node.then, out, seen);
  expand(root, node.else, out, seen);
  return out;
}

/** The subschemas that apply to one child of the values `nodes` describe. */
function child(root: unknown, nodes: Record<string, unknown>[], segment: string, index: boolean): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  // One `seen` across every node, so a subschema two of them share is listed once.
  const seen = new Set<unknown>();
  for (const n of nodes) {
    if (index) {
      const prefix = n.prefixItems;
      const items = Array.isArray(prefix) ? (prefix[Number(segment)] as unknown) ?? n.items : n.items;
      expand(root, Array.isArray(items) ? (items[Number(segment)] as unknown) : items, out, seen);
    } else if (isRecord(n.properties)) {
      expand(root, n.properties[segment], out, seen);
    }
  }
  return out;
}

/**
 * The guidance for one Ajv finding against the schema `ref` names, whose
 * object is `root`.
 *
 * `rule` is the path of declared properties the finding reaches, joined with
 * `/`, with array indexes dropped. A `required` finding appends the missing
 * key. `rule` and `description` are `null` when the path leaves the declared
 * properties, which a stray key or a root-level finding does.
 */
export function guidanceFor(root: unknown, ref: string, e: GuidanceInput): Guidance {
  const guide = builtinGuide(ref);
  const segments = e.instancePath === ""
    ? []
    : e.instancePath.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  const missing = e.keyword === "required" ? e.params.missingProperty : undefined;
  if (typeof missing === "string") segments.push(missing);

  let nodes = expand(root, root);
  const names: string[] = [];
  for (const segment of segments) {
    const index = /^\d+$/.test(segment) && nodes.some((n) => n.items !== undefined || n.prefixItems !== undefined);
    nodes = child(root, nodes, segment, index);
    if (nodes.length === 0) return { id: ref, rule: null, description: null, guide };
    if (!index) names.push(segment);
  }
  if (names.length === 0) return { id: ref, rule: null, description: null, guide };
  const described = nodes.find((n) => typeof n.description === "string")?.description;
  return {
    id: ref,
    rule: names.join("/"),
    description: typeof described === "string" ? firstSentence(described) : null,
    guide,
  };
}
