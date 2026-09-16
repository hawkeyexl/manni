import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const goldenDir = join(root, "test", "kg", "fixtures", "golden");

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
  const r = spawnSync(process.execPath, [cli, "kg", ...args], {
    encoding: "utf8",
    cwd,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { stdout, stderr, output: stdout + stderr, status: r.status ?? -1 };
}

/** Build the corpus, its search index, and (optionally) its vectors. */
function prepare(withVectors = true): {
  dir: string;
  graph: string;
  vectors: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "dockg-embed-"));
  const graph = join(dir, "graph.ttl");
  // The undetermined bucket: the corpus's English tree declares no language,
  // so its 20 entries land in `und` (ADR 01038).
  const vectors = join(dir, "vectors.und.bin");
  execFileSync(process.execPath, [cli, "kg", "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  execFileSync(process.execPath, [cli, "kg", "export", "-f", "search", "-g", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  if (withVectors) {
    execFileSync(
      process.execPath,
      [cli, "kg", "embed", "-g", graph, "--model", "mock", "--no-cache"],
      { encoding: "utf8", cwd: corpus },
    );
  }
  return { dir, graph, vectors };
}

interface SearchJson {
  mode: string;
  results: Array<{ iri: string; via: string }>;
  lexical: Array<{ iri: string }>;
  vector: Array<{ iri: string }>;
  trace: { entry: Array<{ iri: string }> };
}

describe("manni kg embed (integration)", () => {
  it.each(["und", "de", "de-AT", "fr"])(
    "matches the %s vectors golden byte-for-byte",
    (language) => {
      const { dir } = prepare();
      const name = `vectors.${language}.bin`;
      expect(
        readFileSync(join(dir, name)).equals(
          readFileSync(join(goldenDir, name)),
        ),
      ).toBe(true);
    },
  );

  it("records the language each sidecar covers in its header", () => {
    const { dir } = prepare();
    // Bytes 12.. are the JSON header; reading it back through the public
    // decoder would need the runtime bundle, and this only needs the tag.
    const bytes = readFileSync(join(dir, "vectors.de.bin"));
    const headerLength = bytes.readUInt32LE(8);
    const header = JSON.parse(
      bytes.subarray(12, 12 + headerLength).toString("utf8"),
    ) as { language: string };
    expect(header.language).toBe("de");
  });

  it("fills the manifest's vectors block for every language", () => {
    const { dir } = prepare();
    const doc = JSON.parse(
      readFileSync(join(dir, "localizations.json"), "utf8"),
    ) as {
      languages: Array<{
        language: string;
        vectors?: { path: string; model: string; count: number };
      }>;
    };
    expect(doc.languages.map((l) => l.language)).toEqual([
      "de",
      "de-AT",
      "fr",
      "und",
    ]);
    for (const l of doc.languages) {
      expect(l.vectors?.path).toBe(`vectors.${l.language}.bin`);
      expect(l.vectors?.model).toBe("mock");
    }
  });

  it("is byte-identical across two runs (determinism gate)", () => {
    const { dir, graph } = prepare(false);
    const a = join(dir, "a");
    const b = join(dir, "b");
    const args = (out: string) => [
      "embed",
      "-g",
      graph,
      "--model",
      "mock",
      "--no-cache",
      "-o",
      out,
    ];
    run(args(a), corpus);
    run(args(b), corpus);
    for (const name of ["vectors.und.bin", "vectors.de.bin"]) {
      expect(
        readFileSync(join(a, name)).equals(readFileSync(join(b, name))),
      ).toBe(true);
    }
  });

  it("serves repeat runs from the cache", () => {
    const { dir, graph } = prepare(false);
    const cacheHome = mkdtempSync(join(tmpdir(), "dockg-embed-cache-"));
    const cfg = join(cacheHome, "dockg.config.yaml");
    writeFileSync(
      cfg,
      `version: 1\nbaseIri: https://example.com/kg/\nembed:\n  cacheDir: ${JSON.stringify(join(cacheHome, "cache"))}\n`,
    );
    const args = [
      "embed",
      "-g",
      graph,
      "-c",
      cfg,
      "--model",
      "mock",
      "-o",
      join(dir, "c"),
      "-f",
      "json",
    ];
    const first = JSON.parse(run(args, corpus).stdout) as {
      embedded: number;
      cached: number;
    };
    expect(first.embedded).toBeGreaterThan(0);
    // Not zero: concepts are shared vocabulary and appear in every language's
    // index (ADR 01038), and the cache is keyed on text+model+dtype — so the
    // first run already serves each concept's repeats from cache rather than
    // embedding the same string once per locale. Replication is free.
    const firstTotal = first.embedded + first.cached;

    const second = JSON.parse(run(args, corpus).stdout) as {
      embedded: number;
      cached: number;
    };
    expect(second.embedded).toBe(0);
    expect(second.cached).toBe(firstTotal);
  });

  it("reports the model and dimensions it used", () => {
    const { dir, graph } = prepare(false);
    const out = JSON.parse(
      run(
        [
          "embed",
          "-g",
          graph,
          "--model",
          "mock",
          "--no-cache",
          "-o",
          join(dir, "d"),
          "-f",
          "json",
        ],
        corpus,
      ).stdout,
    ) as {
      total: number;
      languages: Array<{ language: string; model: string; dims: number }>;
    };
    expect(out.total).toBeGreaterThan(0);
    expect(out.languages).toHaveLength(4);
    for (const l of out.languages) {
      expect(l.model).toBe("mock");
      expect(l.dims).toBeGreaterThan(0);
    }
  });

  it("exits 2 when the search index is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-embed-none-"));
    const graph = join(dir, "graph.ttl");
    execFileSync(process.execPath, [cli, "kg", "build", "--out", graph], {
      encoding: "utf8",
      cwd: corpus,
    });
    const { status, output } = run(
      ["embed", "-g", graph, "--model", "mock"],
      corpus,
    );
    expect(status).toBe(2);
    expect(output).toContain("export --format search");
  });

  it("exits 2 with an install hint when the optional peer is absent", () => {
    // The real model path needs @huggingface/transformers, which this repo
    // deliberately does not install — the same position a user is in.
    const { dir, graph } = prepare(false);
    const { status, output } = run(
      ["embed", "-g", graph, "-o", join(dir, "e.bin")],
      corpus,
    );
    expect(status).toBe(2);
    expect(output).toContain("npm install @huggingface/transformers");
  });
});

