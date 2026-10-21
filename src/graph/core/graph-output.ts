/**
 * `x-manni-graph-output` (proposal 0051 §5), on graph's side of the seam.
 *
 * Which fields belong in a published graph is a property of the field, not of
 * this tool, so it is recorded where the field is defined. The keyword is a
 * boolean beside a top-level property, registered on every Ajv `manni meta`
 * builds and read back through `Validator.graphOutputPreferences`. Absent means
 * `true`: every field is harvested. A mark nested inside `graph` is ignored, as
 * 0047 rule 2 ignores an `x-manni-location` there — the mark governs a
 * top-level key, and `graph` is the top-level key.
 *
 * The filter runs once, before `deriveGraph`, because all four published
 * outputs descend from what derivation produces: `emitTurtle` writes the graph,
 * and JSON-LD, the iiRDS package and the search index are all built by reading
 * that graph back. Dropping the field here keeps it out of every one of them.
 *
 * Encrypted values (proposal 0045) are harvested like any other value. graph
 * never decrypts, so what lands in the graph is the `~…` token, which says a
 * value exists and nothing about what it is. A field that should not reach a
 * published graph at all is marked `false` — one mechanism for "keep this out
 * of the output", rather than one rule for encryption and another for
 * everything else (0051 stress test 4).
 */
import type { MetaPageView } from "../../meta/internal.js";
import { errorMessage } from "../../shared/errors.js";
import { GraphError } from "../types.js";
import type { DocModel } from "../types.js";

/**
 * `docs`, with every top-level frontmatter key its schemas mark
 * `x-manni-graph-output: false` removed, and every such field of its inline
 * `meta` statements.
 *
 * A page's schemas are the set `manni meta validate` resolves for it (proposal
 * 0074): its own `$schema`, then meta's overrides, `schemas:`, `strict` and
 * the default set, read from meta's section of the same config. graph keeps
 * no schema set of its own, so one config answers both what a page is checked
 * against and what its published graph may carry.
 *
 * The docs arrive with their manifests' values already merged
 * (`withExternalMetadata`), so a field kept beside the page is filtered by
 * the same mark as one kept on it.
 *
 * A document whose schemas mark nothing is returned as it came in, so the
 * common case allocates nothing.
 */
export async function suppressGraphOutput(
  docs: readonly DocModel[],
  sets: Pick<MetaPageView, "validator" | "refsFor">,
): Promise<DocModel[]> {
  const out: DocModel[] = [];
  for (const doc of docs) {
    let refs: string[];
    let frontmatter: Record<string, unknown>;
    let statements: DocModel["statements"];
    try {
      refs = sets.refsFor(doc.path, doc.frontmatter);
      frontmatter = await allowed(doc.frontmatter, refs, sets.validator);
      // A statement's fields validate against the page's own schemas
      // (proposal 0099), so the same marks govern them.
      statements =
        doc.statements &&
        (await Promise.all(
          doc.statements.map(async (s) => {
            const data = await allowed(s.data, refs, sets.validator);
            return data === s.data ? s : { ...s, data };
          }),
        ));
    } catch (e) {
      // Loudly, and for the whole run. The schema is what decides which fields
      // a published graph may carry; a graph built while it could not be read
      // is a graph nobody checked, and quietly building one is the failure
      // this keyword exists to prevent.
      throw new GraphError(
        `${doc.path}: cannot read which fields the graph may carry: ${errorMessage(e)}`,
      );
    }
    const same =
      frontmatter === doc.frontmatter &&
      (statements ?? []).every((s, i) => s === doc.statements?.[i]);
    out.push(same ? doc : { ...doc, frontmatter, ...(statements ? { statements } : {}) });
  }
  return out;
}

/**
 * `data` as agent-facing output carries it (proposal 0090, decision 12): every
 * value its schemas mark `x-manni-graph-output: false` or
 * `x-manni-location: external` removed, at any depth, so an answer pin inside
 * a `sample-questions` item goes while its question stays. `data` itself when
 * nothing is marked, and a copy otherwise; the input is never changed.
 *
 * This is the rule for the chunk artifact's metadata. The graph build keeps
 * `suppressGraphOutput`'s top-level rule, because the graph is linked data,
 * not agent context.
 */
export async function deliveredFields(
  data: Record<string, unknown>,
  refs: string[],
  validator: Pick<MetaPageView["validator"], "deliveryExclusions">,
): Promise<Record<string, unknown>> {
  const pointers = await validator.deliveryExclusions(data, refs);
  if (pointers.length === 0) return data;
  const copy = structuredClone(data);
  // Deepest and highest index first, so removing one never shifts another.
  const paths = pointers.map((p) => p.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~")));
  paths.sort((a, b) => -comparePaths(a, b));
  for (const path of paths) removeAt(copy, path);
  return copy;
}

/** Segment by segment, numbers as numbers, a prefix first. */
function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? "";
    const y = b[i] ?? "";
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : Number.NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : Number.NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

function removeAt(root: unknown, path: readonly string[]): void {
  let node: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (typeof node !== "object" || node === null) return;
    node = (node as Record<string, unknown>)[segment];
  }
  const last = path[path.length - 1];
  if (last === undefined || typeof node !== "object" || node === null) return;
  if (Array.isArray(node)) {
    const index = Number(last);
    if (Number.isInteger(index) && index < node.length) node.splice(index, 1);
    return;
  }
  Reflect.deleteProperty(node, last);
}

/** `data` without the keys its schemas mark `false`, or `data` itself when none are. */
async function allowed(
  data: Record<string, unknown>,
  refs: string[],
  validator: MetaPageView["validator"],
): Promise<Record<string, unknown>> {
  const preferences = await validator.graphOutputPreferences(data, refs);
  const suppressed = [...preferences].filter(([, ok]) => !ok).map(([key]) => key);
  if (suppressed.length === 0) return data;
  const kept: Record<string, unknown> = { ...data };
  for (const key of suppressed) Reflect.deleteProperty(kept, key);
  return kept;
}
