/**
 * Deterministic RDF/XML serialization — the metadata half of the iiRDS package
 * export (ADR 01017). RDF/XML is what `META-INF/metadata.rdf` must be (the iiRDS
 * container rule; Turtle/JSON-LD are not accepted there). Hand-rolled like the
 * Turtle/JSON-LD emitters ([emit.ts], [emit-jsonld.ts]) so the bytes are a
 * stability contract.
 *
 * Canonical form: an XML declaration, then `<rdf:RDF>` with namespace
 * declarations in sorted prefix order, then one `<rdf:Description>` per subject
 * sorted by IRI. Within a subject, predicates are sorted; each object is an
 * `rdf:resource` (IRI) or escaped element text (literal, with `rdf:datatype`
 * when typed). No blank nodes. Byte-identical for any input quad order.
 *
 * The prefix table is passed in (not the global `PREFIXES`) so the package can
 * declare `vcard` without touching the main graph's Turtle/JSON-LD headers.
 */
import type { Quad, Term } from "./derive.js";
import { byCodeUnit } from "./sort.js";
import { NS } from "./vocab.js";

const XSD_STRING = `${NS.xsd}string`;

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/** Compact an IRI to `prefix:local` using the supplied table (longest NS wins). */
function toQName(
  iri: string,
  prefixes: ReadonlyArray<[string, string]>,
): string {
  let best: string | undefined;
  let bestNs = "";
  for (const [prefix, ns] of prefixes) {
    if (
      iri.startsWith(ns) &&
      iri.length > ns.length &&
      ns.length > bestNs.length
    ) {
      best = `${prefix}:${iri.slice(ns.length)}`;
      bestNs = ns;
    }
  }
  if (best === undefined) {
    throw new Error(`emitRdfXml: no prefix covers the IRI ${iri}`);
  }
  return best;
}

/** Sort objects: IRIs before literals, then by value, then by datatype. */
function compareTerms(a: Term, b: Term): number {
  if (a.kind !== b.kind) return a.kind === "iri" ? -1 : 1;
  const v = byCodeUnit(a.value, b.value);
  if (v !== 0) return v;
  const da = a.kind === "literal" ? (a.datatype ?? "") : "";
  const db = b.kind === "literal" ? (b.datatype ?? "") : "";
  return byCodeUnit(da, db);
}

export function emitRdfXml(
  quads: Quad[],
  prefixes: Record<string, string>,
): string {
  const sortedPrefixes = Object.entries(prefixes).sort(([a], [b]) =>
    byCodeUnit(a, b),
  );

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push("<rdf:RDF");
  sortedPrefixes.forEach(([prefix, ns], i) => {
    const tail = i === sortedPrefixes.length - 1 ? ">" : "";
    lines.push(`  xmlns:${prefix}="${escapeAttr(ns)}"${tail}`);
  });

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

  for (const subject of [...subjects.keys()].sort(byCodeUnit)) {
    lines.push(`  <rdf:Description rdf:about="${escapeAttr(subject)}">`);
    const preds = subjects.get(subject)!;
    for (const p of [...preds.keys()].sort(byCodeUnit)) {
      const qname = toQName(p, sortedPrefixes);
      for (const term of [...preds.get(p)!].sort(compareTerms)) {
        if (term.kind === "iri") {
          lines.push(
            `    <${qname} rdf:resource="${escapeAttr(term.value)}"/>`,
          );
        } else if (term.datatype && term.datatype !== XSD_STRING) {
          lines.push(
            `    <${qname} rdf:datatype="${escapeAttr(term.datatype)}">${escapeText(term.value)}</${qname}>`,
          );
        } else {
          lines.push(`    <${qname}>${escapeText(term.value)}</${qname}>`);
        }
      }
    }
    lines.push("  </rdf:Description>");
  }

  lines.push("</rdf:RDF>");
  return `${lines.join("\n")}\n`;
}
