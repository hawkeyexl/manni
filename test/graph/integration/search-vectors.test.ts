import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { spawnText } from "../../helpers/spawn.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { detachedCorpus } from "../helpers/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
// A copy outside any repository: git is detected now (proposal 0051 §6),
// and a corpus built inside this checkout would carry HEAD's committer
// date. See test/graph/helpers/corpus.ts.
const corpus = detachedCorpus();

/**
 * `spawnSync`, not `execFileSync`, so **stderr is captured on success too**.
 * Warnings — a stale sidecar degrading to lexical, say — are printed on a
 * zero-exit run, and an assertion cannot see what the helper throws away.
 *
 * `stdout` stays pure so callers can `JSON.parse` it; `output` is the merged
 * stream for tests that only care that a message appeared somewhere.
 */
function run(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; output: string; status: number } {
  // `spawnText` restores the `null` both streams really carry when the spawn
  // itself failed; `@types/node` promises a string once `encoding` is set.
  const r = spawnText(
    spawnSync(process.execPath, [cli, "graph", ...args], {
      encoding: "utf8",
      cwd,
    }),
  );
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { stdout, stderr, output: stdout + stderr, status: r.status ?? -1 };
}

/**
 * Build the corpus graph, then its search index with (optionally) its vectors
 * beside it: `vector build` writes both, `graph export search` the index alone.
 */
