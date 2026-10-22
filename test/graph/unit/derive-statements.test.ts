/**
 * Inline `meta` statements in the graph (proposal 0099, decisions 10a, 10c and
 * 10e). A heading statement types its section exactly as `graph.sections`
 * does, a block statement mints a `graph:Block`, and the verification fields
 * read the same at the document, section and block levels.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import { ALL_DERIVE_SOURCES } from "../../../src/graph/core/config.js";
import { deriveGraph, type Quad } from "../../../src/graph/core/derive.js";
import { NS, RDF_TYPE } from "../../../src/graph/core/vocab.js";
import { GraphIndex } from "../../../src/graph/runtime/graph.js";
import { traverse } from "../../../src/graph/runtime/traverse.js";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "statements",
);
const BASE = "https://example.com/graph/";
const PAGES = ["heading-statement.md", "graph-sections.md", "page.md", "fields.md"].map(
  (name) => `docs/${name}`,
);

function build(): Quad[] {
  const paths = new Set(PAGES);
  const docs = PAGES.map((path) =>
    analyzeDoc(readFileSync(join(fixture, path), "utf8"), path, paths),
  );
  return deriveGraph(docs, { baseIri: BASE, derive: ALL_DERIVE_SOURCES });
}

const quads = build();
const doc = (name: string): string => `${BASE}doc/docs/${name}`;
const g = (local: string): string => `${NS.graph}${local}`;
const XSD_DATE = `${NS.xsd}date`;
const XSD_DATETIME = `${NS.xsd}dateTime`;
const HAS_PART = `${NS.dcterms}hasPart`;

/** One subject's triples as sortable strings, with its own IRI written `<s>`. */
function triplesOf(subject: string): string[] {
  return quads
    .filter((q) => q.s === subject)
    .map((q) => `${q.p} ${q.o.kind === "iri" ? q.o.value : JSON.stringify(q.o)}`)
    .sort();
}

const has = (s: string, p: string, o: Quad["o"]): boolean =>
  quads.some(
    (q) =>
      q.s === s &&
      q.p === p &&
      q.o.kind === o.kind &&
      q.o.value === o.value &&
      (o.kind === "iri" || (q.o.kind === "literal" && q.o.datatype === o.datatype)),
  );
const iri = (value: string): Quad["o"] => ({ kind: "iri", value });
const lit = (value: string, datatype?: string): Quad["o"] =>
  datatype === undefined ? { kind: "literal", value } : { kind: "literal", value, datatype };

describe("a heading statement (decision 10a)", () => {
  it("gives its section exactly the triples graph.sections gives", () => {
    const inline = `${doc("heading-statement.md")}#install-on-windows`;
    const front = `${doc("graph-sections.md")}#install-on-windows`;
    expect(triplesOf(inline).length).toBeGreaterThan(4);
    expect(triplesOf(inline)).toEqual(triplesOf(front));
  });

  it("finds its section by the heading's line in a tree format too", () => {
    const path = "guide.adoc";
    const content = '= Guide\n\nLead.\n\n// (meta {"applies-to":["linux"]})\n== Install\n\nRun it.\n';
    const docs = [analyzeDoc(content, path, new Set([path]))];
    const out = deriveGraph(docs, { baseIri: BASE, derive: ALL_DERIVE_SOURCES });
    const [install] = docs[0]?.sections.filter((s) => s.title === "Install") ?? [];
    expect(install?.line).toBe(6);
    const section = `${BASE}doc/${path}#${install?.slug ?? ""}`;
    expect(
      out.some(
        (q) =>
          q.s === section &&
          q.p === `${NS.iirds}relates-to-product-variant` &&
          q.o.value === `${BASE}product/linux`,
      ),
    ).toBe(true);
    expect(out.some((q) => q.o.value === g("Block"))).toBe(false);
  });

  it("types the section on a page that also carries blocks", () => {
    const section = `${doc("page.md")}#install-on-windows`;
    expect(has(section, `${NS.iirds}has-topic-type`, iri(`${NS.iirds}GenericTask`))).toBe(true);
    expect(has(section, `${NS.iirds}relates-to-product-variant`, iri(`${BASE}product/windows`))).toBe(true);
    // ADR 01013: a section carries only what was said about it.
    expect(has(`${doc("page.md")}#install-on-linux`, `${NS.iirds}has-topic-type`, iri(`${NS.iirds}GenericTask`))).toBe(false);
  });
});

