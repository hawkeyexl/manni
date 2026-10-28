/**
 * graph reads a MadCap Flare topic through lint's resolved view (proposal
 * 0125, decisions 13 and 15): a snippet's sections and resolved variables
 * reach the graph and the search index, links stay what the file says, and
 * the parse cache steps aside for a topic whose view depends on other files.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import { AnalyzeCache } from "../../../src/graph/core/analyze-cache.js";
import { parseContexts } from "../../../src/graph/core/discover.js";
import { buildSearchIndex } from "../../../src/graph/core/search-index.js";
import { GraphIndex } from "../../../src/graph/runtime/graph.js";
import type { Quad } from "../../../src/graph/core/derive.js";
import { NS, RDF_TYPE } from "../../../src/graph/core/vocab.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const WIDGET = join(import.meta.dirname, "..", "..", "lint", "fixtures", "flare", "widget");
const INSTALL = "Content/Topics/Install.htm";
const PRINT_GUIDE = "Content/Topics/PrintGuide.htm";
const read = (label: string): string => readFileSync(join(WIDGET, label), "utf8");
const html5 = () => parseContexts({ tools: { flare: { target: "HTML5" } } }, WIDGET);

beforeEach(() => {
  resetWarnings();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("analyzeDoc on a Flare topic", () => {
  it("takes a snippet's heading as a section of the topic", async () => {
    const model = await analyzeDoc(read(INSTALL), INSTALL, new Set([INSTALL]), { context: html5() });
    expect(model.sections.map((s) => s.title)).toContain("Before you start");
    const bare = await analyzeDoc(read(INSTALL), INSTALL, new Set([INSTALL]));
    expect(bare.sections.map((s) => s.title)).not.toContain("Before you start");
  });

  it("keeps the links of content the target excludes", async () => {
    const model = await analyzeDoc(read(INSTALL), INSTALL, new Set([INSTALL, PRINT_GUIDE]), {
      context: html5(),
    });
    expect(model.links.map((l) => l.resolvedPath)).toContain(PRINT_GUIDE);
  });

  it("gives a topic the target excludes no sections, and keeps its links", async () => {
    const model = await analyzeDoc(read(PRINT_GUIDE), PRINT_GUIDE, new Set([INSTALL, PRINT_GUIDE]), {
      context: html5(),
    });
    expect(model.sections).toEqual([]);
    expect(model.links.map((l) => l.resolvedPath)).toEqual([INSTALL]);
  });
});

describe("the search index over a Flare topic", () => {
  it("carries the resolved variable values", async () => {
    const BASE = "https://ex.com/graph/";
    const doc = `${BASE}doc/${INSTALL}`;
    const iri = (value: string): Quad["o"] => ({ kind: "iri", value });
    const lit = (value: string): Quad["o"] => ({ kind: "literal", value });
    const graph = GraphIndex.fromQuads([
      { s: doc, p: RDF_TYPE, o: iri(`${NS.graph}Document`) },
      { s: doc, p: `${NS.graph}path`, o: lit(INSTALL) },
      { s: `${doc}#steps`, p: RDF_TYPE, o: iri(`${NS.graph}Section`) },
      { s: `${doc}#steps`, p: `${NS.dcterms}title`, o: lit("Steps") },
    ]);
    const index = await buildSearchIndex(graph, WIDGET, { context: html5() });
    const steps = index.entries.find((e) => e.id === `${doc}#steps`);
    expect(steps?.text).toContain("Run version 4.3.");
    expect(steps?.text).not.toContain("print guide");
  });
});

describe("the analyze cache and a Flare topic", () => {
  it("parses a resolved topic every time and stores nothing", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "manni-graph-flare-cache-")), "cache");
    const context = html5()(INSTALL);
    for (let run = 0; run < 2; run++) {
      const cache = new AnalyzeCache(dir);
      const body = await cache.parse(read(INSTALL), INSTALL, "html", context);
      await cache.flush();
      expect(cache.misses).toBe(1);
      expect(cache.hits).toBe(0);
      expect(body.sections.map((s) => s.title)).toContain("Before you start");
    }
    expect(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : []).toEqual([]);
  });

  it("still caches a Flare topic read without a context", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "manni-graph-flare-cache-")), "cache");
    for (const expected of [0, 1]) {
      const cache = new AnalyzeCache(dir);
      await cache.parse(read(INSTALL), INSTALL, "html");
      await cache.flush();
      expect(cache.hits).toBe(expected);
    }
  });
});
