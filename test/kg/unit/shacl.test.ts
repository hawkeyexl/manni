import { describe, expect, it } from "vitest";
import { DataFactory, Store } from "n3";
import { validateGraph } from "../../../src/kg/core/shacl.js";
import { bundledShapesPath } from "../../../src/kg/core/pkg.js";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";

const { namedNode, literal, quad } = DataFactory;

const BASE = "https://example.com/kg/";
const SHAPES = [bundledShapesPath(import.meta.url)];

const doc = (path: string) => `${BASE}doc/${path}`;
const concept = (slug: string) => `${BASE}concept/${slug}`;
const SCHEME = `${BASE}scheme`;
/** A syntactically valid sha256: 64 lowercase hex characters. */
const HASH = "a".repeat(64);

/** Store builder: [s, p, o] with strings; o starting with "http" is an IRI. */
function build(
  triples: Array<[string, string, string | { lit: string; dt?: string }]>,
): Store {
  const store = new Store();
  for (const [s, p, o] of triples) {
    store.addQuad(
      quad(
        namedNode(s),
        namedNode(p),
        typeof o === "string"
          ? namedNode(o)
          : literal(o.lit, o.dt ? namedNode(o.dt) : undefined),
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
    [d, RDF_TYPE, `${NS.dockg}Document`],
    [d, `${NS.dockg}path`, { lit: "docs/a.md" }],
    // Required since shapes 0.7 (ADR 01036). Any well-formed digest will do —
    // these tests are about the shapes, not about hashing.
    [d, `${NS.dockg}contentHash`, { lit: HASH }],
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
    expect(hit!.severity).toBe("violation");
    expect(hit!.docs).toEqual(["docs/a.md"]);
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
          f.severity === "violation",
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
    expect(hit!.severity).toBe("warning");
  });

  it("closed Document shape rejects unexpected predicates", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      [d, `${NS.dockg}surprise`, { lit: "?" }],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === d && f.path === `${NS.dockg}surprise`,
    );
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("violation");
    expect(hit!.docs).toEqual(["docs/a.md"]);
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
    expect(hit!.severity).toBe("violation");
    expect(hit!.docs).toEqual(["docs/a.md"]);
  });

  it("accepts a section carrying iiRDS typing (ADR 01013)", async () => {
    const s = `${doc("docs/a.md")}#install`;
    const v = `${BASE}product/sp-x200`;
    const store = build([
      ...conformingTriples(),
      [s, RDF_TYPE, `${NS.dockg}Section`],
      [s, `${NS.dcterms}title`, { lit: "Install" }],
      [s, `${NS.dockg}level`, { lit: "2", dt: `${NS.xsd}integer` }],
      [s, `${NS.dockg}order`, { lit: "1", dt: `${NS.xsd}integer` }],
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
      [s, RDF_TYPE, `${NS.dockg}Section`],
      [s, `${NS.dcterms}title`, { lit: "Install" }],
      [s, `${NS.dockg}level`, { lit: "2", dt: `${NS.xsd}integer` }],
      [s, `${NS.dockg}order`, { lit: "1", dt: `${NS.xsd}integer` }],
      [s, `${NS.iirds}has-topic-type`, `${NS.iirds}GenericNonsense`],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === s && f.path === `${NS.iirds}has-topic-type`,
    );
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("violation");
  });

  it("accepts dockg:brokenSectionRef on a document", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      [d, `${NS.dockg}brokenSectionRef`, { lit: "missing-heading" }],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
  });

  it("accepts negative scope disjoint from positive scope (ADR 01014)", async () => {
    const d = doc("docs/a.md");
    const v = `${BASE}product/sp-x300`;
    const store = build([
      ...conformingTriples(),
      [d, `${NS.dockg}notApplicableToVariant`, v],
      [v, RDF_TYPE, `${NS.iirds}ProductVariant`],
      [v, `${NS.dcterms}title`, { lit: "SP-X300" }],
      [d, `${NS.dockg}notSoftwareSubject`, `${NS.iirdsSft}Architecture`],
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
      [d, `${NS.dockg}notApplicableToVariant`, v],
      [v, RDF_TYPE, `${NS.iirds}ProductVariant`],
      [v, `${NS.dcterms}title`, { lit: "SP-X1" }],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) =>
        f.focusNode === d && f.path === `${NS.dockg}notApplicableToVariant`,
    );
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("violation");
    expect(hit!.docs).toEqual(["docs/a.md"]);
  });

  it("rejects a subject asserted as both about and not-about (sh:disjoint)", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      [d, `${NS.iirds}has-subject`, `${NS.iirdsSft}Interface`],
      [d, `${NS.dockg}notSoftwareSubject`, `${NS.iirdsSft}Interface`],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === d && f.path === `${NS.dockg}notSoftwareSubject`,
    );
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("violation");
  });

  it("accepts a reified fill-field entry with confidence (ADR 01015)", async () => {
    const activity = `${BASE}doc/docs/a.md#prov.kg-fill.m1`;
    const entry = `${activity}.field.label`;
    const store = build([
      ...conformingTriples(),
      [activity, RDF_TYPE, `${NS.prov}Activity`],
      [activity, `${NS.prov}wasAssociatedWith`, `${BASE}agent/software/m1`],
      [activity, `${NS.dockg}filledFieldEntry`, entry],
      [entry, `${NS.dockg}filledField`, { lit: "label" }],
      [entry, `${NS.dockg}confidence`, { lit: "0.9", dt: `${NS.xsd}decimal` }],
      [`${BASE}agent/software/m1`, RDF_TYPE, `${NS.prov}SoftwareAgent`],
      [`${BASE}agent/software/m1`, `${NS.foaf}name`, { lit: "m1" }],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
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
    expect(hit!.severity).toBe("violation");
    expect(hit!.focusNode).toBe(concept("a"));
    expect(hit!.message).toContain(concept("b"));
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
        (f) => f.focusNode === concept("a") && f.severity === "violation",
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
    expect(hit!.severity).toBe("violation");
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
      [d2, RDF_TYPE, `${NS.dockg}Document`],
      [d2, `${NS.dockg}path`, { lit: "docs/z.md" }],
      [d3, RDF_TYPE, `${NS.dockg}Document`],
      [d3, `${NS.dockg}path`, { lit: "docs/b.md" }],
      [d2, `${NS.dcterms}subject`, c],
      [d3, `${NS.dcterms}subject`, c],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === c && f.path === `${NS.skos}inScheme`,
    );
    expect(hit).toBeDefined();
    expect(hit!.docs).toEqual(["docs/b.md", "docs/z.md"]);
  });

  it("orders findings: violations before warnings, then by focus node", async () => {
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
    const lastViolation = severities.lastIndexOf("violation");
    expect(lastViolation).toBeLessThan(firstWarning);
  });
});

