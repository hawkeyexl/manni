import { describe, expect, it } from "vitest";
import { emitTurtle } from "../../../src/kg/core/emit.js";
import { NS } from "../../../src/kg/core/vocab.js";
import type { Quad } from "../../../src/kg/core/derive.js";

const iri = (value: string) => ({ kind: "iri", value }) as const;
const lit = (value: string, datatype?: string) =>
  ({ kind: "literal", value, ...(datatype ? { datatype } : {}) }) as const;

const DOC = "https://example.com/kg/doc/docs/a.md";

function sample(): Quad[] {
  return [
    { s: DOC, p: `${NS.dcterms}title`, o: lit("Hello") },
    { s: DOC, p: `${NS.rdf}type`, o: iri(`${NS.dockg}Document`) },
    { s: DOC, p: `${NS.dockg}level`, o: lit("2", `${NS.xsd}integer`) },
    {
      s: DOC,
      p: `${NS.dcterms}subject`,
      o: iri("https://example.com/kg/concept/b"),
    },
    {
      s: DOC,
      p: `${NS.dcterms}subject`,
      o: iri("https://example.com/kg/concept/a"),
    },
    {
      s: "https://example.com/kg/concept/a",
      p: `${NS.skos}prefLabel`,
      o: lit("a"),
    },
  ];
}

describe("emitTurtle", () => {
  it("emits sorted prefixes, subjects, and predicates with rdf:type as `a` first", () => {
    const ttl = emitTurtle(sample());
    expect(ttl).toContain("@prefix dcterms: <http://purl.org/dc/terms/> .");
    expect(ttl).toContain(
      "@prefix dockg: <https://hawkeyexl.github.io/dockg/ns#> .",
    );
    // concept subject sorts before doc subject
    const conceptAt = ttl.indexOf("<https://example.com/kg/concept/a>");
    const docAt = ttl.indexOf(`<${DOC}>`);
    expect(conceptAt).toBeGreaterThan(-1);
    expect(conceptAt).toBeLessThan(docAt);
    // rdf:type first within the doc block, as `a`
    expect(ttl).toMatch(
      /<https:\/\/example\.com\/kg\/doc\/docs\/a\.md> a dockg:Document ;/,
    );
  });

  it("groups multiple objects for one predicate with commas, sorted", () => {
    const ttl = emitTurtle(sample());
    expect(ttl).toContain(
      "dcterms:subject <https://example.com/kg/concept/a>, <https://example.com/kg/concept/b>",
    );
  });

  it("emits xsd:integer literals bare", () => {
    const ttl = emitTurtle(sample());
    // dockg:level is the last predicate in the block (https:// sorts after http://)
    expect(ttl).toContain("dockg:level 2 .");
  });

  it("emits typed non-integer literals with a datatype suffix", () => {
    const ttl = emitTurtle([
      {
        s: DOC,
        p: `${NS.dcterms}created`,
        o: lit("2026-05-01", `${NS.xsd}date`),
      },
    ]);
    expect(ttl).toContain(`dcterms:created "2026-05-01"^^xsd:date`);
  });

  it("escapes literals", () => {
    const ttl = emitTurtle([
      {
        s: DOC,
        p: `${NS.dcterms}title`,
        o: lit('He said "hi"\nback\\slash\ttab'),
      },
    ]);
    expect(ttl).toContain('"He said \\"hi\\"\\nback\\\\slash\\ttab"');
  });

  it("is byte-identical regardless of input quad order (shuffle property)", () => {
    const quads = sample();
    const baseline = emitTurtle(quads);
    // deterministic pseudo-shuffles: rotate and reverse
    for (let i = 1; i < quads.length; i++) {
      const rotated = [...quads.slice(i), ...quads.slice(0, i)];
      expect(emitTurtle(rotated)).toBe(baseline);
      expect(emitTurtle([...rotated].reverse())).toBe(baseline);
    }
  });

  it("ends with exactly one trailing newline and uses LF", () => {
    const ttl = emitTurtle(sample());
    expect(ttl.endsWith(".\n")).toBe(true);
    expect(ttl.includes("\r")).toBe(false);
  });

  it("percent-encodes characters illegal in Turtle IRIs so output always parses", () => {
    const ttl = emitTurtle([
      {
        s: DOC,
        p: `${NS.dcterms}references`,
        o: iri('http://example.com/a"b{c}d e|f^g`h\\i<j>k'),
      },
    ]);
    expect(ttl).toContain(
      "<http://example.com/a%22b%7Bc%7Dd%20e%7Cf%5Eg%60h%5Ci%3Cj%3Ek>",
    );
  });

  it("falls back to full IRIs when the local name is not a safe prefixed name", () => {
    const ttl = emitTurtle([
      { s: DOC, p: `${NS.dcterms}title`, o: iri(`${NS.dockg}weird/local`) },
    ]);
    expect(ttl).toContain("<https://hawkeyexl.github.io/dockg/ns#weird/local>");
  });
});
