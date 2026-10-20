/**
 * Graph-level validation: run the published SHACL shapes over a built graph,
 * plus the SKOS integrity checks core SHACL cannot express (broader cycles,
 * related⨯broaderTransitive disjointness, two untagged prefLabels on one
 * concept, a mapping into the scheme itself). Every finding carries the
 * doc paths responsible, so writers get file names instead of bare IRIs, and
 * the shape that judged it, so they learn what the rule is for (proposal 0089).
 */
import { readFileSync } from "node:fs";
import { DataFactory, Parser, Store, type Quad as N3Quad } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import type { Term } from "@rdfjs/types";
import { errorMessage } from "../../shared/errors.js";
import type { Guidance } from "../../shared/guidance.js";
import type { Severity } from "../../shared/severity.js";
import { GraphError } from "../types.js";
import { compactIri } from "./load.js";
import { bundledShapesPath } from "./pkg.js";
import { byCodeUnit } from "./sort.js";
import { NS } from "./vocab.js";

const SH = "http://www.w3.org/ns/shacl#";
const OWL_ONTOLOGY = "http://www.w3.org/2002/07/owl#Ontology";
const RDFS_SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";

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
  /**
   * SHACL's own word for the same finding, kept for lookup. Absent on a
   * finding no shape reported, such as a sample question that missed.
   */
  shaclSeverity?: ShaclSeverity;
  /** Human-readable description (IRIs compacted to prefixed names). */
  message: string;
  /** IRI of the node the finding is about. */
  focusNode: string;
  /** Predicate IRI involved, when the finding concerns one. */
  path?: string;
  /** graph:path of the docs responsible, sorted (empty when untraceable). */
  docs: string[];
  /**
   * The shape that judged the finding (proposal 0089): the shapes file's id,
   * the shape's local name, its `sh:description` and the file's guide. `null`
   * when no shape stands behind it, as for a sample question that missed.
   */
  guidance: Guidance | null;
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

/** Most severe first: error, warning, notice. */
const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  notice: 2,
};

/**
 * The one order every check finding is reported in: severity, then focus
 * node, path and message. Exported so findings from outside the shapes sort
 * among them the same way.
 */
export function compareFindings(a: CheckFinding, b: CheckFinding): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    byCodeUnit(a.focusNode, b.focusNode) ||
    byCodeUnit(a.path ?? "", b.path ?? "") ||
    byCodeUnit(a.message, b.message)
  );
}

/**
 * A shapes file to read: where it is, and how a finding names it when the file
 * carries no header. A bare string is both.
 */
export type ShapesSource = string | { path: string; label: string };

/** One parsed shapes file, and what names it. */
export interface ShapesFile {
  /** The path as given. */
  label: string;
  /**
   * The `dcterms:identifier` of the file's `owl:Ontology` node, such as
   * `manni:graph-shapes:1.1.1`, or the path as given when it has none.
   */
  id: string;
  /** The ontology node's `rdfs:seeAlso`, when it is an http(s) URL. */
  guide: string | null;
  quads: N3Quad[];
}

/** The shapes in effect: one store, and the file each shape came from. */
export interface LoadedShapes {
  store: Store;
  files: ShapesFile[];
  /** A shape's term value (named or blank) to the file that defines it. */
  fileOf: Map<string, ShapesFile>;
}

/** Read and parse one shapes file. */
export function readShapesFile(source: ShapesSource): ShapesFile {
  const { path, label } = typeof source === "string" ? { path: source, label: source } : source;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    // Only a missing file gets the recovery advice. Any other read error is
    // the OS's to explain.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new GraphError(
        `Shapes file not found: ${path}. Fix the path in --shapes or graph.check.shapes. Leave both unset to use the bundled shapes.`,
      );
    }
    throw new GraphError(`Failed to read shapes ${path}: ${errorMessage(e)}`);
  }
  let quads: N3Quad[];
  try {
    quads = new Parser({ format: "text/turtle" }).parse(text);
  } catch (e) {
    throw new GraphError(`Failed to parse shapes ${path}: ${errorMessage(e)}`);
  }
  const header = new Store(quads);
  const ontology = header
    .getSubjects(DataFactory.namedNode(`${NS.rdf}type`), DataFactory.namedNode(OWL_ONTOLOGY), null)
    .map((s) => s.value)
    .sort(byCodeUnit)[0];
  const first = (predicate: string): string | undefined =>
    ontology === undefined
      ? undefined
      : header
          .getObjects(DataFactory.namedNode(ontology), DataFactory.namedNode(predicate), null)
          .map((o) => o.value)
          .sort(byCodeUnit)[0];
  const seeAlso = first(RDFS_SEE_ALSO);
  return {
    label,
    id: first(`${NS.dcterms}identifier`) ?? label,
    guide: seeAlso !== undefined && /^https?:\/\//.test(seeAlso) ? seeAlso : null,
    quads,
  };
}

