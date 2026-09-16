/**
 * Proof that the RDF/JS seam (ADR 01018) is real: a genuine SPARQL 1.1 engine
 * answers queries over a `GraphIndex`'s quads. Comunica is a **devDependency**
 * — CI weight only, never shipped; the runtime itself stays dependency-free.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { GraphIndex } from "../../../src/kg/runtime/graph.js";
import { matchQuads, rdfjsQuads } from "../../../src/kg/runtime/rdfjs.js";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const goldenJsonLd = join(root, "test", "kg", "fixtures", "golden", "graph.jsonld");

function corpusIndex(): GraphIndex {
  return GraphIndex.fromJsonLd(readFileSync(goldenJsonLd, "utf8"));
}

/** The documented custom-SPARQL recipe: quads → any RDF/JS store → engine. */
function sparqlSource(graph: GraphIndex) {
  return new Store(
    rdfjsQuads(graph) as unknown as ConstructorParameters<typeof Store>[0],
  );
}

// Comunica does real engine setup on first query. Under a full parallel test
// run that cold start has exceeded the default timeout, so give this file room
// rather than leaving a known-flaky test for CI to trip over.
describe("custom SPARQL over the runtime index", { timeout: 60_000 }, () => {
  it("answers a SELECT via an RDF/JS store built from rdfjsQuads", async () => {
    const engine = new QueryEngine();
    const stream = await engine.queryBindings(
      `SELECT ?title WHERE { ?doc <${RDF_TYPE}> <${NS.dockg}Document> ;
                                  <${NS.dcterms}title> ?title . }`,
      { sources: [sparqlSource(corpusIndex())] },
    );
    const titles = (await stream.toArray())
      .map((b) => b.get("title")?.value)
      .sort();
    expect(titles).toEqual([
      "Configuration Reference",
      "Erste Schritte",
      "Getting Started",
      "Loose Notes",
      "Premiers pas",
      "Regionale Hinweise",
      "Upgrading",
      "Windows Notes",
    ]);
  });

  it("answers a JOIN the walker would express as a traversal", async () => {
    const engine = new QueryEngine();
    const stream = await engine.queryBindings(
      `SELECT ?target WHERE {
         ?doc <${NS.dockg}path> "docs/windows-notes.md" ;
              <${NS.dcterms}references> ?target . }`,
      { sources: [sparqlSource(corpusIndex())] },
    );
    const targets = (await stream.toArray()).map((b) => b.get("target")?.value);
    expect(targets).toEqual([
      "https://example.com/kg/doc/docs/configuration.md",
    ]);
  });

  it("emits quads equal in count to the graph's triples", () => {
    const graph = corpusIndex();
    const quads = rdfjsQuads(graph);
    // Same triple count the build reports for the corpus.
    expect(quads.length).toBe(220);
    expect(
      new Store(quads as unknown as ConstructorParameters<typeof Store>[0])
        .size,
    ).toBe(220);
  });
});

describe("matchQuads", () => {
  it("filters by subject, predicate, and object as RDF/JS quads", () => {
    const graph = corpusIndex();
    const doc = "https://example.com/kg/doc/docs/windows-notes.md";
    const titles = matchQuads(graph, doc, `${NS.dcterms}title`);
    expect(titles).toHaveLength(1);
    expect(titles[0]!.object.value).toBe("Windows Notes");
    expect(titles[0]!.subject.termType).toBe("NamedNode");

    const docs = matchQuads(graph, null, RDF_TYPE, `${NS.dockg}Document`);
    expect(docs).toHaveLength(8);
  });
});