describe("Document content hash (ADR 01036)", () => {
  it("rejects a document with no content hash", () => {
    // Required, not optional: the predicate is unconditional, so a regression
    // that stops emitting it must fail rather than pass quietly.
    const triples = conformingTriples().filter(
      ([, p]) => p !== `${NS.dockg}contentHash`,
    );
    return expect(
      validateGraph(build(triples), SHAPES).then((f) =>
        f.map((x) => x.path ?? ""),
      ),
    ).resolves.toContain(`${NS.dockg}contentHash`);
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
          p === `${NS.dockg}contentHash` ? [s, p, { lit: bad }] : [s, p, o],
      );
      const findings = await validateGraph(build(triples), SHAPES);
      expect(
        findings.map((f) => f.path ?? ""),
        `expected "${bad}" to be rejected`,
      ).toContain(`${NS.dockg}contentHash`);
    }
  });

  it("rejects a second content hash on one document", async () => {
    const triples = conformingTriples();
    triples.push([
      doc("docs/a.md"),
      `${NS.dockg}contentHash`,
      { lit: "b".repeat(64) },
    ]);
    const findings = await validateGraph(build(triples), SHAPES);
    expect(findings.map((f) => f.path ?? "")).toContain(
      `${NS.dockg}contentHash`,
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
    triples.push([D, RDF_TYPE, `${NS.dockg}Document`]);
    triples.push([D, `${NS.dockg}path`, { lit: "docs/de/a.md" }]);
    triples.push([D, `${NS.dockg}contentHash`, { lit: HASH }]);
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
    triples.push([D, RDF_TYPE, `${NS.dockg}Document`]);
    triples.push([D, `${NS.dockg}path`, { lit: "docs/de/a.md" }]);
    triples.push([D, `${NS.dockg}contentHash`, { lit: HASH }]);
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
