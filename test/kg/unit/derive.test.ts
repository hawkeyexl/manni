import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/kg/core/analyze.js";
import { deriveGraph } from "../../../src/kg/core/derive.js";
import { NS, ROLE } from "../../../src/kg/core/vocab.js";
import type { Quad, Term } from "../../../src/kg/core/derive.js";
import type { DeriveSource, RouteMapping } from "../../../src/kg/core/config.js";
import type { GitHistory } from "../../../src/kg/core/git.js";

const BASE = "https://example.com/kg/";
const ALL_SOURCES: DeriveSource[] = [
  "frontmatter",
  "sections",
  "links",
  "tags",
  "images",
  "code",
  "provenance",
];

function docs(files: Record<string, string>) {
  const paths = new Set(Object.keys(files));
  return Object.entries(files).map(([path, content]) =>
    analyzeDoc(content, path, paths),
  );
}

function graph(
  files: Record<string, string>,
  sources = ALL_SOURCES,
  extra: {
    toolVersion?: string;
    gitHistory?: GitHistory;
    qualified?: boolean;
  } = {},
): Quad[] {
  return deriveGraph(docs(files), {
    baseIri: BASE,
    derive: sources,
    toolVersion: extra.toolVersion ?? "0.0.0-test",
    gitHistory: extra.gitHistory,
    qualified: extra.qualified,
  });
}

function has(quads: Quad[], s: string, p: string, o: Term): boolean {
  return quads.some(
    (q) =>
      q.s === s &&
      q.p === p &&
      q.o.kind === o.kind &&
      q.o.value === o.value &&
      (q.o.kind === "iri" ||
        (q.o as { datatype?: string }).datatype ===
          (o as { datatype?: string }).datatype),
  );
}

const iri = (value: string): Term => ({ kind: "iri", value });
const lit = (value: string, datatype?: string): Term =>
  datatype ? { kind: "literal", value, datatype } : { kind: "literal", value };

const DOC = `${BASE}doc/docs/a.md`;

describe("deriveGraph — document basics", () => {
  it("types every doc and records its path", () => {
    const g = graph({ "docs/a.md": "# A\n" });
    expect(has(g, DOC, `${NS.rdf}type`, iri(`${NS.dockg}Document`))).toBe(true);
    expect(has(g, DOC, `${NS.dockg}path`, lit("docs/a.md"))).toBe(true);
  });

  it("maps frontmatter title, falling back to first H1", () => {
    const g1 = graph({
      "docs/a.md": "---\ntitle: FM Title\n---\n\n# H1 Title\n",
    });
    expect(has(g1, DOC, `${NS.dcterms}title`, lit("FM Title"))).toBe(true);
    const g2 = graph({ "docs/a.md": "# H1 Title\n" });
    expect(has(g2, DOC, `${NS.dcterms}title`, lit("H1 Title"))).toBe(true);
  });

  it("maps description, creator (as agent node), dates, and language", () => {
    const g = graph({
      "docs/a.md":
        "---\ndescription: Desc\nauthor: Jane Doe\ndate: 2026-05-01\nupdated: 2026-07-01\nlang: en\n---\n",
    });
    const agent = `${BASE}agent/person/jane-doe`;
    expect(has(g, DOC, `${NS.dcterms}description`, lit("Desc"))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}creator`, iri(agent))).toBe(true);
    expect(has(g, DOC, `${NS.prov}wasAttributedTo`, iri(agent))).toBe(true);
    expect(has(g, agent, `${NS.rdf}type`, iri(`${NS.prov}Person`))).toBe(true);
    expect(has(g, agent, `${NS.foaf}name`, lit("Jane Doe"))).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}created`, lit("2026-05-01", `${NS.xsd}date`)),
    ).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.prov}generatedAtTime`,
        lit("2026-05-01", `${NS.xsd}date`),
      ),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}modified`, lit("2026-07-01", `${NS.xsd}date`)),
    ).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}language`, lit("en"))).toBe(true);
  });

  it("serializes Date frontmatter values as ISO 8601 (TOML frontmatter)", () => {
    const g = graph({
      "docs/a.md": '+++\ntitle = "T"\ndate = 2024-01-05T10:00:00Z\n+++\n',
    });
    expect(
      has(
        g,
        DOC,
        `${NS.dcterms}created`,
        lit("2024-01-05T10:00:00.000Z", `${NS.xsd}dateTime`),
      ),
    ).toBe(true);
  });

  it("supports authors arrays (agent node per author, converging)", () => {
    const g = graph({
      "docs/a.md": "---\nauthors: [Jane, Sam]\n---\n",
      "docs/b.md": "---\nauthor: Jane\n---\n",
    });
    expect(
      has(g, DOC, `${NS.dcterms}creator`, iri(`${BASE}agent/person/jane`)),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}creator`, iri(`${BASE}agent/person/sam`)),
    ).toBe(true);
    const janeTypes = g.filter(
      (q) => q.s === `${BASE}agent/person/jane` && q.p === `${NS.rdf}type`,
    );
    expect(janeTypes).toHaveLength(1);
  });

  it("falls back to creator literals when the provenance source is off", () => {
    const g = graph({ "docs/a.md": "---\nauthor: Jane\n---\n" }, [
      "frontmatter",
    ]);
    expect(has(g, DOC, `${NS.dcterms}creator`, lit("Jane"))).toBe(true);
    expect(g.some((q) => q.p === `${NS.prov}wasAttributedTo`)).toBe(false);
    expect(g.some((q) => q.s.startsWith(`${BASE}agent/`))).toBe(false);
  });
});

