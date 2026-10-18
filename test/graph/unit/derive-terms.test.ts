/**
 * One concept scheme (proposal 0085 §1): the termbase, the `graph` block and
 * every concept reference feed one `skos:ConceptScheme`, with one node per
 * concept however a page spells it.
 */
import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import { deriveGraph, termConceptCount } from "../../../src/graph/core/derive.js";
import { NS } from "../../../src/graph/core/vocab.js";
import type { Quad, Term } from "../../../src/graph/core/derive.js";
import type { DeriveSource } from "../../../src/graph/core/config.js";
import type { TermLabel } from "../../../src/shared/term-labels.js";

const BASE = "https://example.com/graph/";
const C = (id: string) => `${BASE}concept/${id}`;
const DOC = (path: string) => `${BASE}doc/${path}`;
const SKOS = (local: string) => `${NS.skos}${local}`;
const SCHEME = `${BASE}scheme`;
const ON: DeriveSource[] = ["frontmatter", "tags", "sections", "terms"];

const TERMBASE: TermLabel[] = [
  { label: "Pluggable auth layer", id: "pluggable-auth-layer", altLabels: ["Auth plug-in"] },
  { label: "PAL", id: "pal", see: "Pluggable auth layer" },
  { label: "Access token", id: "token-x", definition: "A bearer credential." },
  {
    label: "Widget",
    id: "widget",
    language: "en",
    definition: "A part.",
    broader: ["Access token"],
    related: ["Gizmo"],
  },
  { label: "Widget-Komponente", id: "widget", language: "DE", hiddenLabels: ["Wiget"] },
  { label: "Bolt", id: "bolt-en", language: "en" },
  { label: "Bolt", id: "bolt-de", language: "de" },
];

function build(
  files: Record<string, string>,
  { derive = ON, termbase = TERMBASE }: { derive?: DeriveSource[]; termbase?: TermLabel[] } = {},
): Quad[] {
  const paths = new Set(Object.keys(files));
  const docs = Object.entries(files).map(([path, content]) => analyzeDoc(content, path, paths));
  return deriveGraph(docs, { baseIri: BASE, derive, termbase });
}

const iri = (value: string): Term => ({ kind: "iri", value });
const lit = (value: string, language?: string): Term =>
  language ? { kind: "literal", value, language } : { kind: "literal", value };

function has(quads: Quad[], s: string, p: string, o: Term): boolean {
  return quads.some((q) => q.s === s && q.p === p && JSON.stringify(q.o) === JSON.stringify(o));
}
const objects = (quads: Quad[], s: string, p: string) =>
  quads.filter((q) => q.s === s && q.p === p).map((q) => q.o);

describe("term concepts", () => {
  it("makes every term a concept in the scheme, one per id, labels tagged by language", () => {
    const quads = build({ "a.md": "# A\n" });
    expect(has(quads, C("widget"), `${NS.rdf}type`, iri(SKOS("Concept")))).toBe(true);
    expect(has(quads, C("widget"), SKOS("inScheme"), iri(SCHEME))).toBe(true);
    const prefLabels = objects(quads, C("widget"), SKOS("prefLabel"));
    expect(prefLabels).toHaveLength(2);
    expect(prefLabels).toContainEqual(lit("Widget", "en"));
    expect(prefLabels).toContainEqual(lit("Widget-Komponente", "de"));
    expect(has(quads, C("widget"), SKOS("definition"), lit("A part.", "en"))).toBe(true);
    expect(has(quads, C("widget"), SKOS("hiddenLabel"), lit("Wiget", "de"))).toBe(true);
    // An untagged term keeps untagged labels.
    expect(has(quads, C("token-x"), SKOS("prefLabel"), lit("Access token"))).toBe(true);
    expect(has(quads, C("token-x"), SKOS("definition"), lit("A bearer credential."))).toBe(true);
  });

  it("does not make a see entry a concept, and gives its label to the target", () => {
    const quads = build({ "a.md": "# A\n" });
    expect(quads.some((q) => q.s === C("pal"))).toBe(false);
    expect(has(quads, C("pluggable-auth-layer"), SKOS("altLabel"), lit("PAL"))).toBe(true);
  });

  it("resolves term relations through the termbase, and mints the rest freeform", () => {
    const quads = build({ "a.md": "# A\n" });
    expect(has(quads, C("widget"), SKOS("broader"), iri(C("token-x")))).toBe(true);
    expect(has(quads, C("token-x"), SKOS("narrower"), iri(C("widget")))).toBe(true);
    expect(has(quads, C("widget"), SKOS("related"), iri(C("gizmo")))).toBe(true);
    expect(has(quads, C("gizmo"), SKOS("related"), iri(C("widget")))).toBe(true);
    expect(has(quads, C("gizmo"), SKOS("prefLabel"), lit("Gizmo"))).toBe(true);
  });

  it("counts one concept per term id, never a see entry", () => {
    expect(termConceptCount(TERMBASE)).toBe(5);
  });
});

