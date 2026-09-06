/**
 * RDF/JS interop — the custom-SPARQL escape hatch (ADR 01018).
 *
 * The runtime's own walker is deliberately not a SPARQL engine: it is 0 KB and
 * it records a trace. But arbitrary user-authored SPARQL is a legitimate need,
 * so the index can hand out its contents as standard **RDF/JS quads**. Feed
 * them to any RDF/JS store and query with any engine:
 *
 * ```js
 * import { Store } from "n3";
 * import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
 * const store = new Store(rdfjsQuads(graph));
 * const bindings = await new QueryEngine().queryBindings(sparql, { sources: [store] });
 * ```
 *
 * Quads are plain data rather than a hand-rolled `Source` stream on purpose:
 * every engine already accepts a store, stores accept quad arrays, and faking
 * Node's stream contract in a browser-safe module is fragile for no gain. At
 * docs scale materializing is trivial (the reference corpus is 172 quads).
 *
 * Honest caveat: engine results are bindings, not walker traces —
 * explainability lives in the walker API.
 *
 * The term shapes are structural, so they are hand-rolled here rather than
 * pulled from `@rdfjs/data-model`, keeping the runtime dependency-free and
 * browser-safe.
 */
import { byCodeUnit } from "../core/sort.js";
import type { GraphIndex, Value } from "./graph.js";

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

export interface RdfTerm {
  termType: "NamedNode" | "Literal" | "DefaultGraph";
  value: string;
  language?: string;
  datatype?: RdfTerm;
  equals(other?: RdfTerm | null): boolean;
}

export interface RdfQuad {
  termType: "Quad";
  subject: RdfTerm;
  predicate: RdfTerm;
  object: RdfTerm;
  graph: RdfTerm;
  equals(other?: RdfQuad | null): boolean;
}

export function namedNode(value: string): RdfTerm {
  return {
    termType: "NamedNode",
    value,
    equals(other) {
      return !!other && other.termType === "NamedNode" && other.value === value;
    },
  };
}

export function defaultGraph(): RdfTerm {
  return {
    termType: "DefaultGraph",
    value: "",
    equals(other) {
      return !!other && other.termType === "DefaultGraph";
    },
  };
}

export function literal(value: string, datatype?: string): RdfTerm {
  const dt = namedNode(datatype ?? XSD_STRING);
  return {
    termType: "Literal",
    value,
    language: "",
    datatype: dt,
    equals(other) {
      return (
        !!other &&
        other.termType === "Literal" &&
        other.value === value &&
        !!other.datatype &&
        other.datatype.value === dt.value
      );
    },
  };
}

function toTerm(v: Value): RdfTerm {
  return v.kind === "iri" ? namedNode(v.value) : literal(v.value, v.datatype);
}

function makeQuad(s: string, p: string, o: Value): RdfQuad {
  const subject = namedNode(s);
  const predicate = namedNode(p);
  const object = toTerm(o);
  const graph = defaultGraph();
  return {
    termType: "Quad",
    subject,
    predicate,
    object,
    graph,
    equals(other) {
      return (
        !!other &&
        subject.equals(other.subject) &&
        predicate.equals(other.predicate) &&
        object.equals(other.object)
      );
    },
  };
}

/**
 * The whole index as RDF/JS quads, in the index's deterministic order. Feed to
 * any RDF/JS store (`new Store(rdfjsQuads(graph))`) to run SPARQL.
 */
export function rdfjsQuads(graph: GraphIndex): RdfQuad[] {
  const quads: RdfQuad[] = [];
  for (const s of graph.ids()) {
    const node = graph.node(s);
    if (!node) continue;
    for (const p of [...node.props.keys()].sort(byCodeUnit)) {
      for (const v of node.props.get(p) ?? []) quads.push(makeQuad(s, p, v));
    }
  }
  return quads;
}

/**
 * Triple-pattern match returning RDF/JS quads. A null/undefined position is a
 * wildcard. Convenience for callers who want RDF/JS terms without pulling in a
 * store; the walker API is the richer (and traced) way to query.
 */
export function matchQuads(
  graph: GraphIndex,
  subject?: string | null,
  predicate?: string | null,
  object?: string | null,
): RdfQuad[] {
  const quads: RdfQuad[] = [];
  const subjects = subject ? [subject] : graph.ids();
  for (const s of subjects) {
    const node = graph.node(s);
    if (!node) continue;
    const predicates = predicate
      ? [predicate]
      : [...node.props.keys()].sort(byCodeUnit);
    for (const p of predicates) {
      for (const v of node.props.get(p) ?? []) {
        if (object !== undefined && object !== null && v.value !== object) {
          continue;
        }
        quads.push(makeQuad(s, p, v));
      }
    }
  }
  return quads;
}
