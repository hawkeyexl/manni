/**
 * `graph lookup`, `graph retrieve`, `graph traverse --context` and the script
 * surface (proposal 0090, PR 2), over the retrieval fixture's artifact.
 *
 * The cores are called directly here; `retrieve-cli.test.ts` holds the
 * channel: what prints, on which stream, and the exit code.
 */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson } from "../../../src/graph/commands/chunks.js";
import { runLookup, runRetrieve, runTraverseContext } from "../../../src/graph/commands/retrieve.js";
import { createMockEmbedder } from "../../../src/graph/embed/mock.js";
import type { ChunkRow } from "../../../src/graph/runtime/chunks.js";
import {
  createHttpVectorStore,
  createRetriever,
  createStaticVectorStore,
  ModelMismatchError,
  parseChunkRows,
  parseChunksManifest,
  StaleArtifactError,
  type RetrieverFetch,
} from "../../../src/graph/runtime/index.js";
import { removeTempRepo } from "../../helpers/temp-repo.js";
import { CI, DE_QUESTION, INDEX, QUESTION, ROTATE, retrieveArtifact } from "../helpers/retrieve-artifact.js";

let dir: string;
beforeAll(async () => {
  dir = await retrieveArtifact();
}, 60_000);
afterAll(() => {
  removeTempRepo(dir);
});

const posix = (p: string): string => p.split("\\").join("/");
const manifestUrl = (): string => posix(join(dir, INDEX, "chunks.json"));

/** A `fetch` over the file system, as a DOM-free host would supply one. */
const fileFetch: RetrieverFetch = (url) => {
  try {
    const text = readFileSync(url, "utf8");
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
  } catch {
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
  }
};

const iris = (xs: readonly { iri: string }[]): string[] => xs.map((x) => x.iri);

describe("graph lookup", () => {
  it("returns every match ranked with its scores, in the best-scoring language", async () => {
    const { result } = await runLookup({ cwd: dir, question: QUESTION });
    expect(result.refusal).toBeUndefined();
    expect(result.language).toBe("en");
    expect(result.trace.entry.chosen).toBe("en");
    expect(Object.keys(result.trace.entry.languages ?? {}).sort()).toEqual(["de", "en"]);
    const matches = result.matches.passages;
    expect(matches.map((m) => m.rank)).toEqual([1, 2, 3]);
    expect(iris(matches)).toContain(ROTATE);
    for (const m of matches) {
      expect(typeof m.score.fused).toBe("number");
      expect(m.score.lexical === null && m.score.vector === null).toBe(false);
      expect(m.provenance.node).toBe(m.iri);
      expect(m.text).not.toBeNull();
    }
  });

  it("walks outward and inward from every match, and no match repeats", async () => {
    const { result } = await runLookup({ cwd: dir, question: QUESTION });
    const matched = new Set(iris(result.matches.passages));
    expect(result.traversal.passages.length).toBeGreaterThan(0);
    expect(result.traversal.edges.length).toBeGreaterThan(0);
    expect(iris(result.impact.passages)).toContain(CI);
    for (const p of [...result.traversal.passages, ...result.impact.passages]) {
      expect(matched.has(p.iri)).toBe(false);
      expect(p.depth).toBeGreaterThan(0);
    }
    // Edges run in the graph's direction: a dependent points at what it depends on.
    expect(result.impact.edges).toContainEqual({ from: CI, predicate: "dcterms:references", to: ROTATE });
  });

  it("answers a German question in German, and never asks for a language", async () => {
    const { result } = await runLookup({ cwd: dir, question: DE_QUESTION });
    expect(result.refusal).toBeUndefined();
    expect(result.language).toBe("de");
    expect(result.matches.passages.every((p) => p.page.startsWith("docs/de/"))).toBe(true);
  });

  it("keeps every node and edge past each section's budget, without its text", async () => {
    const full = (await runLookup({ cwd: dir, question: QUESTION })).result;
    const config = join(dir, "manni.config.yaml");
    const original = readFileSync(config, "utf8");
    // Room for the first match and nothing more, in each section.
    const room = full.matches.passages[0]?.text?.length ?? 0;
    expect(room).toBeGreaterThan(0);
    writeFileSync(config, original.replace("graph:\n", `graph:\n  retrieve:\n    maxChars: ${String(room)}\n`), "utf8");
    try {
      const tight = (await runLookup({ cwd: dir, question: QUESTION })).result;
      for (const section of ["matches", "traversal", "impact"] as const) {
        expect(iris(tight[section].passages)).toEqual(iris(full[section].passages));
      }
      expect(tight.traversal.edges).toEqual(full.traversal.edges);
      expect(tight.impact.edges).toEqual(full.impact.edges);
      const cut = tight.traversal.passages.filter((p) => p.text === null);
      expect(cut.length).toBeGreaterThan(0);
      expect(cut.every((p) => p.truncated && p.provenance.node === p.iri)).toBe(true);
      expect(tight.traversal.truncated).toBe(true);
      // Each section has its own budget.
      expect(tight.matches.passages[0]?.text).not.toBeNull();
    } finally {
      writeFileSync(config, original, "utf8");
    }
  });

  it("is retrieve plus impact: matches and traversal equal the bundle, impact the union of each match's", async () => {
    const { result } = await runLookup({ cwd: dir, question: QUESTION });
    const bundle = await runRetrieve({ cwd: dir, question: QUESTION, lang: "en", maxChars: 1_000_000 });
    expect(iris(bundle.context)).toEqual([...iris(result.matches.passages), ...iris(result.traversal.passages)]);
    const matched = new Set(iris(result.matches.passages));
    const union = new Set<string>();
    for (const m of result.matches.passages) {
      const walk = await runTraverseContext({ cwd: dir, node: m.iri, impact: true, lang: "en", maxChars: 1_000_000 });
      for (const b of walk.context) if (b.role === "dependent" && !matched.has(b.iri)) union.add(b.iri);
    }
    expect(new Set(iris(result.impact.passages))).toEqual(union);
  });
});