describe("deriveGraph — provenance", () => {
  it("types every doc as prov:Entity when the source is on", () => {
    const g = graph({ "docs/a.md": "# A\n" });
    expect(has(g, DOC, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(true);
    const off = graph({ "docs/a.md": "# A\n" }, ["frontmatter"]);
    expect(has(off, DOC, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(false);
  });

  it("maps kg.derived-from to resolved docs, URLs, and broken links", () => {
    const g = graph({
      "docs/a.md":
        '---\nkg:\n  derived-from: [b.md, "https://example.org/spec", missing.md]\n---\n',
      "docs/b.md": "# B\n",
    });
    expect(
      has(g, DOC, `${NS.prov}wasDerivedFrom`, iri(`${BASE}doc/docs/b.md`)),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.prov}wasDerivedFrom`, iri("https://example.org/spec")),
    ).toBe(true);
    expect(has(g, DOC, `${NS.dockg}brokenLink`, lit("missing.md"))).toBe(true);
  });

  it("maps the page-level generated-by to a generation activity", () => {
    // The `kg` block no longer carries a `generated-by` twin: page provenance
    // is the page's own fact (docmeta:ai-context), not the graph block's.
    const g = graph({
      "docs/a.md": "---\ngenerated-by: claude-sonnet-4-5\n---\n",
      "docs/b.md": "---\ngenerated-by: gpt-4o\n---\n",
    });
    // fragment uses a "." separator so heading slugs can never collide
    const activity = `${DOC}#prov.generation`;
    const model = `${BASE}agent/software/claude-sonnet-4-5`;
    expect(has(g, DOC, `${NS.prov}wasGeneratedBy`, iri(activity))).toBe(true);
    expect(has(g, activity, `${NS.rdf}type`, iri(`${NS.prov}Activity`))).toBe(
      true,
    );
    expect(has(g, activity, `${NS.prov}wasAssociatedWith`, iri(model))).toBe(
      true,
    );
    expect(has(g, model, `${NS.rdf}type`, iri(`${NS.prov}SoftwareAgent`))).toBe(
      true,
    );
    expect(has(g, model, `${NS.foaf}name`, lit("claude-sonnet-4-5"))).toBe(
      true,
    );
    // the second page, same rule
    expect(
      has(
        g,
        `${BASE}doc/docs/b.md`,
        `${NS.prov}wasGeneratedBy`,
        iri(`${BASE}doc/docs/b.md#prov.generation`),
      ),
    ).toBe(true);
  });

  it("keeps a '## Generation' heading distinct from the generation activity", () => {
    const g = graph({
      "docs/a.md": "---\ngenerated-by: gpt-4o\n---\n\n## Generation\n",
    });
    const section = `${DOC}#generation`;
    const activity = `${DOC}#prov.generation`;
    expect(has(g, section, `${NS.rdf}type`, iri(`${NS.dockg}Section`))).toBe(
      true,
    );
    expect(has(g, section, `${NS.rdf}type`, iri(`${NS.prov}Activity`))).toBe(
      false,
    );
    expect(has(g, activity, `${NS.rdf}type`, iri(`${NS.prov}Activity`))).toBe(
      true,
    );
    expect(has(g, activity, `${NS.rdf}type`, iri(`${NS.dockg}Section`))).toBe(
      false,
    );
  });

  it("maps kg.provenance entries to per-model fill activities, not shared subjects", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  label: Config\n  concepts: [shared-tag]\n  provenance:\n    - generated-by: claude-sonnet-4-5\n      fields: [label]\n    - generated-by: gpt-4o\n      fields: [concepts]\n---\n",
      "docs/b.md": "---\ntags: [shared-tag]\n---\n",
    });
    const claudeActivity = `${DOC}#prov.kg-fill.claude-sonnet-4-5`;
    const gptActivity = `${DOC}#prov.kg-fill.gpt-4o`;
    const topic = `${BASE}concept/config`;
    const shared = `${BASE}concept/shared-tag`;
    expect(
      has(g, claudeActivity, `${NS.rdf}type`, iri(`${NS.prov}Activity`)),
    ).toBe(true);
    expect(
      has(
        g,
        claudeActivity,
        `${NS.prov}wasAssociatedWith`,
        iri(`${BASE}agent/software/claude-sonnet-4-5`),
      ),
    ).toBe(true);
    // Each filled field is a reified entry node under its activity (ADR 01015).
    const claudeEntry = `${claudeActivity}.field.label`;
    expect(
      has(g, claudeActivity, `${NS.dockg}filledFieldEntry`, iri(claudeEntry)),
    ).toBe(true);
    expect(has(g, claudeEntry, `${NS.dockg}filledField`, lit("label"))).toBe(
      true,
    );
    // label's concept is generated by the model that proposed it, not the other
    expect(has(g, claudeActivity, `${NS.prov}generated`, iri(topic))).toBe(
      true,
    );
    expect(has(g, gptActivity, `${NS.prov}generated`, iri(topic))).toBe(false);
    const gptEntry = `${gptActivity}.field.concepts`;
    expect(has(g, gptEntry, `${NS.dockg}filledField`, lit("concepts"))).toBe(
      true,
    );
    // the shared concept itself is never attributed
    expect(g.some((q) => q.s === shared && q.p.startsWith(NS.prov))).toBe(
      false,
    );
    expect(
      g.some((q) => q.p === `${NS.prov}generated` && q.o.value === shared),
    ).toBe(false);
  });

  it("ignores the dropped single-object kg.provenance form", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  provenance:\n    generated-by: claude-sonnet-4-5\n    fields: [concepts]\n---\n",
    });
    // docmeta:kg made provenance array-only, so `manni kg validate` rejects this
    // shape. Deriving from it anyway would let `build` read frontmatter that
    // does not validate — the two commands must agree (ADR 01023).
    const activity = `${DOC}#prov.kg-fill.claude-sonnet-4-5`;
    expect(g.some((q) => q.s === activity)).toBe(false);
    expect(g.some((q) => q.p === `${NS.dockg}filledField`)).toBe(false);
  });

  it("emits per-field confidence as a decimal on the fill-field entry (ADR 01015)", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  label: Config\n  provenance:\n    - generated-by: m1\n      fields: [label]\n      confidence:\n        label: 0.9\n---\n",
    });
    const entry = `${DOC}#prov.kg-fill.m1.field.label`;
    expect(
      has(g, entry, `${NS.dockg}confidence`, lit("0.9", `${NS.xsd}decimal`)),
    ).toBe(true);
  });

  it("emits the graph-level build activity with tool agent and prov:used edges", () => {
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, {
      toolVersion: "1.2.3",
    });
    const graphNode = `${BASE}graph`;
    const activity = `${BASE}activity/build`;
    const tool = `${BASE}agent/software/dockg`;
    expect(has(g, graphNode, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(
      true,
    );
    expect(has(g, graphNode, `${NS.prov}wasGeneratedBy`, iri(activity))).toBe(
      true,
    );
    expect(has(g, activity, `${NS.prov}used`, iri(DOC))).toBe(true);
    expect(has(g, activity, `${NS.prov}wasAssociatedWith`, iri(tool))).toBe(
      true,
    );
    expect(has(g, tool, `${NS.rdf}type`, iri(`${NS.prov}SoftwareAgent`))).toBe(
      true,
    );
    expect(has(g, tool, `${NS.dockg}version`, lit("1.2.3"))).toBe(true);
  });

  it("adds prov:endedAtTime only when git history provides a head time", () => {
    const time = "2026-07-20T12:00:00-07:00";
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, {
      gitHistory: { headTime: time, files: new Map() },
    });
    expect(
      has(
        g,
        `${BASE}activity/build`,
        `${NS.prov}endedAtTime`,
        lit(time, `${NS.xsd}dateTime`),
      ),
    ).toBe(true);
    const without = graph({ "docs/a.md": "# A\n" });
    expect(without.some((q) => q.p === `${NS.prov}endedAtTime`)).toBe(false);
  });

  it("maps declared kg.revision-of like derived-from: resolved, URL, or broken", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  revision-of: [old.md, https://example.org/v1, gone.md]\n---\n",
      "docs/old.md": "# Old\n",
    });
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri(`${BASE}doc/docs/old.md`)),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri("https://example.org/v1")),
    ).toBe(true);
    expect(has(g, DOC, `${NS.dockg}brokenLink`, lit("gone.md"))).toBe(true);
  });

  it("fills dates from git history only when frontmatter has none", () => {
    const gitHistory: GitHistory = {
      files: new Map([
        [
          "docs/a.md",
          {
            created: "2026-01-01T10:00:00+00:00",
            modified: "2026-02-02T10:00:00+00:00",
            authors: ["Git Author"],
            renamedFrom: [],
          },
        ],
      ]),
    };
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, { gitHistory });
    expect(
      has(
        g,
        DOC,
        `${NS.dcterms}created`,
        lit("2026-01-01T10:00:00+00:00", `${NS.xsd}dateTime`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.dcterms}modified`,
        lit("2026-02-02T10:00:00+00:00", `${NS.xsd}dateTime`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.prov}wasAttributedTo`,
        iri(`${BASE}agent/person/git-author`),
      ),
    ).toBe(true);

    const fmWins = graph(
      { "docs/a.md": "---\ndate: 2025-05-05\nupdated: 2025-06-06\n---\n" },
      ALL_SOURCES,
      { gitHistory },
    );
    expect(
      fmWins.some(
        (q) => q.p === `${NS.dcterms}created` && q.o.value.startsWith("2026"),
      ),
    ).toBe(false);
    expect(
      has(
        fmWins,
        DOC,
        `${NS.dcterms}created`,
        lit("2025-05-05", `${NS.xsd}date`),
      ),
    ).toBe(true);
  });

  it("derives prov:wasRevisionOf edges from git renames", () => {
    const gitHistory: GitHistory = {
      files: new Map([
        [
          "docs/a.md",
          {
            authors: ["X"],
            renamedFrom: ["docs/old-name.md", "docs/older.md"],
          },
        ],
      ]),
    };
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, { gitHistory });
    const old = `${BASE}doc/docs/old-name.md`;
    expect(has(g, DOC, `${NS.prov}wasRevisionOf`, iri(old))).toBe(true);
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri(`${BASE}doc/docs/older.md`)),
    ).toBe(true);
    expect(has(g, old, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(true);
  });

  it("emits no graph-level block when the provenance source is off", () => {
    const g = graph({ "docs/a.md": "# A\n" }, ["frontmatter", "tags"]);
    expect(g.some((q) => q.s === `${BASE}graph`)).toBe(false);
    expect(g.some((q) => q.s === `${BASE}activity/build`)).toBe(false);
  });
});

