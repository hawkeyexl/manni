/** Load a built .ttl into an in-memory N3 store for query/stats. */
import { existsSync, readFileSync } from "node:fs";
import { Parser, Store } from "n3";
import { DockgError } from "../types.js";
import type { Quad, Term } from "./derive.js";
import { NS, PREFIXES } from "./vocab.js";

const XSD_STRING = `${NS.xsd}string`;

export function loadGraph(ttlPath: string): Store {
  if (!existsSync(ttlPath)) {
    throw new DockgError(
      `Graph not found: ${ttlPath} — run \`manni kg build\` first.`,
    );
  }
  const parser = new Parser({ format: "text/turtle" });
  let quads;
  try {
    quads = parser.parse(readFileSync(ttlPath, "utf8"));
  } catch (e) {
    throw new DockgError(
      `Failed to parse ${ttlPath}: ${e instanceof Error ? e.message : "parse error"}`,
    );
  }
  return new Store(quads);
}

/**
 * Convert an in-memory N3 store back to dockg's internal quad shape — the
 * bridge from the Turtle-reading Node side to the platform-neutral emitters and
 * runtime. A redundant `xsd:string` datatype is dropped so the result matches
 * what the JSON-LD path produces.
 */
export function storeToQuads(store: Store): Quad[] {
  return store.getQuads(null, null, null, null).map((q) => {
    const o = q.object;
    let term: Term;
    if (o.termType === "Literal") {
      const dt = o.datatype.value;
      term =
        dt && dt !== XSD_STRING
          ? { kind: "literal", value: o.value, datatype: dt }
          : { kind: "literal", value: o.value };
    } else {
      term = { kind: "iri", value: o.value };
    }
    return { s: q.subject.value, p: q.predicate.value, o: term };
  });
}

/** Expand `dcterms:references`-style prefixed names to full IRIs; pass through the rest. */
export function expandTerm(input: string): string {
  const colon = input.indexOf(":");
  if (colon > 0) {
    const prefix = input.slice(0, colon);
    const ns = (NS as Record<string, string>)[prefix];
    if (ns) return `${ns}${input.slice(colon + 1)}`;
  }
  return input;
}

/** Compact a full IRI back to a prefixed name when a known namespace matches. */
export function compactIri(iri: string): string {
  for (const [prefix, ns] of PREFIXES) {
    if (iri.startsWith(ns) && iri.length > ns.length) {
      return `${prefix}:${iri.slice(ns.length)}`;
    }
  }
  return iri;
}