/** Parse one or more shapes .ttl files into a single store. */
export function loadShapes(sources: ShapesSource[]): LoadedShapes {
  const store = new Store();
  const files: ShapesFile[] = [];
  const fileOf = new Map<string, ShapesFile>();
  for (const source of sources) {
    const file = readShapesFile(source);
    files.push(file);
    store.addQuads(file.quads);
    // The first file to say anything about a shape owns it. n3 gives each
    // parse its own blank-node prefix, so a blank shape cannot collide.
    for (const q of file.quads) {
      if (!fileOf.has(q.subject.value)) fileOf.set(q.subject.value, file);
    }
  }
  return { store, files, fileOf };
}

/** `…/shapes/1.1.1#Document-language` → `Document-language`. */
export function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  return iri.slice((hash === -1 ? iri.lastIndexOf("/") : hash) + 1);
}

/**
 * A literal of `shape` under `predicate`, untagged or English first, then by
 * language. `null` when the shape has none.
 */
export function shapeText(store: Store, shape: Term, predicate: string): string | null {
  const subject =
    shape.termType === "BlankNode"
      ? DataFactory.blankNode(shape.value)
      : DataFactory.namedNode(shape.value);
  return preferredLiteral(store.getObjects(subject, DataFactory.namedNode(predicate), null));
}

/** The untagged literal first, then English, then by language and value. */
function preferredLiteral(terms: Term[]): string | null {
  const literals = terms.flatMap((t) =>
    t.termType === "Literal" ? [{ value: t.value, language: t.language }] : [],
  );
  const rank = (lang: string): number => (lang === "" ? 0 : lang.startsWith("en") ? 1 : 2);
  literals.sort(
    (a, b) =>
      rank(a.language) - rank(b.language) ||
      byCodeUnit(a.language, b.language) ||
      byCodeUnit(a.value, b.value),
  );
  return literals[0]?.value ?? null;
}

/** How a message names a concept: its prefLabel, else its compact IRI. */
function labelOf(store: Store, iri: string): string {
  return (
    preferredLiteral(
      store.getObjects(DataFactory.namedNode(iri), DataFactory.namedNode(`${NS.skos}prefLabel`), null),
    ) ?? compactIri(iri)
  );
}

/** `"A"`, `"A" and "B"`, `"A", "B" and "C"`. */
function quotedList(values: string[]): string {
  const quoted = values.map((v) => `"${v}"`);
  const last = quoted.pop();
  if (last === undefined) return "";
  return quoted.length === 0 ? last : `${quoted.join(", ")} and ${last}`;
}

/** What a finding a shape reported says about that shape. */
function shapeGuidance(loaded: LoadedShapes, shape: Term | null): Guidance | null {
  if (shape === null) return null;
  // Unreachable miss: a shape that reports has constraint triples, and every triple came from a file.
  const file = loaded.fileOf.get(shape.value);
  if (file === undefined) return null;
  const named = shape.termType === "NamedNode";
  return {
    id: file.id,
    rule: named ? localName(shape.value) : null,
    description: named ? shapeText(loaded.store, shape, `${SH}description`) : null,
    guide: file.guide,
  };
}

let bundled: LoadedShapes | undefined;

/**
 * The guidance for a check-core finding: the bundled shape for its path,
 * whatever shapes the run validated against. These checks are manni's own
 * code, so the bundled contract is what speaks for them.
 */
function coreGuidance(rule: string): Guidance | null {
  bundled ??= loadShapes([bundledShapesPath(import.meta.url)]);
  const shape = bundled.store
    .getSubjects(DataFactory.namedNode(`${NS.rdf}type`), DataFactory.namedNode(`${SH}PropertyShape`), null)
    .find((s) => localName(s.value) === rule);
  return shape === undefined ? null : shapeGuidance(bundled, shape);
}

/**
 * Trace a focus node back to the doc(s) responsible: its own graph:path,
 * the path of its fragment-stripped base (sections, provenance fragments),
 * or — for shared nodes like concepts and agents — the paths of docs that
 * point at it, up to two hops back. Sorted and deduplicated.
 */
