import { describe, expect, it } from "vitest";
import { GraphIndex } from "../../../src/kg/runtime/graph.js";
import type { Quad } from "../../../src/kg/core/derive.js";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";

const BASE = "https://ex.com/kg/";
const DOC_A = `${BASE}doc/a.md`;
const DOC_B = `${BASE}doc/b.md`;

const JSONLD = {
  "@context": {
    dcterms: NS.dcterms,
    dockg: NS.dockg,
    xsd: NS.xsd,
  },
  "@graph": [
    {
      "@id": DOC_A,
      "@type": ["dockg:Document", "prov:Entity"],
      "dcterms:title": "A",
      "dcterms:references": [{ "@id": DOC_B }],
      "dockg:path": "docs/a.md",
      "dockg:wordCount": { "@value": "42", "@type": "xsd:integer" },
    },
    {
      "@id": DOC_B,
      "@type": "dockg:Document",
      "dcterms:title": "B",
    },
  ],
};

describe("GraphIndex.fromJsonLd", () => {
  it("expands CURIE keys and @type using the document's own @context", () => {
    const g = GraphIndex.fromJsonLd(JSONLD);
    expect(g.types(DOC_A)).toContain(`${NS.dockg}Document`);
    expect(g.literal(DOC_A, `${NS.dcterms}title`)).toBe("A");
    expect(g.literal(DOC_A, `${NS.dockg}path`)).toBe("docs/a.md");
  });

  it("accepts a JSON string as well as a parsed object", () => {
    const g = GraphIndex.fromJsonLd(JSON.stringify(JSONLD));
    expect(g.literal(DOC_A, `${NS.dcterms}title`)).toBe("A");
  });

  it("leaves an unknown prefix (an absolute IRI) untouched", () => {
    const g = GraphIndex.fromJsonLd(JSONLD);
    // prov: is not in this @context, so the type stays as written.
    expect(g.types(DOC_A)).toContain("prov:Entity");
  });

  it("indexes typed literals with their expanded datatype", () => {
    const g = GraphIndex.fromJsonLd(JSONLD);
    const [wc] = g.values(DOC_A, `${NS.dockg}wordCount`);
    expect(wc).toEqual({
      kind: "literal",
      value: "42",
      datatype: `${NS.xsd}integer`,
    });
  });

  it("builds outbound and inbound adjacency", () => {
    const g = GraphIndex.fromJsonLd(JSONLD);
    expect(g.out(DOC_A, `${NS.dcterms}references`)).toEqual([
      { predicate: `${NS.dcterms}references`, target: DOC_B },
    ]);
    expect(g.in(DOC_B, `${NS.dcterms}references`)).toEqual([
      { predicate: `${NS.dcterms}references`, target: DOC_A },
    ]);
  });

  it("indexes instances by class", () => {
    const g = GraphIndex.fromJsonLd(JSONLD);
    expect(g.instancesOf(`${NS.dockg}Document`)).toEqual([DOC_A, DOC_B]);
  });

  it("returns ids and edges in deterministic sorted order", () => {
    const g = GraphIndex.fromJsonLd(JSONLD);
    expect(g.ids()).toEqual([...g.ids()].sort());
    const reversed = {
      ...JSONLD,
      "@graph": [...JSONLD["@graph"]].reverse(),
    };
    expect(GraphIndex.fromJsonLd(reversed).ids()).toEqual(g.ids());
  });

  it("materializes referenced-only IRIs as (empty) nodes", () => {
    const g = GraphIndex.fromJsonLd({
      "@context": { dcterms: NS.dcterms },
      "@graph": [
        { "@id": DOC_A, "dcterms:references": { "@id": `${BASE}ghost` } },
      ],
    });
    expect(g.has(`${BASE}ghost`)).toBe(true);
    expect(g.types(`${BASE}ghost`)).toEqual([]);
  });
});

describe("GraphIndex.fromQuads", () => {
  const quads: Quad[] = [
    { s: DOC_A, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
    { s: DOC_A, p: `${NS.dcterms}title`, o: { kind: "literal", value: "A" } },
    {
      s: DOC_A,
      p: `${NS.dcterms}references`,
      o: { kind: "iri", value: DOC_B },
    },
  ];

  it("builds an equivalent index from dockg quads", () => {
    const g = GraphIndex.fromQuads(quads);
    expect(g.types(DOC_A)).toEqual([`${NS.dockg}Document`]);
    expect(g.literal(DOC_A, `${NS.dcterms}title`)).toBe("A");
    expect(g.in(DOC_B, `${NS.dcterms}references`)).toHaveLength(1);
  });

  it("drops a redundant xsd:string datatype (matching JSON-LD parsing)", () => {
    const g = GraphIndex.fromQuads([
      {
        s: DOC_A,
        p: `${NS.dcterms}title`,
        o: { kind: "literal", value: "A", datatype: `${NS.xsd}string` },
      },
    ]);
    expect(g.values(DOC_A, `${NS.dcterms}title`)).toEqual([
      { kind: "literal", value: "A" },
    ]);
  });
});

describe("GraphIndex CURIE helpers", () => {
  it("expands and compacts against the context, longest namespace winning", () => {
    const g = GraphIndex.fromJsonLd(JSONLD);
    expect(g.expand("dcterms:title")).toBe(`${NS.dcterms}title`);
    expect(g.compact(`${NS.dcterms}title`)).toBe("dcterms:title");
    // No matching prefix → unchanged, both directions.
    expect(g.expand("https://example.org/x")).toBe("https://example.org/x");
    expect(g.compact("https://example.org/x")).toBe("https://example.org/x");
  });
});
