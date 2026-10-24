/**
 * `--no-authoring` through the built CLI (proposal 0110): what a run without
 * author-facing content writes and prints, its usage errors, and the warning
 * a configured evals report gets.
 *
 * The fixture is committed in a temporary repository, so cite resolves the
 * page's pin and the chunk rows carry it by default.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChunkRow } from "../../../src/graph/runtime/chunks.js";
import { spawnText } from "../../helpers/spawn.js";
import { commit, gitAvailable, makeTempRepo, removeTempRepo, writeFile } from "../../helpers/temp-repo.js";

const root = join(import.meta.dirname, "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "authoring");

function graph(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnText(spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd }));
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

function filesUnder(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) Object.assign(out, filesUnder(abs, base));
    else out[relative(base, abs).split("\\").join("/")] = readFileSync(abs, "utf8");
  }
  return out;
}

const rows = (dir: string): ChunkRow[] =>
  Object.entries(filesUnder(dir))
    .filter(([name]) => /^chunks\..*\.jsonl$/.test(name))
    .flatMap(([, text]) => text.trimEnd().split("\n"))
    .map((line) => JSON.parse(line) as ChunkRow);

const hasGit = gitAvailable();

describe.skipIf(!hasGit)("graph publish with and without author-facing content", () => {
  let dir: string;
  let on: ReturnType<typeof graph>;
  let off: ReturnType<typeof graph>;

  beforeAll(() => {
    dir = makeTempRepo({ files: filesUnder(FIXTURE) });
    const first = commit(dir, "initial", { authorDate: "2026-03-01T12:00:00Z" });
    writeFile(dir, "docs/authored.md", readFileSync(join(dir, "docs/authored.md"), "utf8").replaceAll("COMMIT", first));
    commit(dir, "pin", { authorDate: "2026-03-02T12:00:00Z" });
    on = graph(["publish", "-o", "on"], dir);
    off = graph(["publish", "--no-authoring", "-o", "off"], dir);
  }, 120_000);
  afterAll(() => {
    removeTempRepo(dir);
  });

  it("names the records on the build line by default, and none without them", () => {
    expect(on.status).toBe(0);
    expect(off.status).toBe(0);
    expect(on.stdout).toMatch(/^build {5}graph\.ttl: \d+ pages, \d+ triples, 3 strategy records$/m);
    expect(off.stdout).toMatch(/^build {5}graph\.ttl: \d+ pages, \d+ triples$/m);
  });

  it("writes no record and no external value into any artifact", () => {
    const written = filesUnder(join(dir, "off"));
    for (const [name, text] of Object.entries(written)) {
      expect(text, name).not.toContain("https://example.com/graph/strategy/");
      expect(text, name).not.toContain("https://example.com/graph/doc/strategy/");
      expect(text, name).not.toContain("2024-01-02");
      expect(text, name).not.toContain("Ask Pat before the next release.");
    }
    expect(rows(join(dir, "off")).filter((r) => r.page.startsWith("strategy/"))).toEqual([]);
    const full = filesUnder(join(dir, "on"));
    expect(full["graph.ttl"]).toContain("https://example.com/graph/strategy/persona/pat");
    expect(full["graph.ttl"]).toContain("2024-01-02");
  });

  it("carries pins by default, and none without author-facing content", () => {
    const page = (list: ChunkRow[]) => list.filter((r) => r.page === "docs/authored.md");
    expect(page(rows(join(dir, "on"))).some((r) => r.provenance.pins.total > 0)).toBe(true);
    const userFacing = page(rows(join(dir, "off")));
    expect(userFacing.length).toBeGreaterThan(0);
    for (const row of userFacing) {
      expect(row.provenance.pins.items).toEqual([]);
      expect(row.provenance.evals).toBeNull();
    }
  });
});

describe("a run with nothing author-facing in it", () => {
  let dir: string;
  beforeAll(() => {
    dir = makeTempRepo({ files: filesUnder(FIXTURE), init: false });
  });
  afterAll(() => {
    removeTempRepo(dir);
  });

  it("writes the same bytes and prints the same stdout with --no-authoring", () => {
    const on = graph(["publish", "--collection", "plain", "-o", "out"], dir);
    const before = filesUnder(join(dir, "out"));
    rmSync(join(dir, "out"), { recursive: true });
    const off = graph(["publish", "--collection", "plain", "--no-authoring", "-o", "out"], dir);
    expect(on.status).toBe(0);
    expect(off.status).toBe(0);
    expect(off.stdout).toBe(on.stdout);
    expect(filesUnder(join(dir, "out"))).toEqual(before);
    expect(Object.keys(before)).toContain("chunks.json");
  });

  it("builds the same Turtle with --no-authoring", () => {
    const on = graph(["build", "--collection", "plain", "-o", "plain.ttl"], dir);
    const bytes = readFileSync(join(dir, "plain.ttl"), "utf8");
    const off = graph(["build", "--collection", "plain", "--no-authoring", "-o", "plain.ttl"], dir);
    expect(off.stdout).toBe(on.stdout);
    expect(readFileSync(join(dir, "plain.ttl"), "utf8")).toBe(bytes);
  });

  it("names the records on the build line when the build holds some", () => {
    const r = graph(["build", "-o", "all.ttl"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Wrote .*all\.ttl \(\d+ docs, \d+ triples, \d+ concepts, 3 strategy records\)\n$/);
    const one = graph(["build", "-o", "one.ttl", "strategy/pat.md", "docs/old.md"], dir);
    expect(one.stdout).toMatch(/, 1 strategy record\)\n$/);
  });
});

describe("usage errors and the evals warning", () => {
  let dir: string;
  beforeAll(() => {
    dir = makeTempRepo({ files: filesUnder(FIXTURE), init: false });
  });
  afterAll(() => {
    removeTempRepo(dir);
  });

  const EVALS =
    "manni: --evals attaches eval verdicts, which are author-facing, and this run leaves author-facing content out.\n";

  it("refuses --evals with --no-authoring on publish, exit 2", () => {
    const r = graph(["publish", "--no-authoring", "--evals", "evals.json"], dir);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(EVALS);
  });

  it("refuses --evals with --no-authoring on export chunks, exit 2", () => {
    const r = graph(["export", "chunks", "--no-authoring", "--evals", "evals.json"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(EVALS);
  });

  it("refuses --no-authoring on an export target that writes the graph as built, exit 2", () => {
    for (const target of ["jsonld", "iirds", "search", "questions"]) {
      const r = graph(["export", target, "--no-authoring"], dir);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(
        "manni: --no-authoring applies only to graph export chunks and llms; the others write the graph as built, so build it with --no-authoring.\n",
      );
    }
  });

  it("refuses serve --no-authoring without --publish, exit 2", () => {
    const r = graph(["serve", "--no-authoring"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: --no-authoring decides what --publish builds, so it needs --publish.\n");
  });

  it("warns once that a configured report is left out, exit 0", () => {
    const r = graph(["publish", "-c", "evals.config.yaml", "--no-authoring", "-o", "evals-out"], dir);
    expect(r.status).toBe(0);
    const said = r.stderr
      .split("\n")
      .filter((l) => l === "manni: graph.export.chunks.evals is set, but eval verdicts are author-facing, so this run leaves them out.");
    expect(said).toHaveLength(1);
  });
});