describe("deriveGraph — qualified provenance", () => {
  it("qualifies author attribution with a deterministic node and role", () => {
    const g = graph(
      { "docs/a.md": "---\nauthor: Jane Doe\n---\n" },
      ALL_SOURCES,
      {
        qualified: true,
      },
    );
    const node = `${DOC}#prov.attribution.jane-doe`;
    expect(has(g, DOC, `${NS.prov}qualifiedAttribution`, iri(node))).toBe(true);
    expect(has(g, node, `${NS.rdf}type`, iri(`${NS.prov}Attribution`))).toBe(
      true,
    );
    expect(
      has(g, node, `${NS.prov}agent`, iri(`${BASE}agent/person/jane-doe`)),
    ).toBe(true);
    expect(has(g, node, `${NS.prov}hadRole`, iri(ROLE.author))).toBe(true);
    // direct property remains
    expect(
      has(
        g,
        DOC,
        `${NS.prov}wasAttributedTo`,
        iri(`${BASE}agent/person/jane-doe`),
      ),
    ).toBe(true);
  });

  it("qualifies generation and build associations", () => {
    const g = graph(
      { "docs/a.md": "---\ngenerated-by: model-x\n---\n" },
      ALL_SOURCES,
      { qualified: true },
    );
    // association nodes carry the agent slug so two agents on one activity
    // can never merge into a single node
    const genAssoc = `${DOC}#prov.generation.assoc.model-x`;
    expect(
      has(
        g,
        `${DOC}#prov.generation`,
        `${NS.prov}qualifiedAssociation`,
        iri(genAssoc),
      ),
    ).toBe(true);
    expect(
      has(g, genAssoc, `${NS.rdf}type`, iri(`${NS.prov}Association`)),
    ).toBe(true);
    expect(
      has(g, genAssoc, `${NS.prov}agent`, iri(`${BASE}agent/software/model-x`)),
    ).toBe(true);
    expect(has(g, genAssoc, `${NS.prov}hadRole`, iri(ROLE.generator))).toBe(
      true,
    );

    const buildAssoc = `${BASE}activity/build.assoc.dockg`;
    expect(
      has(
        g,
        `${BASE}activity/build`,
        `${NS.prov}qualifiedAssociation`,
        iri(buildAssoc),
      ),
    ).toBe(true);
    expect(has(g, buildAssoc, `${NS.prov}hadRole`, iri(ROLE.tool))).toBe(true);
  });

  it("emits zero qualified triples when the flag is off", () => {
    const g = graph({
      "docs/a.md": "---\nauthor: Jane\ngenerated-by: m\n---\n",
    });
    expect(g.some((q) => q.p.includes("qualified"))).toBe(false);
    expect(g.some((q) => q.p === `${NS.prov}hadRole`)).toBe(false);
  });
});

