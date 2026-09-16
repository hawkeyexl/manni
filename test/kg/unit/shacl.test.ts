import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DataFactory, Store } from "n3";
import { validateGraph } from "../../../src/kg/core/shacl.js";
import { bundledShapesPath } from "../../../src/kg/core/pkg.js";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";

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
      DataFactory.quad(
        DataFactory.namedNode(s),
        DataFactory.namedNode(p),
        typeof o === "string"
          ? DataFactory.namedNode(o)
          : DataFactory.literal(o.lit, o.dt ? DataFactory.namedNode(o.dt) : undefined),
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
    [d, RDF_TYPE, `${NS.kg}Document`],
    [d, `${NS.kg}path`, { lit: "docs/a.md" }],
    // Required since shapes 0.7 (ADR 01036). Any well-formed digest will do —
    // these tests are about the shapes, not about hashing.
    [d, `${NS.kg}contentHash`, { lit: HASH }],
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
  });

  it("closed Document shape rejects unexpected predicates", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      [d, `${NS.kg}surprise`, { lit: "?" }],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === d && f.path === `${NS.kg}surprise`,
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
      [s, RDF_TYPE, `${NS.kg}Section`],
      [s, `${NS.dcterms}title`, { lit: "Install" }],
      [s, `${NS.kg}level`, { lit: "2", dt: `${NS.xsd}integer` }],
      [s, `${NS.kg}order`, { lit: "1", dt: `${NS.xsd}integer` }],
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
      [s, RDF_TYPE, `${NS.kg}Section`],
      [s, `${NS.dcterms}title`, { lit: "Install" }],
      [s, `${NS.kg}level`, { lit: "2", dt: `${NS.xsd}integer` }],
      [s, `${NS.kg}order`, { lit: "1", dt: `${NS.xsd}integer` }],
      [s, `${NS.iirds}has-topic-type`, `${NS.iirds}GenericNonsense`],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === s && f.path === `${NS.iirds}has-topic-type`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
  });

  it("accepts kg:brokenSectionRef on a document", async () => {
    const d = doc("docs/a.md");
    const store = build([
      ...conformingTriples(),
      [d, `${NS.kg}brokenSectionRef`, { lit: "missing-heading" }],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
  });

  it("accepts negative scope disjoint from positive scope (ADR 01014)", async () => {
    const d = doc("docs/a.md");
    const v = `${BASE}product/sp-x300`;
    const store = build([
      ...conformingTriples(),
      [d, `${NS.kg}notApplicableToVariant`, v],
      [v, RDF_TYPE, `${NS.iirds}ProductVariant`],
      [v, `${NS.dcterms}title`, { lit: "SP-X300" }],
      [d, `${NS.kg}notSoftwareSubject`, `${NS.iirdsSft}Architecture`],
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
      [d, `${NS.kg}notApplicableToVariant`, v],
      [v, RDF_TYPE, `${NS.iirds}ProductVariant`],
      [v, `${NS.dcterms}title`, { lit: "SP-X1" }],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) =>
        f.focusNode === d && f.path === `${NS.kg}notApplicableToVariant`,
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
      [d, `${NS.kg}notSoftwareSubject`, `${NS.iirdsSft}Interface`],
    ]);
    const findings = await validateGraph(store, SHAPES);
    const hit = findings.find(
      (f) => f.focusNode === d && f.path === `${NS.kg}notSoftwareSubject`,
    );
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
  });

  it("accepts a reified fill-field entry with confidence (ADR 01015)", async () => {
    const activity = `${BASE}doc/docs/a.md#prov.kg-fill.m1`;
    const entry = `${activity}.field.label`;
    const store = build([
      ...conformingTriples(),
      [activity, RDF_TYPE, `${NS.prov}Activity`],
      [activity, `${NS.prov}wasAssociatedWith`, `${BASE}agent/software/m1`],
      [activity, `${NS.kg}filledFieldEntry`, entry],
      [entry, `${NS.kg}filledField`, { lit: "label" }],
      [entry, `${NS.kg}confidence`, { lit: "0.9", dt: `${NS.xsd}decimal` }],
      [`${BASE}agent/software/m1`, RDF_TYPE, `${NS.prov}SoftwareAgent`],
      [`${BASE}agent/software/m1`, `${NS.foaf}name`, { lit: "m1" }],
    ]);
    expect(await validateGraph(store, SHAPES)).toEqual([]);
  });

  /** A fill activity attributing `field` on docs/a.md to model `m1`. */
  function filled(field: string): Array<[string, string, string | { lit: string }]> {
    const activity = `${BASE}doc/docs/a.md#prov.kg-fill.m1`;
    const entry = `${activity}.field.${field}`;
    return [
      [activity, RDF_TYPE, `${NS.prov}Activity`],
      [activity, `${NS.prov}wasAssociatedWith`, `${BASE}agent/software/m1`],
      [activity, `${NS.kg}filledFieldEntry`, entry],
      [entry, `${NS.kg}filledField`, { lit: field }],
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
      const curated = findings.filter((f) =>
        f.message.includes("curated by hand"),
      );
      expect(curated).toHaveLength(1);
      expect(curated[0]?.severity).toBe("error");
      expect(curated[0]?.path).toBe(`${NS.kg}filledField`);
      expect(curated[0]?.focusNode).toBe(
        `${BASE}doc/docs/a.md#prov.kg-fill.m1`,
      );
      expect(curated[0]?.docs).toEqual(["docs/a.md"]);
      expect(curated[0]?.message).toContain(`/graph/${field}`);
    });
  }

  it("leaves a machine attribution on a fillable field alone", async () => {
    const store = build([...conformingTriples(), ...filled("label")]);
    const findings = await validateGraph(store, SHAPES);
    expect(findings.filter((f) => f.message.includes("curated by hand"))).toEqual(
      [],
    );
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
    expect(hit?.message).toContain(concept("b"));
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
      [d2, RDF_TYPE, `${NS.kg}Document`],
      [d2, `${NS.kg}path`, { lit: "docs/z.md" }],
      [d3, RDF_TYPE, `${NS.kg}Document`],
      [d3, `${NS.kg}path`, { lit: "docs/b.md" }],
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
 * `notice | warning | error` (src/shared/severity.ts). kg maps onto the
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
    Map<string, { severity: string; shaclSeverity: string }>
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
      ([, p]) => p !== `${NS.kg}contentHash`,
    );
    return expect(
      validateGraph(build(triples), SHAPES).then((f) =>
        f.map((x) => x.path ?? ""),
      ),
    ).resolves.toContain(`${NS.kg}contentHash`);
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
          p === `${NS.kg}contentHash` ? [s, p, { lit: bad }] : [s, p, o],
      );
      const findings = await validateGraph(build(triples), SHAPES);
      expect(
        findings.map((f) => f.path ?? ""),
        `expected "${bad}" to be rejected`,
      ).toContain(`${NS.kg}contentHash`);
    }
  });

  it("rejects a second content hash on one document", async () => {
    const triples = conformingTriples();
    triples.push([
      doc("docs/a.md"),
      `${NS.kg}contentHash`,
      { lit: "b".repeat(64) },
    ]);
    const findings = await validateGraph(build(triples), SHAPES);
    expect(findings.map((f) => f.path ?? "")).toContain(
      `${NS.kg}contentHash`,
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
    triples.push([D, RDF_TYPE, `${NS.kg}Document`]);
    triples.push([D, `${NS.kg}path`, { lit: "docs/de/a.md" }]);
    triples.push([D, `${NS.kg}contentHash`, { lit: HASH }]);
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
    triples.push([D, RDF_TYPE, `${NS.kg}Document`]);
    triples.push([D, `${NS.kg}path`, { lit: "docs/de/a.md" }]);
    triples.push([D, `${NS.kg}contentHash`, { lit: HASH }]);
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
