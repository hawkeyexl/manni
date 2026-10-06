import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph } from "../../../src/graph/commands/build.js";
import { ANALYZE_CACHE_DIR } from "../../../src/graph/core/analyze-cache.js";
import { detachedCorpus } from "../helpers/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");

/** Build the corpus at `cwd` through the built CLI and return the Turtle. */
function build(cwd: string): string {
  const out = join(mkdtempSync(join(tmpdir(), "manni-graph-cache-out-")), "graph.ttl");
  execFileSync(process.execPath, [cli, "graph", "build", "--out", out], {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return readFileSync(out, "utf8");
}

function entries(cwd: string): string[] {
  return readdirSync(join(cwd, ANALYZE_CACHE_DIR)).map((name) =>
    join(cwd, ANALYZE_CACHE_DIR, name),
  );
}

/** The cache entry whose body carries a section titled `title`. */
function entryWithSection(cwd: string, title: string): string {
  const hit = entries(cwd).find((file) =>
    readFileSync(file, "utf8").includes(`"title":"${title}"`),
  );
  if (hit === undefined) throw new Error(`no cache entry holds "${title}"`);
  return hit;
}

describe("graph build caches each page's parse across runs", () => {
  it("writes one entry per page and builds byte-identical Turtle from it", () => {
    const corpus = detachedCorpus();
    const cold = build(corpus);
    const written = entries(corpus);
    expect(written.length).toBeGreaterThan(0);
    const before = written.map((file) => readFileSync(file, "utf8"));

    expect(build(corpus)).toBe(cold);
    // A hit rewrites nothing.
    expect(entries(corpus).map((file) => readFileSync(file, "utf8"))).toEqual(before);
  });

  it("reads the parse from the entry rather than from the page", () => {
    const corpus = detachedCorpus();
    build(corpus);
    // Doctor an entry the key still matches: only a build that read it can
    // print the doctored title.
    const file = entryWithSection(corpus, "Advanced");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace('"title":"Advanced"', '"title":"Doctored"'),
    );
    expect(build(corpus)).toContain('dcterms:title "Doctored"');
  });

  it("re-parses a page whose bytes changed", () => {
    const corpus = detachedCorpus();
    const cold = build(corpus);
    appendFileSync(join(corpus, "docs", "configuration.md"), "\n## Brand New\n");
    const warm = build(corpus);
    expect(warm).not.toBe(cold);
    expect(warm).toContain('dcterms:title "Brand New"');
  });

  it("ignores a corrupt entry and builds what a cold run builds", () => {
    const corpus = detachedCorpus();
    const cold = build(corpus);
    for (const file of entries(corpus)) writeFileSync(file, "not json {");
    expect(build(corpus)).toBe(cold);
    rmSync(join(corpus, ANALYZE_CACHE_DIR), { recursive: true });
    expect(build(corpus)).toBe(cold);
  });

  it("serves the in-memory build `manni check` runs", async () => {
    const corpus = detachedCorpus();
    const cold = await buildGraph({ cwd: corpus });
    expect(existsSync(join(corpus, ANALYZE_CACHE_DIR))).toBe(true);
    const warm = await buildGraph({ cwd: corpus });
    expect(warm.turtle).toBe(cold.turtle);
  });
});