describe("deriveGraph — tags and concepts", () => {
  it("mints one concept per tag with subject edges and a scheme", () => {
    const g = graph({ "docs/a.md": "---\ntags: [setup]\n---\n" });
    const concept = `${BASE}concept/setup`;
    expect(has(g, DOC, `${NS.dcterms}subject`, iri(concept))).toBe(true);
    expect(has(g, concept, `${NS.rdf}type`, iri(`${NS.skos}Concept`))).toBe(
      true,
    );
    expect(has(g, concept, `${NS.skos}prefLabel`, lit("setup"))).toBe(true);
    expect(has(g, concept, `${NS.skos}inScheme`, iri(`${BASE}scheme`))).toBe(
      true,
    );
    expect(
      has(g, `${BASE}scheme`, `${NS.rdf}type`, iri(`${NS.skos}ConceptScheme`)),
    ).toBe(true);
  });

  it("identical tags across docs converge on one concept", () => {
    const g = graph({
      "docs/a.md": "---\ntags: [setup]\n---\n",
      "docs/b.md": "---\nkeywords: [setup]\n---\n",
    });
    const conceptQuads = g.filter(
      (q) => q.s === `${BASE}concept/setup` && q.p === `${NS.rdf}type`,
    );
    expect(conceptQuads).toHaveLength(1);
  });

  it("emits no scheme when no concepts exist", () => {
    const g = graph({ "docs/a.md": "# A\n" });
    expect(g.some((q) => q.s === `${BASE}scheme`)).toBe(false);
  });
});

describe("deriveGraph — sections", () => {
  it("nests sections under doc and parent sections with level and order", () => {
    const g = graph({ "docs/a.md": "# A\n\n## B\n" });
    const secA = `${DOC}#a`;
    const secB = `${DOC}#b`;
    expect(has(g, secA, `${NS.rdf}type`, iri(`${NS.dockg}Section`))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}hasPart`, iri(secA))).toBe(true);
    expect(has(g, secA, `${NS.dcterms}hasPart`, iri(secB))).toBe(true);
    expect(has(g, secB, `${NS.dockg}level`, lit("2", `${NS.xsd}integer`))).toBe(
      true,
    );
    expect(has(g, secB, `${NS.dockg}order`, lit("1", `${NS.xsd}integer`))).toBe(
      true,
    );
  });
});

describe("deriveGraph — links", () => {
  it("maps internal links to doc references, resolving anchors to sections", () => {
    const g = graph({
      "docs/a.md":
        "[to b](b.md)\n[to sec](b.md#setup)\n[dead anchor](b.md#nope)\n",
      "docs/b.md": "## Setup\n",
    });
    const target = `${BASE}doc/docs/b.md`;
    expect(has(g, DOC, `${NS.dcterms}references`, iri(target))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}references`, iri(`${target}#setup`))).toBe(
      true,
    );
    expect(has(g, DOC, `${NS.dcterms}references`, iri(`${target}#nope`))).toBe(
      false,
    );
  });

  it("maps external links and broken links", () => {
    const g = graph({
      "docs/a.md": "[x](https://example.org/x)\n[gone](missing.md)\n",
    });
    expect(
      has(g, DOC, `${NS.dcterms}references`, iri("https://example.org/x")),
    ).toBe(true);
    expect(has(g, DOC, `${NS.dockg}brokenLink`, lit("missing.md"))).toBe(true);
  });
});