export function blameDocs(store: Store, focus: string): string[] {
  const pathPred = DataFactory.namedNode(`${NS.graph}path`);
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
      throw new GraphError(
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
 * SKOS S27: skos:related is disjoint with skos:broaderTransitive. Reported
 * once per unordered pair, because derive writes skos:related both ways
 * round, and on the descendant. A pair where SHACL's one-hop sh:disjoint
 * already fires is skipped, so one mistake doesn't produce two findings.
 */
function relatedConflicts(store: Store): CheckFinding[] {
  const edges = broaderEdges(store);
  const related = `${NS.skos}related`;
  // Pairs as nested maps rather than joined keys: a joined key would need a
  // separator character, and IRIs make any choice fragile.
  const has = (index: Map<string, Set<string>>, a: string, b: string): boolean =>
    index.get(a)?.has(b) ?? false;
  const put = (index: Map<string, Set<string>>, a: string, b: string): void => {
    const targets = index.get(a);
    if (targets) targets.add(b);
    else index.set(a, new Set([b]));
  };
  const index = (predicate: string): Map<string, Set<string>> => {
    const out = new Map<string, Set<string>>();
    for (const q of store.getQuads(null, DataFactory.namedNode(predicate), null, null)) {
      if (q.object.termType === "NamedNode") put(out, q.subject.value, q.object.value);
    }
    return out;
  };
  const relatedIndex = index(related);
  const broaderIndex = index(`${NS.skos}broader`);
  // Where Concept-related's sh:disjoint fires: one node holds both links.
  const disjointFires = (a: string, b: string): boolean =>
    (has(relatedIndex, a, b) && has(broaderIndex, a, b)) ||
    (has(relatedIndex, b, a) && has(broaderIndex, b, a));

  const closures = new Map<string, Set<string>>();
  const ancestors = (node: string): Set<string> => {
    let found = closures.get(node);
    if (found === undefined) {
      found = broaderClosure(edges, node);
      closures.set(node, found);
    }
    return found;
  };

  const seen = new Map<string, Set<string>>();
  const findings: CheckFinding[] = [];
  for (const [s, targets] of [...relatedIndex].sort(([a], [b]) => byCodeUnit(a, b))) {
    for (const o of [...targets].sort(byCodeUnit)) {
      const [a, b] = byCodeUnit(s, o) <= 0 ? [s, o] : [o, s];
      if (has(seen, a, b)) continue;
      put(seen, a, b);
      if (disjointFires(a, b)) continue;
      const bAboveA = ancestors(a).has(b);
      if (!bAboveA && !ancestors(b).has(a)) continue;
      const [descendant, ancestor] = bAboveA ? [a, b] : [b, a];
      findings.push(
        finding("violation", {
          message: `"${labelOf(store, ancestor)}" is both related to "${labelOf(store, descendant)}" and one of its ancestors. Remove one link: from \`related-concepts\` or \`related-terms\`, or from the \`broader\` chain between them.`,
          focusNode: descendant,
          path: related,
          docs: [
            ...new Set([...blameDocs(store, descendant), ...blameDocs(store, ancestor)]),
          ].sort(byCodeUnit),
          guidance: coreGuidance("Concept-related"),
        }),
      );
    }
  }
  return findings;
}

function cycleFindings(store: Store): CheckFinding[] {
  return broaderCycles(store).map((members) => {
    const labels = members.map((m) => labelOf(store, m));
    return finding("violation", {
      message:
        labels.length === 1
          ? `${quotedList(labels)} forms a broader cycle with itself, so it is its own ancestor. Remove the \`broader\` or \`narrower\` value that names it.`
          : `${quotedList(labels)} form a broader cycle, so each is its own ancestor. Remove one \`broader\` or \`narrower\` value on the cycle.`,
      // `broaderCycles` returns only components of at least one member, so
      // the first is there; `?? ""` says that without asserting it.
      focusNode: members[0] ?? "",
      path: `${NS.skos}broader`,
      docs: [...new Set(members.flatMap((m) => blameDocs(store, m)))].sort(),
      guidance: coreGuidance("Concept-broader"),
    });
  });
}

/**
 * Shapes 1.0.0 reported the untagged collision itself, with this message. A
 * run that pins 1.0.0 still carries it, and the check core's copy would only
 * repeat it.
 */
const SHAPES_1_0_0_COLLISION =
  "concept carries multiple prefLabels (same slug, different spellings) — settle on one spelling";

/**
 * The prefLabel collision SHACL Core cannot express. Concept IRIs converge on
 * slugified labels, so "Configuration" and "configuration" land on one concept
 * with two untagged spellings. `sh:uniqueLang` catches two labels in one
 * language and ignores untagged ones, so this catches those.
 */
function untaggedPrefLabelFindings(store: Store): CheckFinding[] {
  const prefLabel = `${NS.skos}prefLabel`;
  const untagged = new Map<string, Set<string>>();
  for (const q of store.getQuads(null, DataFactory.namedNode(prefLabel), null, null)) {
    if (q.object.termType !== "Literal" || q.object.language !== "") continue;
    const spellings = untagged.get(q.subject.value);
    if (spellings) spellings.add(q.object.value);
    else untagged.set(q.subject.value, new Set([q.object.value]));
  }
  return [...untagged]
    .filter(([, spellings]) => spellings.size > 1)
    .map(([focusNode, spellings]) =>
      finding("warning", {
        message: `Pages spell this concept ${spellings.size === 2 ? "two" : String(spellings.size)} ways: ${quotedList([...spellings].sort(byCodeUnit))}. Use one spelling on every page that names it.`,
        focusNode,
        path: prefLabel,
        docs: blameDocs(store, focusNode),
        guidance: coreGuidance("Concept-prefLabel-collision"),
      }),
    );
}

/**
 * The SKOS mapping properties, each beside the term-page key that writes it.
 * Each links a concept to one in another scheme.
 */
const MAPPINGS = [
  ["exactMatch", "exact-matches"],
  ["closeMatch", "close-matches"],
  ["broadMatch", "broad-matches"],
  ["narrowMatch", "narrow-matches"],
  ["relatedMatch", "related-matches"],
] as const;

/**
 * A mapping whose object is a concept in this graph's scheme. SKOS keeps the
 * mapping properties for links between schemes, so inside one the relation is
 * broader, narrower or related.
 */
function inSchemeMappingFindings(store: Store): CheckFinding[] {
  const inScheme = DataFactory.namedNode(`${NS.skos}inScheme`);
  const findings: CheckFinding[] = [];
  for (const [mapping, key] of MAPPINGS) {
    const path = `${NS.skos}${mapping}`;
    for (const q of store.getQuads(null, DataFactory.namedNode(path), null, null)) {
      if (q.object.termType !== "NamedNode") continue;
      // Into *this* scheme: the target shares a scheme with the concept that
      // maps to it. A concept of an outside scheme carried in the graph keeps
      // its own `skos:inScheme`, and mapping to it is the point of a match.
      const schemes = new Set(store.getObjects(q.subject, inScheme, null).map((o) => o.value));
      const shared = store.getObjects(q.object, inScheme, null).some((o) => schemes.has(o.value));
      if (!shared) continue;
      findings.push(
        finding("violation", {
          message: `\`${key}\` names "${labelOf(store, q.object.value)}", a concept in this glossary. Use \`broader\`, \`narrower\` or \`related-terms\` for it instead.`,
          focusNode: q.subject.value,
          path,
          docs: blameDocs(store, q.subject.value),
          guidance: coreGuidance(`Concept-${mapping}`),
        }),
      );
    }
  }
  return findings;
}

/**
 * The three `graph` fields a machine may never be attributed for. The old
 * `kg.provenance` schema enumerated the twelve *fillable* fields, which kept
 * these out; a free JSON Pointer cannot express that, so proposal 0046 stress
 * test 13 moved the guard into graph's harvest and, from there, to here.
 */
const CURATED_FIELDS = new Set(["sections", "revision-of", "derived-from"]);

/** The fragment a `graph fill` activity's IRI carries, before its model slug. */
const GRAPH_FILL_FRAGMENT = "#prov.graph-fill.";

/**
 * A machine attribution on a hand-curated field. `check` reads only the built
 * graph and `build` has no findings channel, so the store is where the fact is
 * read: the harvest has already put `graph:filledField "sections"` on a field
 * node under a `#prov.graph-fill.` activity.
 */
function curatedFieldFindings(store: Store): CheckFinding[] {
  const filledField = `${NS.graph}filledField`;
  const pathPred = DataFactory.namedNode(`${NS.graph}path`);
  const findings: CheckFinding[] = [];
  for (const q of store.getQuads(null, DataFactory.namedNode(filledField), null, null)) {
    if (q.object.termType !== "Literal") continue;
    const field = q.object.value;
    if (!CURATED_FIELDS.has(field)) continue;
    const node = q.subject.value;
    const at = node.indexOf(GRAPH_FILL_FRAGMENT);
    const fieldAt = node.lastIndexOf(".field.");
    if (at === -1 || fieldAt <= at) continue;
    const activity = node.slice(0, fieldAt);
    // The model the activity is for, from its own fragment. Naming it beats
    // repeating the activity IRI, which the reporter already prints as the
    // focus node ahead of this message.
    const model = node.slice(at + GRAPH_FILL_FRAGMENT.length, fieldAt);
    // These activities hang off no document edge, so `blameDocs` cannot walk
    // back to one. The doc IRI is the activity's own, minus its fragment.
    const docIri = activity.slice(0, activity.indexOf("#"));
    const path = store.getQuads(DataFactory.namedNode(docIri), pathPred, null, null)[0]
      ?.object.value;
    findings.push(
      finding("violation", {
        message: `\`meta-provenance\` credits ${model} with /graph/${field}, a field only a person writes. Check the value, then delete that entry.`,
        focusNode: activity,
        path: filledField,
        docs: path === undefined ? blameDocs(store, activity) : [path],
        guidance: coreGuidance("FilledFieldEntry-name"),
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
  sourceShape: Term | null;
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
  shapesPaths: ShapesSource[],
): Promise<CheckFinding[]> {
  const shapes = loadShapes(shapesPaths);
  const validator = new SHACLValidator(shapes.store);
  let report;
  try {
    report = await validator.validate(store);
  } catch (e) {
    throw new GraphError(
      `SHACL validation failed: ${errorMessage(e)}`,
    );
  }

  // One finding per (shape, focus node, path): a shape that fails on two
  // values of one property is one mistake, so it reports once. Nested maps
  // rather than a joined key, for the reason `relatedConflicts` gives. Each
  // keeps its distinct messages, joined once the results are all read.
  type Merged = { found: CheckFinding; messages: string[] };
  const merged = new Map<string, Map<string, Map<string, Merged>>>();
  const groups: Merged[] = [];
  for (const result of report.results as ShaclResult[]) {
    const focus = result.focusNode?.value ?? "";
    const path = result.path?.value;
    const messages = result.message
      .map((m) => m.value)
      .filter((m) => m.length > 0);
    // The shape's own sh:message wins, as SHACL says it does. The library
    // lets a validator's text override it (sh:uniqueLang's does), so it is
    // read back here. One with a {$this} or {?var} placeholder is left to
    // the library, which substitutes it.
    const declared =
      result.sourceShape === null ? null : shapeText(shapes.store, result.sourceShape, `${SH}message`);
    const message =
      declared !== null && !/\{[$?]/.test(declared)
        ? declared
        : messages.length > 0
          ? messages.join("; ")
          : `constraint violated${path ? ` on ${compactIri(path)}` : ""}`;
    const byFocus = merged.get(result.sourceShape?.value ?? "") ?? new Map<string, Map<string, Merged>>();
    merged.set(result.sourceShape?.value ?? "", byFocus);
    const byPath = byFocus.get(focus) ?? new Map<string, Merged>();
    byFocus.set(focus, byPath);
    const earlier = byPath.get(path ?? "");
    if (earlier !== undefined) {
      if (!earlier.messages.includes(message)) earlier.messages.push(message);
      continue;
    }
    const found = finding(severityOf(result.severity?.value), {
      message,
      focusNode: focus,
      ...(path !== undefined ? { path } : {}),
      docs: blameDocs(store, focus),
      guidance: shapeGuidance(shapes, result.sourceShape),
    });
    const group = { found, messages: [message] };
    byPath.set(path ?? "", group);
    groups.push(group);
  }
  const findings = groups.map(({ found, messages }) => ({ ...found, message: messages.join("; ") }));

  // Shapes 1.0.0 still says the untagged collision itself, with this message.
  // The check core's copy adds nothing beside it.
  const said = new Set(
    findings
      .filter((f) => f.message === SHAPES_1_0_0_COLLISION)
      .map((f) => f.focusNode),
  );
  findings.push(
    ...cycleFindings(store),
    ...relatedConflicts(store),
    ...curatedFieldFindings(store),
    ...inSchemeMappingFindings(store),
    ...untaggedPrefLabelFindings(store).filter((f) => !said.has(f.focusNode)),
  );

  findings.sort(compareFindings);
  return findings;
}
