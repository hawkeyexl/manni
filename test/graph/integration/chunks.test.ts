/**
 * `manni graph export chunks` (proposal 0090, PR 1): the chunk artifact and
 * the provenance record each passage carries.
 *
 * The fixture is committed twice in a temporary repository. The second
 * commit changes the source line one pin rests on (a drifted pin) and the
 * page body without its `last-updated` (a stale stamp). An evals report is
 * then written, and one page is edited after it (a changed page, and a dirty
 * worktree).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runBuild } from "../../../src/graph/commands/build.js";
import { runEmbed } from "../../../src/graph/commands/embed.js";
import { runExport } from "../../../src/graph/commands/export.js";
import { runDerive, integrityOf } from "../../../src/meta/index.js";
import { sliceSection } from "../../../src/graph/runtime/resolve.js";
import type { ChunkRow, ChunksManifest } from "../../../src/graph/runtime/chunks.js";
import { GraphError } from "../../../src/graph/types.js";
import {
  emitLocalizations,
  LOCALIZATIONS_FILENAME,
  parseLocalizations,
  vectorIndexFilename,
} from "../../../src/graph/core/localizations.js";
import { encodeVectorIndex } from "../../../src/graph/core/vector-index.js";
import {
  commit,
  gitAvailable,
  makeTempRepo,
  removeTempRepo,
  writeFile,
} from "../../helpers/temp-repo.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "provenance");
const LANGUAGES = join(import.meta.dirname, "..", "fixtures", "chunks-languages");
const DOC = "urn:manni:graph:doc/docs/retry.md";
const LIMITS = `${DOC}#retry-limits`;
const BACKOFF = `${DOC}#backoff`;

/** Every fixture file, as `makeTempRepo` takes them. */
function fixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(FIXTURE, abs).split("\\").join("/")] = readFileSync(abs, "utf8");
    }
  };
  walk(FIXTURE);
  return out;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");

function rowsOf(dir: string, file = "chunks.und.jsonl"): ChunkRow[] {
  return read(dir, `.manni/graph/${file}`)
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as ChunkRow);
}
const manifestOf = (dir: string): ChunksManifest =>
  JSON.parse(read(dir, ".manni/graph/chunks.json")) as ChunksManifest;
const row = (rows: ChunkRow[], id: string): ChunkRow => {
  const hit = rows.find((r) => r.id === id);
  if (hit === undefined) throw new Error(`no row ${id}`);
  return hit;
};

/** An evals report shaped as `manni docevals run -f json` writes one. */
function report(dir: string): string {
  const integrity = (rel: string) => integrityOf(Buffer.from(read(dir, rel), "utf8"));
  return JSON.stringify({
    pages: 3,
    evalResults: [
      { evalName: "no-todo", suite: "graph", type: "assertion", grader: "command", file: "docs/retry.md", outcome: "pass", integrity: integrity("docs/retry.md") },
      { evalName: "answers", suite: "quality", type: "judgment", grader: "ai", file: "docs/retry.md", outcome: "fail", integrity: integrity("docs/retry.md"), consensus: { meanConfidence: 0.91 } },
      { evalName: "no-todo", suite: "graph", type: "assertion", grader: "command", file: "docs/other.md", outcome: "pass", integrity: integrity("docs/other.md") },
      { evalName: "no-todo", suite: "graph", type: "assertion", grader: "command", file: "docs/gone.md", outcome: "pass", integrity: `sha256-${"0".repeat(64)}` },
    ],
    suites: [],
    usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 0 },
    generated: [],
    exitCode: 1,
    problems: [],
  });
}

/** The fixture, committed twice, with a report and one page edited after it. */
function scenario(): { dir: string; first: string; second: string } {
  const dir = makeTempRepo({ files: fixtureFiles() });
  const first = commit(dir, "initial", { authorDate: "2026-03-01T12:00:00Z" });
  writeFile(dir, "docs/retry.md", read(dir, "docs/retry.md").replaceAll("COMMIT", first).replace("Backoff doubles each time.", "Backoff doubles on each retry."));
  writeFile(dir, "src/upload.ts", read(dir, "src/upload.ts").replace("BACKOFF_MS = 500", "BACKOFF_MS = 750"));
  const second = commit(dir, "drift", { authorDate: "2026-05-01T12:00:00Z" });
  writeFile(dir, "evals.json", report(dir));
  writeFile(dir, "docs/other.md", `${read(dir, "docs/other.md")}\nMore text.\n`);
  return { dir, first, second };
}