describe("deriveGraph — kg sub-key (SKOS fields)", () => {
  it("mints a primary topic concept with labels and relations", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  label: Configuration\n  alt-labels: [config]\n  broader: [Administration]\n  related-concepts: [Installation]\n  concepts: [reference]\n---\n",
    });
    const c = `${BASE}concept/configuration`;
    expect(has(g, DOC, `${NS.foaf}primaryTopic`, iri(c))).toBe(true);
    expect(has(g, c, `${NS.skos}prefLabel`, lit("Configuration"))).toBe(true);
    expect(has(g, c, `${NS.skos}altLabel`, lit("config"))).toBe(true);
    expect(
      has(g, c, `${NS.skos}broader`, iri(`${BASE}concept/administration`)),
    ).toBe(true);
    expect(
      has(g, c, `${NS.skos}related`, iri(`${BASE}concept/installation`)),
    ).toBe(true);
    expect(
      has(
        g,
        `${BASE}concept/administration`,
        `${NS.rdf}type`,
        iri(`${NS.skos}Concept`),
      ),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}subject`, iri(`${BASE}concept/reference`)),
    ).toBe(true);
  });
});

describe("deriveGraph — iiRDS Core/Software typing (ADR 01012)", () => {
  it("references the published topic-type IRI", () => {
    const g = graph({ "docs/a.md": "---\nkg:\n  type: task\n---\n" });
    expect(
      has(g, DOC, `${NS.iirds}has-topic-type`, iri(`${NS.iirds}GenericTask`)),
    ).toBe(true);
  });

  it("mints a ProductVariant node per applies-to label", () => {
    const g = graph({
      "docs/a.md": "---\nkg:\n  applies-to: [SP-X100, SP-X200]\n---\n",
    });
    for (const [slug, label] of [
      ["sp-x100", "SP-X100"],
      ["sp-x200", "SP-X200"],
    ] as const) {
      const v = `${BASE}product/${slug}`;
      expect(has(g, DOC, `${NS.iirds}relates-to-product-variant`, iri(v))).toBe(
        true,
      );
      expect(has(g, v, `${NS.rdf}type`, iri(`${NS.iirds}ProductVariant`))).toBe(
        true,
      );
      expect(has(g, v, `${NS.dcterms}title`, lit(label))).toBe(true);
    }
  });

  it("splits software-domain values across their two predicates", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  about-product-lifecycle: [deployment, update]\n  about-product-aspect: [interface]\n---\n",
    });
    expect(
      has(
        g,
        DOC,
        `${NS.iirds}relates-to-product-lifecycle-phase`,
        iri(`${NS.iirdsSft}Deployment`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.iirds}relates-to-product-lifecycle-phase`,
        iri(`${NS.iirdsSft}Update`),
      ),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.iirds}has-subject`, iri(`${NS.iirdsSft}Interface`)),
    ).toBe(true);
  });

  it("emits no iiRDS triples when neither the kg block nor the page types it", () => {
    const g = graph({ "docs/a.md": "# A\n" });
    expect(g.some((q) => q.p.startsWith(NS.iirds))).toBe(false);
    expect(
      g.some((q) => q.o.kind === "iri" && q.o.value.startsWith(NS.iirdsSft)),
    ).toBe(false);
  });
});

/**
 * The harvest rule (ADR 01024): deeper wins, the page level is the fallback,
 * per fact. Each fact is exercised in all three states — block only, page only,
 * and both (where the block must win outright, never merge).
 */
describe("deriveGraph — the harvest rule (ADR 01024)", () => {
  const TOPIC_TYPE = `${NS.iirds}has-topic-type`;
  const VARIANT = `${NS.iirds}relates-to-product-variant`;

  it("derives kg.type from the page's type when the block is silent", () => {
    const g = graph({ "docs/a.md": "---\ntype: how-to\n---\n\n# A\n" });
    expect(has(g, DOC, TOPIC_TYPE, iri(`${NS.iirds}GenericTask`))).toBe(true);
  });

  it.each([
    ["how-to", "GenericTask"],
    ["tutorial", "GenericLearning"],
    ["explanation", "GenericConcept"],
    ["reference", "GenericReference"],
    ["troubleshooting", "GenericTroubleshooting"],
  ])("maps the page type %s onto iirds:%s", (pageType, expected) => {
    const g = graph({ "docs/a.md": `---\ntype: ${pageType}\n---\n\n# A\n` });
    expect(has(g, DOC, TOPIC_TYPE, iri(`${NS.iirds}${expected}`))).toBe(true);
  });

  it("derives nothing from a page type with no iiRDS counterpart", () => {
    // Inventing a topic type for an unmapped value would put a claim in the
    // graph nobody made. Silence is the correct output.
    const g = graph({ "docs/a.md": "---\ntype: blog-post\n---\n\n# A\n" });
    expect(g.some((q) => q.p === TOPIC_TYPE)).toBe(false);
  });

  it("lets an explicit kg.type win over the page's type", () => {
    const g = graph({
      "docs/a.md": "---\ntype: how-to\nkg:\n  type: reference\n---\n\n# A\n",
    });
    expect(has(g, DOC, TOPIC_TYPE, iri(`${NS.iirds}GenericReference`))).toBe(
      true,
    );
    expect(has(g, DOC, TOPIC_TYPE, iri(`${NS.iirds}GenericTask`))).toBe(false);
  });

  it("harvests page-level applies-to, and lets the block override it", () => {
    const fallback = graph({
      "docs/a.md": "---\napplies-to: [SP-X100]\n---\n\n# A\n",
    });
    expect(has(fallback, DOC, VARIANT, iri(`${BASE}product/sp-x100`))).toBe(
      true,
    );

    const deeper = graph({
      "docs/a.md":
        "---\napplies-to: [SP-X100]\nkg:\n  applies-to: [SP-X200]\n---\n\n# A\n",
    });
    expect(has(deeper, DOC, VARIANT, iri(`${BASE}product/sp-x200`))).toBe(true);
    // Deeper wins outright: the page-level value is replaced, not merged in.
    expect(has(deeper, DOC, VARIANT, iri(`${BASE}product/sp-x100`))).toBe(
      false,
    );
  });

  it("harvests page-level not-applicable-to, and lets the block override it", () => {
    const fallback = graph({
      "docs/a.md": "---\nnot-applicable-to: [SP-X300]\n---\n\n# A\n",
    });
    expect(
      has(
        fallback,
        DOC,
        `${NS.dockg}notApplicableToVariant`,
        iri(`${BASE}product/sp-x300`),
      ),
    ).toBe(true);

    const deeper = graph({
      "docs/a.md":
        "---\nnot-applicable-to: [SP-X300]\nkg:\n  not-applicable-to: [SP-X400]\n---\n\n# A\n",
    });
    expect(
      has(
        deeper,
        DOC,
        `${NS.dockg}notApplicableToVariant`,
        iri(`${BASE}product/sp-x300`),
      ),
    ).toBe(false);
  });

  it("harvests page-level concepts, and lets kg.concepts override them", () => {
    const fallback = graph({
      "docs/a.md": "---\nconcepts: [caching]\n---\n\n# A\n",
    });
    expect(
      has(fallback, DOC, `${NS.dcterms}subject`, iri(`${BASE}concept/caching`)),
    ).toBe(true);

    const deeper = graph({
      "docs/a.md":
        "---\nconcepts: [caching]\nkg:\n  concepts: [indexing]\n---\n\n# A\n",
    });
    expect(
      has(deeper, DOC, `${NS.dcterms}subject`, iri(`${BASE}concept/indexing`)),
    ).toBe(true);
    expect(
      has(deeper, DOC, `${NS.dcterms}subject`, iri(`${BASE}concept/caching`)),
    ).toBe(false);
  });

  it("keeps tags/keywords harvesting alongside the concepts fact", () => {
    // `tags` is dockg's own derive source, a different fact from `concepts` —
    // deeper-wins governs the kg/page concepts pair, not this union.
    const g = graph({
      "docs/a.md": "---\ntags: [setup]\nkg:\n  concepts: [indexing]\n---\n",
    });
    expect(
      has(g, DOC, `${NS.dcterms}subject`, iri(`${BASE}concept/setup`)),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}subject`, iri(`${BASE}concept/indexing`)),
    ).toBe(true);
  });

  it("harvests page-level supersedes as prov:wasRevisionOf", () => {
    const g = graph({
      "docs/a.md": "---\nsupersedes: [b.md]\n---\n\n# A\n",
      "docs/b.md": "# B\n",
    });
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri(`${BASE}doc/docs/b.md`)),
    ).toBe(true);
  });

  it("lets kg.revision-of win over the page's supersedes", () => {
    const g = graph({
      "docs/a.md":
        "---\nsupersedes: [b.md]\nkg:\n  revision-of: [c.md]\n---\n\n# A\n",
      "docs/b.md": "# B\n",
      "docs/c.md": "# C\n",
    });
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri(`${BASE}doc/docs/c.md`)),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri(`${BASE}doc/docs/b.md`)),
    ).toBe(false);
  });

  it("does not harvest docmeta:structure's own fields", () => {
    // prerequisites / next-steps / related-pages belong to another vocabulary.
    // Harvesting them here would claim a fact this one does not own.
    const g = graph({
      "docs/a.md":
        "---\nprerequisites: [b.md]\nnext-steps: [b.md]\nrelated-pages: [b.md]\n---\n\n# A\n",
      "docs/b.md": "# B\n",
    });
    expect(g.some((q) => q.p === `${NS.dcterms}requires`)).toBe(false);
    expect(g.some((q) => q.p === `${NS.dcterms}references`)).toBe(false);
  });

  it("normalizes the single-string shorthand on every list field", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  label: Config\n  alt-labels: config\n  broader: Admin\n  applies-to: SP-X100\n  about-product-aspect: interface\n---\n",
    });
    const topic = `${BASE}concept/config`;
    expect(has(g, topic, `${NS.skos}altLabel`, lit("config"))).toBe(true);
    expect(
      has(g, topic, `${NS.skos}broader`, iri(`${BASE}concept/admin`)),
    ).toBe(true);
    expect(has(g, DOC, VARIANT, iri(`${BASE}product/sp-x100`))).toBe(true);
    expect(
      has(g, DOC, `${NS.iirds}has-subject`, iri(`${NS.iirdsSft}Interface`)),
    ).toBe(true);
  });

  it("never harvests into section typing — sections stay explicit-only", () => {
    const g = graph({
      "docs/a.md":
        "---\ntype: how-to\napplies-to: [SP-X100]\nkg:\n  sections:\n    install:\n      type: reference\n---\n\n## Install\n",
    });
    const section = `${DOC}#install`;
    expect(
      has(g, section, TOPIC_TYPE, iri(`${NS.iirds}GenericReference`)),
    ).toBe(true);
    // the document's harvested applies-to must not leak down into the section
    expect(g.some((q) => q.s === section && q.p === VARIANT)).toBe(false);
  });
});

