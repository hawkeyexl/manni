import { describe, expect, it } from "vitest";
import { GraphIndex } from "../../../src/kg/runtime/graph.js";
import {
  impact,
  resolveVariant,
  reverseReferences,
  scopeExclusion,
  traverse,
} from "../../../src/kg/runtime/traverse.js";
import { createTrace, reachedNodes } from "../../../src/kg/runtime/trace.js";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";
import {
  DOCKG_NOT_APPLICABLE_TO_VARIANT,
  IIRDS_RELATES_TO_PRODUCT_VARIANT,
} from "../../../src/kg/core/iirds.js";

const BASE = "https://ex.com/kg/";
const A = `${BASE}doc/a.md`;
const B = `${BASE}doc/b.md`;
const C = `${BASE}doc/c.md`;
const X100 = `${BASE}product/sp-x100`;
const X300 = `${BASE}product/sp-x300`;
const REFERENCES = `${NS.dcterms}references`;

/**
 * a → b → c over dcterms:references.
 * a: applies to X100. b: explicitly NOT applicable to X100. c: no scope claim.
 */
function fixture(): GraphIndex {
  return GraphIndex.fromQuads([
    { s: A, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
    { s: A, p: REFERENCES, o: { kind: "iri", value: B } },
    {
      s: A,
      p: IIRDS_RELATES_TO_PRODUCT_VARIANT,
      o: { kind: "iri", value: X100 },
    },
    { s: B, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
    { s: B, p: REFERENCES, o: { kind: "iri", value: C } },
    {
      s: B,
      p: DOCKG_NOT_APPLICABLE_TO_VARIANT,
      o: { kind: "iri", value: X100 },
    },
    { s: C, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
    {
      s: X100,
      p: RDF_TYPE,
      o: { kind: "iri", value: `${NS.iirds}ProductVariant` },
    },
    {
      s: X100,
      p: `${NS.dcterms}title`,
      o: { kind: "literal", value: "SP-X100" },
    },
    {
      s: X300,
      p: RDF_TYPE,
      o: { kind: "iri", value: `${NS.iirds}ProductVariant` },
    },
    {
      s: X300,
      p: `${NS.dcterms}title`,
      o: { kind: "literal", value: "SP-X300" },
    },
  ]);
}

describe("traverse", () => {
  it("walks outbound edges breadth-first with depth bounds", () => {
    const g = fixture();
    // Predicate IRIs sort iirds: < dcterms:, so X100 precedes B.
    const one = traverse(g, { seeds: [A], depth: 1 });
    expect(one.nodes.map((n) => n.iri)).toEqual([A, X100, B]);
    const two = traverse(g, { seeds: [A], depth: 2, predicates: [REFERENCES] });
    expect(two.nodes).toEqual([
      { iri: A, depth: 0 },
      { iri: B, depth: 1 },
      { iri: C, depth: 2 },
    ]);
  });

  it("does not follow rdf:type into class nodes by default", () => {
    const g = fixture();
    const r = traverse(g, { seeds: [A], depth: 2 });
    // Without this guard every document would be two hops from every other
    // via the shared dockg:Document class node — edge contamination.
    expect(r.nodes.map((n) => n.iri)).not.toContain(`${NS.dockg}Document`);
    expect(r.trace.hops.some((h) => h.predicate === RDF_TYPE)).toBe(false);
  });

  it("follows rdf:type when explicitly asked to", () => {
    const g = fixture();
    const r = traverse(g, { seeds: [A], depth: 1, includeTypeEdges: true });
    expect(r.nodes.map((n) => n.iri)).toContain(`${NS.dockg}Document`);
  });

  it("restricts to the requested predicates", () => {
    const g = fixture();
    const r = traverse(g, { seeds: [A], depth: 1, predicates: [REFERENCES] });
    expect(r.nodes.map((n) => n.iri)).toEqual([A, B]);
  });

  it("honors a node limit", () => {
    const g = fixture();
    const r = traverse(g, {
      seeds: [A],
      depth: 3,
      predicates: [REFERENCES],
      limit: 2,
    });
    expect(r.nodes).toHaveLength(2);
  });

  it("is deterministic across repeated runs and seed orderings", () => {
    const g = fixture();
    const a = traverse(g, { seeds: [A, C], depth: 2 });
    const b = traverse(g, { seeds: [C, A], depth: 2 });
    expect(b.nodes).toEqual(a.nodes);
    expect(b.trace.hops).toEqual(a.trace.hops);
  });

  it("ignores seeds that are not in the graph", () => {
    const g = fixture();
    const r = traverse(g, { seeds: [`${BASE}nope`], depth: 1 });
    expect(r.nodes).toEqual([]);
  });
});

describe("scope filtering", () => {
  it("excludes a node whose explicit negative names the variant", () => {
    const g = fixture();
    const r = traverse(g, {
      seeds: [A],
      depth: 2,
      predicates: [REFERENCES],
      variant: "SP-X100",
    });
    expect(r.nodes.map((n) => n.iri)).toEqual([A]);
    expect(r.trace.exclusions).toEqual([
      { node: B, rule: DOCKG_NOT_APPLICABLE_TO_VARIANT, value: X100 },
    ]);
  });

  it("excludes a node that scoped itself to other variants", () => {
    const g = fixture();
    // A declares X100 only, so under an X300 filter it is out of scope —
    // recorded under the positive predicate, not the negative one.
    const exclusion = scopeExclusion(g, A, { variantIri: X300 });
    expect(exclusion).toEqual({
      node: A,
      rule: IIRDS_RELATES_TO_PRODUCT_VARIANT,
      value: X300,
    });
  });

  it("keeps a node that makes no scope claim at all", () => {
    const g = fixture();
    expect(scopeExclusion(g, C, { variantIri: X100 })).toBeUndefined();
    expect(scopeExclusion(g, C, { variantIri: X300 })).toBeUndefined();
  });

  it("keeps everything when no scope filter is given", () => {
    const g = fixture();
    const r = traverse(g, { seeds: [A], depth: 2, predicates: [REFERENCES] });
    expect(r.nodes.map((n) => n.iri)).toEqual([A, B, C]);
    expect(r.trace.exclusions).toEqual([]);
  });

  it("resolves a variant by title, by slug, and by IRI", () => {
    const g = fixture();
    expect(resolveVariant(g, "SP-X100")).toBe(X100);
    expect(resolveVariant(g, "sp-x100")).toBe(X100);
    expect(resolveVariant(g, X100)).toBe(X100);
    expect(resolveVariant(g, "nope")).toBeUndefined();
  });
});

describe("reverseReferences and impact", () => {
  it("finds who links to a node", () => {
    const g = fixture();
    const r = reverseReferences(g, B);
    expect(r.nodes.map((n) => n.iri)).toEqual([B, A]);
  });

  it("reports transitive inbound reach, excluding the node itself", () => {
    const g = fixture();
    const r = impact(g, C, { predicates: [REFERENCES] });
    expect(r.nodes.map((n) => n.iri)).toEqual([B, A]);
  });

  it("counts `limit` in affected nodes, not including the dropped seed", () => {
    const g = fixture();
    // Two nodes reach C transitively; asking for 1 must yield exactly 1, not 0
    // (the seed used to consume a slot before being filtered out).
    expect(impact(g, C, { predicates: [REFERENCES], limit: 1 }).nodes).toEqual([
      { iri: B, depth: 1 },
    ]);
    expect(
      impact(g, C, { predicates: [REFERENCES], limit: 2 }).nodes.map(
        (n) => n.iri,
      ),
    ).toEqual([B, A]);
  });
});

describe("trace completeness (the explainability contract)", () => {
  it("reaches every returned node through recorded entry or hop events", () => {
    const g = fixture();
    const r = traverse(g, { seeds: [A], depth: 2 });
    const reached = reachedNodes(r.trace);
    for (const node of r.nodes) expect(reached.has(node.iri)).toBe(true);
  });

  it("keeps a seed's existing provenance instead of re-recording it", () => {
    // The documented `findEntry` → `traverse` composition shares one trace.
    // Re-recording the seed as explicit/1 would answer "why did retrieval start
    // here?" twice, with the search score contradicted by a flat 1.
    const g = fixture();
    const trace = createTrace();
    trace.entry.push({ iri: A, score: 0.75, via: "lexical" });
    traverse(g, { seeds: [A], depth: 1, trace });
    expect(trace.entry).toEqual([{ iri: A, score: 0.75, via: "lexical" }]);
  });

  it("still records a seed no earlier stage seeded", () => {
    const g = fixture();
    const r = traverse(g, { seeds: [A], depth: 1 });
    expect(r.trace.entry).toEqual([{ iri: A, score: 1, via: "explicit" }]);
  });

  it("records an exclusion for every node filtered out of the results", () => {
    const g = fixture();
    const r = traverse(g, {
      seeds: [A],
      depth: 2,
      predicates: [REFERENCES],
      variant: "SP-X100",
    });
    const returned = new Set(r.nodes.map((n) => n.iri));
    const excluded = new Set(r.trace.exclusions.map((e) => e.node));
    // B was walked (a hop exists) but is absent from results — so it must have
    // an exclusion explaining why.
    const walked = new Set(r.trace.hops.map((h) => h.to));
    for (const iri of walked) {
      if (!returned.has(iri)) expect(excluded.has(iri)).toBe(true);
    }
    expect(excluded.has(B)).toBe(true);
  });

  it("records the hop even when the target is then excluded", () => {
    const g = fixture();
    const r = traverse(g, {
      seeds: [A],
      depth: 1,
      predicates: [REFERENCES],
      variant: "SP-X100",
    });
    expect(r.trace.hops).toEqual([
      { from: A, predicate: REFERENCES, to: B, depth: 1, direction: "out" },
    ]);
  });
});

/**
 * Language as a scope dimension (ADR 01037).
 *
 * Same table as variants and subjects, one difference: the value is a literal
 * and there is no negative predicate, because a document has one language and
 * "not in German" is not a claim anybody makes.
 */
describe("scope filtering by language", () => {
  const DE = `${BASE}doc/de.md`;
  const EN = `${BASE}doc/en.md`;
  const NONE = `${BASE}doc/none.md`;
  const LANGUAGE = `${NS.dcterms}language`;

  const localized = (): GraphIndex =>
    GraphIndex.fromQuads([
      { s: DE, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
      { s: DE, p: LANGUAGE, o: { kind: "literal", value: "de" } },
      { s: DE, p: REFERENCES, o: { kind: "iri", value: EN } },
      { s: EN, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
      { s: EN, p: LANGUAGE, o: { kind: "literal", value: "en" } },
      { s: EN, p: REFERENCES, o: { kind: "iri", value: NONE } },
      {
        s: NONE,
        p: RDF_TYPE,
        o: { kind: "iri", value: `${NS.dockg}Document` },
      },
    ]);

  it("keeps a node in the requested language", () => {
    expect(scopeExclusion(localized(), DE, { language: "de" })).toBeUndefined();
  });

  it("excludes a node that declares a different language", () => {
    const hit = scopeExclusion(localized(), EN, { language: "de" });
    expect(hit).toEqual({ node: EN, rule: LANGUAGE, value: "de" });
  });

  it("keeps a node that declares no language at all", () => {
    // Consistent with variants: an unscoped node applies broadly, and absence
    // means unknown rather than excluded (ADR 01014).
    expect(
      scopeExclusion(localized(), NONE, { language: "de" }),
    ).toBeUndefined();
  });

  it("matches the tag exactly — de-AT is not de", () => {
    const graph = GraphIndex.fromQuads([
      { s: DE, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
      { s: DE, p: LANGUAGE, o: { kind: "literal", value: "de-AT" } },
    ]);
    expect(scopeExclusion(graph, DE, { language: "de" })?.rule).toBe(LANGUAGE);
  });

  it("stops a traversal at the language boundary, and records why", () => {
    const result = traverse(localized(), {
      seeds: [DE],
      depth: 3,
      language: "de",
    });
    expect(result.nodes.map((n) => n.iri)).toEqual([DE]);
    expect(result.trace.exclusions).toContainEqual({
      node: EN,
      rule: LANGUAGE,
      value: "de",
    });
  });

  it("composes with a variant filter rather than replacing it", () => {
    const graph = GraphIndex.fromQuads([
      { s: A, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
      { s: A, p: LANGUAGE, o: { kind: "literal", value: "de" } },
      {
        s: A,
        p: IIRDS_RELATES_TO_PRODUCT_VARIANT,
        o: { kind: "iri", value: X300 },
      },
    ]);
    // Right language, wrong variant: still excluded, and the trace names the
    // variant predicate rather than the language one.
    const hit = scopeExclusion(graph, A, {
      language: "de",
      variantIri: X100,
    });
    expect(hit?.rule).toBe(IIRDS_RELATES_TO_PRODUCT_VARIANT);
  });
});

/**
 * A section takes its document's language (review fix). Applicability stays
 * explicit-only per ADR 01013 — the two rules differ on purpose.
 */
describe("scope filtering — sections inherit language, not applicability", () => {
  const EN = `${BASE}doc/en.md`;
  const EN_SECTION = `${EN}#setup`;
  const LANGUAGE = `${NS.dcterms}language`;

  const graph = (): GraphIndex =>
    GraphIndex.fromQuads([
      { s: EN, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
      { s: EN, p: LANGUAGE, o: { kind: "literal", value: "en" } },
      {
        s: EN_SECTION,
        p: RDF_TYPE,
        o: { kind: "iri", value: `${NS.dockg}Section` },
      },
      {
        s: EN,
        p: IIRDS_RELATES_TO_PRODUCT_VARIANT,
        o: { kind: "iri", value: X100 },
      },
    ]);

  it("excludes an English section under --lang de", () => {
    // Reachable directly: derive mints a section IRI as a dcterms:references
    // target when a link's anchor resolves, so a German page linking
    // `en.md#setup` reaches this node without passing through its document.
    const hit = scopeExclusion(graph(), EN_SECTION, { language: "de" });
    expect(hit).toEqual({ node: EN_SECTION, rule: LANGUAGE, value: "de" });
  });

  it("keeps that section under --lang en", () => {
    expect(
      scopeExclusion(graph(), EN_SECTION, { language: "en" }),
    ).toBeUndefined();
  });

  it("does not inherit the document's variant", () => {
    // ADR 01013: a section gets exactly what its own block declares. The
    // document applies to X100; the section claims nothing and so applies
    // broadly, including to X300.
    expect(
      scopeExclusion(graph(), EN_SECTION, { variantIri: X300 }),
    ).toBeUndefined();
  });
});

/**
 * A seed always expands, even when the scope filter excludes it (review fix).
 *
 * The canonical localization query has exactly this shape — from an English
 * page, "what German content does a change here affect?" — and gating the seed
 * made it return nothing, because the seed excluded itself before the frontier
 * was ever populated.
 */
describe("scope filtering — the seed is a starting point, not a result", () => {
  const EN = `${BASE}doc/en.md`;
  const DE = `${BASE}doc/de.md`;
  const LANGUAGE = `${NS.dcterms}language`;
  const WORK_TRANSLATION = `${NS.schema}workTranslation`;

  const graph = (): GraphIndex =>
    GraphIndex.fromQuads([
      { s: EN, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
      { s: EN, p: LANGUAGE, o: { kind: "literal", value: "en" } },
      { s: EN, p: WORK_TRANSLATION, o: { kind: "iri", value: DE } },
      { s: DE, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
      { s: DE, p: LANGUAGE, o: { kind: "literal", value: "de" } },
    ]);

  it("reaches a differently-languaged translation from a labeled source", () => {
    const result = traverse(graph(), {
      seeds: [EN],
      depth: 2,
      predicates: [WORK_TRANSLATION],
      language: "de",
    });
    expect(result.nodes.map((n) => n.iri)).toEqual([DE]);
  });

  it("keeps the excluded seed out of the results, and names it in the trace", () => {
    const result = traverse(graph(), {
      seeds: [EN],
      depth: 2,
      predicates: [WORK_TRANSLATION],
      language: "de",
    });
    expect(result.nodes.map((n) => n.iri)).not.toContain(EN);
    expect(result.trace.exclusions).toContainEqual({
      node: EN,
      rule: LANGUAGE,
      value: "de",
    });
  });

  it("does the same through impact()", () => {
    // impact() drops the seed from its results anyway, so the observable
    // failure was simply an empty answer.
    const result = impact(graph(), DE, {
      predicates: [WORK_TRANSLATION],
      language: "de",
    });
    expect(result.nodes.map((n) => n.iri)).toEqual([EN].filter(() => false));
    const reverse = impact(graph(), DE, { predicates: [WORK_TRANSLATION] });
    expect(reverse.nodes.map((n) => n.iri)).toEqual([EN]);
  });

  it("still returns a seed the filter accepts", () => {
    const result = traverse(graph(), {
      seeds: [EN],
      depth: 1,
      predicates: [WORK_TRANSLATION],
      language: "en",
    });
    expect(result.nodes.map((n) => n.iri)).toContain(EN);
  });
});

/**
 * `impact()` compensates for the seed occupying a slot in the walker's limit.
 * Since the seed-gating fix it may not occupy one, so the slack has to be
 * trimmed rather than assumed spent (review finding).
 */
describe("impact — limit means affected nodes, seed excluded or not", () => {
  const EN = `${BASE}doc/en.md`;
  const TRANSLATIONS = ["de1", "de2", "de3"].map((s) => `${BASE}doc/${s}.md`);
  const LANGUAGE = `${NS.dcterms}language`;
  const TRANSLATION_OF = `${NS.schema}translationOfWork`;

  const graph = (): GraphIndex =>
    GraphIndex.fromQuads([
      { s: EN, p: RDF_TYPE, o: { kind: "iri", value: `${NS.dockg}Document` } },
      { s: EN, p: LANGUAGE, o: { kind: "literal", value: "en" } },
      ...TRANSLATIONS.flatMap((t) => [
        {
          s: t,
          p: RDF_TYPE,
          o: { kind: "iri" as const, value: `${NS.dockg}Document` },
        },
        { s: t, p: LANGUAGE, o: { kind: "literal" as const, value: "de" } },
        { s: t, p: TRANSLATION_OF, o: { kind: "iri" as const, value: EN } },
      ]),
    ]);

  it("honors the limit when the filter excludes the seed", () => {
    // The seed is `en`, the filter is `de`, so the seed never lands in `nodes`
    // and the +1 slack goes unspent — three came back for a limit of two.
    const result = impact(graph(), EN, {
      predicates: [TRANSLATION_OF],
      language: "de",
      limit: 2,
    });
    expect(result.nodes).toHaveLength(2);
  });

  it("honors the limit when the seed passes the filter", () => {
    const result = impact(graph(), EN, {
      predicates: [TRANSLATION_OF],
      limit: 2,
    });
    expect(result.nodes).toHaveLength(2);
  });

  it("returns everything affected when no limit is given", () => {
    const result = impact(graph(), EN, {
      predicates: [TRANSLATION_OF],
      language: "de",
    });
    expect(result.nodes.map((n) => n.iri).sort()).toEqual(
      [...TRANSLATIONS].sort(),
    );
  });
});
