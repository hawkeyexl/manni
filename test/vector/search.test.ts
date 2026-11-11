/**
 * `manni vector search` (proposal 0128): one language's nodes, ranked by
 * meaning alone. Moved from graph's search-with-vectors cases when `graph
 * search --mode vector` went.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { renderSearch, runBuild, runSearch } from "../../src/vector/index.js";
import { runBuild as runGraphBuild } from "../../src/graph/commands/build.js";
import { runExport } from "../../src/graph/commands/export.js";
import { detachedCorpus } from "../graph/helpers/corpus.js";

/** A detached corpus and a fresh vector build of it in its own directory. */
async function built(): Promise<{ corpus: string; index: string }> {
  const corpus = detachedCorpus();
  const index = mkdtempSync(join(tmpdir(), "manni-vector-search-"));
  await runBuild({ cwd: corpus, out: index, model: "mock", noCache: true });
  return { corpus, index };
}

/**
 * Add a page to the `und` index and record its digest in the manifest, as a
 * fresh `graph export search` would. The sidecar stays as it was, so it is
 * stale against an index the manifest still vouches for.
 */
function reindexWithNewPage(index: string): void {
  const path = join(index, "search.und.json");
  const doc = JSON.parse(readFileSync(path, "utf8")) as { entries: Array<Record<string, string>> };
  doc.entries.push({
    id: "https://example.com/graph/doc/docs/brand-new.md",
    type: "graph:Document",
    title: "Brand new",
    text: "content that did not exist when the vectors were built",
  });
  const edited = JSON.stringify(doc);
  writeFileSync(path, edited, "utf8");
  const manifestPath = join(index, "localizations.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    languages: Array<{ language: string; search: { digest: string } }>;
  };
  for (const entry of manifest.languages) {
    if (entry.language === "und") {
      entry.search.digest = `sha256:${createHash("sha256").update(edited, "utf8").digest("hex")}`;
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
}

describe("vector search", () => {
  let shared: { corpus: string; index: string };
  beforeAll(async () => {
    shared = await built();
  });

  it("ranks by the vector leg alone", async () => {
    const report = await runSearch({ cwd: shared.corpus, index: shared.index, lang: "und", query: "configuration" });
    expect(report.mode).toBe("vector");
    expect(report.lexical).toEqual([]);
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.map((r) => r.iri)).toEqual(report.vector.map((r) => r.iri));
    expect(report.results.every((r) => r.via === "vector")).toBe(true);
    // The trace describes the ranking returned, not a fusion this mode discards.
    expect(report.trace.entry.map((e) => e.iri)).toEqual(report.results.map((r) => r.iri));
  });

  it("caps the results at --limit", async () => {
    const report = await runSearch({ cwd: shared.corpus, index: shared.index, lang: "und", query: "configuration", limit: 2 });
    expect(report.results.length).toBeLessThanOrEqual(2);
  });

  it("reports the vector mode even when nothing matched", async () => {
    const report = await runSearch({ cwd: shared.corpus, index: shared.index, lang: "und", query: "   " });
    expect(report.mode).toBe("vector");
    expect(report.results).toEqual([]);
  });

  it("prints one line per hit and the count line", async () => {
    const report = await runSearch({ cwd: shared.corpus, index: shared.index, lang: "und", query: "configuration", limit: 3 });
    const lines = renderSearch(report, "pretty").split("\n");
    expect(lines.at(-1)).toBe(`${String(report.results.length)} result${report.results.length === 1 ? "" : "s"} (vector)`);
    expect(lines[0]).toMatch(/^\d\.\d{4} {2}\S+/);
  });

  it("refuses several languages without --lang", async () => {
    await expect(runSearch({ cwd: shared.corpus, index: shared.index, query: "x" })).rejects.toThrow(
      "This corpus has more than one localization (de, de-AT, fr, und) — pass --lang to choose one.",
    );
  });

  it("embeds the query with the sidecar's model, not the configured one", async () => {
    const { corpus, index } = await built();
    appendFileSync(join(corpus, "manni.config.yaml"), "\nvector:\n  model: some/other-model\n");
    const report = await runSearch({ cwd: corpus, index, lang: "und", query: "configuration" });
    expect(report.results.length).toBeGreaterThan(0);
  });

  it("names manni vector build when nothing is built", async () => {
    const empty = mkdtempSync(join(tmpdir(), "manni-vector-none-"));
    await expect(runSearch({ cwd: shared.corpus, index: empty, query: "x" })).rejects.toThrow(
      `Localization manifest not found: ${join(empty, "localizations.json")} — run \`manni vector build\` first.`,
    );
  });

  it("names manni vector build when only graph export search ran", async () => {
    const corpus = detachedCorpus();
    const index = mkdtempSync(join(tmpdir(), "manni-vector-lexical-"));
    const graph = join(index, "graph.ttl");
    await runGraphBuild({ cwd: corpus, out: graph });
    await runExport({ cwd: corpus, graph, format: "search" });
    await expect(runSearch({ cwd: corpus, index, lang: "und", query: "x" })).rejects.toThrow(
      'Vector index not found: no sidecar recorded for "und" — run `manni vector build` first.',
    );
  });

  it("refuses a sidecar built from a different search index", async () => {
    const { corpus, index } = await built();
    reindexWithNewPage(index);
    await expect(runSearch({ cwd: corpus, index, lang: "und", query: "x" })).rejects.toThrow(
      "Vector index was built from a different search index — the corpus changed. Re-run `manni vector build`.",
    );
  });

  it("refuses a corrupt sidecar as an operational error", async () => {
    const { corpus, index } = await built();
    writeFileSync(join(index, "vectors.und.bin"), "definitely not a vector index", "utf8");
    const go = runSearch({ cwd: corpus, index, lang: "und", query: "x" });
    await expect(go).rejects.toThrow("bad magic");
    await expect(go).rejects.toThrow("re-run `manni vector build`.");
  });
});
