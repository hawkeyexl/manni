/**
 * Graph-level validation: run the published SHACL shapes over a built graph,
 * plus the two SKOS integrity checks core SHACL cannot express (broader
 * cycles, related⨯broaderTransitive disjointness). Every finding carries the
 * doc paths responsible, so writers get file names instead of bare IRIs.
 */
import { readFileSync } from "node:fs";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import type { Term } from "@rdfjs/types";
import { errorMessage } from "../../shared/errors.js";
import type { Severity } from "../../shared/severity.js";
import { KgError } from "../types.js";
import { compactIri } from "./load.js";
import { byCodeUnit } from "./sort.js";
import { NS } from "./vocab.js";

/** SHACL's own scale, as `sh:severity` spells it. */
export type ShaclSeverity = "violation" | "warning" | "info";

export interface CheckFinding {
  /**
   * The family's scale (`src/shared/severity.ts`). SHACL's three levels map
   * onto it one for one — violation to error, warning to warning, info to
   * notice — and the source value stays in {@link shaclSeverity}, the way
   * a11y keeps axe's `impact` (proposal 0035, stress test 10).
   */
  severity: Severity;
  /** SHACL's own word for the same finding, kept for lookup. */
  shaclSeverity: ShaclSeverity;
  /** Human-readable description (IRIs compacted to prefixed names). */
  message: string;
  /** IRI of the node the finding is about. */
  focusNode: string;
  /** Predicate IRI involved, when the finding concerns one. */
  path?: string;
  /** kg:path of the docs responsible, sorted (empty when untraceable). */
  docs: string[];
}

/**
 * SHACL's scale onto the family's. The one place the translation happens, so
 * no caller re-derives it: a finding is built through {@link finding} and
 * carries both words from there on.
 */
const FAMILY_SEVERITY: Record<ShaclSeverity, Severity> = {
  violation: "error",
  warning: "warning",
  info: "notice",
};

/** A finding at `shaclSeverity`, carrying the family severity it maps to. */
function finding(
  shaclSeverity: ShaclSeverity,
  rest: Omit<CheckFinding, "severity" | "shaclSeverity">,
): CheckFinding {
  return { severity: FAMILY_SEVERITY[shaclSeverity], shaclSeverity, ...rest };
}

const SEVERITY_RANK: Record<ShaclSeverity, number> = {
  violation: 0,
  warning: 1,
  info: 2,
};

/** Parse one or more shapes .ttl files into a single store. */
export function loadShapes(paths: string[]): Store {
  const store = new Store();
  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      throw new KgError(`Shapes file not found: ${path}`);
    }
    try {
      store.addQuads(new Parser({ format: "text/turtle" }).parse(text));
    } catch (e) {
      throw new KgError(
        `Failed to parse shapes ${path}: ${errorMessage(e)}`,
      );
    }
  }
  return store;
}

/**
 * Trace a focus node back to the doc(s) responsible: its own kg:path,
 * the path of its fragment-stripped base (sections, provenance fragments),
 * or — for shared nodes like concepts and agents — the paths of docs that
 * point at it, up to two hops back. Sorted and deduplicated.
 */
export function blameDocs(store: Store, focus: string): string[] {
  const pathPred = DataFactory.namedNode(`${NS.kg}path`);
  const pathOf = (iri: string): string | undefined =>
    store.getQuads(DataFactory.namedNode(iri), pathPred, null, null)[0]?.object.value;

  const found = new Set<string>();
  const visited = new Set<string>();

  const walk = (iri: string, depth: number): void => {
    if (visited.has(iri)) return;
    visited.add(iri);

    const own = pathOf(iri);
    if (own !== undefined) {
      found.add(own);
      return;
    }
    const hash = iri.indexOf("#");
    if (hash !== -1) {
      const base = pathOf(iri.slice(0, hash));
      if (base !== undefined) {
        found.add(base);
        return;
      }
    }
    if (depth === 0) return;
    for (const quad of store.getQuads(null, null, DataFactory.namedNode(iri), null)) {
      if (quad.subject.termType === "NamedNode") {
        walk(quad.subject.value, depth - 1);
      }
    }
  };

  walk(focus, 2);
  return [...found].sort();
}