describe("block statements (decision 10c)", () => {
  const page = doc("page.md");

  it("mints one graph:Block per statement, numbered within its section", () => {
    const blocks = quads
      .filter((q) => q.p === RDF_TYPE && q.o.value === g("Block"))
      .map((q) => q.s)
      .filter((s) => s.startsWith(`${page}#`))
      .sort();
    expect(blocks).toEqual([
      `${page}#.1`,
      `${page}#install-on-linux.1`,
      `${page}#install-on-windows.1`,
      `${page}#install-on-windows.2`,
    ]);
  });

  it("hangs each block off its section, or off the document before any heading", () => {
    expect(has(page, HAS_PART, iri(`${page}#.1`))).toBe(true);
    expect(has(`${page}#install-on-windows`, HAS_PART, iri(`${page}#install-on-windows.1`))).toBe(true);
    expect(has(`${page}#install-on-windows`, HAS_PART, iri(`${page}#install-on-windows.2`))).toBe(true);
    expect(has(`${page}#install-on-linux`, HAS_PART, iri(`${page}#install-on-linux.1`))).toBe(true);
  });

  it("records lines, pin and pin status as meta computes them", () => {
    const one = `${page}#install-on-windows.1`;
    expect(has(one, g("lines"), lit("18-19"))).toBe(true);
    expect(
      has(one, g("pin"), lit("sha256-b7357401f7906223d41496f7168418e86f41cab0d2ebdf8ac8b6bb182818f7b7")),
    ).toBe(true);
    expect(has(one, g("pinStatus"), lit("current"))).toBe(true);

    expect(has(`${page}#install-on-windows.2`, g("lines"), lit("22"))).toBe(true);
    expect(has(`${page}#install-on-windows.2`, g("pinStatus"), lit("unpinned"))).toBe(true);
    expect(triplesOf(`${page}#install-on-windows.2`).some((t) => t.startsWith(g("pin") + " "))).toBe(false);

    expect(has(`${page}#install-on-linux.1`, g("pinStatus"), lit("changed"))).toBe(true);
  });

  it("maps the statement's fields as the document node maps front matter", () => {
    expect(has(`${page}#.1`, `${NS.dcterms}subject`, iri(`${BASE}concept/setup`))).toBe(true);
    expect(has(`${page}#install-on-linux.1`, g("lastVerified"), lit("2026-10-01", XSD_DATE))).toBe(true);
    const one = `${page}#install-on-windows.1`;
    expect(has(one, g("lastVerified"), lit("2026-10-21T08:00:00Z", XSD_DATETIME))).toBe(true);
    const v = `${one}/verified-by/1`;
    expect(has(one, g("verifiedBy"), iri(v))).toBe(true);
    expect(triplesOf(v)).toEqual(
      [
        `${RDF_TYPE} ${g("Verification")}`,
        `${g("tool")} ${JSON.stringify(lit("doc-detective"))}`,
        `${g("check")} ${JSON.stringify(lit("install-windows"))}`,
        `${g("version")} ${JSON.stringify(lit("4.27.0"))}`,
        `${g("passed")} ${JSON.stringify(lit("2026-10-21T08:00:00Z", XSD_DATETIME))}`,
      ].sort(),
    );
  });
});

