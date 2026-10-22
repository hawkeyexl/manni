/**
 * `manni graph export chunks` through the built CLI (proposal 0090, PR 1):
 * what each message prints, on which stream, and the exit code. The record's
 * contents are `chunks.test.ts`'s; this file holds the channel to them.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnText } from "../../helpers/spawn.js";
import { makeTempRepo, removeTempRepo, writeFile } from "../../helpers/temp-repo.js";

const root = join(import.meta.dirname, "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "provenance");

function graph(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnText(spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd }));
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

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

// Outside git, so the run needs no history and says so once.
describe("graph export chunks, on the command line", () => {
  let dir: string;
  beforeAll(() => {
    const files = fixtureFiles();
    files["docs/retry.md"] = (files["docs/retry.md"] ?? "").replaceAll("COMMIT", "a".repeat(40));
    files["manni.config.yaml"] = (files["manni.config.yaml"] ?? "").replace("      evals: evals.json\n", "      evals: null\n");
    dir = makeTempRepo({ files, init: false });
    expect(graph(["build"], dir).status).toBe(0);
  });
  afterAll(() => {
    removeTempRepo(dir);
  });

  it("writes the artifact and exits 0, with its warnings and its one notice on stderr", () => {
    const r = graph(["export", "chunks"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^Wrote 6 chunks to .*chunks\.json\n$/);
    const lines = r.stderr.trimEnd().split("\n");
    expect(lines).toContain("manni: no docevals report is configured, so records carry no eval verdicts.");
    expect(lines).toContain(
      "manni: no vector sidecar, so chunks carry no vectors and retrieval is lexical only; configure graph.embed to add them.",
    );
    expect(lines.filter((l) => l.startsWith("manni: git cannot read this directory ("))).toHaveLength(1);
  });

  it("refuses --evals with another target, exit 2", () => {
    const r = graph(["export", "jsonld", "--evals", "evals.json"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: --evals applies only to graph export chunks.\n");
  });

  it("refuses a missing report and a non-report, exit 2", () => {
    const missing = graph(["export", "chunks", "--evals", "evals.json"], dir);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("manni: graph.export.chunks.evals names evals.json, which does not exist.\n");
    writeFile(dir, "bad.json", "[]");
    const bad = graph(["export", "chunks", "--evals", "bad.json"], dir);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("manni: bad.json is not a docevals JSON report; write one with manni docevals run -f json.\n");
  });
});
