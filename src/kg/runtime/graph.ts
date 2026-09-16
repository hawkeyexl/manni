/**
 * `GraphIndex` — the browser-native in-memory graph (ADR 01018).
 *
 * Built from `graph.jsonld` (the Phase 6 export) with **no RDF parser**: that
 * artifact is plain `JSON.parse`-able, deterministically sorted, and free of
 * blank nodes, so a `Map`-based adjacency index is all the runtime needs. Node
 * callers can also build from quads (`fromQuads`) so the CLI can read Turtle.
 *
 * Platform-neutral: no `node:` imports, no npm dependencies, no I/O — the
 * caller supplies the bytes. Type-only imports are erased at build time.
 *
 * Every accessor returns deterministically sorted results, so traversal order
 * (and therefore the trace) is byte-stable for a given graph.
 */
import type { Quad } from "../core/derive.js";
import { byCodeUnit } from "../core/sort.js";
import { RDF_TYPE } from "../core/vocab.js";

/** An object value: an IRI reference or a literal. */
export type Value =
  | { kind: "iri"; value: string }
  | { kind: "literal"; value: string; datatype?: string };

export interface GraphNode {
  id: string;
  /** Full class IRIs, sorted. */
  types: string[];
  /** Full predicate IRI → values, in insertion-normalized sorted order. */
  props: Map<string, Value[]>;
}

/** The parsed shape of a `graph.jsonld` document. */
interface JsonLdDoc {
  "@context"?: Record<string, string>;
  "@graph"?: unknown[];
}

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

function compareValues(a: Value, b: Value): number {
  if (a.kind !== b.kind) return a.kind === "iri" ? -1 : 1;
  const v = byCodeUnit(a.value, b.value);
  if (v !== 0) return v;
  const da = a.kind === "literal" ? (a.datatype ?? "") : "";
  const db = b.kind === "literal" ? (b.datatype ?? "") : "";
  return byCodeUnit(da, db);
}

export class GraphIndex {
  private readonly nodes = new Map<string, GraphNode>();
  /** subject → predicate → object IRIs (sorted). */
  private readonly outbound = new Map<string, Map<string, string[]>>();
  /** object → predicate → subject IRIs (sorted). */
  private readonly inbound = new Map<string, Map<string, string[]>>();
  /** class IRI → instance IRIs (sorted). */
  private readonly byType = new Map<string, string[]>();
  /** prefix → namespace, from the artifact's own `@context`. */
  readonly context: Record<string, string>;

  private constructor(context: Record<string, string>) {
    this.context = context;
  }

  /**
   * Build from a `graph.jsonld` document — a JSON string or the parsed object.
   * CURIE keys and `@type` values are expanded using the document's own
   * `@context`, so the index is self-describing.
   */
  static fromJsonLd(input: string | object): GraphIndex {
    const doc = (
      typeof input === "string" ? (JSON.parse(input) as JsonLdDoc) : input
    ) as JsonLdDoc;
    const context = doc["@context"] ?? {};
    const index = new GraphIndex({ ...context });
    for (const raw of doc["@graph"] ?? []) {
      index.addJsonLdNode(raw as Record<string, unknown>);
    }
    index.finalize();
    return index;
  }

  /** Build from dockg's internal quad shape (the Node/CLI path). */
  static fromQuads(quads: Quad[], context: Record<string, string> = {}) {
    const index = new GraphIndex({ ...context });
    for (const q of quads) {
      const o = q.o;
      const value: Value =
        o.kind === "iri"
          ? { kind: "iri", value: o.value }
          : o.datatype && o.datatype !== XSD_STRING
            ? { kind: "literal", value: o.value, datatype: o.datatype }
            : { kind: "literal", value: o.value };
      index.addTriple(q.s, q.p, value);
    }
    index.finalize();
    return index;
  }

  /** Expand a CURIE (`dcterms:title`) to a full IRI using `@context`. */
  expand(term: string): string {
    const colon = term.indexOf(":");
    if (colon <= 0) return term;
    const ns = this.context[term.slice(0, colon)];
    return ns ? `${ns}${term.slice(colon + 1)}` : term;
  }

  /** Compact a full IRI to a CURIE when a context namespace matches. */
  compact(iri: string): string {
    let best = iri;
    let bestNs = "";
    for (const [prefix, ns] of Object.entries(this.context)) {
      if (
        iri.startsWith(ns) &&
        iri.length > ns.length &&
        ns.length > bestNs.length
      ) {
        best = `${prefix}:${iri.slice(ns.length)}`;
        bestNs = ns;
      }
    }
    return best;
  }

  private addJsonLdNode(raw: Record<string, unknown>): void {
    const id = typeof raw["@id"] === "string" ? this.expand(raw["@id"]) : "";
    if (!id) return;
    this.ensureNode(id);

    const rawTypes = raw["@type"];
    for (const t of toArray(rawTypes)) {
      if (typeof t === "string") {
        this.addTriple(id, RDF_TYPE, { kind: "iri", value: this.expand(t) });
      }
    }

    for (const [key, rawValue] of Object.entries(raw)) {
      if (key === "@id" || key === "@type") continue;
      const predicate = this.expand(key);
      for (const v of toArray(rawValue)) {
        const value = this.toValue(v);
        if (value) this.addTriple(id, predicate, value);
      }
    }
  }

