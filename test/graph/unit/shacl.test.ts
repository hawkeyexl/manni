import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DataFactory, Store } from "n3";
import { validateGraph } from "../../../src/graph/core/shacl.js";
import { bundledShapesPath } from "../../../src/graph/core/pkg.js";
import { NS, RDF_TYPE } from "../../../src/graph/core/vocab.js";

const BASE = "https://example.com/graph/";
const SHAPES = [bundledShapesPath(import.meta.url)];

const doc = (path: string) => `${BASE}doc/${path}`;
const concept = (slug: string) => `${BASE}concept/${slug}`;
const SCHEME = `${BASE}scheme`;
/** A syntactically valid sha256: 64 lowercase hex characters. */
const HASH = "a".repeat(64);

/** Store builder: [s, p, o] with strings; o starting with "http" is an IRI. */
function build(
  triples: Array<[string, string, string | { lit: string; dt?: string; lang?: string }]>,
): Store {
  const store = new Store();
  for (const [s, p, o] of triples) {
    store.addQuad(
      DataFactory.quad(
        DataFactory.namedNode(s),
        DataFactory.namedNode(p),
        typeof o === "string"
          ? DataFactory.namedNode(o)
          : DataFactory.literal(
              o.lit,
              o.lang ?? (o.dt ? DataFactory.namedNode(o.dt) : undefined),
            ),
      ),
    );
  }
  return store;
}

/** A minimal conforming graph: one doc, one typed concept, the scheme. */
function conformingTriples(): Array<
  [string, string, string | { lit: string }]
> {
  const d = doc("docs/a.md");
  const c = concept("setup");
  return [
    [d, RDF_TYPE, `${NS.graph}Document`],
    [d, `${NS.graph}path`, { lit: "docs/a.md" }],
    // Required since shapes 0.7 (ADR 01036). Any well-formed digest will do —
    // these tests are about the shapes, not about hashing.
    [d, `${NS.graph}contentHash`, { lit: HASH }],
    [d, `${NS.dcterms}title`, { lit: "A" }],
    [d, `${NS.dcterms}subject`, c],
    [c, RDF_TYPE, `${NS.skos}Concept`],
    [c, `${NS.skos}prefLabel`, { lit: "setup" }],
    [c, `${NS.skos}inScheme`, SCHEME],
    [SCHEME, RDF_TYPE, `${NS.skos}ConceptScheme`],
    [SCHEME, `${NS.dcterms}title`, { lit: "dockg concepts" }],
  ];
}

/** Type + label + scheme membership for a concept in one call. */
function conceptTriples(
  slug: string,
  label = slug,
): Array<[string, string, string | { lit: string }]> {
  const c = concept(slug);
  return [
    [c, RDF_TYPE, `${NS.skos}Concept`],
    [c, `${NS.skos}prefLabel`, { lit: label }],
    [c, `${NS.skos}inScheme`, SCHEME],
  ];
}

