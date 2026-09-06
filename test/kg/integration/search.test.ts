import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const goldenDir = join(root, "test", "kg", "fixtures", "golden");

function run(args: string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, "kg", ...args], {
      encoding: "utf8",
      cwd,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (err.stdout ?? "") + (err.stderr ?? ""),
      status: err.status ?? -1,
    };
  }
}

/**
 * Build the corpus and its per-language search indexes into a fresh temp dir.
 *
 * `index` is the undetermined bucket: the corpus's English tree sits under a
 * route that declares no language, so `und` is where its 20 entries land
 * (ADR 01038). The localized trees get their own files beside it.
 */
function buildIndexed(): {
  dir: string;
  graph: string;
  index: string;
  manifest: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "dockg-search-"));
  const graph = join(dir, "graph.ttl");
  execFileSync(process.execPath, [cli, "kg", "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  execFileSync(process.execPath, [cli, "kg", "export", "-f", "search", "-g", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
  return {
    dir,
    graph,
    index: join(dir, "search.und.json"),
    manifest: join(dir, "localizations.json"),
  };
}

interface SearchJson {
  results: Array<{ iri: string; score: number; via: string; title?: string }>;
  trace: { entry: Array<{ iri: string }> };
}

function search(args: string[], cwd = corpus): SearchJson {
  return JSON.parse(run(args, cwd).stdout) as SearchJson;
}

describe("manni kg export --format search (integration)", () => {
  it.each(["und", "de", "de-AT", "fr"])(
    "matches the %s search golden byte-for-byte",
    (language) => {
      const { dir } = buildIndexed();
      const name = `search.${language}.json`;
      expect(readFileSync(join(dir, name), "utf8")).toBe(
        readFileSync(join(goldenDir, name), "utf8"),
      );
    },
  );

  it("matches the localization manifest golden byte-for-byte", () => {
    const { manifest } = buildIndexed();
    // The golden manifest carries the `vectors` blocks `manni kg embed` wrote, so
    // compare only what `export` is responsible for: version, languages,
    // document counts, and each index's path/entries/digest.
    const strip = (raw: string) => {
      const doc = JSON.parse(raw) as {
        version: number;
        languages: Array<Record<string, unknown>>;
      };
      return JSON.stringify({
        version: doc.version,
        languages: doc.languages.map(({ vectors: _vectors, ...rest }) => rest),
      });
    };
    expect(strip(readFileSync(manifest, "utf8"))).toBe(
      strip(readFileSync(join(goldenDir, "localizations.json"), "utf8")),
    );
  });

  it("files each document exactly once, and every concept everywhere", () => {
    const { dir, manifest } = buildIndexed();
    const doc = JSON.parse(readFileSync(manifest, "utf8")) as {
      languages: Array<{ language: string; search: { path: string } }>;
    };
    const buckets = doc.languages.map(({ language, search: s }) => ({
      language,
      entries: (
        JSON.parse(readFileSync(join(dir, s.path), "utf8")) as {
          entries: Array<{ id: string; type: string }>;
        }
      ).entries,
    }));

    // Documents and sections belong to one locale each: nothing duplicated,
    // nothing dropped.
    const owned = buckets.flatMap((b) =>
      b.entries.filter((e) => e.type !== "skos:Concept").map((e) => e.id),
    );
    expect(new Set(owned).size).toBe(owned.length);
    expect(owned.length).toBe(21);

    // Concepts are shared vocabulary, not documents in a language, so every
    // index carries all of them — otherwise `--lang de` could never return one.
    const concepts = buckets.map((b) =>
      b.entries
        .filter((e) => e.type === "skos:Concept")
        .map((e) => e.id)
        .sort(),
    );
    for (const set of concepts) expect(set).toEqual(concepts[0]);
    expect(concepts[0]).toHaveLength(6);
  });

  it("is byte-identical across two exports (determinism gate)", () => {
    const { graph, dir } = buildIndexed();
    const a = join(dir, "a");
    const b = join(dir, "b");
    run(["export", "-f", "search", "-g", graph, "-o", a], corpus);
    run(["export", "-f", "search", "-g", graph, "-o", b], corpus);
    for (const name of [
      "localizations.json",
      "search.und.json",
      "search.de.json",
    ]) {
      expect(readFileSync(join(a, name), "utf8")).toBe(
        readFileSync(join(b, name), "utf8"),
      );
    }
  });

  it("defaults the output to the graph's directory", () => {
    const { index, manifest } = buildIndexed();
    // Not graph.json — that would sit confusingly next to graph.jsonld.
    expect(index.endsWith("search.und.json")).toBe(true);
    expect(() => readFileSync(index, "utf8")).not.toThrow();
    expect(() => readFileSync(manifest, "utf8")).not.toThrow();
  });

  it("gives repeated headings their own text, not the first one's", () => {
    const { index } = buildIndexed();
    const doc = JSON.parse(readFileSync(index, "utf8")) as {
      entries: Array<{ id: string; text?: string }>;
    };
    // Named by document, not by fragment alone: the localized tree added in
    // ADR 01037 also has a `## Install`, and a bare `endsWith("#install")`
    // silently starts asserting about the German page instead.
    const find = (suffix: string) =>
      doc.entries.find((e) => e.id.endsWith(`docs/getting-started.md${suffix}`))
        ?.text ?? "";
    // getting-started.md has two `## Install` headings.
    expect(find("#install")).toContain("Run the installer");
    expect(find("#install-1")).toContain("duplicate heading");
  });
});

describe("manni kg search (integration)", () => {
  it("ranks the configuration nodes first for a title query", () => {
    const { graph } = buildIndexed();
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
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results[0]!.iri).toContain("configuration");
    expect(out.results[0]!.via).toBe("lexical");
  });

  it("finds a section by body text the graph does not contain", () => {
    const { graph } = buildIndexed();
    // "installer" appears only in getting-started.md's body — the case the
    // search artifact exists to make findable (ADR 01019).
    const out = search([
      "search",
      "installer",
      "-g",
      graph,
      "--lang",
      "und",
      "-f",
      "json",
    ]);
    expect(out.results.map((r) => r.iri)).toContain(
      "https://example.com/kg/doc/docs/getting-started.md#install",
    );
  });

  it("records every result in the trace and honors --limit", () => {
    const { graph } = buildIndexed();
    const out = search([
      "search",
      "configuration",
      "-g",
      graph,
      "--lang",
      "und",
      "--limit",
      "2",
      "-f",
      "json",
    ]);
    expect(out.results).toHaveLength(2);
    expect(out.trace.entry.map((e) => e.iri)).toEqual(
      out.results.map((r) => r.iri),
    );
  });

  it("reports no matches without failing", () => {
    const { graph } = buildIndexed();
    const { stdout, status } = run(
      ["search", "zzzznotpresent", "-g", graph, "--lang", "und"],
      corpus,
    );
    expect(status).toBe(0);
    expect(stdout).toContain("(no matches)");
  });

  it("is deterministic across two runs", () => {
    const { graph } = buildIndexed();
    const args = [
      "search",
      "install",
      "-g",
      graph,
      "--lang",
      "und",
      "-f",
      "json",
    ];
    expect(run(args, corpus).stdout).toBe(run(args, corpus).stdout);
  });

  it("exits 2 when the index is unreadable or the wrong file", () => {
    const { dir, graph } = buildIndexed();
    const bad = mkdtempSync(join(tmpdir(), "dockg-search-bad-"));
    // A manifest naming an index that is not JSON at all.
    writeFileSync(
      join(bad, "localizations.json"),
      JSON.stringify({
        version: 1,
        languages: [
          {
            language: "und",
            documents: 1,
            search: { path: "search.und.json", entries: 1, digest: "sha256:x" },
          },
        ],
      }),
      "utf8",
    );
    writeFileSync(join(bad, "search.und.json"), "not json", "utf8");
    const parse = run(["search", "anything", "-g", graph, "-i", bad], corpus);
    expect(parse.status).toBe(2);
    expect(parse.stdout).toContain("Failed to parse");

    // A real file of the wrong shape must not report a confident "0 results".
    writeFileSync(
      join(bad, "search.und.json"),
      JSON.stringify({ "@graph": [] }),
      "utf8",
    );
    const shape = run(["search", "anything", "-g", graph, "-i", bad], corpus);
    expect(shape.status).toBe(2);
    expect(shape.stdout).toContain("Not a dockg search index");
    expect(dir).toBeTruthy();
  });

  it("refuses to guess when the corpus has more than one localization", () => {
    // Answering a question out of the wrong language is the failure the
    // per-locale fan-out exists to prevent; picking silently would hide it
    // behind a confident result (ADR 01038).
    const { graph } = buildIndexed();
    const { status, stdout } = run(["search", "install", "-g", graph], corpus);
    expect(status).toBe(2);
    expect(stdout).toContain("more than one localization");
    expect(stdout).toContain("--lang");
  });

  it("names the languages it has when --lang matches none", () => {
    const { graph } = buildIndexed();
    const { status, stdout } = run(
      ["search", "install", "-g", graph, "--lang", "ja"],
      corpus,
    );
    expect(status).toBe(2);
    expect(stdout).toContain('No index for language "ja"');
    expect(stdout).toContain("de-AT");
  });

  it("searches only the language it was given", () => {
    const { graph } = buildIndexed();
    const out = search([
      "search",
      "Erste",
      "-g",
      graph,
      "--lang",
      "de",
      "-f",
      "json",
    ]);
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) expect(r.iri).toContain("/docs/de/");
  });

  it("exits 2 when the search index is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-search-none-"));
    const graph = join(dir, "graph.ttl");
    execFileSync(process.execPath, [cli, "kg", "build", "--out", graph], {
      encoding: "utf8",
      cwd: corpus,
    });
    const { status, stdout } = run(
      ["search", "anything", "-g", graph, "--lang", "und"],
      corpus,
    );
    expect(status).toBe(2);
    expect(stdout).toContain("export --format search");
  });
});

