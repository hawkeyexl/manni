/**
 * A language-tagged literal (proposal 0085 §1) survives every place a literal
 * flows: the three serializers, the quad dedupe, reading Turtle back, and the
 * browser runtime's index.
 */
import { describe, expect, it } from "vitest";
import { emitTurtle } from "../../../src/graph/core/emit.js";
import { emitJsonLd } from "../../../src/graph/core/emit-jsonld.js";
import { emitRdfXml } from "../../../src/graph/core/emit-rdfxml.js";
import { parseGraph, storeToQuads } from "../../../src/graph/core/load.js";
import { NS, PREFIXES } from "../../../src/graph/core/vocab.js";
import { GraphIndex } from "../../../src/graph/runtime/graph.js";
import type { Quad } from "../../../src/graph/core/derive.js";

const C = "https://example.com/graph/concept/widget";
const PREF = `${NS.skos}prefLabel`;

const quads: Quad[] = [
  { s: C, p: PREF, o: { kind: "literal", value: "Widget", language: "en" } },
  { s: C, p: PREF, o: { kind: "literal", value: "Widget", language: "de" } },
  { s: C, p: PREF, o: { kind: "literal", value: "Widget" } },
];

describe("language-tagged literals", () => {
  it("renders Turtle as \"lit\"@tag, untagged first, then by tag", () => {
    expect(emitTurtle(quads)).toContain(
      'skos:prefLabel "Widget", "Widget"@de, "Widget"@en .',
    );
  });

  it("is byte-identical whatever the input order", () => {
    expect(emitTurtle([...quads].reverse())).toBe(emitTurtle(quads));
    expect(emitJsonLd([...quads].reverse())).toBe(emitJsonLd(quads));
  });

  it("round-trips the tag through n3", () => {
    const back = storeToQuads(parseGraph(emitTurtle(quads), "test"));
    expect(back.map((q) => q.o)).toEqual(
      expect.arrayContaining([
        { kind: "literal", value: "Widget", language: "en" },
        { kind: "literal", value: "Widget", language: "de" },
        { kind: "literal", value: "Widget" },
      ]),
    );
  });

  it("renders JSON-LD as {@value, @language} and reads it back in the runtime", () => {
    const jsonld = emitJsonLd(quads);
    const node = (JSON.parse(jsonld) as { "@graph": Array<Record<string, unknown>> })[
      "@graph"
    ][0];
    expect(node?.["skos:prefLabel"]).toEqual([
      "Widget",
      { "@value": "Widget", "@language": "de" },
      { "@value": "Widget", "@language": "en" },
    ]);
    const index = GraphIndex.fromJsonLd(jsonld);
    expect(index.values(C, PREF)).toEqual(
      GraphIndex.fromQuads(quads).values(C, PREF),
    );
    expect(index.values(C, PREF)).toContainEqual({
      kind: "literal",
      value: "Widget",
      language: "en",
    });
  });

  it("renders RDF/XML with xml:lang", () => {
    const xml = emitRdfXml(quads, Object.fromEntries(PREFIXES));
    expect(xml).toContain('<skos:prefLabel xml:lang="en">Widget</skos:prefLabel>');
    expect(xml).toContain("<skos:prefLabel>Widget</skos:prefLabel>");
  });
});