const hasGit = gitAvailable();
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) removeTempRepo(d);
  dirs = [];
});

describe.skipIf(!hasGit)("graph export chunks", () => {
  let dir: string;
  let first: string;
  let second: string;
  let result: Awaited<ReturnType<typeof runExport>>;

  beforeAll(async () => {
    ({ dir, first, second } = scenario());
    await runBuild({ cwd: dir });
    result = await runExport({ cwd: dir, format: "chunks" });
  }, 60_000);

  it("writes the manifest and one JSONL per language, with sorted keys", () => {
    expect(result.outPath).toBe(join(dir, ".manni/graph/chunks.json"));
    const manifest = manifestOf(dir);
    expect(Object.keys(manifest)).toEqual([
      "commit", "evals", "format", "graph", "graphFile", "languages", "pages", "retrieve", "searchIndex", "version", "withheld", "worktree",
    ]);
    expect(manifest).toMatchObject({
      format: "manni-graph-chunks",
      version: 1,
      graphFile: "graph.jsonld",
      searchIndex: "localizations.json",
      commit: second,
      worktree: "modified",
      retrieve: { seeds: 3, depth: 1, maxChars: 12000, withhold: [] },
      evals: { report: "evals.json", digest: integrityOf(readFileSync(join(dir, "evals.json"))) },
      withheld: [],
    });
    expect(manifest.graph).toMatch(/^sha256-[0-9a-f]{64}$/);
    const rows = rowsOf(dir);
    expect(manifest.languages).toEqual({ und: { file: "chunks.und.jsonl", model: null, rows: rows.length } });
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort());
    for (const r of rows) {
      expect(r.graph).toBe(manifest.graph);
      expect(Object.keys(r)).toEqual(["graph", "id", "language", "lines", "metadata", "page", "provenance", "text", "title"]);
    }
  });

  it("is byte-identical when exported again", async () => {
    const before = [read(dir, ".manni/graph/chunks.json"), read(dir, ".manni/graph/chunks.und.jsonl")];
    await runExport({ cwd: dir, format: "chunks" });
    expect([read(dir, ".manni/graph/chunks.json"), read(dir, ".manni/graph/chunks.und.jsonl")]).toEqual(before);
  });

  it("cuts a section's passage where sliceSection does, in body lines", () => {
    const content = read(dir, "docs/retry.md");
    const limits = row(rowsOf(dir), LIMITS);
    expect(limits.text).toBe(sliceSection(content, "Retry limits", 2));
    expect(limits.lines).toBe("4-13");
    expect(limits.title).toBe("Retry limits");
    const doc = row(rowsOf(dir), DOC);
    expect(doc.lines).toBe("1-16");
    expect(doc.text.startsWith("# Retry an upload")).toBe(false);
    expect(doc.text.trim().startsWith("# Retry an upload")).toBe(true);
  });

  it("counts the pins whose claim overlaps the passage, each with its commit and verification", () => {
    const { pins } = row(rowsOf(dir), LIMITS).provenance;
    expect(pins).toMatchObject({ total: 2, current: 1, notice: 0, warning: 0, error: 1 });
    expect(pins.items).toEqual([
      {
        id: "retry-default",
        claim: "6",
        source: "src/upload.ts:1",
        commit: first,
        findings: [],
        lastVerified: "2026-10-19",
        verifiedBy: [{ tool: "lychee", passed: "2026-10-19" }],
      },
      {
        id: "retry-backoff",
        claim: "8",
        source: "src/upload.ts:2",
        commit: first,
        findings: [{ rule: "source-changed", severity: "error" }],
        lastVerified: null,
        verifiedBy: [],
      },
    ]);
    expect(row(rowsOf(dir), BACKOFF).provenance.pins).toEqual({ total: 0, current: 0, notice: 0, warning: 0, error: 0, items: [] });
  });

  it("dates the page as meta derive would stamp it, and reads its verification", async () => {
    const derived = await runDerive({ inputs: ["docs/retry.md"], cwd: dir, fields: ["created", "last-updated"], sources: ["git"], dryRun: true });
    const field = (name: string) => derived.results[0]?.fields.find((f) => f.field === name)?.derived;
    const { dates } = row(rowsOf(dir), LIMITS).provenance;
    expect(dates).toEqual({
      created: { day: field("created"), stamp: "absent" },
      lastUpdated: { day: field("last-updated"), stamp: "stale" },
      lastVerified: "2026-10-20",
      verifiedBy: [{ tool: "doc-detective", check: "retry-limits", passed: "2026-10-20" }],
    });
    expect(dates.created.day).toBe("2026-03-01");
    expect(dates.lastUpdated.day).toBe("2026-05-01");
    // An uncommitted change has no day git can attest.
    // With no day to compare, there is no stamp either.
    expect(row(rowsOf(dir), "urn:manni:graph:doc/docs/other.md").provenance.dates.lastUpdated).toEqual({ day: null, stamp: null });
  });

  it("ties verdicts to the page text they judged", () => {
    const retry = row(rowsOf(dir), LIMITS).provenance.evals;
    expect(retry).toMatchObject({ current: true, pass: 1, fail: 1, needsReview: 0, skipped: 0, error: 0 });
    expect(retry?.items).toEqual([
      { name: "no-todo", suite: "graph", grader: "command", outcome: "pass" },
      { name: "answers", suite: "quality", grader: "ai", outcome: "fail", confidence: 0.91 },
    ]);
    expect(row(rowsOf(dir), "urn:manni:graph:doc/docs/other.md").provenance.evals?.current).toBe(false);
  });

  it("carries the block statements anchored inside the passage", () => {
    expect(row(rowsOf(dir), LIMITS).provenance.statements).toEqual([
      { lines: "11-11", status: "unpinned", data: { "last-verified": "2026-10-18" } },
    ]);
    expect(row(rowsOf(dir), BACKOFF).provenance.statements).toEqual([]);
  });

  it("overlays heading statements on the page's delivered fields, and drops answer pins", () => {
    const backoff = row(rowsOf(dir), BACKOFF).metadata;
    const limits = row(rowsOf(dir), LIMITS).metadata;
    expect(backoff["applies-to"]).toEqual(["windows"]);
    expect(limits["applies-to"]).toBeUndefined();
    expect(limits.title).toBe("Retry an upload");
    expect(limits).not.toHaveProperty("citations");
    expect(limits["sample-questions"]).toEqual([{ question: "How many times does an upload retry?" }]);
    expect(manifestOf(dir).pages["docs/retry.md"]?.metadata).toEqual(row(rowsOf(dir), DOC).metadata);
  });

  it("says what it could not prove", () => {
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        `1 page differs from ${second.slice(0, 8)}, so their records describe uncommitted text.`,
        "1 page changed since evals.json was written, so their verdicts read stale.",
        "1 page in evals.json is not in the graph, so their verdicts are left out.",
        "no vector sidecar, so chunks carry no vectors and retrieval is lexical only; configure graph.embed to add them.",
      ]),
    );
    expect(result.notices).toEqual([]);
  });

  it("leaves out what graph.retrieve.withhold names, and lists it", async () => {
    const config = read(dir, "manni.config.yaml");
    writeFile(dir, "manni.config.yaml", `${config}  retrieve:\n    withhold: [drifted]\n`);
    try {
      const withheld = await runExport({ cwd: dir, format: "chunks" });
      const ids = rowsOf(dir).map((r) => r.id);
      expect(ids).not.toContain(LIMITS);
      expect(ids).toContain(BACKOFF);
      expect(manifestOf(dir).withheld).toEqual([
        { id: DOC, page: "docs/retry.md", because: ["drifted"] },
        { id: `${DOC}#retry-an-upload`, page: "docs/retry.md", because: ["drifted"] },
        { id: LIMITS, page: "docs/retry.md", because: ["drifted"] },
      ]);
      expect(withheld.notices).toEqual(["3 chunks withheld by graph.retrieve.withhold (drifted); chunks.json lists them."]);
    } finally {
      writeFile(dir, "manni.config.yaml", config);
    }
  });

  it("withholds a page whose current verdicts failed, and never one whose verdicts are stale", async () => {
    const config = read(dir, "manni.config.yaml");
    writeFile(dir, "manni.config.yaml", `${config}  retrieve:\n    withhold: [failing]\n`);
    try {
      await runExport({ cwd: dir, format: "chunks" });
      const ids = rowsOf(dir).map((r) => r.id);
      expect(ids).not.toContain(LIMITS);
      expect(ids).not.toContain(BACKOFF);
      expect(ids).toContain("urn:manni:graph:doc/docs/other.md");
      const withheld = manifestOf(dir).withheld;
      expect(withheld.map((w) => w.page)).toEqual(withheld.map(() => "docs/retry.md"));
      expect(withheld.map((w) => w.because)).toEqual(withheld.map(() => ["failing"]));
      expect(withheld.map((w) => w.id)).toEqual(expect.arrayContaining([DOC, LIMITS, BACKOFF]));
    } finally {
      writeFile(dir, "manni.config.yaml", config);
    }
  });

  it("gives a page the report never judged no verdicts, and withholds nothing for it", async () => {
    const full = JSON.parse(read(dir, "evals.json")) as { evalResults: { file: string; outcome: string }[] };
    full.evalResults = full.evalResults.filter((r) => r.file !== "docs/other.md");
    for (const r of full.evalResults) r.outcome = "fail";
    writeFileSync(join(dir, "partial.json"), JSON.stringify(full));
    const config = read(dir, "manni.config.yaml");
    writeFile(dir, "manni.config.yaml", `${config}  retrieve:\n    withhold: [drifted, failing]\n`);
    try {
      await runExport({ cwd: dir, format: "chunks", evals: "partial.json" });
      const other = row(rowsOf(dir), "urn:manni:graph:doc/docs/other.md");
      expect(other.provenance.evals).toBeNull();
      expect(manifestOf(dir).withheld.some((w) => w.page === "docs/other.md")).toBe(false);
    } finally {
      writeFile(dir, "manni.config.yaml", config);
    }
  });

  it("attaches each node's vector when a sidecar holds one", async () => {
    await runExport({ cwd: dir, format: "search" });
    await runEmbed({ cwd: dir, model: "mock", noCache: true });
    const withVectors = await runExport({ cwd: dir, format: "chunks" });
    const manifest = manifestOf(dir);
    const model = manifest.languages.und?.model;
    expect(model?.id).toBe("mock");
    const limits = row(rowsOf(dir), LIMITS);
    expect(limits.vector).toHaveLength(model?.dimensions ?? -1);
    expect(withVectors.warnings.some((w) => w.startsWith("no vector sidecar"))).toBe(false);
  });

  it("refuses --evals with another target, a missing report and a non-report", async () => {
    await expect(runExport({ cwd: dir, format: "jsonld", evals: "evals.json" })).rejects.toThrow(
      new GraphError("--evals applies only to graph export chunks."),
    );
    await expect(runExport({ cwd: dir, format: "chunks", evals: "missing.json" })).rejects.toThrow(
      "graph.export.chunks.evals names missing.json, which does not exist.",
    );
    writeFileSync(join(dir, "not-a-report.json"), "{\"hello\": 1}");
    await expect(runExport({ cwd: dir, format: "chunks", evals: "not-a-report.json" })).rejects.toThrow(
      "not-a-report.json is not a docevals JSON report; write one with manni docevals run -f json.",
    );
  });

  it("warns when a report records no integrity, or none is configured", async () => {
    const old = JSON.parse(read(dir, "evals.json")) as { evalResults: Record<string, unknown>[] };
    for (const r of old.evalResults) delete r.integrity;
    writeFileSync(join(dir, "old.json"), JSON.stringify(old));
    const stale = await runExport({ cwd: dir, format: "chunks", evals: "old.json" });
    expect(stale.warnings).toContain(
      "old.json records no page integrity, so every verdict reads stale; write it again with manni docevals run -f json.",
    );
    expect(row(rowsOf(dir), LIMITS).provenance.evals?.current).toBe(false);

    const config = read(dir, "manni.config.yaml");
    writeFile(dir, "manni.config.yaml", config.replace("      evals: evals.json\n", "      evals: null\n"));
    try {
      const none = await runExport({ cwd: dir, format: "chunks" });
      expect(none.warnings).toContain("no docevals report is configured, so records carry no eval verdicts.");
      expect(row(rowsOf(dir), LIMITS).provenance.evals).toBeNull();
      expect(manifestOf(dir).evals).toBeNull();
    } finally {
      writeFile(dir, "manni.config.yaml", config);
    }
  });
});