describe("graph retrieve", () => {
  it("returns a bundle with roles, pages and provenance", async () => {
    const bundle = await runRetrieve({ cwd: dir, question: QUESTION, lang: "en" });
    expect(bundle.question).toBe(QUESTION);
    expect(bundle.language).toBe("en");
    expect(bundle.context.filter((b) => b.role === "match")).toHaveLength(3);
    expect(bundle.context.some((b) => b.role === "context")).toBe(true);
    for (const b of bundle.context) {
      expect(bundle.pages[b.page]?.metadata).toBeDefined();
      expect(b.provenance.page).toBe(b.page);
    }
    expect(bundle.trace.withheld).toEqual([]);
  });

  it("lets each flag override its key", async () => {
    const one = await runRetrieve({ cwd: dir, question: QUESTION, lang: "en", seeds: 1, depth: 0 });
    expect(one.context.map((b) => b.role)).toEqual(["match"]);
    const tight = await runRetrieve({ cwd: dir, question: QUESTION, lang: "en", maxChars: 1 });
    expect(tight.refusal?.reason).toBe("no-content");
  });

  it("filters on row metadata with --where, a list field by containment, and traces what it left out", async () => {
    const admin = await runRetrieve({
      cwd: dir,
      question: QUESTION,
      lang: "en",
      where: [{ field: "audience", value: "admin" }],
    });
    expect(admin.context.length).toBeGreaterThan(0);
    expect(admin.context.every((b) => admin.pages[b.page]?.metadata.audience === "admin")).toBe(true);
    expect(admin.trace.filtered).toContainEqual({ node: "urn:manni:graph:doc/docs/en/setup.md", field: "audience" });

    const both = await runRetrieve({
      cwd: dir,
      question: QUESTION,
      lang: "en",
      where: [
        { field: "audience", value: "admin" },
        { field: "tags", value: "keys" },
      ],
    });
    expect(new Set(both.context.map((b) => b.page))).toEqual(new Set(["docs/en/rotate.md"]));
    // The store applies `where` before its cut, so the rows it never returns are not traced.
    expect(both.trace.filtered).toContainEqual({ node: "urn:manni:graph:doc/docs/en/setup.md", field: "audience" });
  });

  it("refuses with each reason, as an answer", async () => {
    const docs = await createRetriever({ manifest: manifestUrl(), fetch: fileFetch, embed: false });
    expect((await docs.retrieve(QUESTION)).refusal?.reason).toBe("lang-required");
    expect((await docs.retrieve("zzzqx vvvkw", { lang: "en" })).refusal?.reason).toBe("no-route");
    expect((await docs.retrieve(QUESTION, { lang: "fr" })).refusal?.reason).toBe("unknown-scope");
    expect((await docs.retrieve(QUESTION, { lang: "en", variant: "nope" })).refusal?.reason).toBe("unknown-scope");
    expect((await docs.traverse("urn:manni:graph:doc/nowhere.md")).refusal?.reason).toBe("unknown-node");
    expect((await docs.retrieve(QUESTION, { lang: "en", maxChars: 1 })).refusal?.reason).toBe("no-content");
  });

  it("withholds drifted passages at query time and refuses when every match is withheld", async () => {
    // A copy of the artifact whose every row carries an error pin.
    const drifted = join(dir, "drifted");
    cpSync(join(dir, INDEX), drifted, { recursive: true });
    for (const lang of ["en", "de"]) {
      const file = join(drifted, `chunks.${lang}.jsonl`);
      const rows = parseChunkRows(readFileSync(file, "utf8")).map((r) => ({
        ...r,
        provenance: { ...r.provenance, pins: { ...r.provenance.pins, total: 1, error: 1 } },
      }));
      writeFileSync(file, rows.map((r) => `${canonicalJson(r)}\n`).join(""), "utf8");
    }
    const bundle = await runRetrieve({ cwd: dir, index: "drifted", question: QUESTION, lang: "en", withhold: ["drifted"] });
    expect(bundle.refusal?.reason).toBe("withheld");
    expect(bundle.trace.withheld.length).toBe(3);
    expect(bundle.trace.withheld.every((w) => w.at === "query" && w.because.includes("drifted"))).toBe(true);
    const lookedUp = (await runLookup({ cwd: dir, index: "drifted", question: QUESTION })).result;
    expect(lookedUp.refusal).toBeUndefined();

    // The script surface tightens the floor per call, as the CLI does.
    const scripted = await createRetriever({ manifest: posix(join(drifted, "chunks.json")), fetch: fileFetch, embed: false });
    expect((await scripted.retrieve(QUESTION, { lang: "en", withhold: ["drifted"] })).refusal?.reason).toBe("withheld");
    expect((await scripted.traverse(ROTATE, { withhold: ["drifted"] })).trace.withheld.length).toBeGreaterThan(0);
    expect((await scripted.impact(ROTATE, { withhold: ["drifted"] })).trace.withheld.length).toBeGreaterThan(0);
  });
});

