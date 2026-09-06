/**
 * Graph-level validation: run the published SHACL shapes over a built graph,
 * plus the two SKOS integrity checks core SHACL cannot express (broader
 * cycles, related⨯broaderTransitive disjointness). Every finding carries the
 * doc paths responsible, so writers get file names instead of bare IRIs.
 */
import { readFileSync } from "node:fs";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { DockgError } from "../types.js";
import { compactIri } from "./load.js";
import { byCodeUnit } from "./sort.js";
import { NS } from "./vocab.js";

const { namedNode } = DataFactory;

export type CheckSeverity = "violation" | "warning" | "info";

export interface CheckFinding {
  severity: CheckSeverity;
  /** Human-readable description (IRIs compacted to prefixed names). */
  message: string;
  /** IRI of the node the finding is about. */
  focusNode: string;
  /** Predicate IRI involved, when the finding concerns one. */
  path?: string;
  /** dockg:path of the docs responsible, sorted (empty when untraceable). */
  docs: string[];
}

const SEVERITY_RANK: Record<CheckSeverity, number> = {
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
      throw new DockgError(`Shapes file not found: ${path}`);
    }
    try {
      store.addQuads(new Parser({ format: "text/turtle" }).parse(text));
    } catch (e) {
      throw new DockgError(
        `Failed to parse shapes ${path}: ${e instanceof Error ? e.message : "parse error"}`,
      );
    }
  }
  return store;
}

/**
 * Trace a focus node back to the doc(s) responsible: its own dockg:path,
 * the path of its fragment-stripped base (sections, provenance fragments),
 * or — for shared nodes like concepts and agents — the paths of docs that
 * point at it, up to two hops back. Sorted and deduplicated.
 */
export function blameDocs(store: Store, focus: string): string[] {
  const pathPred = namedNode(`${NS.dockg}path`);
  const pathOf = (iri: string): string | undefined =>
    store.getQuads(namedNode(iri), pathPred, null, null)[0]?.object.value;

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
    for (const quad of store.getQuads(null, null, namedNode(iri), null)) {
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
    namedNode(`${NS.skos}broader`),
    null,
    null,
  )) {
    if (q.object.termType === "NamedNode") {
      edges.push({ s: q.subject.value, o: q.object.value });
    }
  }
  for (const q of store.getQuads(
    null,
    namedNode(`${NS.skos}narrower`),
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

  const nodes = [...adjacency.keys()].sort();
  for (const root of nodes) {
    if (index.has(root)) continue;
    // Explicit work stack of [node, next-child-index] frames.
    const frames: Array<[string, number]> = [[root, 0]];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const [node, childIdx] = frame;
      if (childIdx === 0) {
        index.set(node, counter);
        lowlink.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
      }
      const children = adjacency.get(node) ?? [];
      if (childIdx < children.length) {
        frame[1] += 1;
        const child = children[childIdx]!;
        if (!index.has(child)) {
          frames.push([child, 0]);
        } else if (onStack.has(child)) {
          lowlink.set(node, Math.min(lowlink.get(node)!, index.get(child)!));
        }
      } else {
        if (lowlink.get(node) === index.get(node)) {
          const component: string[] = [];
          let member: string;
          do {
            member = stack.pop()!;
            onStack.delete(member);
            component.push(member);
          } while (member !== node);
          if (component.length > 1 || selfLoops.has(node)) {
            components.push(component.sort());
          }
        }
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent) {
          lowlink.set(
            parent[0],
            Math.min(lowlink.get(parent[0])!, lowlink.get(node)!),
          );
        }
      }
    }
  }
  return components.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
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
  while (queue.length > 0) {
    const node = queue.shift()!;
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
    namedNode(`${NS.skos}related`),
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
    findings.push({
      severity: "violation",
      message: `skos:related conflicts with skos:broaderTransitive between ${compactIri(s)} and ${compactIri(o)} — a concept cannot be both related to and an ancestor/descendant of another`,
      focusNode: s,
      path: `${NS.skos}related`,
      docs: blameDocs(store, s),
    });
  }
  return findings;
}

function cycleFindings(store: Store): CheckFinding[] {
  return broaderCycles(store).map((members) => ({
    severity: "violation" as const,
    message: `skos:broader cycle through ${members
      .map((m) => compactIri(m))
      .join(
        ", ",
      )} (${members.map((m) => m).join(" → ")}) — a concept cannot be its own ancestor`,
    focusNode: members[0]!,
    path: `${NS.skos}broader`,
    docs: [...new Set(members.flatMap((m) => blameDocs(store, m)))].sort(),
  }));
}

function severityOf(iri: string | undefined): CheckSeverity {
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
    throw new DockgError(
      `SHACL validation failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const findings: CheckFinding[] = [];
  for (const result of report.results) {
    const focus = result.focusNode?.value ?? "";
    const path = result.path?.value;
    const messages = result.message
      .map((m) => m.value)
      .filter((m) => m.length > 0);
    const message =
      messages.length > 0
        ? messages.join("; ")
        : `constraint violated${path ? ` on ${compactIri(path)}` : ""}`;
    findings.push({
      severity: severityOf(result.severity?.value),
      message,
      focusNode: focus,
      ...(path !== undefined ? { path } : {}),
      docs: blameDocs(store, focus),
    });
  }

  findings.push(...cycleFindings(store), ...relatedConflicts(store));

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      byCodeUnit(a.focusNode, b.focusNode) ||
      byCodeUnit(a.path ?? "", b.path ?? "") ||
      byCodeUnit(a.message, b.message),
  );
  return findings;
}