describe("one node per concept, however a page spells it", () => {
  it("resolves a reference by label, id and alt-label, case-insensitive, adding no prefLabel", () => {
    const quads = build({
      "a.md": "---\nconcepts: [access TOKEN, token-x, auth plug-in]\n---\n# A\n",
    });
    expect(objects(quads, DOC("a.md"), `${NS.dcterms}subject`)).toEqual([
      iri(C("token-x")),
      iri(C("pluggable-auth-layer")),
    ]);
    expect(objects(quads, C("token-x"), SKOS("prefLabel"))).toEqual([lit("Access token")]);
    expect(quads.some((q) => q.s === C("access-token"))).toBe(false);
  });

  it("follows a see entry to its target", () => {
    const quads = build({ "a.md": "---\nkeywords: [PAL]\n---\n# A\n" });
    expect(has(quads, DOC("a.md"), `${NS.dcterms}subject`, iri(C("pluggable-auth-layer")))).toBe(
      true,
    );
  });

  it("prefers the page's own language, then any", () => {
    const quads = build({
      "de.md": "---\nlang: de\nconcepts: [Bolt]\n---\n# A\n",
      "en.md": "---\nlang: en-us\nconcepts: [Bolt]\n---\n# A\n",
      "fr.md": "---\nlang: fr\nconcepts: [Widget-Komponente]\n---\n# A\n",
    });
    expect(objects(quads, DOC("de.md"), `${NS.dcterms}subject`)).toEqual([iri(C("bolt-de"))]);
    expect(objects(quads, DOC("en.md"), `${NS.dcterms}subject`)).toEqual([iri(C("bolt-en"))]);
    expect(objects(quads, DOC("fr.md"), `${NS.dcterms}subject`)).toEqual([iri(C("widget"))]);
  });

  it("resolves a graph block's label and edges, and emits every edge both ways", () => {
    const quads = build({
      "a.md":
        "---\ngraph:\n  label: OAuth\n  broader: [Access token]\n  narrower: [Refresh]\n  related-concepts: [PAL]\n---\n# A\n",
    });
    expect(has(quads, C("oauth"), SKOS("broader"), iri(C("token-x")))).toBe(true);
    expect(has(quads, C("token-x"), SKOS("narrower"), iri(C("oauth")))).toBe(true);
    expect(has(quads, C("refresh"), SKOS("broader"), iri(C("oauth")))).toBe(true);
    expect(has(quads, C("pluggable-auth-layer"), SKOS("related"), iri(C("oauth")))).toBe(true);
    expect(objects(quads, C("token-x"), SKOS("prefLabel"))).toEqual([lit("Access token")]);
  });

  it("gives a term page its term as primary topic", () => {
    const quads = build({
      "glossary/token.md": "---\ntype: term\nid: token-x\nlabel: Access token\n---\n# T\n",
      "glossary/pal.md": "---\ntype: term\nlabel: Pluggable auth layer\n---\n# P\n",
    });
    expect(has(quads, DOC("glossary/token.md"), `${NS.foaf}primaryTopic`, iri(C("token-x")))).toBe(
      true,
    );
    expect(
      has(quads, DOC("glossary/pal.md"), `${NS.foaf}primaryTopic`, iri(C("pluggable-auth-layer"))),
    ).toBe(true);
  });
});

describe("top concepts", () => {
  it("marks every concept with no broader concept, both ways round", () => {
    const quads = build({ "a.md": "# A\n" });
    expect(has(quads, C("token-x"), SKOS("topConceptOf"), iri(SCHEME))).toBe(true);
    expect(has(quads, SCHEME, SKOS("hasTopConcept"), iri(C("token-x")))).toBe(true);
    expect(has(quads, C("widget"), SKOS("topConceptOf"), iri(SCHEME))).toBe(false);
    expect(has(quads, SCHEME, SKOS("hasTopConcept"), iri(C("widget")))).toBe(false);
  });

  it("applies to freeform concepts too, with no termbase", () => {
    const quads = build(
      { "a.md": "---\ngraph:\n  label: Child\n  broader: [Parent]\n---\n# A\n" },
      { termbase: [] },
    );
    expect(has(quads, C("parent"), SKOS("narrower"), iri(C("child")))).toBe(true);
    expect(has(quads, C("parent"), SKOS("topConceptOf"), iri(SCHEME))).toBe(true);
    expect(has(quads, C("child"), SKOS("topConceptOf"), iri(SCHEME))).toBe(false);
  });
});

describe("without the terms derive source", () => {
  it("ignores the termbase and mints concepts from labels, as before", () => {
    const quads = build(
      { "a.md": "---\nconcepts: [Auth plug-in]\n---\n# A\n" },
      { derive: ["frontmatter", "tags"] },
    );
    expect(objects(quads, DOC("a.md"), `${NS.dcterms}subject`)).toEqual([iri(C("auth-plug-in"))]);
    expect(quads.some((q) => q.s === C("widget"))).toBe(false);
  });
});
