/**
 * `manni vector build` over the graph's determinism corpus (proposal 0128).
 *
 * The vectors are keyed by graph node IRIs, and the indexed text is graph's,
 * so the same pages and the same `graph:` settings give the same bytes as
 * `graph build`, `graph export search` and the old `graph embed` together.
 * The graph goldens are that gate.
 */
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { renderBuild, runBuild, type BuildReport } from "../../src/vector/index.js";
import { detachedCorpus } from "../graph/helpers/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const golden = join(root, "test", "graph", "fixtures", "golden");
const LANGUAGES = ["und", "de", "de-AT", "fr"];

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `manni-vector-${prefix}-`));
}

describe("vector build over the golden corpus", () => {
  let out: string;
  let corpus: string;
  let report: BuildReport;
  beforeAll(async () => {
    corpus = detachedCorpus();
    out = tmp("golden");
    report = await runBuild({ cwd: corpus, out, model: "mock", noCache: true });
  });

  it.each(LANGUAGES)("writes the %s search index and sidecar byte-identical to the goldens", (language) => {
    for (const name of [`search.${language}.json`, `vectors.${language}.bin`]) {
      expect(readFileSync(join(out, name)).equals(readFileSync(join(golden, name))), name).toBe(true);
    }
  });

  it("writes the localization manifest byte-identical to the golden", () => {
    expect(readFileSync(join(out, "localizations.json"), "utf8")).toBe(
      readFileSync(join(golden, "localizations.json"), "utf8"),
    );
  });

  it("writes no graph.ttl, there or beside graph.out", () => {
    expect(readdirSync(out)).not.toContain("graph.ttl");
    expect(existsSync(join(corpus, "graph.ttl"))).toBe(false);
  });

  it("reports each language and totals that add up", () => {
    expect(report.languages.map((l) => l.language).sort()).toEqual([...LANGUAGES].sort());
    expect(report.entries).toBe(report.languages.reduce((n, l) => n + l.entries, 0));
    expect(report.total).toBe(report.languages.reduce((n, l) => n + l.total, 0));
    expect(report.embedded + report.cached).toBe(report.total);
    expect(report.documents).toBeGreaterThan(0);
    for (const l of report.languages) {
      expect(l.model).toBe("mock");
      expect(l.dims).toBeGreaterThan(0);
      expect(l.total).toBeLessThanOrEqual(l.entries);
      expect(l.searchPath.endsWith(`search.${l.language}.json`)).toBe(true);
      expect(l.outPath.endsWith(`vectors.${l.language}.bin`)).toBe(true);
    }
  });

  it("prints the index line, the sidecar line and one line per language", () => {
    const lines = renderBuild(report, "pretty").split("\n");
    const n = report.languages.length;
    expect(lines[0]).toBe(
      `Indexed ${String(report.documents)} pages: ${String(report.entries)} entries in ${String(n)} languages`,
    );
    expect(lines[1]).toBe(`Wrote ${String(n)} sidecars, recorded in ${report.manifestPath}`);
    expect(lines.slice(2, 2 + n).every((l) => / vectors \(\d+-d, mock\) -> /.test(l))).toBe(true);
    expect(lines.at(-1)).toBe(`  ${String(report.embedded)} embedded, ${String(report.cached)} from cache`);
  });

  it("prints the report as JSON, naming a directory outside the working one in full", () => {
    const json = JSON.parse(renderBuild(report, "json")) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual([
      "manifestPath",
      "documents",
      "entries",
      "languages",
      "embedded",
      "cached",
      "total",
    ]);
    expect(report.manifestPath).toBe(join(out, "localizations.json"));
  });
});

describe("vector build settings", () => {
  it("writes beside graph.out when -o is not given", async () => {
    const corpus = detachedCorpus();
    const report = await runBuild({ cwd: corpus, model: "mock", noCache: true });
    // Inside the working directory, a path is relative to it.
    expect(report.manifestPath).toBe("localizations.json");
    expect(report.languages.every((l) => l.outPath === `vectors.${l.language}.bin`)).toBe(true);
    expect(existsSync(join(corpus, "localizations.json"))).toBe(true);
    expect(existsSync(join(corpus, "vectors.und.bin"))).toBe(true);
  });

  it("serves a repeat run from the cache vector.cacheDir names", async () => {
    const corpus = detachedCorpus();
    appendFileSync(join(corpus, "manni.config.yaml"), "\nvector:\n  model: mock\n  cacheDir: .vectors\n");
    const first = await runBuild({ cwd: corpus, out: tmp("cache-a") });
    expect(first.embedded).toBeGreaterThan(0);
    const second = await runBuild({ cwd: corpus, out: tmp("cache-b") });
    expect(second.embedded).toBe(0);
    expect(second.cached).toBe(first.total);
    expect(existsSync(join(corpus, ".vectors"))).toBe(true);
  });

  it("matches vector.byLanguage keys whatever case they are written in", async () => {
    const corpus = detachedCorpus();
    appendFileSync(
      join(corpus, "manni.config.yaml"),
      "\nvector:\n  model: not/a-real-model\n  byLanguage:\n    UND:\n      model: mock\n    De:\n      model: mock\n    de-at:\n      model: mock\n    FR:\n      model: mock\n",
    );
    const report = await runBuild({ cwd: corpus, out: tmp("by-language"), noCache: true });
    expect(report.languages.every((l) => l.model === "mock")).toBe(true);
  });

  it("lets --embedding-model override vector.model", async () => {
    const corpus = detachedCorpus();
    appendFileSync(join(corpus, "manni.config.yaml"), "\nvector:\n  model: not/a-real-model\n");
    const report = await runBuild({ cwd: corpus, out: tmp("override"), model: "mock", noCache: true });
    expect(report.languages.every((l) => l.model === "mock")).toBe(true);
  });
});