describe("deriveGraph — negative scope (ADR 01014)", () => {
  it("emits notApplicableToVariant + a ProductVariant node, and not-about-product-aspect", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  not-applicable-to: [SP-X300]\n  not-about-product-aspect: [architecture]\n---\n",
    });
    const v = `${BASE}product/sp-x300`;
    expect(has(g, DOC, `${NS.dockg}notApplicableToVariant`, iri(v))).toBe(true);
    expect(has(g, v, `${NS.rdf}type`, iri(`${NS.iirds}ProductVariant`))).toBe(
      true,
    );
    expect(has(g, v, `${NS.dcterms}title`, lit("SP-X300"))).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.dockg}notSoftwareSubject`,
        iri(`${NS.iirdsSft}Architecture`),
      ),
    ).toBe(true);
  });

  it("converges a variant used by both applies-to and not-applicable-to on one node", () => {
    // (A self-contradiction the SHACL sh:disjoint rule rejects — but derive
    // still emits both edges to one shared ProductVariant node.)
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  applies-to: [SP-X1]\n  not-applicable-to: [SP-X1]\n---\n",
    });
    const v = `${BASE}product/sp-x1`;
    expect(has(g, DOC, `${NS.iirds}relates-to-product-variant`, iri(v))).toBe(
      true,
    );
    expect(has(g, DOC, `${NS.dockg}notApplicableToVariant`, iri(v))).toBe(true);
    expect(g.filter((q) => q.s === v && q.p === `${NS.rdf}type`)).toHaveLength(
      1,
    );
  });

  it("attaches negative scope to a section too", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  sections:\n    install:\n      not-applicable-to: [SP-X9]\n      not-about-product-aspect: [interface]\n---\n\n# A\n\n## Install\n",
    });
    const SEC = `${DOC}#install`;
    expect(
      has(
        g,
        SEC,
        `${NS.dockg}notApplicableToVariant`,
        iri(`${BASE}product/sp-x9`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        SEC,
        `${NS.dockg}notSoftwareSubject`,
        iri(`${NS.iirdsSft}Interface`),
      ),
    ).toBe(true);
  });

  it("emits no negative-scope triples when the fields are absent", () => {
    const g = graph({ "docs/a.md": "---\nkg:\n  type: task\n---\n" });
    expect(g.some((q) => q.p === `${NS.dockg}notApplicableToVariant`)).toBe(
      false,
    );
    expect(g.some((q) => q.p === `${NS.dockg}notSoftwareSubject`)).toBe(false);
  });
});