describe("graph traverse --context", () => {
  it("serves the walk from a node as a bundle", async () => {
    const out = await runTraverseContext({ cwd: dir, node: ROTATE });
    expect(out.node).toBe(ROTATE);
    expect(out.context[0]).toMatchObject({ iri: ROTATE, role: "match", depth: 0 });
    expect(out.context.slice(1).every((b) => b.role === "context")).toBe(true);
    const inward = await runTraverseContext({ cwd: dir, node: ROTATE, impact: true });
    expect(inward.context.filter((b) => b.role === "dependent").map((b) => b.iri)).toContain(CI);
  });

  it("filters the walk on row metadata with where, as retrieve does", async () => {
    const all = await runTraverseContext({ cwd: dir, node: ROTATE });
    const where = [{ field: "audience", value: "admin" }];
    const admin = await runTraverseContext({ cwd: dir, node: ROTATE, where });
    expect(admin.context.every((b) => admin.pages[b.page]?.metadata.audience === "admin")).toBe(true);
    expect(admin.context.length + admin.trace.filtered.length).toBe(all.context.length);
    expect(admin.trace.filtered.every((f) => f.field === "audience")).toBe(true);
  });
});

describe("createRetriever", () => {
  const embed = createMockEmbedder({ dims: 8 });

  it("answers as the CLI does over the same artifact, for all four verbs", async () => {
    const docs = await createRetriever({ manifest: manifestUrl(), fetch: fileFetch, embed });
    expect(docs.manifest.format).toBe("manni-graph-chunks");
    const cli = { cwd: dir, embedder: embed };
    expect(await docs.lookup(QUESTION)).toEqual((await runLookup({ ...cli, question: QUESTION })).result);
    expect(await docs.retrieve(QUESTION, { lang: "en" })).toEqual(
      await runRetrieve({ ...cli, question: QUESTION, lang: "en" }),
    );
    expect(await docs.traverse(ROTATE, { depth: 2 })).toEqual(await runTraverseContext({ ...cli, node: ROTATE, depth: 2 }));
    expect(await docs.impact(ROTATE)).toEqual(await runTraverseContext({ ...cli, node: ROTATE, impact: true }));
  });

  it("falls back to lexical entry when it cannot embed, and says so", async () => {
    const docs = await createRetriever({ manifest: manifestUrl(), fetch: fileFetch, embed: false });
    const bundle = await docs.retrieve(QUESTION, { lang: "en" });
    expect(bundle.trace.entry.fallback).toBe("lexical");
    expect(bundle.refusal).toBeUndefined();
  });

  it("throws on another model, and on a graph the manifest was not built from", async () => {
    const other = await createRetriever({
      manifest: manifestUrl(),
      fetch: fileFetch,
      embed: createMockEmbedder({ dims: 8, model: "other" }),
    });
    await expect(other.lookup(QUESTION)).rejects.toThrow(ModelMismatchError);
    await expect(other.lookup(QUESTION)).rejects.toThrow("chunks.json was embedded with mock, and the embedder loads other.");

    const tampered: RetrieverFetch = async (url, init) => {
      const r = await fileFetch(url, init);
      if (!url.endsWith("graph.jsonld")) return r;
      const text = `${await r.text()} `;
      return { ok: true, status: 200, text: () => Promise.resolve(text) };
    };
    await expect(createRetriever({ manifest: manifestUrl(), fetch: tampered, embed })).rejects.toThrow(StaleArtifactError);
  });

  it("drops and traces an id the store names that no row holds", async () => {
    const store = createHttpVectorStore({
      url: "https://example.com/api/vectors",
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ matches: [{ id: "urn:manni:graph:doc/gone.md", score: 0.9 }] })),
        }),
    });
    const docs = await createRetriever({ manifest: manifestUrl(), fetch: fileFetch, embed, store });
    const bundle = await docs.retrieve(QUESTION, { lang: "en" });
    expect(bundle.trace.resolutions).toContainEqual({
      iri: "urn:manni:graph:doc/gone.md",
      sourceUrl: "chunks.en.jsonl",
      ok: false,
      error: "no chunk row",
    });
  });
});