// graph.embed.byLanguage can embed each language with its own model, so the
// manifest records the model per language, from that language's sidecar.
describe("graph export chunks across languages", () => {
  it("records each language's model, and null for a language with no sidecar", async () => {
    const files: Record<string, string> = {};
    for (const rel of ["manni.config.yaml", "docs/en.md", "docs/de.md", "docs/fr.md"]) {
      files[rel] = readFileSync(join(LANGUAGES, rel), "utf8");
    }
    const dir = makeTempRepo({ files, init: false });
    dirs.push(dir);
    await runBuild({ cwd: dir });
    await runExport({ cwd: dir, format: "search" });
    const out = join(dir, ".manni/graph");
    const manifestPath = join(out, LOCALIZATIONS_FILENAME);
    const doc = parseLocalizations(readFileSync(manifestPath, "utf8"));
    if (doc === undefined) throw new Error("no localizations manifest");
    // English and German embedded with different models; French left without vectors.
    const models: Record<string, { model: string; dims: number }> = { en: { model: "model-en", dims: 4 }, de: { model: "model-de", dims: 6 } };
    for (const entry of doc.languages) {
      const want = models[entry.language];
      if (want === undefined) continue;
      const index = JSON.parse(readFileSync(join(out, entry.search.path), "utf8")) as { entries: { id: string }[] };
      const path = vectorIndexFilename(entry.language);
      const vectors = index.entries.map((e) => ({ id: e.id, vector: new Float32Array(want.dims).fill(0.5) }));
      writeFileSync(join(out, path), encodeVectorIndex(vectors, { model: want.model, dtype: "fp32", source: entry.search.digest, language: entry.language }));
      entry.vectors = { path, model: want.model, dtype: "fp32", dims: want.dims, count: vectors.length };
    }
    writeFileSync(manifestPath, emitLocalizations(doc));

    await runExport({ cwd: dir, format: "chunks" });
    const first = read(dir, ".manni/graph/chunks.json");
    const manifest = JSON.parse(first) as ChunksManifest;
    expect(manifest).not.toHaveProperty("model");
    expect(manifest.languages).toEqual({
      de: { file: "chunks.de.jsonl", model: { id: "model-de", dimensions: 6 }, rows: rowsOf(dir, "chunks.de.jsonl").length },
      en: { file: "chunks.en.jsonl", model: { id: "model-en", dimensions: 4 }, rows: rowsOf(dir, "chunks.en.jsonl").length },
      fr: { file: "chunks.fr.jsonl", model: null, rows: rowsOf(dir, "chunks.fr.jsonl").length },
    });
    expect(Object.keys(manifest.languages.en ?? {})).toEqual(["file", "model", "rows"]);
    expect(rowsOf(dir, "chunks.de.jsonl").every((r) => r.vector?.length === 6)).toBe(true);
    expect(rowsOf(dir, "chunks.fr.jsonl").every((r) => r.vector === undefined)).toBe(true);

    await runExport({ cwd: dir, format: "chunks" });
    expect(read(dir, ".manni/graph/chunks.json")).toBe(first);
  }, 60_000);
});