describe("deriveGraph — section-level metadata (ADR 01013)", () => {
  const SEC = `${DOC}#install`;

  it("attaches iiRDS typing and concepts to the matching section node", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  sections:\n    install:\n      type: reference\n      applies-to: [SP-X200]\n      about-product-aspect: [interface]\n      concepts: [setup]\n---\n\n# A\n\n## Install\n",
    });
    expect(
      has(
        g,
        SEC,
        `${NS.iirds}has-topic-type`,
        iri(`${NS.iirds}GenericReference`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        SEC,
        `${NS.iirds}relates-to-product-variant`,
        iri(`${BASE}product/sp-x200`),
      ),
    ).toBe(true);
    expect(
      has(g, SEC, `${NS.iirds}has-subject`, iri(`${NS.iirdsSft}Interface`)),
    ).toBe(true);
    expect(
      has(g, SEC, `${NS.dcterms}subject`, iri(`${BASE}concept/setup`)),
    ).toBe(true);
  });

  it("emits dockg:brokenSectionRef for a key naming no heading", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  sections:\n    nope:\n      type: task\n---\n\n# A\n\n## Install\n",
    });
    expect(has(g, DOC, `${NS.dockg}brokenSectionRef`, lit("nope"))).toBe(true);
    // The unmatched key attaches nothing to any section node.
    expect(g.some((q) => q.p === `${NS.iirds}has-topic-type`)).toBe(false);
  });

  it("does not leak the document's typing onto sections (explicit-only)", () => {
    const g = graph({
      "docs/a.md": "---\nkg:\n  type: task\n---\n\n# A\n\n## Install\n",
    });
    // The doc is typed; the section is not.
    expect(
      has(g, DOC, `${NS.iirds}has-topic-type`, iri(`${NS.iirds}GenericTask`)),
    ).toBe(true);
    expect(
      g.some((q) => q.s === SEC && q.p === `${NS.iirds}has-topic-type`),
    ).toBe(false);
  });

  it("emits no section metadata when kg.sections is absent", () => {
    const g = graph({ "docs/a.md": "# A\n\n## Install\n" });
    expect(g.some((q) => q.p === `${NS.dockg}brokenSectionRef`)).toBe(false);
    expect(g.some((q) => q.s === SEC && q.p.startsWith(NS.iirds))).toBe(false);
  });

  it("requires the sections source (no section nodes, no metadata or broken ref)", () => {
    const g = graph(
      {
        "docs/a.md":
          "---\nkg:\n  sections:\n    install:\n      type: task\n    nope:\n      type: task\n---\n\n# A\n\n## Install\n",
      },
      ["frontmatter"],
    );
    // Sections source off: no section nodes, and no brokenSectionRef either
    // (every key would falsely read as broken without sections to match).
    expect(g.some((q) => q.p === `${NS.dockg}brokenSectionRef`)).toBe(false);
    expect(g.some((q) => q.s === SEC)).toBe(false);
  });

  it("gates section typing on the sections source, independent of frontmatter", () => {
    // ADR 01013's deliberate asymmetry: with `frontmatter` off but `sections`
    // on, the section still gets its iiRDS typing even though the document's
    // own kg typing (under `frontmatter`) does not.
    const g = graph(
      {
        "docs/a.md":
          "---\nkg:\n  type: concept\n  sections:\n    install:\n      type: task\n---\n\n# A\n\n## Install\n",
      },
      ["sections"],
    );
    expect(
      has(g, SEC, `${NS.iirds}has-topic-type`, iri(`${NS.iirds}GenericTask`)),
    ).toBe(true);
    // Document-level typing is gated by `frontmatter`, which is off here.
    expect(
      has(
        g,
        DOC,
        `${NS.iirds}has-topic-type`,
        iri(`${NS.iirds}GenericConcept`),
      ),
    ).toBe(false);
  });
});