/**
 * Regressions from the review of ADR 01038's implementation. Each of these was
 * a silent wrong answer or a raw stack trace before the fix.
 */
describe("manni kg search — artifact resolution (review fixes)", () => {
  it("finds the sidecar the manifest names, wherever the indexes live", () => {
    // The manifest's `vectors.path` is relative to the manifest. Resolving it
    // against `config.embed.out` instead made the vector leg vanish silently
    // for any layout where the two differ — a lexical answer to a hybrid
    // question, with exit 0.
    const { graph, dir } = buildIndexed();
    execFileSync(
      process.execPath,
      [cli, "kg", "embed", "-g", graph, "--model", "mock", "--no-cache"],
      { encoding: "utf8", cwd: corpus },
    );
    const out = search([
      "search",
      "configuration",
      "-g",
      graph,
      "-i",
      dir,
      "--lang",
      "und",
      "--mode",
      "hybrid",
      "-f",
      "json",
    ]);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.trace.entry.length).toBeGreaterThan(0);
  });

  it("exits 2 on a manifest entry that is missing its search block", () => {
    // A truncated or hand-edited manifest used to crash at
    // `localization.search.path` with a Node stack trace and exit 1.
    const { graph } = buildIndexed();
    const bad = mkdtempSync(join(tmpdir(), "dockg-search-manifest-"));
    writeFileSync(
      join(bad, "localizations.json"),
      JSON.stringify({
        version: 1,
        languages: [{ language: "de", documents: 1 }],
      }),
      "utf8",
    );
    const { status, stdout } = run(
      ["search", "anything", "-g", graph, "-i", bad],
      corpus,
    );
    expect(status).toBe(2);
    expect(stdout).toContain("Not a dockg localization manifest");
  });

  it("refuses a language tag it cannot safely turn into a filename", () => {
    // `export` does not run SHACL, so the BCP-47 pattern in the shapes never
    // sees this graph. Unchecked, `lang: ../escaped` reached writeFileSync as
    // a path segment and crashed with exit 1.
    const dir = mkdtempSync(join(tmpdir(), "dockg-search-badlang-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  baseIri: https://example.com/kg/\n  inputs: ["*.md"]\n  provenance:\n    git: false\n',
    );
    writeFileSync(
      join(dir, "a.md"),
      "---\ntitle: Evil\nlang: ../escaped\n---\n\n# Evil\n",
    );
    execFileSync(process.execPath, [cli, "kg", "build", "--out", "g.ttl"], {
      encoding: "utf8",
      cwd: dir,
    });
    const { status, stdout } = run(
      ["export", "-f", "search", "-g", "g.ttl", "-o", "kg"],
      dir,
    );
    expect(status).toBe(2);
    expect(stdout).toContain("not a BCP-47 tag");
    expect(stdout).not.toContain("ENOENT");
  });
});