// Proposal 0099, decision 11: a repository without git is a normal case.
describe("graph export chunks outside git", () => {
  it("computes pins, reads verification, leaves commit and days null, and says so once", async () => {
    const files = fixtureFiles();
    files["docs/retry.md"] = (files["docs/retry.md"] ?? "").replaceAll("COMMIT", "a".repeat(40));
    const dir = makeTempRepo({ files, init: false });
    dirs.push(dir);
    // The configured report is not here; this case is about git, so drop it.
    writeFile(dir, "manni.config.yaml", read(dir, "manni.config.yaml").replace("      evals: evals.json\n", "      evals: null\n"));
    await runBuild({ cwd: dir });
    const run = await runExport({ cwd: dir, format: "chunks" });
    const limits = row(rowsOf(dir), LIMITS).provenance;
    expect(limits.commit).toBeNull();
    expect(limits.worktree).toBeNull();
    expect(limits.pins).toMatchObject({ total: 2, current: 2, error: 0 });
    expect(limits.pins.items.map((i) => i.commit)).toEqual(["a".repeat(40), "a".repeat(40)]);
    expect(limits.dates).toEqual({
      created: { day: null, stamp: null },
      lastUpdated: { day: null, stamp: null },
      lastVerified: "2026-10-20",
      verifiedBy: [{ tool: "doc-detective", check: "retry-limits", passed: "2026-10-20" }],
    });
    expect(run.notices).toHaveLength(1);
    expect(run.notices?.[0]).toMatch(/^git cannot read this directory \(.+\), so records carry no commit and no derived dates\.$/);
    expect(manifestOf(dir)).toMatchObject({ commit: null, worktree: null });
  }, 60_000);
});