describe("deriveGraph — images, code, derive toggles", () => {
  it("maps images and code languages", () => {
    const g = graph({
      "docs/a.md": "![i](img/x.png)\n\n```python\np\n```\n",
    });
    expect(
      has(g, DOC, `${NS.schema}image`, iri(`${BASE}file/docs/img/x.png`)),
    ).toBe(true);
    expect(has(g, DOC, `${NS.dockg}codeLanguage`, lit("python"))).toBe(true);
  });

  it("respects derive source toggles", () => {
    const g = graph(
      { "docs/a.md": "---\ntitle: T\ntags: [x]\n---\n\n## S\n" },
      ["frontmatter"],
    );
    expect(has(g, DOC, `${NS.dcterms}title`, lit("T"))).toBe(true);
    expect(g.some((q) => q.p === `${NS.dcterms}subject`)).toBe(false);
    expect(g.some((q) => q.p === `${NS.dcterms}hasPart`)).toBe(false);
  });

  it("deduplicates repeated quads", () => {
    const g = graph({
      "docs/a.md": "[x](b.md)\n[y](b.md)\n",
      "docs/b.md": "# B\n",
    });
    const refs = g.filter(
      (q) => q.s === DOC && q.p === `${NS.dcterms}references`,
    );
    expect(refs).toHaveLength(1);
  });
});

describe("deriveGraph — localization (ADR 01037)", () => {
  const EN_DOC = `${BASE}doc/docs/a.md`;
  const DE_DOC = `${BASE}doc/docs/de/a.md`;
  const FR_DOC = `${BASE}doc/docs/fr/a.md`;

  const route = (
    root: string,
    basePath: string,
    language?: string,
  ): RouteMapping => ({
    basePath,
    root,
    extensions: [".md"],
    indexFiles: ["index"],
    ...(language === undefined ? {} : { language }),
  });

  /** Like `graph()`, but the docs are analyzed against route mappings. */
  function localized(
    files: Record<string, string>,
    routes: RouteMapping[],
  ): Quad[] {
    const paths = new Set(Object.keys(files));
    const models = Object.entries(files).map(([path, content]) =>
      analyzeDoc(content, path, paths, { routes }),
    );
    return deriveGraph(models, {
      baseIri: BASE,
      derive: ALL_SOURCES,
      toolVersion: "0.0.0-test",
    });
  }

  const LOCALE_ROUTES = [route("docs/de", "/de", "de"), route("docs", "")];

  it("labels a document with the language of its enclosing route", () => {
    const g = localized(
      { "docs/de/a.md": "# A\n", "docs/a.md": "# A\n" },
      LOCALE_ROUTES,
    );
    expect(has(g, DE_DOC, `${NS.dcterms}language`, lit("de"))).toBe(true);
  });

  it("derives no language when no route and no page declares one", () => {
    const g = localized({ "docs/a.md": "# A\n" }, LOCALE_ROUTES);
    expect(
      g.some((q) => q.s === EN_DOC && q.p === `${NS.dcterms}language`),
    ).toBe(false);
  });

  it("lets page frontmatter override the route language", () => {
    const g = localized(
      { "docs/de/a.md": "---\nlang: de-AT\n---\n\n# A\n" },
      LOCALE_ROUTES,
    );
    expect(has(g, DE_DOC, `${NS.dcterms}language`, lit("de-AT"))).toBe(true);
    expect(has(g, DE_DOC, `${NS.dcterms}language`, lit("de"))).toBe(false);
  });

  it("inherits the nearest enclosing route that declares a language", () => {
    const g = localized({ "docs/api/a.md": "# A\n" }, [
      route("docs/api", "/api"),
      route("docs", "", "en"),
    ]);
    expect(
      has(g, `${BASE}doc/docs/api/a.md`, `${NS.dcterms}language`, lit("en")),
    ).toBe(true);
  });

  it("links a translation to its source in both directions", () => {
    const g = localized(
      {
        "docs/a.md": "# A\n",
        "docs/de/a.md": "---\ntranslation-of: ../a.md\n---\n\n# A\n",
      },
      LOCALE_ROUTES,
    );
    expect(has(g, DE_DOC, `${NS.schema}translationOfWork`, iri(EN_DOC))).toBe(
      true,
    );
    expect(has(g, EN_DOC, `${NS.schema}workTranslation`, iri(DE_DOC))).toBe(
      true,
    );
  });

  it("lists every translation on the source document", () => {
    const g = localized(
      {
        "docs/a.md": "# A\n",
        "docs/de/a.md": "---\ntranslation-of: docs/a.md\n---\n\n# A\n",
        "docs/fr/a.md": "---\ntranslation-of: docs/a.md\n---\n\n# A\n",
      },
      [
        route("docs/de", "/de", "de"),
        route("docs/fr", "/fr", "fr"),
        route("docs", ""),
      ],
    );
    const translations = g
      .filter((q) => q.s === EN_DOC && q.p === `${NS.schema}workTranslation`)
      .map((q) => q.o.value);
    expect(translations.sort()).toEqual([DE_DOC, FR_DOC].sort());
  });

  it("records an unresolvable translation-of as a broken link", () => {
    const g = localized(
      { "docs/de/a.md": "---\ntranslation-of: ../missing.md\n---\n\n# A\n" },
      LOCALE_ROUTES,
    );
    expect(has(g, DE_DOC, `${NS.dockg}brokenLink`, lit("../missing.md"))).toBe(
      true,
    );
    expect(
      g.some((q) => q.s === DE_DOC && q.p === `${NS.schema}translationOfWork`),
    ).toBe(false);
  });

  it("emits no inverse for a translation-of naming a URL outside the corpus", () => {
    const url = "https://example.org/en/a";
    const g = localized(
      { "docs/de/a.md": `---\ntranslation-of: ${url}\n---\n\n# A\n` },
      LOCALE_ROUTES,
    );
    expect(has(g, DE_DOC, `${NS.schema}translationOfWork`, iri(url))).toBe(
      true,
    );
    expect(g.some((q) => q.s === url)).toBe(false);
  });
});
