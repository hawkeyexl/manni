/**
 * What a build without author-facing content leaves out (proposal 0110, D2):
 * every strategy record, and every value a page's schemas mark
 * `x-manni-location: external`, at any depth. `x-manni-graph-output: false`
 * keeps a field out in both modes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../../../src/graph/commands/build.js";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import type { Quad } from "../../../src/graph/core/derive.js";
import { openMetaView, withExternalMetadata } from "../../../src/graph/core/external.js";
import { suppressGraphOutput, userFacing } from "../../../src/graph/core/graph-output.js";
import { parseGraph, storeToQuads } from "../../../src/graph/core/load.js";
import { NS, RDF_TYPE } from "../../../src/graph/core/vocab.js";

const fixture = join(import.meta.dirname, "..", "fixtures", "authoring");
const BASE = "https://example.com/graph/";
const PAGE = `${BASE}doc/docs/authored.md`;
const OLD = `${BASE}doc/docs/old.md`;

async function quadsOf(authoring?: boolean): Promise<Quad[]> {
  const { turtle } = await buildGraph({ cwd: fixture, ...(authoring === undefined ? {} : { authoring }) });
  return storeToQuads(parseGraph(turtle, "the built graph"));
}

const has = (quads: Quad[], s: string, p: string, o?: string): boolean =>
  quads.some((q) => q.s === s && q.p === p && (o === undefined || q.o.value === o));

describe("graph build without author-facing content (0110 D2)", () => {
  it("leaves every strategy record out of the document set", async () => {
    const on = await quadsOf();
    const off = await quadsOf(false);
    const record = `${BASE}doc/strategy/pat.md`;
    expect(has(on, record, RDF_TYPE, `${NS.graph}Document`)).toBe(true);
    expect(has(off, record, RDF_TYPE)).toBe(false);
    expect(off.filter((q) => q.s.startsWith(`${BASE}strategy/`) || q.o.value.startsWith(`${BASE}strategy/`))).toEqual([]);
    expect((await buildGraph({ cwd: fixture, authoring: false })).strategyRecords).toBe(0);
  });

  it("resolves a link to a record as a link to a file outside the build", async () => {
    const off = await quadsOf(false);
    expect(has(off, PAGE, `${NS.dcterms}references`, `${BASE}doc/strategy/pat.md`)).toBe(false);
    expect(has(off, PAGE, `${NS.graph}brokenLink`, "../strategy/pat.md")).toBe(true);
  });

  it("drops created, from the page and from a statement", async () => {
    const created = (quads: Quad[]) =>
      quads.filter((q) => q.p === `${NS.dcterms}created`).map((q) => q.o.value);
    expect(created(await quadsOf())).toEqual(expect.arrayContaining(["2024-01-02", "2024-02-03"]));
    const off = created(await quadsOf(false));
    expect(off).not.toContain("2024-01-02");
    expect(off).not.toContain("2024-02-03");
  });

  it("drops the revision-of fallback supersedes feeds", async () => {
    expect(has(await quadsOf(), PAGE, `${NS.prov}wasRevisionOf`, OLD)).toBe(true);
    expect(has(await quadsOf(false), PAGE, `${NS.prov}wasRevisionOf`, OLD)).toBe(false);
  });

  it("drops the PROV triples provenance and meta-provenance derive", async () => {
    const generation = `${PAGE}#prov.generation`;
    const fill = `${PAGE}#prov.graph-fill.model-y`;
    const on = await quadsOf();
    const off = await quadsOf(false);
    expect(has(on, PAGE, `${NS.prov}wasGeneratedBy`, generation)).toBe(true);
    expect(has(on, fill, RDF_TYPE)).toBe(true);
    expect(off.some((q) => q.s === generation || q.o.value === generation)).toBe(false);
    expect(off.some((q) => q.s === fill)).toBe(false);
  });

  it("drops the authors a schema prefers in a sidecar", async () => {
    const ada = `${BASE}agent/person/ada-lovelace`;
    expect(has(await quadsOf(), PAGE, `${NS.dcterms}creator`, ada)).toBe(true);
    expect(has(await quadsOf(false), PAGE, `${NS.dcterms}creator`, ada)).toBe(false);
  });

  it("keeps what the page carries for its readers", async () => {
    const off = await quadsOf(false);
    expect(has(off, PAGE, `${NS.dcterms}title`, "Retry an upload")).toBe(true);
    expect(has(off, PAGE, `${NS.foaf}primaryTopic`, `${BASE}concept/retries`)).toBe(true);
  });
});

describe("userFacing, the field rule (0110 D2)", () => {
  async function read(): Promise<{ docs: Awaited<ReturnType<typeof withExternalMetadata>>; view: Awaited<ReturnType<typeof openMetaView>> }> {
    const path = "docs/authored.md";
    const doc = await analyzeDoc(readFileSync(join(fixture, path), "utf8"), path, new Set([path]));
    const view = await openMetaView({ configPath: "manni.config.yaml" }, fixture, [path]);
    return { docs: await withExternalMetadata([doc], view), view };
  }

  it("drops an external value at any depth, and keeps its page-level siblings", async () => {
    const { docs, view } = await read();
    const [page] = await userFacing(docs, view);
    const fm = page?.frontmatter ?? {};
    for (const key of ["created", "authors", "supersedes", "provenance", "meta-provenance", "citations", "personas", "journeys"]) {
      expect(fm, key).not.toHaveProperty(key);
    }
    expect(fm["review"]).toEqual({ status: "done" });
    expect(fm["audiences"]).toEqual(["readers"]);
    expect(page?.statements?.[0]?.data).toEqual({ "applies-to": ["cli"] });
  });

  it("keeps an x-manni-graph-output: false field out in both modes", async () => {
    const { docs, view } = await read();
    const [on] = await suppressGraphOutput(docs, view);
    const [off] = await suppressGraphOutput(await userFacing(docs, view), view);
    expect(docs[0]?.frontmatter).toHaveProperty("internal");
    expect(on?.frontmatter).not.toHaveProperty("internal");
    expect(off?.frontmatter).not.toHaveProperty("internal");
  });

  it("returns a page that holds no external value as it came in", async () => {
    const path = "plain/install.md";
    const doc = await analyzeDoc(readFileSync(join(fixture, path), "utf8"), path, new Set([path]));
    const view = await openMetaView({ configPath: "manni.config.yaml" }, fixture, [path]);
    const [same] = await userFacing([doc], view);
    expect(same).toBe(doc);
  });
});