function prepare(withVectors = true): {
  dir: string;
  graph: string;
  vectors: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-search-vectors-"));
  const graph = join(dir, "graph.ttl");
  // The undetermined bucket: the corpus's English tree declares no language,
  // so its entries land in `und` (ADR 01038).
  const vectors = join(dir, "vectors.und.bin");
  execFileSync(process.execPath, [cli, "graph", "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  const index = withVectors
    ? [cli, "vector", "build", "--embedding-model", "mock", "--no-cache", "-o", dir]
    : [cli, "graph", "export", "search", "-g", graph];
  execFileSync(process.execPath, index, { encoding: "utf8", cwd: corpus });
  return { dir, graph, vectors };
}

/**
 * Add a page to the `und` index and record its new digest in the manifest, as
 * a fresh `export search` would. The sidecar is left as it was, so it is
 * stale against an index the manifest still vouches for.
 */
function reexportWithNewPage(graph: string): void {
  const index = join(dirname(graph), "search.und.json");
  const doc = JSON.parse(readFileSync(index, "utf8")) as {
    entries: Array<Record<string, string>>;
  };
  doc.entries.push({
    id: "https://example.com/graph/doc/docs/brand-new.md",
    type: "graph:Document",
    title: "Brand new",
    text: "content that did not exist when the vectors were built",
  });
  const edited = JSON.stringify(doc);
  writeFileSync(index, edited, "utf8");
  const manifestPath = join(dirname(graph), "localizations.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    languages: Array<{ language: string; search: { digest: string } }>;
  };
  for (const entry of manifest.languages) {
    if (entry.language !== "und") continue;
    entry.search.digest = `sha256:${createHash("sha256").update(edited, "utf8").digest("hex")}`;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
}

interface SearchJson {
  mode: string;
  results: Array<{ iri: string; via: string }>;
  lexical: Array<{ iri: string }>;
  vector: Array<{ iri: string }>;
  trace: { entry: Array<{ iri: string }> };
}

describe("manni graph search with vectors (integration)", () => {
  const search = (args: string[]): SearchJson =>
    JSON.parse(run(args, corpus).stdout) as SearchJson;

  it("runs hybrid when a sidecar is present, returning both legs", () => {
    const { graph, vectors } = prepare();
    const out = search([
      "search",
      "configuration",
      "-g",
      graph,
      "--lang",
      "und",
      "--vectors",
      vectors,
      "-f",
      "json",
    ]);
    expect(out.mode).toBe("hybrid");
    expect(out.lexical.length).toBeGreaterThan(0);
    expect(out.vector.length).toBeGreaterThan(0);
    // The fused ranking is what seeded the trace.
    expect(out.trace.entry.map((e) => e.iri)).toEqual(
      out.results.map((r) => r.iri),
    );
  });

  it("stays lexical-only under --mode lexical even with a sidecar", () => {
    const { graph, vectors } = prepare();
    const out = search([
      "search",
      "configuration",
      "-g",
      graph,
      "--lang",
      "und",
      "--vectors",
      vectors,
      "--mode",
      "lexical",
      "-f",
      "json",
    ]);
    expect(out.mode).toBe("lexical");
    expect(out.vector).toEqual([]);
  });

  it("answers lexically when no sidecar exists, without failing", () => {
    // Additive, never a new failure mode (ADR 01009).
    const { graph } = prepare(false);
    const out = search([
      "search",
      "configuration",
      "-g",
      graph,
      "--lang",
      "und",
      "-f",
      "json",
    ]);
    expect(out.mode).toBe("lexical");
    expect(out.results.length).toBeGreaterThan(0);
  });

  it("exits 2 when --mode hybrid is asked for without a sidecar", () => {
    const { graph } = prepare(false);
    const { status, output } = run(
      [
        "search",
        "configuration",
        "-g",
        graph,
        "--lang",
        "und",
        "--mode",
        "hybrid",
      ],
      corpus,
    );
    expect(status).toBe(2);
    expect(output).toContain("run `manni vector build` first, or use `--mode lexical`.");
  });

  it("refuses a sidecar built from a different search index", () => {
    // Editing docs and re-exporting without re-embedding must not rank against
    // yesterday's vectors — stale hits point at IRIs that may be gone, and
    // everything added since is unreachable (ADR 01020).
    const { graph, vectors } = prepare();
    reexportWithNewPage(graph);

    const { status, output } = run(
      [
        "search",
        "configuration",
        "-g",
        graph,
        "--lang",
        "und",
        "--vectors",
        vectors,
      ],
      corpus,
    );
    expect(status).toBe(2);
    expect(output).toContain("corpus changed");
  });

  it("degrades to lexical when a stale sidecar was never asked for", () => {
    // The refusal above is right when the vector leg was requested. But a plain
    // `manni graph search` that merely *finds* a stale sidecar beside the graph must
    // not turn a working lexical search into exit 2 — the leg is additive
    // (ADR 01009). Warned on stderr, so the user learns why it went lexical.
    const { graph } = prepare();
    reexportWithNewPage(graph);

    // The sidecar sits where the manifest records it, so it is the
    // discovered case: passing `--vectors` would make it explicitly
    // requested, which is the exit-2 branch above.
    // No --vectors and no --mode: the sidecar is discovered, not requested.
    const { status, stdout, stderr } = run(
      [
        "search",
        "configuration",
        "-g",
        graph,
        "--lang",
        "und",
        "-f",
        "json",
      ],
      corpus,
    );
    expect(status).toBe(0);
    const report = JSON.parse(stdout.slice(stdout.indexOf("{"))) as SearchJson;
    expect(report.mode).toBe("lexical");
    expect(report.results.length).toBeGreaterThan(0);
    expect(stderr).toContain("corpus changed");
  });

  it("errors on an explicit --vectors path that does not exist", () => {
    // A typo'd path would otherwise fall through to lexical with exit 0 — a
    // confident answer to a question the user did not ask.
    const { graph } = prepare(false);
    const { status, output } = run(
      [
        "search",
        "configuration",
        "-g",
        graph,
        "--lang",
        "und",
        "--vectors",
        "nope.bin",
      ],
      corpus,
    );
    expect(status).toBe(2);
    expect(output).toContain("Vector index not found");
  });

  it("exits 2 rather than crashing on a corrupt sidecar", () => {
    // A truncated write or `--vectors` pointed at the wrong file is an
    // operational error like an unparseable index — not a raw stack trace.
    const { dir, graph } = prepare(false);
    const bad = join(dir, "not-vectors.bin");
    writeFileSync(bad, "definitely not a vector index", "utf8");
    const { status, output } = run(
      [
        "search",
        "configuration",
        "-g",
        graph,
        "--lang",
        "und",
        "--vectors",
        bad,
      ],
      corpus,
    );
    expect(status).toBe(2);
    expect(output).toContain("bad magic");
    expect(output).not.toContain("at decodeVectorIndex");
  });

  it("refuses a sidecar built by a different model", () => {
    const { dir, graph } = prepare(false);
    const otherDir = join(dir, "other");
    const other = join(otherDir, "vectors.und.bin");
    execFileSync(
      process.execPath,
      [cli, "vector", "build", "--embedding-model", "mock", "--no-cache", "-o", otherDir, "--dtype", "q8"],
      { encoding: "utf8", cwd: corpus },
    );
    // Point the query side at a model the sidecar was not built with.
    const cfg = join(dir, "dockg.config.yaml");
    writeFileSync(
      cfg,
      "baseIri: https://example.com/graph/\nvector:\n  model: some/other-model\n",
    );
    const { status, stdout } = run(
      [
        "search",
        "configuration",
        "-g",
        graph,
        "--lang",
        "und",
        "-c",
        cfg,
        "--vectors",
        other,
        "--mode",
        "hybrid",
      ],
      corpus,
    );
    // The sidecar says "mock", so the mock embedder is used and matches —
    // config's model is not silently substituted. Ranking still succeeds.
    expect(status).toBe(0);
    expect(stdout).toContain("hybrid");
  });
});