  private toValue(v: unknown): Value | undefined {
    if (typeof v === "string") return { kind: "literal", value: v };
    if (typeof v === "number" || typeof v === "boolean") {
      return { kind: "literal", value: String(v) };
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o["@id"] === "string") {
        return { kind: "iri", value: this.expand(o["@id"]) };
      }
      if (o["@value"] !== undefined) {
        const raw = o["@value"];
        // JSON.stringify spells a number or boolean the way String() would,
        // and gives an object a lexical form instead of "[object Object]".
        const lexical = typeof raw === "string" ? raw : JSON.stringify(raw);
        const dt =
          typeof o["@type"] === "string" ? this.expand(o["@type"]) : undefined;
        return dt && dt !== XSD_STRING
          ? { kind: "literal", value: lexical, datatype: dt }
          : { kind: "literal", value: lexical };
      }
    }
    return undefined;
  }

  private ensureNode(id: string): GraphNode {
    let node = this.nodes.get(id);
    if (!node) {
      node = { id, types: [], props: new Map() };
      this.nodes.set(id, node);
    }
    return node;
  }

  private addTriple(s: string, p: string, o: Value): void {
    const node = this.ensureNode(s);
    let values = node.props.get(p);
    if (!values) {
      values = [];
      node.props.set(p, values);
    }
    values.push(o);

    if (p === RDF_TYPE && o.kind === "iri") {
      node.types.push(o.value);
      const instances = this.byType.get(o.value);
      if (instances) instances.push(s);
      else this.byType.set(o.value, [s]);
    }

    if (o.kind === "iri") {
      addEdge(this.outbound, s, p, o.value);
      addEdge(this.inbound, o.value, p, s);
      // Referenced-only IRIs still resolve as (empty) nodes.
      this.ensureNode(o.value);
    }
  }

  /** Sort every collection so traversal order is deterministic. */
  private finalize(): void {
    for (const node of this.nodes.values()) {
      node.types.sort(byCodeUnit);
      for (const values of node.props.values()) values.sort(compareValues);
    }
    for (const instances of this.byType.values()) instances.sort(byCodeUnit);
    for (const map of [this.outbound, this.inbound]) {
      for (const preds of map.values()) {
        for (const targets of preds.values()) targets.sort(byCodeUnit);
      }
    }
  }

  /** Every node IRI, sorted. */
  ids(): string[] {
    return [...this.nodes.keys()].sort(byCodeUnit);
  }

  size(): number {
    return this.nodes.size;
  }

  node(iri: string): GraphNode | undefined {
    return this.nodes.get(iri);
  }

  has(iri: string): boolean {
    return this.nodes.has(iri);
  }

  /** Class IRIs of a node, sorted. */
  types(iri: string): string[] {
    return this.nodes.get(iri)?.types ?? [];
  }

  /** Instances of a class, sorted. */
  instancesOf(classIri: string): string[] {
    return this.byType.get(classIri) ?? [];
  }

  /** All values for a predicate, sorted. */
  values(iri: string, predicate: string): Value[] {
    return this.nodes.get(iri)?.props.get(predicate) ?? [];
  }

  /** Literal lexical forms for a predicate, sorted. */
  literals(iri: string, predicate: string): string[] {
    return this.values(iri, predicate)
      .filter((v) => v.kind === "literal")
      .map((v) => v.value);
  }

  /** The first literal for a predicate, if any. */
  literal(iri: string, predicate: string): string | undefined {
    return this.literals(iri, predicate)[0];
  }

  /** Outbound IRI targets: all predicates, or one. Sorted. */
  out(
    iri: string,
    predicate?: string,
  ): Array<{ predicate: string; target: string }> {
    return edges(this.outbound, iri, predicate);
  }

  /** Inbound IRI sources (who points at this node). Sorted. */
  in(
    iri: string,
    predicate?: string,
  ): Array<{ predicate: string; target: string }> {
    return edges(this.inbound, iri, predicate);
  }
}

function addEdge(
  map: Map<string, Map<string, string[]>>,
  key: string,
  predicate: string,
  target: string,
): void {
  let preds = map.get(key);
  if (!preds) {
    preds = new Map();
    map.set(key, preds);
  }
  const targets = preds.get(predicate);
  if (targets) targets.push(target);
  else preds.set(predicate, [target]);
}

function edges(
  map: Map<string, Map<string, string[]>>,
  iri: string,
  predicate?: string,
): Array<{ predicate: string; target: string }> {
  const preds = map.get(iri);
  if (!preds) return [];
  const out: Array<{ predicate: string; target: string }> = [];
  const keys = predicate ? [predicate] : [...preds.keys()].sort(byCodeUnit);
  for (const p of keys) {
    for (const target of preds.get(p) ?? []) out.push({ predicate: p, target });
  }
  return out;
}

function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