describe("validateGraph", () => {
  it("returns no findings for a conforming graph", async () => {
    const findings = await validateGraph(build(conformingTriples()), SHAPES);
    expect(findings).toEqual([]);
  });

  it("is deterministic across runs", async () => {
    const store = build([
      ...conformingTriples(),
      ...conceptTriples("orphaned"),
      [concept("orphaned"), `${NS.skos}broader`, concept("orphaned")],
      [concept("untyped-target"), `${NS.skos}prefLabel`, { lit: "x" }],
    ]);
    const a = await validateGraph(store, SHAPES);
    const b = await validateGraph(store, SHAPES);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("flags a concept missing skos:inScheme, blaming the referencing doc", async () => {
    const c = concept("loose");
    const store = build([
      ...conformingTriples(),
      [doc("docs/a.md"), `${NS.dcterms}subject`, c],
      [c, RDF_TYPE, `${NS.skos}Concept`],
      [c, `${NS.skos}prefLabel`, { lit: "loose" }],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === c && f.path === `${NS.skos}inScheme`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    // SHACL's own word survives beside the family's, as a11y keeps axe's
    // `impact` (proposal 0035, stress test 10).
    expect(hit?.shaclSeverity).toBe("violation");
    expect(hit?.docs).toEqual(["docs/a.md"]);
  });

  it("flags a concept missing skos:prefLabel", async () => {
    const c = concept("nameless");
    const store = build([
      ...conformingTriples(),
      [c, RDF_TYPE, `${NS.skos}Concept`],
      [c, `${NS.skos}inScheme`, SCHEME],
    ]);
    const findings = await validateGraph(store, SHAPES);
    expect(
      findings.some(
        (f) =>
          f.focusNode === c &&
          f.path === `${NS.skos}prefLabel` &&
          f.severity === "error",
      ),
    ).toBe(true);
  });

  it("warns (not fails) on skos:prefLabel collisions from slug convergence", async () => {
    const c = concept("configuration");
    const store = build([
      ...conformingTriples(),
      ...conceptTriples("configuration", "Configuration"),
      [c, `${NS.skos}prefLabel`, { lit: "configuration" }],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === c && f.path === `${NS.skos}prefLabel`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("warning");
    expect(hit?.shaclSeverity).toBe("warning");
    expect(hit?.message).toBe(
      'Pages spell this concept two ways: "Configuration" and "configuration". Use one spelling on every page that names it.',
    );
    expect(findings.filter((f) => f.focusNode === c)).toHaveLength(1);
  });

  it("admits one prefLabel per language, and warns on two in one language", async () => {
    const c = concept("widget");
    const label = (
      lit: string,
      lang: string,
    ): [string, string, { lit: string; lang: string }] => [
      c,
      `${NS.skos}prefLabel`,
      { lit, lang },
    ];
    const typed: Array<[string, string, string]> = [
      [c, RDF_TYPE, `${NS.skos}Concept`],
      [c, `${NS.skos}inScheme`, SCHEME],
    ];
    const ok = await validateGraph(
      build([
        ...conformingTriples(),
        ...typed,
        label("Widget", "en"),
        label("Widget-Komponente", "de"),
      ]),
      SHAPES,
    );
    expect(ok.filter((f) => f.focusNode === c)).toEqual([]);
    const twice = await validateGraph(
      build([
        ...conformingTriples(),
        ...typed,
        label("Widget", "en"),
        label("Gadget", "en"),
      ]),
      SHAPES,
    );
    const hit = twice.find((f) => f.focusNode === c);
    expect(hit?.severity).toBe("warning");
    expect(hit?.path).toBe(`${NS.skos}prefLabel`);
  });

  it("admits a term concept's notes and the top concepts, both ways round", async () => {
    const c = concept("setup");
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        [c, `${NS.skos}definition`, { lit: "Getting started.", lang: "en" }],
        [c, `${NS.skos}scopeNote`, { lit: "Install only." }],
        [c, `${NS.skos}hiddenLabel`, { lit: "stup" }],
        [c, `${NS.skos}topConceptOf`, SCHEME],
        [SCHEME, `${NS.skos}hasTopConcept`, c],
      ]),
      SHAPES,
    );
    expect(findings).toEqual([]);
  });

  it("admits a concept's notation and its mappings to other vocabularies", async () => {
    const c = concept("setup");
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        [c, `${NS.skos}notation`, { lit: "S-1" }],
        [c, `${NS.skos}exactMatch`, "https://www.wikidata.org/wiki/Q1"],
        [c, `${NS.skos}closeMatch`, "https://e.org/close"],
        [c, `${NS.skos}broadMatch`, "https://e.org/broad"],
        [c, `${NS.skos}narrowMatch`, "https://e.org/narrow"],
        [c, `${NS.skos}relatedMatch`, "https://e.org/related"],
      ]),
      SHAPES,
    );
    expect(findings).toEqual([]);
  });

  it("rejects a mapping whose object is a literal", async () => {
    const c = concept("setup");
    const findings = await validateGraph(
      build([...conformingTriples(), [c, `${NS.skos}closeMatch`, { lit: "https://e.org/close" }]]),
      SHAPES,
    );
    expect(findings.map((f) => [f.severity, f.path])).toEqual([["error", `${NS.skos}closeMatch`]]);
  });

  it("flags a mapping that points into this scheme, naming the concept", async () => {
    const c = concept("setup");
    const other = concept("install");
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        [other, RDF_TYPE, `${NS.skos}Concept`],
        [other, `${NS.skos}prefLabel`, { lit: "install" }],
        [other, `${NS.skos}inScheme`, SCHEME],
        [c, `${NS.skos}exactMatch`, other],
        [c, `${NS.skos}relatedMatch`, "https://e.org/related"],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => [f.severity, f.focusNode, f.path, f.message])).toEqual([
      [
        "error",
        c,
        `${NS.skos}exactMatch`,
        '`exact-matches` names "install", a concept in this glossary. Use `broader`, `narrower` or `related-terms` for it instead.',
      ],
    ]);
  });

  it("leaves a mapping to a concept of another scheme alone", async () => {
    const c = concept("setup");
    const outside = "https://e.org/vocab/install";
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        [outside, RDF_TYPE, `${NS.skos}Concept`],
        [outside, `${NS.skos}prefLabel`, { lit: "install" }],
        [outside, `${NS.skos}inScheme`, "https://e.org/vocab"],
        [c, `${NS.skos}exactMatch`, outside],
      ]),
      SHAPES,
    );
    expect(findings.filter((f) => f.path === `${NS.skos}exactMatch`)).toEqual([]);
  });

  it("closed Document shape rejects unexpected predicates", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      [d, `${NS.graph}surprise`, { lit: "?" }],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === d && f.path === `${NS.graph}surprise`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.docs).toEqual(["docs/a.md"]);
  });

  it("accepts a published iiRDS topic type and a ProductVariant node", async () => {
    const d = doc("docs/a.md");
    const v = `${BASE}product/sp-x200`;
    const store = build([
      ...conformingTriples(),
      [d, `${NS.iirds}has-topic-type`, `${NS.iirds}GenericTask`],
      [d, `${NS.iirds}relates-to-product-variant`, v],
      [v, RDF_TYPE, `${NS.iirds}ProductVariant`],
      [v, `${NS.dcterms}title`, { lit: "SP-X200" }],
      [d, `${NS.iirds}has-subject`, `${NS.iirdsSft}Interface`],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
  });

  it("rejects a topic-type IRI outside the published set (sh:in)", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      // Not one of the six iirds:Generic* instances.
      [d, `${NS.iirds}has-topic-type`, `${NS.iirds}GenericNonsense`],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === d && f.path === `${NS.iirds}has-topic-type`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.docs).toEqual(["docs/a.md"]);
  });

  it("accepts a section carrying iiRDS typing (ADR 01013)", async () => {
    const s = `${doc("docs/a.md")}#install`;
    const v = `${BASE}product/sp-x200`;
    const store = build([
      ...conformingTriples(),
      [s, RDF_TYPE, `${NS.graph}Section`],
      [s, `${NS.dcterms}title`, { lit: "Install" }],
      [s, `${NS.graph}level`, { lit: "2", dt: `${NS.xsd}integer` }],
      [s, `${NS.graph}order`, { lit: "1", dt: `${NS.xsd}integer` }],
      [s, `${NS.iirds}has-topic-type`, `${NS.iirds}GenericReference`],
      [s, `${NS.iirds}relates-to-product-variant`, v],
      [v, RDF_TYPE, `${NS.iirds}ProductVariant`],
      [v, `${NS.dcterms}title`, { lit: "SP-X200" }],
      [s, `${NS.iirds}has-subject`, `${NS.iirdsSft}Interface`],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
  });

  it("rejects an out-of-set section topic type (Section sh:in)", async () => {
    const s = `${doc("docs/a.md")}#install`;
    const store = build([
      ...conformingTriples(),
      [s, RDF_TYPE, `${NS.graph}Section`],
      [s, `${NS.dcterms}title`, { lit: "Install" }],
      [s, `${NS.graph}level`, { lit: "2", dt: `${NS.xsd}integer` }],
      [s, `${NS.graph}order`, { lit: "1", dt: `${NS.xsd}integer` }],
      [s, `${NS.iirds}has-topic-type`, `${NS.iirds}GenericNonsense`],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === s && f.path === `${NS.iirds}has-topic-type`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
  });

  it("accepts graph:brokenSectionRef on a document", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      [d, `${NS.graph}brokenSectionRef`, { lit: "missing-heading" }],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
  });

  it("accepts negative scope disjoint from positive scope (ADR 01014)", async () => {
    const d = doc("docs/a.md");
    const v = `${BASE}product/sp-x300`;
    const store = build([
      ...conformingTriples(),
      [d, `${NS.graph}notApplicableToVariant`, v],
      [v, RDF_TYPE, `${NS.iirds}ProductVariant`],
      [v, `${NS.dcterms}title`, { lit: "SP-X300" }],
      [d, `${NS.graph}notSoftwareSubject`, `${NS.iirdsSft}Architecture`],
      // A different subject on the positive side — no conflict.
      [d, `${NS.iirds}has-subject`, `${NS.iirdsSft}Interface`],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
  });

  it("rejects a variant asserted as both applicable and not-applicable (sh:disjoint)", async () => {
    const d = doc("docs/a.md");
    const v = `${BASE}product/sp-x1`;
    const store = build([
      ...conformingTriples(),
      [d, `${NS.iirds}relates-to-product-variant`, v],
      [d, `${NS.graph}notApplicableToVariant`, v],
      [v, RDF_TYPE, `${NS.iirds}ProductVariant`],
      [v, `${NS.dcterms}title`, { lit: "SP-X1" }],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) =>
        f.focusNode === d && f.path === `${NS.graph}notApplicableToVariant`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.docs).toEqual(["docs/a.md"]);
  });

  it("rejects a subject asserted as both about and not-about (sh:disjoint)", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      [d, `${NS.iirds}has-subject`, `${NS.iirdsSft}Interface`],
      [d, `${NS.graph}notSoftwareSubject`, `${NS.iirdsSft}Interface`],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === d && f.path === `${NS.graph}notSoftwareSubject`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
  });

  it("accepts a reified fill-field entry with confidence (ADR 01015)", async () => {
    const activity = `${BASE}doc/docs/a.md#prov.graph-fill.m1`;
    const entry = `${activity}.field.label`;
    const store = build([
      ...conformingTriples(),
      [activity, RDF_TYPE, `${NS.prov}Activity`],
      [activity, `${NS.prov}wasAssociatedWith`, `${BASE}agent/software/m1`],
      [activity, `${NS.graph}filledFieldEntry`, entry],
      [entry, `${NS.graph}filledField`, { lit: "label" }],
      [entry, `${NS.graph}confidence`, { lit: "0.9", dt: `${NS.xsd}decimal` }],
      [`${BASE}agent/software/m1`, RDF_TYPE, `${NS.prov}SoftwareAgent`],
      [`${BASE}agent/software/m1`, `${NS.foaf}name`, { lit: "m1" }],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
  });

  /** A fill activity attributing `field` on docs/a.md to model `m1`. */
  function filled(field: string): Array<[string, string, string | { lit: string }]> {
    const activity = `${BASE}doc/docs/a.md#prov.graph-fill.m1`;
    const entry = `${activity}.field.${field}`;
    return [
      [activity, RDF_TYPE, `${NS.prov}Activity`],
      [activity, `${NS.prov}wasAssociatedWith`, `${BASE}agent/software/m1`],
      [activity, `${NS.graph}filledFieldEntry`, entry],
      [entry, `${NS.graph}filledField`, { lit: field }],
      [`${BASE}agent/software/m1`, RDF_TYPE, `${NS.prov}SoftwareAgent`],
      [`${BASE}agent/software/m1`, `${NS.foaf}name`, { lit: "m1" }],
    ];
  }

  // Proposal 0046 stress test 13: `kg.provenance` enumerated the twelve
  // fillable fields, which kept these three out. A free JSON Pointer cannot,
  // so the guard lives here now.
  for (const field of ["sections", "revision-of", "derived-from"]) {
    it(`flags a machine attribution on the hand-curated ${field}`, async () => {
      const store = build([...conformingTriples(), ...filled(field)]);
      const findings = await validateGraph(store, SHAPES);
      const curated = findings.filter((f) => f.path === `${NS.graph}filledField`);
      expect(curated).toHaveLength(1);
      expect(curated[0]?.severity).toBe("error");
      expect(curated[0]?.path).toBe(`${NS.graph}filledField`);
      expect(curated[0]?.focusNode).toBe(
        `${BASE}doc/docs/a.md#prov.graph-fill.m1`,
      );
      expect(curated[0]?.docs).toEqual(["docs/a.md"]);
      expect(curated[0]?.message).toBe(
        `\`meta-provenance\` credits m1 with /graph/${field}, a field only a person writes. Check the value, then delete that entry.`,
      );
    });
  }

  it("leaves a machine attribution on a fillable field alone", async () => {
    const store = build([...conformingTriples(), ...filled("label")]);
    const findings = await validateGraph(store, SHAPES);
    expect(findings.filter((f) => f.path === `${NS.graph}filledField`)).toEqual([]);
  });

  it("detects a two-node skos:broader cycle", async () => {
    const store = build([
      ...conformingTriples(),
      ...conceptTriples("a"),
      ...conceptTriples("b"),
      [concept("a"), `${NS.skos}broader`, concept("b")],
      [concept("b"), `${NS.skos}broader`, concept("a")],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find((f) => f.message.includes("cycle"));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.focusNode).toBe(concept("a"));
    expect(hit?.message).toBe(
      '"a" and "b" form a broader cycle, so each is its own ancestor. Remove one `broader` or `narrower` value on the cycle.',
    );
  });

  it("detects a self-loop and a narrower-implied cycle", async () => {
    const store = build([
      ...conformingTriples(),
      ...conceptTriples("self"),
      [concept("self"), `${NS.skos}broader`, concept("self")],
      ...conceptTriples("x"),
      ...conceptTriples("y"),
      // x broader y AND x narrower y (⇒ y broader x) — a two-edge cycle.
      [concept("x"), `${NS.skos}broader`, concept("y")],
      [concept("x"), `${NS.skos}narrower`, concept("y")],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const cycles = findings.filter((f) => f.message.includes("cycle"));
    expect(cycles.some((f) => f.focusNode === concept("self"))).toBe(true);
    expect(cycles.some((f) => f.focusNode === concept("x"))).toBe(true);
  });

  it("flags skos:related conflicting with one-hop skos:broader", async () => {
    const store = build([
      ...conformingTriples(),
      ...conceptTriples("a"),
      ...conceptTriples("b"),
      [concept("a"), `${NS.skos}broader`, concept("b")],
      [concept("a"), `${NS.skos}related`, concept("b")],
    ]);
    const findings = await validateGraph(store, SHAPES);
    expect(
      findings.some(
        (f) => f.focusNode === concept("a") && f.severity === "error",
      ),
    ).toBe(true);
  });

  it("flags skos:related conflicting with transitive skos:broader", async () => {
    const store = build([
      ...conformingTriples(),
      ...conceptTriples("a"),
      ...conceptTriples("b"),
      ...conceptTriples("c"),
      [concept("a"), `${NS.skos}broader`, concept("b")],
      [concept("b"), `${NS.skos}broader`, concept("c")],
      [concept("a"), `${NS.skos}related`, concept("c")],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.message.includes("related") && f.message.includes("broader"),
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
  });

  it("blames every doc that references a bad shared concept, sorted", async () => {
    const c = concept("shared");
    const d2 = doc("docs/z.md");
    const d3 = doc("docs/b.md");
    const store = build([
      ...conformingTriples(),
      [c, RDF_TYPE, `${NS.skos}Concept`],
      [c, `${NS.skos}prefLabel`, { lit: "shared" }],
      // missing inScheme → violation
      [d2, RDF_TYPE, `${NS.graph}Document`],
      [d2, `${NS.graph}path`, { lit: "docs/z.md" }],
      [d3, RDF_TYPE, `${NS.graph}Document`],
      [d3, `${NS.graph}path`, { lit: "docs/b.md" }],
      [d2, `${NS.dcterms}subject`, c],
      [d3, `${NS.dcterms}subject`, c],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === c && f.path === `${NS.skos}inScheme`,
    );
    expect(hit).toBeDefined();
    expect(hit?.docs).toEqual(["docs/b.md", "docs/z.md"]);
  });

  it("orders findings: errors before warnings, then by focus node", async () => {
    const store = build([
      ...conformingTriples(),
      // warning: collision on the conforming concept
      [concept("setup"), `${NS.skos}prefLabel`, { lit: "Setup" }],
      // violation: untyped-target concept missing everything
      [concept("bad"), RDF_TYPE, `${NS.skos}Concept`],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const severities = findings.map((f) => f.severity);
    const firstWarning = severities.indexOf("warning");
    const lastViolation = severities.lastIndexOf("error");
    expect(lastViolation).toBeLessThan(firstWarning);
  });
});

/**
 * SHACL speaks `Violation | Warning | Info`; the family speaks
 * `notice | warning | error` (src/shared/severity.ts). graph maps onto the
 * family's and keeps SHACL's word in `shaclSeverity`, as a11y keeps axe's
 * `impact` (proposal 0051 §2, 0035 stress test 10).
 */
describe("SHACL severity maps onto the family scale", () => {
  const SEVERITY_SHAPES = [
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "fixtures",
      "severity-shapes.ttl",
    ),
  ];
  const THING = "https://example.com/severity#thing";
  const EX = "https://example.com/severity#";

  async function findingsByMessage(): Promise<
    Map<string, { severity: string; shaclSeverity: string | undefined }>
  > {
    const store = build([
      [THING, RDF_TYPE, `${EX}Thing`],
      [THING, `${EX}violating`, { lit: "x" }],
      [THING, `${EX}warning`, { lit: "x" }],
      [THING, `${EX}info`, { lit: "x" }],
      [THING, `${EX}unstated`, { lit: "x" }],
    ]);
    const findings = await validateGraph(store, SEVERITY_SHAPES);
    return new Map(
      findings.map((f) => [
        f.message,
        { severity: f.severity, shaclSeverity: f.shaclSeverity },
      ]),
    );
  }

  it("names the file by its path, and a blank-node shape by no rule", async () => {
    const store = build([
      [THING, RDF_TYPE, `${EX}Thing`],
      [THING, `${EX}violating`, { lit: "x" }],
    ]);
    const findings = await validateGraph(store, SEVERITY_SHAPES);
    expect(findings.map((f) => f.guidance)).toEqual([
      { id: SEVERITY_SHAPES[0], rule: null, description: null, guide: null },
    ]);
  });

  it.each([
    ["violation-level constraint", "error", "violation"],
    ["warning-level constraint", "warning", "warning"],
    ["info-level constraint", "notice", "info"],
    // SHACL's default severity is sh:Violation.
    ["unstated-severity constraint", "error", "violation"],
  ])("maps %s to %s", async (message, severity, shaclSeverity) => {
    const byMessage = await findingsByMessage();
    expect(byMessage.get(message)).toEqual({ severity, shaclSeverity });
  });

  it("orders error, then warning, then notice", async () => {
    const store = build([
      [THING, RDF_TYPE, `${EX}Thing`],
      [THING, `${EX}violating`, { lit: "x" }],
      [THING, `${EX}warning`, { lit: "x" }],
      [THING, `${EX}info`, { lit: "x" }],
    ]);
    const findings = await validateGraph(store, SEVERITY_SHAPES);
    expect(findings.map((f) => f.severity)).toEqual([
      "error",
      "warning",
      "notice",
    ]);
  });
});

describe("Document content hash (ADR 01036)", () => {
  it("rejects a document with no content hash", () => {
    // Required, not optional: the predicate is unconditional, so a regression
    // that stops emitting it must fail rather than pass quietly.
    const triples = conformingTriples().filter(
      ([, p]) => p !== `${NS.graph}contentHash`,
    );
    return expect(
      validateGraph(build(triples), SHAPES).then((f) =>
        f.map((x) => x.path ?? ""),
      ),
    ).resolves.toContain(`${NS.graph}contentHash`);
  });

  it("rejects a hash that is not 64 lowercase hex characters", async () => {
    for (const bad of [
      "not-a-hash",
      "A".repeat(64), // uppercase
      "a".repeat(63), // too short
      "a".repeat(65), // too long
    ]) {
      const triples = conformingTriples().map(
        ([s, p, o]): [string, string, string | { lit: string }] =>
          p === `${NS.graph}contentHash` ? [s, p, { lit: bad }] : [s, p, o],
      );
      const findings = await validateGraph(build(triples), SHAPES);
      expect(
        findings.map((f) => f.path ?? ""),
        `expected "${bad}" to be rejected`,
      ).toContain(`${NS.graph}contentHash`);
    }
  });

  it("rejects a second content hash on one document", async () => {
    const triples = conformingTriples();
    triples.push([
      doc("docs/a.md"),
      `${NS.graph}contentHash`,
      { lit: "b".repeat(64) },
    ]);
    const findings = await validateGraph(build(triples), SHAPES);
    expect(findings.map((f) => f.path ?? "")).toContain(
      `${NS.graph}contentHash`,
    );
  });

  it("accepts a well-formed hash", async () => {
    expect(await validateGraph(build(conformingTriples()), SHAPES)).toEqual([]);
  });
});

/**
 * The localization contract (ADR 01037). Both halves, and the negatives assert
 * *which* path was named — a rejection for the wrong reason is a silent hole.
 */
describe("shapes 1.0.0 — localization", () => {
  const D = doc("docs/de/a.md");

  const withLanguage = (tag: string) => {
    const triples = conformingTriples();
    triples.push([D, RDF_TYPE, `${NS.graph}Document`]);
    triples.push([D, `${NS.graph}path`, { lit: "docs/de/a.md" }]);
    triples.push([D, `${NS.graph}contentHash`, { lit: HASH }]);
    triples.push([D, `${NS.dcterms}language`, { lit: tag }]);
    return build(triples);
  };

  it.each(["de", "en", "de-DE", "pt-BR", "zh-Hans", "zh-Hans-CN", "und"])(
    "accepts the BCP-47 tag %s",
    async (tag) => {
      expect(await validateGraph(withLanguage(tag), SHAPES)).toEqual([]);
    },
  );

  it.each(["English", "de_DE", "d", "deutsch-language", "de-"])(
    "rejects %s, naming dcterms:language",
    async (tag) => {
      const findings = await validateGraph(withLanguage(tag), SHAPES);
      expect(
        findings.map((f) => f.path ?? ""),
        `expected "${tag}" to be rejected`,
      ).toContain(`${NS.dcterms}language`);
    },
  );

  it("rejects a second language on one document", async () => {
    const triples = conformingTriples();
    triples.push([doc("docs/a.md"), `${NS.dcterms}language`, { lit: "en" }]);
    triples.push([doc("docs/a.md"), `${NS.dcterms}language`, { lit: "de" }]);
    const findings = await validateGraph(build(triples), SHAPES);
    expect(findings.map((f) => f.path ?? "")).toContain(
      `${NS.dcterms}language`,
    );
  });

  it("accepts the two translation directions between corpus documents", async () => {
    const triples = conformingTriples();
    triples.push([D, RDF_TYPE, `${NS.graph}Document`]);
    triples.push([D, `${NS.graph}path`, { lit: "docs/de/a.md" }]);
    triples.push([D, `${NS.graph}contentHash`, { lit: HASH }]);
    triples.push([D, `${NS.schema}translationOfWork`, doc("docs/a.md")]);
    triples.push([doc("docs/a.md"), `${NS.schema}workTranslation`, D]);
    expect(await validateGraph(build(triples), SHAPES)).toEqual([]);
  });

  it("accepts a translation source outside the corpus", async () => {
    const triples = conformingTriples();
    triples.push([
      doc("docs/a.md"),
      `${NS.schema}translationOfWork`,
      "https://example.org/en/a",
    ]);
    expect(await validateGraph(build(triples), SHAPES)).toEqual([]);
  });

  it("rejects a workTranslation pointing at a non-Document", async () => {
    const triples = conformingTriples();
    triples.push([
      doc("docs/a.md"),
      `${NS.schema}workTranslation`,
      concept("setup"),
    ]);
    const findings = await validateGraph(build(triples), SHAPES);
    expect(findings.map((f) => f.path ?? "")).toContain(
      `${NS.schema}workTranslation`,
    );
  });
});

/**
 * Proposal 0089: a finding names the frontmatter key and says what to change,
 * and the lines under it name the shape that judged it. One mistake reports
 * once.
 */
describe("findings speak to the page's author (shapes 1.1.1)", () => {
  const ID = "manni:graph-shapes:1.3.0";
  const GUIDE = "https://hawkeyexl.github.io/manni/graph/fix/";
  const SHAPES_110 = [join(dirname(defined(SHAPES[0])), "shapes-1.1.0.ttl")];
  const d = doc("docs/a.md");
  const variant = `${BASE}product/sp-x1`;
  const variantTriples: Array<[string, string, string | { lit: string }]> = [
    [variant, RDF_TYPE, `${NS.iirds}ProductVariant`],
    [variant, `${NS.dcterms}title`, { lit: "SP-X1" }],
  ];
  const section = `${d}#install`;
  const sectionTriples: Array<[string, string, string | { lit: string; dt?: string }]> = [
    [section, RDF_TYPE, `${NS.graph}Section`],
    [section, `${NS.dcterms}title`, { lit: "Install" }],
    [section, `${NS.graph}level`, { lit: "2", dt: `${NS.xsd}integer` }],
    [section, `${NS.graph}order`, { lit: "1", dt: `${NS.xsd}integer` }],
  ];

  it("names `lang` for a language name, with the shape that judged it", async () => {
    const findings = await validateGraph(
      build([...conformingTriples(), [d, `${NS.dcterms}language`, { lit: "German" }]]),
      SHAPES,
    );
    expect(findings).toEqual([
      {
        severity: "error",
        shaclSeverity: "violation",
        message: "Set `lang` to a language tag such as `de` or `pt-BR`, not a language name.",
        focusNode: d,
        path: `${NS.dcterms}language`,
        docs: ["docs/a.md"],
        guidance: {
          id: ID,
          rule: "Document-language",
          description:
            "The language the page is written in. Search, filters and per-language indexes group pages by it.",
          guide: GUIDE,
        },
      },
    ]);
  });

  it("names both variant lists when a page puts one variant in each", async () => {
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        ...variantTriples,
        [d, `${NS.iirds}relates-to-product-variant`, variant],
        [d, `${NS.graph}notApplicableToVariant`, variant],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => [f.message, f.guidance?.rule])).toEqual([
      [
        "The page lists a variant in both `applies-to` and `not-applicable-to`. Keep it only in the one that is true.",
        "Document-notApplicableToVariant",
      ],
    ]);
  });

  it("merges results that share a shape, a node and a path into one finding", async () => {
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        [d, `${NS.iirds}has-subject`, `${NS.iirdsSft}Interface`],
        [d, `${NS.iirds}has-subject`, `${NS.iirdsSft}Architecture`],
        [d, `${NS.graph}notSoftwareSubject`, `${NS.iirdsSft}Interface`],
        [d, `${NS.graph}notSoftwareSubject`, `${NS.iirdsSft}Architecture`],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => f.message)).toEqual([
      "The page lists an aspect in both `about-product-aspect` and `not-about-product-aspect`. Keep it only in the one that is true.",
    ]);
  });

  it("says which section list holds a variant and an aspect twice", async () => {
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        ...variantTriples,
        ...sectionTriples,
        [section, `${NS.iirds}relates-to-product-variant`, variant],
        [section, `${NS.graph}notApplicableToVariant`, variant],
        [section, `${NS.iirds}has-subject`, `${NS.iirdsSft}Interface`],
        [section, `${NS.graph}notSoftwareSubject`, `${NS.iirdsSft}Interface`],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => [f.message, f.docs])).toEqual([
      [
        "A section in `graph.sections` lists a variant in both `applies-to` and `not-applicable-to`. Keep it only in the one that is true.",
        ["docs/a.md"],
      ],
      [
        "A section in `graph.sections` lists an aspect in both `about-product-aspect` and `not-about-product-aspect`. Keep it only in the one that is true.",
        ["docs/a.md"],
      ],
    ]);
  });

  it("says a variant is spelled two ways when its node has two titles", async () => {
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        ...variantTriples,
        [variant, `${NS.dcterms}title`, { lit: "sp-x1" }],
        [d, `${NS.iirds}relates-to-product-variant`, variant],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => [f.message, f.guidance?.rule, f.docs])).toEqual([
      [
        "Pages spell this variant two ways in `applies-to` or `not-applicable-to`. Use one spelling on every page.",
        "ProductVariant-title",
        ["docs/a.md"],
      ],
    ]);
  });

  it("names both links when a related concept is also broader", async () => {
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        ...conceptTriples("a", "Alpha"),
        ...conceptTriples("b", "Beta"),
        [concept("a"), `${NS.skos}broader`, concept("b")],
        [concept("b"), `${NS.skos}narrower`, concept("a")],
        [concept("a"), `${NS.skos}related`, concept("b")],
        [concept("b"), `${NS.skos}related`, concept("a")],
      ]),
      SHAPES,
    );
    // sh:disjoint fires on Alpha, and the check core says nothing beside it.
    expect(findings.map((f) => [f.focusNode, f.message, f.guidance?.rule])).toEqual([
      [
        concept("a"),
        "A concept is related to a concept that is also broader than it. Remove one link: from `related-concepts` or `related-terms`, or from `broader` or `narrower`.",
        "Concept-related",
      ],
    ]);
  });

  it("reports a related-and-ancestor pair once, on the descendant", async () => {
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        ...conceptTriples("a", "Alpha"),
        ...conceptTriples("b", "Beta"),
        ...conceptTriples("g", "Gamma"),
        [concept("a"), `${NS.skos}broader`, concept("b")],
        [concept("b"), `${NS.skos}broader`, concept("g")],
        // derive writes skos:related both ways round.
        [concept("a"), `${NS.skos}related`, concept("g")],
        [concept("g"), `${NS.skos}related`, concept("a")],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => [f.focusNode, f.path, f.message, f.guidance])).toEqual([
      [
        concept("a"),
        `${NS.skos}related`,
        '"Gamma" is both related to "Alpha" and one of its ancestors. Remove one link: from `related-concepts` or `related-terms`, or from the `broader` chain between them.',
        {
          id: ID,
          rule: "Concept-related",
          description:
            "A concept on the same level as this one. It is never also an ancestor or a descendant.",
          guide: GUIDE,
        },
      ],
    ]);
  });

  it("names three cycle members by label", async () => {
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        ...conceptTriples("a", "Alpha"),
        ...conceptTriples("b", "Beta"),
        ...conceptTriples("c", "Gamma"),
        [concept("a"), `${NS.skos}broader`, concept("b")],
        [concept("b"), `${NS.skos}broader`, concept("c")],
        [concept("c"), `${NS.skos}broader`, concept("a")],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => [f.message, f.guidance?.rule])).toEqual([
      [
        '"Alpha", "Beta" and "Gamma" form a broader cycle, so each is its own ancestor. Remove one `broader` or `narrower` value on the cycle.',
        "Concept-broader",
      ],
    ]);
  });

  it("names a self-loop's one member", async () => {
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        ...conceptTriples("self", "Self"),
        [concept("self"), `${NS.skos}broader`, concept("self")],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => f.message)).toEqual([
      '"Self" forms a broader cycle with itself, so it is its own ancestor. Remove the `broader` or `narrower` value that names it.',
    ]);
  });

  it("asks for one label per language on two labels in one language", async () => {
    const c = concept("widget");
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        [c, RDF_TYPE, `${NS.skos}Concept`],
        [c, `${NS.skos}inScheme`, SCHEME],
        [c, `${NS.skos}prefLabel`, { lit: "Widget", lang: "en" }],
        [c, `${NS.skos}prefLabel`, { lit: "Gadget", lang: "en" }],
      ]),
      SHAPES,
    );
    expect(findings.map((f) => [f.severity, f.message, f.guidance?.rule])).toEqual([
      [
        "warning",
        "This concept has two labels in one language. Give each term page one `label` per language.",
        "Concept-prefLabel-collision",
      ],
    ]);
  });

  it("sends a closed-shape finding to whoever maintains the shapes", async () => {
    const findings = await validateGraph(
      build([...conformingTriples(), [d, `${NS.graph}surprise`, { lit: "?" }]]),
      SHAPES,
    );
    expect(findings.map((f) => [f.message, f.guidance?.rule])).toEqual([
      [
        "manni wrote a property this shape does not list. The page is not at fault. Report it to whoever maintains the shapes.",
        "DocumentShape",
      ],
    ]);
  });

  it("gives every check-core finding the bundled shape for its path", async () => {
    const other = concept("install");
    const activity = `${d}#prov.graph-fill.m1`;
    const findings = await validateGraph(
      build([
        ...conformingTriples(),
        ...conceptTriples("x"),
        [concept("x"), `${NS.skos}broader`, concept("x")],
        [other, RDF_TYPE, `${NS.skos}Concept`],
        [other, `${NS.skos}prefLabel`, { lit: "install" }],
        [other, `${NS.skos}inScheme`, SCHEME],
        [concept("setup"), `${NS.skos}closeMatch`, other],
        [concept("setup"), `${NS.skos}prefLabel`, { lit: "Setup" }],
        [activity, RDF_TYPE, `${NS.prov}Activity`],
        [activity, `${NS.graph}filledFieldEntry`, `${activity}.field.sections`],
        [`${activity}.field.sections`, `${NS.graph}filledField`, { lit: "sections" }],
      ]),
      SHAPES,
    );
    expect(
      findings.map((f) => [f.guidance?.id, f.guidance?.rule, f.guidance?.guide].join(" ")).sort(),
    ).toEqual(
      [
        `${ID} Concept-broader ${GUIDE}`,
        `${ID} Concept-closeMatch ${GUIDE}`,
        `${ID} Concept-prefLabel-collision ${GUIDE}`,
        `${ID} FilledFieldEntry-name ${GUIDE}`,
      ].sort(),
    );
    expect(findings.find((f) => f.guidance?.rule === "Concept-closeMatch")?.message).toBe(
      '`close-matches` names "install", a concept in this glossary. Use `broader`, `narrower` or `related-terms` for it instead.',
    );
  });

  it("keeps the library's messages for a pinned 1.1.0, naming the file by its path", async () => {
    const findings = await validateGraph(
      build([...conformingTriples(), [d, `${NS.dcterms}language`, { lit: "German" }]]),
      SHAPES_110,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/^Value does not match pattern/);
    expect(findings[0]?.guidance).toEqual({
      id: SHAPES_110[0],
      rule: "Document-language",
      description: null,
      guide: null,
    });
  });

  it("names a house file by its header", async () => {
    const house = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "fixtures",
      "check-guidance",
      "house-shapes.ttl",
    );
    const findings = await validateGraph(build(conformingTriples()), [house]);
    expect(findings.map((f) => [f.severity, f.message, f.guidance])).toEqual([
      [
        "warning",
        "Add a `description` that says what the page is for.",
        {
          id: "house:shapes:1.0.0",
          rule: "Described-description",
          description: "Every page carries a one-sentence description.",
          guide: "https://example.com/house/guide/",
        },
      ],
    ]);
  });

  it("says how to recover from a shapes path that does not exist", async () => {
    await expect(validateGraph(build(conformingTriples()), ["nope.ttl"])).rejects.toThrow(
      "Shapes file not found: nope.ttl. Fix the path in --shapes or graph.check.shapes. Leave both unset to use the bundled shapes.",
    );
  });
});

