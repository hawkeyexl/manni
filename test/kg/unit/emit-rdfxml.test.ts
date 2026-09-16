import { describe, expect, it } from "vitest";
import { emitRdfXml } from "../../../src/kg/core/emit-rdfxml.js";
import type { Quad } from "../../../src/kg/core/derive.js";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";

const iri = (value: string): Quad["o"] => ({ kind: "iri", value });
const lit = (value: string, datatype?: string): Quad["o"] => ({
  kind: "literal",
  value,
  ...(datatype ? { datatype } : {}),
});

const PREFIXES: Record<string, string> = {
  dcterms: NS.dcterms,
  iirds: NS.iirds,
  rdf: NS.rdf,
  xsd: NS.xsd,
};

describe("emitRdfXml", () => {
  it("emits an XML declaration and a sorted-namespace rdf:RDF root", () => {
    const out = emitRdfXml([], PREFIXES);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(
      true,
    );
    expect(out).toContain("<rdf:RDF");
    // Namespaces declared in sorted prefix order.
    const decls = [...out.matchAll(/xmlns:([a-z]+)=/g)].map((m) => m[1]);
    expect(decls).toEqual([...decls].sort());
    expect(out.trimEnd().endsWith("</rdf:RDF>")).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("renders rdf:type as a compacted element with rdf:resource", () => {
    const s = `${NS.iirds}p1`;
    const out = emitRdfXml(
      [{ s, p: RDF_TYPE, o: iri(`${NS.iirds}Package`) }],
      PREFIXES,
    );
    expect(out).toContain(`<rdf:Description rdf:about="${NS.iirds}p1">`);
    expect(out).toContain(`<rdf:type rdf:resource="${NS.iirds}Package"/>`);
  });

  it("renders IRI, plain-literal, and typed-literal objects distinctly", () => {
    const s = `${NS.iirds}d1`;
    const out = emitRdfXml(
      [
        { s, p: `${NS.iirds}is-part-of-package`, o: iri(`${NS.iirds}p1`) },
        { s, p: `${NS.iirds}title`, o: lit("Hello") },
        { s, p: `${NS.dcterms}extent`, o: lit("3", `${NS.xsd}integer`) },
      ],
      PREFIXES,
    );
    expect(out).toContain(
      `<iirds:is-part-of-package rdf:resource="${NS.iirds}p1"/>`,
    );
    expect(out).toContain("<iirds:title>Hello</iirds:title>");
    expect(out).toContain(
      `<dcterms:extent rdf:datatype="${NS.xsd}integer">3</dcterms:extent>`,
    );
  });

  it("XML-escapes text content and attribute values", () => {
    const s = `${NS.iirds}d&1`;
    const out = emitRdfXml(
      [{ s, p: `${NS.iirds}title`, o: lit('A < B & "C"') }],
      PREFIXES,
    );
    expect(out).toContain(`rdf:about="${NS.iirds}d&amp;1"`);
    expect(out).toContain('<iirds:title>A &lt; B &amp; "C"</iirds:title>');
  });

  it("sorts subjects and is invariant to input quad order", () => {
    const forward: Quad[] = [
      { s: `${NS.iirds}z`, p: `${NS.iirds}title`, o: lit("Z") },
      { s: `${NS.iirds}a`, p: RDF_TYPE, o: iri(`${NS.iirds}Topic`) },
      { s: `${NS.iirds}a`, p: `${NS.iirds}title`, o: lit("A") },
    ];
    const out = emitRdfXml(forward, PREFIXES);
    expect(out.indexOf(`rdf:about="${NS.iirds}a"`)).toBeLessThan(
      out.indexOf(`rdf:about="${NS.iirds}z"`),
    );
    expect(emitRdfXml([...forward].reverse(), PREFIXES)).toBe(out);
  });
});