interface Edge {
  s: string;
  o: string;
}

/** skos:broader edges, folding narrower in as its inverse. */
function broaderEdges(store: Store): Edge[] {
  const edges: Edge[] = [];
  for (const q of store.getQuads(
    null,
    DataFactory.namedNode(`${NS.skos}broader`),
    null,
    null,
  )) {
    if (q.object.termType === "NamedNode") {
      edges.push({ s: q.subject.value, o: q.object.value });
    }
  }
  for (const q of store.getQuads(
    null,
    DataFactory.namedNode(`${NS.skos}narrower`),
    null,
    null,
  )) {
    if (q.object.termType === "NamedNode") {
      edges.push({ s: q.object.value, o: q.subject.value });
    }
  }
  return edges;
}

/**
 * Strongly connected components of the broader graph (iterative Tarjan —
 * no recursion, taxonomy depth can't blow the stack). Returns only real
 * cycles: components of 2+ nodes, or single nodes with a self-loop.
 */
export function broaderCycles(store: Store): string[][] {
  const adjacency = new Map<string, string[]>();
  const selfLoops = new Set<string>();
  for (const { s, o } of broaderEdges(store)) {
    if (s === o) selfLoops.add(s);
    const list = adjacency.get(s);
    if (list) list.push(o);
    else adjacency.set(s, [o]);
    if (!adjacency.has(o)) adjacency.set(o, []);
  }
  for (const list of adjacency.values()) list.sort();

  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  /**
   * A node's Tarjan number. Every node is stamped into both maps on the frame
   * where `childIdx === 0`, before any edge out of it is followed, so a miss
   * here is not a missing value but a broken traversal — which is worth
   * saying rather than reading as `NaN` three lines later.
   */
  const numberOf = (map: Map<string, number>, node: string): number => {
    const value = map.get(node);
    if (value === undefined) {
      throw new KgError(
        `internal: ${node} was visited before it was numbered`,
      );
    }
    return value;
  };

  const nodes = [...adjacency.keys()].sort();
  for (const root of nodes) {
    if (index.has(root)) continue;
    // Explicit work stack of [node, next-child-index] frames. The loop reads
    // the top frame as its condition, so the frame is proven present by the
    // same test that keeps the loop running.
    const frames: Array<[string, number]> = [[root, 0]];
    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
      const [node, childIdx] = frame;
      if (childIdx === 0) {
        index.set(node, counter);
        lowlink.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
      }
      const children = adjacency.get(node) ?? [];
      // Reading the child *is* the bounds check: `adjacency` holds dense
      // arrays of strings, so a hit is a child and a miss is the end of them.
      const child = children[childIdx];
      if (child !== undefined) {
        frame[1] += 1;
        if (!index.has(child)) {
          frames.push([child, 0]);
        } else if (onStack.has(child)) {
          lowlink.set(
            node,
            Math.min(numberOf(lowlink, node), numberOf(index, child)),
          );
        }
      } else {
        if (lowlink.get(node) === index.get(node)) {
          const component: string[] = [];
          let member: string | undefined;
          do {
            member = stack.pop();
            if (member === undefined) break;
            onStack.delete(member);
            component.push(member);
          } while (member !== node);
          if (component.length > 1 || selfLoops.has(node)) {
            components.push(component.sort());
          }
        }
        frames.pop();
        const parent = frames.at(-1);
        if (parent) {
          lowlink.set(
            parent[0],
            Math.min(numberOf(lowlink, parent[0]), numberOf(lowlink, node)),
          );
        }
      }
    }
  }
  // A component always has a member — it is built by popping at least one —
  // so `?? ""` is a spelling of that, not a fallback anyone can reach.
  return components.sort((a, b) => ((a[0] ?? "") < (b[0] ?? "") ? -1 : 1));
}

