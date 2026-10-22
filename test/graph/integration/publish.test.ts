/**
 * `manni graph publish` (proposal 0090, PR 4): every step that is set up, in
 * one directory, through each step's own core. A step that is not set up is
 * skipped and reported, and a step that fails stops the run with its message.
 *
 * The retrieval fixture is copied outside git, so the run also shows that
 * publishing never needs a repository.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderPublish, runPublish, type PublishReport } from "../../../src/graph/commands/publish.js";
import type { ChunkRow } from "../../../src/graph/runtime/chunks.js";
import { GraphError } from "../../../src/graph/types.js";
import { spawnText } from "../../helpers/spawn.js";
import { makeTempRepo, removeTempRepo } from "../../helpers/temp-repo.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "retrieve");
const cli = join(import.meta.dirname, "..", "..", "..", "dist", "cli.js");

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

/** Every optional section `graph publish` runs a step for. */
const EVERY_STEP = [
  "  embed:",
  "    model: mock",
  "  export:",
  "    iirds:",
  "      title: Example",
  "    llms:",
  "      title: Example",
  "      origin: https://docs.example.com",
  "",
].join("\n");

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) removeTempRepo(d);
  dirs = [];
});

function fixture(extra = ""): string {
  const dir = makeTempRepo({ files: fixtureFiles(), init: false });
  dirs.push(dir);
  if (extra !== "") {
    const path = join(dir, "manni.config.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace("graph:\n", `graph:\n${extra}`), "utf8");
  }
  return dir;
}

const said: { kind: string; message: string }[] = [];
const say = (kind: "warning" | "notice", message: string): void => {
  said.push({ kind, message });
};

const steps = (report: PublishReport): [string, string][] => report.steps.map((s) => [s.step, s.status]);

describe("graph publish", () => {
  it("runs what is set up into the graph's directory, and skips the rest", async () => {
    const dir = fixture();
    const report = await runPublish({ cwd: dir, say });
    expect(report.out).toBe(".manni/graph");
    expect(steps(report)).toEqual([
      ["build", "ran"],
      ["export:search", "ran"],
      ["embed", "skipped"],
      ["export:jsonld", "ran"],
      ["export:chunks", "ran"],
      ["export:llms", "skipped"],
      ["export:iirds", "skipped"],
    ]);
    const skipped = report.steps.filter((s) => s.status === "skipped");
    expect(skipped.map((s) => s.detail)).toEqual([
      "no graph.embed section",
      "no graph.export.llms section",
      "no graph.export.iirds section",
    ]);
    expect(skipped.every((s) => s.files.length === 0)).toBe(true);
    for (const file of ["graph.ttl", "graph.jsonld", "localizations.json", "search.en.json", "chunks.json", "chunks.en.jsonl"]) {
      expect(existsSync(join(dir, ".manni/graph", file)), file).toBe(true);
    }
    const files = report.steps.flatMap((s) => s.files);
    expect(files).toContain("chunks.json");
    expect(new Set(files).size).toBe(files.length);
  });

  it("puts every artifact in --out, embeds when graph.embed exists, and writes llms.txt and the iiRDS package", async () => {
    const dir = fixture(EVERY_STEP);
    const report = await runPublish({ cwd: dir, out: "site/graph", say });
    expect(report.out).toBe("site/graph");
    expect(report.steps.every((s) => s.status === "ran")).toBe(true);
    const out = join(dir, "site/graph");
    const written = readdirSync(out).sort();
    expect(written).toEqual(
      [
        "chunks.de.jsonl",
        "chunks.en.jsonl",
        "chunks.json",
        "graph.iirds",
        "graph.jsonld",
        "graph.ttl",
        "llms.txt",
        "localizations.json",
        "search.de.json",
        "search.en.json",
        "vectors.de.bin",
        "vectors.en.bin",
      ].sort(),
    );
    expect(new Set(report.steps.flatMap((s) => s.files)).size).toBe(written.length);
    // The rows carry the vectors the embed step wrote beside them.
    const row = JSON.parse(readFileSync(join(out, "chunks.en.jsonl"), "utf8").split("\n")[0] ?? "{}") as ChunkRow;
    expect(Array.isArray(row.vector)).toBe(true);
    expect(existsSync(join(dir, ".manni/graph/graph.ttl"))).toBe(false);
  });

  it("stops at the first step that fails, with that step's message", async () => {
    const dir = fixture("  export:\n    llms:\n      title: Example\n");
    const run = runPublish({ cwd: dir, say });
    await expect(run).rejects.toThrow(GraphError);
    await expect(run).rejects.toThrow(
      "graph publish stopped at export:llms: graph export llms needs graph.export.llms.origin, the site's scheme and host.",
    );
  });

  it("passes --evals to the chunks step", async () => {
    const dir = fixture();
    await expect(runPublish({ cwd: dir, evals: "missing.json", say })).rejects.toThrow(
      /^graph publish stopped at export:chunks: .*missing\.json/,
    );
  });

  it("prints a line per step and the file count, or the step list as JSON", async () => {
    const dir = fixture();
    const report = await runPublish({ cwd: dir, say });
    const pretty = renderPublish(report, "pretty").split("\n");
    expect(pretty[0]).toMatch(/^build {5}graph\.ttl: 7 pages, \d+ triples$/);
    expect(pretty).toContain("skipped   embed: no graph.embed section");
    expect(pretty).toContain("skipped   iirds: no graph.export.iirds section");
    expect(pretty.at(-1)).toBe(`Published ${String(new Set(report.steps.flatMap((s) => s.files)).size)} files to .manni/graph/.`);
    const json = JSON.parse(renderPublish(report, "json")) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(["out", "steps"]);
    expect(json.steps).toEqual(report.steps);
    for (const s of report.steps) expect(Object.keys(s)).toEqual(["step", "status", "detail", "files"]);
  });
});

describe("graph publish, through the CLI", () => {
  function graph(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
    const r = spawnText(spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd }));
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
  }

  it("exits 0 outside git, and says the git notice once", () => {
    const dir = fixture();
    const r = graph(["publish"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/\nPublished \d+ files to \.manni\/graph\/\.\n$/);
    expect(r.stderr.match(/git cannot read this directory/g)).toHaveLength(1);
  });

  it("exits 2 when a step fails, naming the step", () => {
    const dir = fixture("  export:\n    llms:\n      origin: https://docs.example.com\n");
    const r = graph(["publish", "-f", "json"], dir);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/manni: graph publish stopped at export:llms: graph export llms needs graph\.export\.llms\.title\.\n$/);
  });
});