/** Narrows without a non-null assertion. */
function defined<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

describe("a merged finding's messages", () => {
  const SHAPES_FILE = [
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "semicolon-message-shapes.ttl"),
  ];
  const THING = "https://example.com/semicolon#thing";
  const EX = "https://example.com/semicolon#";

  it("says a message holding \"; \" once, however many values break it", async () => {
    const findings = await validateGraph(
      build([
        [THING, RDF_TYPE, `${EX}Thing`],
        [THING, `${EX}code`, { lit: "abc" }],
        [THING, `${EX}code`, { lit: "def" }],
      ]),
      SHAPES_FILE,
    );
    expect(findings.map((f) => f.message)).toEqual([
      "Shorten the code; one character is the limit",
    ]);
  });

  it("says each distinct message once when two constraints on one path fail", async () => {
    const two = "https://example.com/two#";
    const findings = await validateGraph(
      build([
        [`${two}thing`, RDF_TYPE, `${two}Thing`],
        [`${two}thing`, `${two}code`, { lit: "ABCD" }],
      ]),
      [join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "two-constraint-shapes.ttl")],
    );
    expect(findings).toHaveLength(1);
    const parts = defined(findings[0]).message.split("; ");
    expect(parts).toHaveLength(2);
    expect(new Set(parts).size).toBe(2);
  });
});
