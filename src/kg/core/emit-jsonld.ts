/**
 * Deterministic JSON-LD serialization — the web-native rendering of the same
 * graph the Turtle emitter produces. Canonical form: an `@context` carrying the
 * fixed prefix table, then `@graph` as one node object per subject sorted by
 * `@id`. Within a node: `@id`, then `@type` (compacted class IRIs, sorted),
 * then predicate CURIE keys sorted, each value array sorted. Objects are built
 * in that sorted key order so `JSON.stringify(_, null, 2)` is byte-stable.
 * Byte-identical output for any input quad order.
 *
 * Deliberately hand-rolled rather than the `jsonld` library, for the same
 * reason the Turtle emitter avoids N3.Writer: library formatting and ordering
 * are incidental, not a stability contract. dockg emits no blank nodes and no
 * language-tagged literals, so neither is handled here.
 */
import { compactIri } from "./load.js";
import type { Quad, Term } from "./derive.js";
import { byCodeUnit } from "./sort.js";
import { NS, PREFIXES, RDF_TYPE } from "./vocab.js";

const XSD_STRING = `${NS.xsd}string`;

/**
 * A rendered JSON-LD object value plus the fields it sorts by. Sorting compares
 * field by field (never a joined string with a separator — that would need a
 * delimiter byte, and NUL/control bytes in source are forbidden): IRIs before
 * literals (mirroring the Turtle emitter), then lexical value, then datatype.
 */
interface RenderedValue {
  value: unknown;
  /** 0 = IRI, 1 = literal — IRIs sort first. */
  kind: 0 | 1;
  /** IRI value or literal lexical form. */
  primary: string;
  /** Datatype IRI for typed literals; "" for IRIs and plain literals. */
  datatype: string;
}

function renderValue(term: Term): RenderedValue {
  if (term.kind === "iri") {
    return {
      value: { "@id": term.value },
      kind: 0,
      primary: term.value,
      datatype: "",
    };
  }
  if (term.datatype && term.datatype !== XSD_STRING) {
    return {
      value: { "@value": term.value, "@type": compactIri(term.datatype) },
      kind: 1,
      primary: term.value,
      datatype: term.datatype,
    };
  }
  return { value: term.value, kind: 1, primary: term.value, datatype: "" };
}

function compareRendered(a: RenderedValue, b: RenderedValue): number {
  if (a.kind !== b.kind) return a.kind - b.kind;
  const p = byCodeUnit(a.primary, b.primary);
  if (p !== 0) return p;
  return byCodeUnit(a.datatype, b.datatype);
}

/** Collapse a sorted value list to a scalar (n=1) or array (n>1). */
function collapse(values: RenderedValue[]): unknown {
  const rendered = [...values].sort(compareRendered).map((v) => v.value);
  return rendered.length === 1 ? rendered[0] : rendered;
}

export function emitJsonLd(quads: Quad[]): string {
  const context: Record<string, string> = {};
  for (const [prefix, ns] of PREFIXES) context[prefix] = ns;

  // subject → predicate → terms
  const subjects = new Map<string, Map<string, Term[]>>();
  for (const quad of quads) {
    let preds = subjects.get(quad.s);
    if (!preds) {
      preds = new Map();
      subjects.set(quad.s, preds);
    }
    let terms = preds.get(quad.p);
    if (!terms) {
      terms = [];
      preds.set(quad.p, terms);
    }
    terms.push(quad.o);
  }

  // Sorting the entries rather than the keys: each predicate map arrives with
  // the subject it belongs to, so there is no second lookup to assert on.
  const graph = [...subjects.entries()]
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([subject, preds]) => {
      const node: Record<string, unknown> = { "@id": subject };

      const types = preds.get(RDF_TYPE);
      if (types) {
        const compacted = types
          .map((t) => compactIri(t.value))
          .sort(byCodeUnit);
        node["@type"] = compacted.length === 1 ? compacted[0] : compacted;
      }

      const predEntries = [...preds.entries()]
        .filter(([p]) => p !== RDF_TYPE)
        .sort(([a], [b]) => byCodeUnit(a, b));
      for (const [p, terms] of predEntries) {
        node[compactIri(p)] = collapse(terms.map(renderValue));
      }
      return node;
    });

  return `${JSON.stringify({ "@context": context, "@graph": graph }, null, 2)}\n`;
}
