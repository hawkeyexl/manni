import { describe, expect, it } from "vitest";
import { defined } from "../helpers/defined.js";
import { emitJsonLd } from "../../../src/kg/core/emit-jsonld.js";
import type { Quad } from "../../../src/kg/core/derive.js";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";

const iri = (value: string): Quad["o"] => ({ kind: "iri", value });
const lit = (value: string, datatype?: string): Quad["o"] => ({
  kind: "literal",
  value,
  ...(datatype ? { datatype } : {}),
});

type Node = Record<string, unknown>;

function parse(ttl: string): {
  context: Record<string, string>;
  graph: Node[];
} {
  const doc = JSON.parse(ttl) as {
    "@context": Record<string, string>;
    "@graph": Node[];
  };
  return { context: doc["@context"], graph: doc["@graph"] };
}

describe("emitJsonLd", () => {
  it("carries the full prefix table as @context", () => {
    const { context } = parse(emitJsonLd([]));
    expect(context.kg).toBe(NS.kg);
    expect(context.iirds).toBe(NS.iirds);
    expect(context.xsd).toBe(NS.xsd);
    // Keys are in prefix (alphabetical) order.
    expect(Object.keys(context)).toEqual([...Object.keys(context)].sort());
  });

  it("folds rdf:type into a compacted @type", () => {
    const s = `${NS.kg}doc/a`;
    const quads: Quad[] = [
      { s, p: RDF_TYPE, o: iri(`${NS.kg}Document`) },
      { s, p: RDF_TYPE, o: iri(`${NS.prov}Entity`) },
    ];
    const { graph } = parse(emitJsonLd(quads));
    expect(graph).toHaveLength(1);
    // Multiple types → sorted array of compacted class IRIs.
    expect(defined(graph[0])["@type"]).toEqual(["kg:Document", "prov:Entity"]);
  });

  it("emits a single @type as a scalar, not an array", () => {
    const s = `${NS.kg}doc/a`;
    const quads: Quad[] = [{ s, p: RDF_TYPE, o: iri(`${NS.kg}Document`) }];
    const { graph } = parse(emitJsonLd(quads));
    expect(defined(graph[0])["@type"]).toBe("kg:Document");
  });

  it("renders IRI objects as {@id}, plain literals as strings, typed as {@value,@type}", () => {
    const s = `${NS.kg}doc/a`;
    const quads: Quad[] = [
      { s, p: `${NS.dcterms}references`, o: iri(`${NS.kg}doc/b`) },
      { s, p: `${NS.dcterms}title`, o: lit("Hello") },
      { s, p: `${NS.kg}wordCount`, o: lit("42", `${NS.xsd}integer`) },
    ];
    const { graph } = parse(emitJsonLd(quads));
    const node = defined(graph[0]);
    expect(node["dcterms:references"]).toEqual({ "@id": `${NS.kg}doc/b` });
    expect(node["dcterms:title"]).toBe("Hello");
    expect(node["kg:wordCount"]).toEqual({
      "@value": "42",
      "@type": "xsd:integer",
    });
  });

  it("treats an xsd:string datatype as a plain literal", () => {
    const s = `${NS.kg}doc/a`;
    const quads: Quad[] = [
      { s, p: `${NS.dcterms}title`, o: lit("Hi", `${NS.xsd}string`) },
    ];
    const { graph } = parse(emitJsonLd(quads));
    expect(defined(graph[0])["dcterms:title"]).toBe("Hi");
  });

  it("collapses a single value to a scalar and keeps multiples as a sorted array", () => {
    const s = `${NS.kg}doc/a`;
    const quads: Quad[] = [
      { s, p: `${NS.dcterms}references`, o: iri(`${NS.kg}doc/c`) },
      { s, p: `${NS.dcterms}references`, o: iri(`${NS.kg}doc/b`) },
      { s, p: `${NS.dcterms}title`, o: lit("One") },
    ];
    const { graph } = parse(emitJsonLd(quads));
    expect(defined(graph[0])["dcterms:title"]).toBe("One");
    expect(defined(graph[0])["dcterms:references"]).toEqual([
      { "@id": `${NS.kg}doc/b` },
      { "@id": `${NS.kg}doc/c` },
    ]);
  });

  it("sorts @graph nodes by @id and predicate keys within a node", () => {
    const quads: Quad[] = [
      { s: `${NS.kg}doc/z`, p: `${NS.dcterms}title`, o: lit("Z") },
      { s: `${NS.kg}doc/a`, p: `${NS.kg}path`, o: lit("a.md") },
      { s: `${NS.kg}doc/a`, p: `${NS.dcterms}title`, o: lit("A") },
    ];
    const { graph } = parse(emitJsonLd(quads));
    expect(graph.map((n) => n["@id"])).toEqual([
      `${NS.kg}doc/a`,
      `${NS.kg}doc/z`,
    ]);
    // Within the first node, @id leads, then predicate keys sorted.
    const keys = Object.keys(defined(graph[0]));
    expect(keys[0]).toBe("@id");
    expect(keys.slice(1)).toEqual([...keys.slice(1)].sort());
  });

  it("is byte-identical regardless of input quad order", () => {
    const s = `${NS.kg}doc/a`;
    const forward: Quad[] = [
      { s, p: RDF_TYPE, o: iri(`${NS.kg}Document`) },
      { s, p: `${NS.dcterms}title`, o: lit("A") },
      { s, p: `${NS.dcterms}references`, o: iri(`${NS.kg}doc/b`) },
    ];
    const reversed = [...forward].reverse();
    expect(emitJsonLd(reversed)).toBe(emitJsonLd(forward));
  });

  it("ends with exactly one trailing newline and is valid JSON", () => {
    const out = emitJsonLd([
      { s: `${NS.kg}doc/a`, p: `${NS.dcterms}title`, o: lit("A") },
    ]);
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.endsWith("}\n\n")).toBe(false);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
