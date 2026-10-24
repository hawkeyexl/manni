/**
 * Strategy typing (proposal 0110, D3): an audience, persona or journey record
 * mints one node, its file names it as its topic, and a reference derives an
 * edge only to a record that is in the build.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../../../src/graph/commands/build.js";
import { parseGraph, storeToQuads } from "../../../src/graph/core/load.js";
import { NS, RDF_TYPE } from "../../../src/graph/core/vocab.js";
import type { Quad } from "../../../src/graph/core/derive.js";

const fixture = join(import.meta.dirname, "..", "fixtures", "strategy");
const BASE = "https://example.com/graph/";
const doc = (path: string): string => `${BASE}doc/${path}`;
const entity = (type: string, id: string): string => `${BASE}strategy/${type}/${id}`;

const AUDIENCE = `${NS.schema}audience`;
const PART_OF = `${NS.dcterms}isPartOf`;
const TOPIC = `${NS.foaf}primaryTopic`;

async function quadsOf(collection?: string[]): Promise<Quad[]> {
  const { turtle } = await buildGraph({ cwd: fixture, ...(collection === undefined ? {} : { collection }) });
  return storeToQuads(parseGraph(turtle, "the built graph"));
}

const objects = (quads: Quad[], s: string, p: string): string[] =>
  quads.filter((q) => q.s === s && q.p === p).map((q) => q.o.value).sort();

describe("strategy records in the graph (0110 D3)", () => {
  it("types each record and names it as its file's topic", async () => {
    const quads = await quadsOf();
    expect(objects(quads, entity("audience", "ci-engineers"), RDF_TYPE)).toEqual([`${NS.schema}Audience`]);
    expect(objects(quads, entity("persona", "devin"), RDF_TYPE)).toEqual([`${NS.schema}PeopleAudience`]);
    expect(objects(quads, entity("journey", "D1"), RDF_TYPE)).toEqual([`${NS.graph}Journey`]);
    expect(objects(quads, entity("persona", "devin"), `${NS.dcterms}title`)).toEqual(["Devin, CI engineer"]);
    expect(objects(quads, doc("strategy/personas/devin.md"), TOPIC)).toEqual([entity("persona", "devin")]);
    expect(objects(quads, doc("strategy/journeys/d1.md"), TOPIC)).toEqual([entity("journey", "D1")]);
  });

  it("leaves a record's topic to its graph block when the block names one", async () => {
    const quads = await quadsOf();
    expect(objects(quads, doc("strategy/journeys/labelled.md"), TOPIC)).toEqual([`${BASE}concept/releases`]);
    expect(objects(quads, entity("journey", "j2"), RDF_TYPE)).toEqual([`${NS.graph}Journey`]);
  });

  it("links a persona to its audience and a journey to its personas", async () => {
    const quads = await quadsOf();
    expect(objects(quads, entity("persona", "devin"), PART_OF)).toEqual([entity("audience", "ci-engineers")]);
    expect(objects(quads, entity("journey", "D1"), AUDIENCE)).toEqual([entity("persona", "devin")]);
  });

  it("links a page to the records it names, ignoring case, and only to records in the build", async () => {
    const quads = await quadsOf();
    expect(objects(quads, doc("docs/page.md"), AUDIENCE)).toEqual([
      entity("audience", "ci-engineers"),
      entity("persona", "devin"),
    ]);
    expect(objects(quads, doc("docs/page.md"), PART_OF)).toEqual([entity("journey", "D1")]);
  });

  it("derives nothing from an id no record declares", async () => {
    const quads = await quadsOf();
    expect(objects(quads, entity("persona", "maya"), PART_OF)).toEqual([]);
    const strangers = quads.filter((q) => /strategy\/[a-z]+\/(nobody|missing|ghost|docs-engineers)$/.test(q.o.value));
    expect(strangers).toEqual([]);
  });

  it("derives no strategy node or edge when no record is in the build", async () => {
    const quads = await quadsOf(["pages"]);
    expect(quads.filter((q) => q.s.startsWith(`${BASE}strategy/`) || q.o.value.startsWith(`${BASE}strategy/`))).toEqual([]);
  });

  it("counts the records in the build", async () => {
    const all = await buildGraph({ cwd: fixture });
    const pages = await buildGraph({ cwd: fixture, collection: ["pages"] });
    expect(all.strategyRecords).toBeGreaterThan(0);
    expect(all.strategyRecords).toBe(
      (await quadsOf()).filter((q) => q.p === RDF_TYPE && q.s.startsWith(`${BASE}strategy/`)).length,
    );
    expect(pages.strategyRecords).toBe(0);
  });
});