describe("the stores and parsers", () => {
  const rows = (): ChunkRow[] => parseChunkRows(readFileSync(join(dir, INDEX, "chunks.en.jsonl"), "utf8"));

  it("parseChunkRows round-trips the export", () => {
    const text = readFileSync(join(dir, INDEX, "chunks.en.jsonl"), "utf8");
    expect(rows().map((r) => `${canonicalJson(r)}\n`).join("")).toBe(text);
  });

  it("parseChunksManifest reads chunks.json and refuses anything else", () => {
    expect(parseChunksManifest(readFileSync(join(dir, INDEX, "chunks.json"), "utf8")).version).toBe(1);
    expect(() => parseChunksManifest("{}")).toThrow("Not a manni graph chunk manifest");
  });

  it("parseChunksManifest refuses a manifest missing a field it reads, at parse time", () => {
    const { languages: _dropped, ...partial } = parseChunksManifest(readFileSync(join(dir, INDEX, "chunks.json"), "utf8"));
    expect(() => parseChunksManifest(partial)).toThrow("Not a manni graph chunk manifest");
  });

  it("parseChunkRows refuses a row missing a field it reads", () => {
    const [first] = readFileSync(join(dir, INDEX, "chunks.en.jsonl"), "utf8").split("\n");
    const { provenance: _dropped, ...partial } = JSON.parse(first ?? "{}") as ChunkRow;
    expect(() => parseChunkRows(JSON.stringify(partial))).toThrow("Line 1 is not a chunk row.");
  });

  it("the static store applies where before the k cut", async () => {
    const all = rows();
    const target = all.find((r) => r.id === ROTATE);
    const store = createStaticVectorStore(all);
    const ranked = await store.query({ text: "", vector: target?.vector ?? null, k: all.length, language: "en", where: [] });
    const last = ranked.at(-1)?.id;
    expect(last).toBeDefined();
    const marked = all.map((r) => (r.id === last ? { ...r, metadata: { ...r.metadata, probe: "only" } } : r));
    const where = [{ field: "probe", value: "only" }];
    const hits = await createStaticVectorStore(marked).query({ text: "", vector: target?.vector ?? null, k: 1, language: "en", where });
    expect(hits.map((h) => h.id)).toEqual([last]);
  });

  it("the static store ranks by cosine, within k and the language", async () => {
    const all = rows();
    const target = all.find((r) => r.id === ROTATE);
    const store = createStaticVectorStore(all);
    const hits = await store.query({ text: "", vector: target?.vector ?? null, k: 2, language: "en", where: [] });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.id).toBe(ROTATE);
    expect(hits[0]?.score).toBeCloseTo(1, 5);
    expect(await store.query({ text: "", vector: null, k: 2, language: "en", where: [] })).toEqual([]);
    expect(await store.query({ text: "", vector: target?.vector ?? null, k: 2, language: "de", where: [] })).toEqual([]);
  });

  it("the HTTP store posts the documented protocol and reads matches back", async () => {
    let sent: { url: string; body: unknown } | undefined;
    const store = createHttpVectorStore({
      url: "https://example.com/api/vectors",
      fetch: (url, init) => {
        sent = { url, body: JSON.parse(init?.body ?? "null") };
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ matches: [{ id: ROTATE, score: 0.5 }, { nope: true }] })),
        });
      },
    });
    const where = [{ field: "audience", value: "admin" }];
    const hits = await store.query({ text: "q", vector: [1, 0], k: 5, language: "en", where });
    expect(sent).toEqual({
      url: "https://example.com/api/vectors",
      body: { text: "q", vector: [1, 0], k: 5, language: "en", where },
    });
    expect(hits).toEqual([{ id: ROTATE, score: 0.5 }]);
  });
});