/** Forward reachability over broader edges from each given start node. */
function broaderClosure(edges: Edge[], start: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const { s, o } of edges) {
    const list = adjacency.get(s);
    if (list) list.push(o);
    else adjacency.set(s, [o]);
  }
  const seen = new Set<string>();
  const queue = [...(adjacency.get(start) ?? [])];
  // Shifting *is* the emptiness test, so the queue is never read past its end.
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    if (seen.has(node)) continue;
    seen.add(node);
    queue.push(...(adjacency.get(node) ?? []));
  }
  return seen;
}

/**
 * SKOS S27: skos:related is disjoint with skos:broaderTransitive. The
 * one-hop case is already a SHACL sh:disjoint violation — skip it here so
 * one mistake doesn't produce two findings.
 */
function relatedConflicts(store: Store): CheckFinding[] {
  const edges = broaderEdges(store);
  // Direct edges indexed by subject — no composite string keys (a joined
  // key would need a separator character, and IRIs make any choice fragile).
  const direct = new Map<string, Set<string>>();
  for (const e of edges) {
    const targets = direct.get(e.s);
    if (targets) targets.add(e.o);
    else direct.set(e.s, new Set([e.o]));
  }
  const findings: CheckFinding[] = [];
  for (const q of store.getQuads(
    null,
    DataFactory.namedNode(`${NS.skos}related`),
    null,
    null,
  )) {
    if (q.object.termType !== "NamedNode") continue;
    const s = q.subject.value;
    const o = q.object.value;
    if (direct.get(s)?.has(o)) continue; // covered by sh:disjoint
    const conflict =
      broaderClosure(edges, s).has(o) || broaderClosure(edges, o).has(s);
    if (!conflict) continue;
    findings.push(
      finding("violation", {
        message: `skos:related conflicts with skos:broaderTransitive between ${compactIri(s)} and ${compactIri(o)} — a concept cannot be both related to and an ancestor/descendant of another`,
        focusNode: s,
        path: `${NS.skos}related`,
        docs: blameDocs(store, s),
      }),
    );
  }
  return findings;
}

function cycleFindings(store: Store): CheckFinding[] {
  return broaderCycles(store).map((members) =>
    finding("violation", {
      message: `skos:broader cycle through ${members
        .map((m) => compactIri(m))
        .join(
          ", ",
        )} (${members.map((m) => m).join(" → ")}) — a concept cannot be its own ancestor`,
      // `broaderCycles` returns only components of at least one member, so
      // the first is there; `?? ""` says that without asserting it.
      focusNode: members[0] ?? "",
      path: `${NS.skos}broader`,
      docs: [...new Set(members.flatMap((m) => blameDocs(store, m)))].sort(),
    }),
  );
}

/**
 * The three `kg` fields a machine may never be attributed for. The old
 * `kg.provenance` schema enumerated the twelve *fillable* fields, which kept
 * these out; a free JSON Pointer cannot express that, so proposal 0046 stress
 * test 13 moved the guard into kg's harvest and, from there, to here.
 */
const CURATED_FIELDS = new Set(["sections", "revision-of", "derived-from"]);

/** The fragment a `kg fill` activity's IRI carries, before its model slug. */
const KG_FILL_FRAGMENT = "#prov.kg-fill.";

/**
 * A machine attribution on a hand-curated field. `check` reads only the built
 * graph and `build` has no findings channel, so the store is where the fact is
 * read: the harvest has already put `kg:filledField "sections"` on a field
 * node under a `#prov.kg-fill.` activity.
 */