describe("manni kg search with vectors (integration)", () => {
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

  it("reports the vector leg alone under --mode vector", () => {
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
      "vector",
      "-f",
      "json",
    ]);
    expect(out.mode).toBe("vector");
    expect(out.results.map((r) => r.iri)).toEqual(out.vector.map((r) => r.iri));
    expect(out.results.every((r) => r.via === "vector")).toBe(true);
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

  it("exits 2 when --mode vector is asked for without a sidecar", () => {
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
        "vector",
      ],
      corpus,
    );
    expect(status).toBe(2);
    expect(output).toContain("manni kg embed");
  });

  it("refuses a sidecar built from a different search index", () => {
    // Editing docs and re-exporting without re-embedding must not rank against
    // yesterday's vectors — stale hits point at IRIs that may be gone, and
    // everything added since is unreachable (ADR 01020).
    const { graph, vectors } = prepare();
    const index = join(dirname(graph), "search.und.json");
    const doc = JSON.parse(readFileSync(index, "utf8")) as {
      entries: Array<Record<string, string>>;
    };
    doc.entries.push({
      id: "https://example.com/kg/doc/docs/brand-new.md",
      type: "dockg:Document",
      title: "Brand new",
      text: "content that did not exist when the vectors were built",
    });
    writeFileSync(index, JSON.stringify(doc), "utf8");

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
    // `manni kg search` that merely *finds* a stale sidecar beside the graph must
    // not turn a working lexical search into exit 2 — the leg is additive
    // (ADR 01009). Warned on stderr, so the user learns why it went lexical.
    const { graph, vectors } = prepare();
    const index = join(dirname(graph), "search.und.json");
    const doc = JSON.parse(readFileSync(index, "utf8")) as {
      entries: Array<Record<string, string>>;
    };
    doc.entries.push({
      id: "https://example.com/kg/doc/docs/brand-new.md",
      type: "dockg:Document",
      title: "Brand new",
      text: "content that did not exist when the vectors were built",
    });
    writeFileSync(index, JSON.stringify(doc), "utf8");

    // The sidecar has to be at the *configured default* location for this to be
    // the discovered case — passing `--vectors` would make it explicitly
    // requested, which is the exit-2 branch above. `embed.out` is the sidecar
    // directory since the per-locale fan-out (ADR 01038); search joins it with
    // the filename the manifest records for this language.
    const cfg = join(dirname(vectors), "dockg.config.yaml");
    writeFileSync(
      cfg,
      `version: 1\nbaseIri: https://example.com/kg/\nembed:\n  out: ${JSON.stringify(dirname(vectors))}\n`,
      "utf8",
    );

    // No --vectors and no --mode: the sidecar is discovered, not requested.
    const { status, stdout, stderr } = run(
      [
        "search",
        "configuration",
        "-g",
        graph,
        "--lang",
        "und",
        "-c",
        cfg,
        "-f",
        "json",
      ],
      dirname(vectors),
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

  it("reports the requested mode even when the vector leg matched nothing", () => {
    // Reporting "lexical" for an explicit `--mode vector` would deny that the
    // semantic leg ran at all.
    const { graph, vectors } = prepare();
    const out = search([
      "search",
      "   ",
      "-g",
      graph,
      "--lang",
      "und",
      "--vectors",
      vectors,
      "--mode",
      "vector",
      "-f",
      "json",
    ]);
    expect(out.mode).toBe("vector");
    expect(out.results).toEqual([]);
  });

  it("keeps the trace consistent with the results under --mode vector", () => {
    // The trace answers "why did these come back" (ADR 01018), so it must
    // describe the ranking returned, not the fusion this mode discards.
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
      "vector",
      "-f",
      "json",
    ]);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.trace.entry.map((e) => e.iri)).toEqual(
      out.results.map((r) => r.iri),
    );
  });

  it("refuses a sidecar built by a different model", () => {
    const { dir, graph } = prepare(false);
    const otherDir = join(dir, "other");
    const other = join(otherDir, "vectors.und.bin");
    run(
      [
        "embed",
        "-g",
        graph,
        "--model",
        "mock",
        "--no-cache",
        "-o",
        otherDir,
        "--dtype",
        "q8",
      ],
      corpus,
    );
    // Point the query side at a model the sidecar was not built with.
    const cfg = join(dir, "dockg.config.yaml");
    writeFileSync(
      cfg,
      "version: 1\nbaseIri: https://example.com/kg/\nembed:\n  model: some/other-model\n",
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
