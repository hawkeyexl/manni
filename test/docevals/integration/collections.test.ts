/**
 * `manni docevals` reading its document set from `collections:` (proposal
 * 0041), against the built `dist/cli.js`: the bare run over the configured
 * collections, a typed path, and every usage error with its stderr line and
 * exit code.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const COLLECTIONS = join(ROOT, "test", "docevals", "fixtures", "collections");
const FILES_KEY = join(ROOT, "test", "docevals", "fixtures", "files-key");

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function manni(args: string[], cwd: string): Run {
  const r = spawnSync("node", [MANNI, "docevals", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

/** The pages a `-f json` run graded, in report order, deduplicated. */
function gradedFiles(run: Run): string[] {
  const report = JSON.parse(run.stdout) as { evalResults: { file: string }[] };
  return [...new Set(report.evalResults.map((r) => r.file))].sort();
}

describe("manni docevals and collections", () => {
  it("evaluates every configured collection when given no paths", () => {
    const run = manni(["run", "--deterministic-only", "-f", "json"], COLLECTIONS);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(gradedFiles(run)).toEqual(["blog/post.md", "docs/guide.md"]);
  });

  it("evaluates a typed path relative to cwd, in no collection", () => {
    const run = manni(["run", "outside/other.md", "--deterministic-only", "-f", "json"], COLLECTIONS);
    expect(run.status).toBe(0);
    expect(gradedFiles(run)).toEqual(["outside/other.md"]);
  });

  it("refuses --collection beside a path", () => {
    const run = manni(["run", "--collection", "guides", "docs/guide.md"], COLLECTIONS);
    expect(run.status).toBe(2);
    expect(run.stderr).toBe(
      "manni: --collection selects a configured collection; it cannot be combined with paths.\n",
    );
  });

  it("refuses a collection the config does not declare", () => {
    const run = manni(["run", "--collection", "nope", "--deterministic-only"], COLLECTIONS);
    expect(run.status).toBe(2);
    expect(run.stderr).toBe(
      'manni: no collection named "nope" in manni.config.yaml. Configured: guides, blog.\n',
    );
  });

  it("refuses a run with no paths and no collections", () => {
    const empty = mkdtempSync(join(tmpdir(), "manni-docevals-empty-"));
    const run = manni(["run", "--deterministic-only"], empty);
    expect(run.status).toBe(2);
    expect(run.stderr).toBe(
      "manni: No files to evaluate. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.\n",
    );
  });

  it("refuses a config that still declares docevals.files", () => {
    const run = manni(["list"], FILES_KEY);
    expect(run.status).toBe(2);
    expect(run.stderr).toBe(
      'manni: manni.config.yaml: "files" is no longer a docevals key. Document sets are declared once for every tool, under a top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections\n',
    );
  });
});