describe("a statement's other fields derive as front matter does (decisions 10a and 10c)", () => {
  const page = doc("fields.md");
  const section = `${page}#install-on-windows`;
  const block = `${page}#install-on-windows.1`;
  const DC = NS.dcterms;
  const PROV = NS.prov;

  it("titles a block from its statement, and keeps a section's heading as its title", () => {
    expect(has(block, `${DC}title`, lit("The download step"))).toBe(true);
    expect(quads.filter((q) => q.s === section && q.p === `${DC}title`).map((q) => q.o.value)).toEqual([
      "Install on Windows",
    ]);
  });

  it("maps description, authors and dates", () => {
    expect(has(section, `${DC}description`, lit("How the Windows install goes."))).toBe(true);
    expect(has(block, `${DC}description`, lit("Get the installer."))).toBe(true);
    expect(has(section, `${DC}creator`, iri(`${BASE}agent/person/ada`))).toBe(true);
    expect(has(section, `${PROV}wasAttributedTo`, iri(`${BASE}agent/person/ada`))).toBe(true);
    expect(has(block, `${DC}creator`, iri(`${BASE}agent/person/grace`))).toBe(true);
    expect(has(section, `${DC}created`, lit("2026-09-01", XSD_DATE))).toBe(true);
    expect(has(section, `${PROV}generatedAtTime`, lit("2026-09-01", XSD_DATE))).toBe(true);
    expect(has(section, `${DC}modified`, lit("2026-10-02", XSD_DATE))).toBe(true);
    expect(has(block, `${DC}created`, lit("2026-09-03", XSD_DATE))).toBe(true);
    expect(has(block, `${DC}modified`, lit("2026-10-03", XSD_DATE))).toBe(true);
  });

  it("writes only the language a statement declares, and reads its labels in the page's otherwise", () => {
    expect(has(section, `${DC}language`, lit("de"))).toBe(true);
    expect(quads.some((q) => q.s === block && q.p === `${DC}language`)).toBe(false);
    const question = (s: string) =>
      quads.find((q) => q.s === s && q.p === g("sampleQuestion"))?.o;
    expect(question(section)).toEqual({ kind: "literal", value: "How do I install on Windows?", language: "de" });
    expect(question(block)).toEqual({ kind: "literal", value: "Where is the installer?", language: "en" });
  });

  it("maps tags and keywords to dcterms:subject", () => {
    expect(has(section, `${DC}subject`, iri(`${BASE}concept/windows`))).toBe(true);
    expect(has(block, `${DC}subject`, iri(`${BASE}concept/download`))).toBe(true);
  });

  it("maps supersedes, translation-of and provenance, and puts a broken target on the page", () => {
    expect(has(section, `${PROV}wasRevisionOf`, iri(doc("graph-sections.md")))).toBe(true);
    expect(has(block, `${PROV}wasRevisionOf`, iri(doc("heading-statement.md")))).toBe(true);
    expect(has(section, `${NS.schema}translationOfWork`, iri(doc("page.md")))).toBe(true);
    expect(has(doc("page.md"), `${NS.schema}workTranslation`, iri(section))).toBe(true);
    expect(has(page, g("brokenLink"), lit("./missing.md"))).toBe(true);
    expect(quads.some((q) => q.s === block && q.p === g("brokenLink"))).toBe(false);
    expect(has(section, `${PROV}wasGeneratedBy`, iri(`${section}.prov.generation`))).toBe(true);
    expect(has(`${section}.prov.generation`, `${PROV}wasAssociatedWith`, iri(`${BASE}agent/software/model-a`))).toBe(true);
    expect(has(block, `${PROV}wasGeneratedBy`, iri(`${block}.prov.generation`))).toBe(true);
  });

  it("verifies a section from its heading statement", () => {
    expect(has(section, g("lastVerified"), lit("2026-10-21", XSD_DATE))).toBe(true);
    const v = `${section}/verified-by/1`;
    expect(has(section, g("verifiedBy"), iri(v))).toBe(true);
    expect(has(v, g("tool"), lit("doc-detective"))).toBe(true);
    expect(has(v, g("check"), lit("install-section"))).toBe(true);
  });
});

describe("verification on the document node (decision 10e)", () => {
  it("delivers front-matter last-verified and verified-by with the block predicates", () => {
    const page = doc("page.md");
    expect(has(page, g("lastVerified"), lit("2026-10-21", XSD_DATE))).toBe(true);
    const v = `${page}#/verified-by/1`;
    expect(has(page, g("verifiedBy"), iri(v))).toBe(true);
    expect(has(v, RDF_TYPE, iri(g("Verification")))).toBe(true);
    expect(has(v, g("tool"), lit("doc-detective"))).toBe(true);
    expect(has(v, g("check"), lit("install-page"))).toBe(true);
    expect(has(v, g("version"), lit("4.27.0"))).toBe(true);
    expect(has(v, g("passed"), lit("2026-10-21", XSD_DATE))).toBe(true);
  });
});

describe("traversal and block nodes", () => {
  it("never steps into a graph:Block or its graph:Verification", () => {
    const graph = GraphIndex.fromQuads(quads);
    const page = doc("page.md");
    const { nodes, trace } = traverse(graph, { seeds: [page], depth: 3, direction: "both" });
    const reached = new Set([...nodes.map((n) => n.iri), ...trace.hops.map((h) => h.to)]);
    expect(reached.has(`${page}#install-on-windows`)).toBe(true);
    for (const node of reached) {
      expect(graph.types(node), node).not.toContain(g("Block"));
      expect(graph.types(node), node).not.toContain(g("Verification"));
    }
    expect(graph.instancesOf(g("Block")).length).toBeGreaterThan(0);
  });
});