function curatedFieldFindings(store: Store): CheckFinding[] {
  const filledField = `${NS.kg}filledField`;
  const pathPred = DataFactory.namedNode(`${NS.kg}path`);
  const findings: CheckFinding[] = [];
  for (const q of store.getQuads(null, DataFactory.namedNode(filledField), null, null)) {
    if (q.object.termType !== "Literal") continue;
    const field = q.object.value;
    if (!CURATED_FIELDS.has(field)) continue;
    const node = q.subject.value;
    const at = node.indexOf(KG_FILL_FRAGMENT);
    const fieldAt = node.lastIndexOf(".field.");
    if (at === -1 || fieldAt <= at) continue;
    const activity = node.slice(0, fieldAt);
    // The model the activity is for, from its own fragment. Naming it beats
    // repeating the activity IRI, which the reporter already prints as the
    // focus node ahead of this message.
    const model = node.slice(at + KG_FILL_FRAGMENT.length, fieldAt);
    // These activities hang off no document edge, so `blameDocs` cannot walk
    // back to one. The doc IRI is the activity's own, minus its fragment.
    const docIri = activity.slice(0, activity.indexOf("#"));
    const path = store.getQuads(DataFactory.namedNode(docIri), pathPred, null, null)[0]
      ?.object.value;
    findings.push(
      finding("violation", {
        message: `meta-provenance attributes /kg/${field} to ${model} — ${field} is curated by hand, never filled by a machine`,
        focusNode: activity,
        path: filledField,
        docs: path === undefined ? blameDocs(store, activity) : [path],
      }),
    );
  }
  return findings;
}

/**
 * One validation result, with the nullability its library documents in code
 * rather than in its `.d.ts`.
 *
 * `rdf-validate-shacl` declares `path`, `focusNode` and `severity` as `Term`,
 * and every one of them is `…out(ns.sh.resultPath).term || null` at runtime. A
 * result with no path is ordinary — a node-shape constraint has none — so the
 * guards at the read site are the real contract and the declaration is the
 * optimistic one. Saying so once here is what keeps them from reading as
 * checks that cannot fail.
 */
interface ShaclResult {
  message: Term[];
  path: Term | null;
  focusNode: Term | null;
  severity: Term | null;
}

function severityOf(iri: string | undefined): ShaclSeverity {
  if (iri === "http://www.w3.org/ns/shacl#Warning") return "warning";
  if (iri === "http://www.w3.org/ns/shacl#Info") return "info";
  return "violation";
}

/**
 * Validate a built graph against SHACL shapes files, merge in the TS-side
 * SKOS checks, and return deterministic, doc-blamed findings.
 */
export async function validateGraph(
  store: Store,
  shapesPaths: string[],
): Promise<CheckFinding[]> {
  const shapes = loadShapes(shapesPaths);
  const validator = new SHACLValidator(shapes);
  let report;
  try {
    report = await validator.validate(store);
  } catch (e) {
    throw new KgError(
      `SHACL validation failed: ${errorMessage(e)}`,
    );
  }

  const findings: CheckFinding[] = [];
  for (const result of report.results as ShaclResult[]) {
    const focus = result.focusNode?.value ?? "";
    const path = result.path?.value;
    const messages = result.message
      .map((m) => m.value)
      .filter((m) => m.length > 0);
    const message =
      messages.length > 0
        ? messages.join("; ")
        : `constraint violated${path ? ` on ${compactIri(path)}` : ""}`;
    findings.push(
      finding(severityOf(result.severity?.value), {
        message,
        focusNode: focus,
        ...(path !== undefined ? { path } : {}),
        docs: blameDocs(store, focus),
      }),
    );
  }

  findings.push(
    ...cycleFindings(store),
    ...relatedConflicts(store),
    ...curatedFieldFindings(store),
  );

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.shaclSeverity] - SEVERITY_RANK[b.shaclSeverity] ||
      byCodeUnit(a.focusNode, b.focusNode) ||
      byCodeUnit(a.path ?? "", b.path ?? "") ||
      byCodeUnit(a.message, b.message),
  );
  return findings;
}
