/**
 * A collection page is labelled relative to the config's directory, wherever
 * the run starts. Building the same collection from the repository root and
 * from a subdirectory (through `-c ../manni.config.yaml` and through
 * discovery) must write byte-identical Turtle, git history included.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hermeticEnv } from "../helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");

const CONFIG = `collections:
  - name: pages
    paths:
      - "docs/**/*.md"
graph:
  routes:
    - basePath: /site
      root: docs
`;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: hermeticEnv({
      GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z",
    }),
  });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-labels-"));
  mkdirSync(join(dir, "docs"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "manni.config.yaml"), CONFIG);
  writeFileSync(
    join(dir, "docs", "a.md"),
    "# A\n\nSee [B](b.md) and [B by route](/site/b).\n",
  );
  writeFileSync(join(dir, "docs", "b.md"), "# B\n");
  writeFileSync(join(dir, "sub", "README.md"), "# Sub\n");
  git(dir, "init", "-q");
  git(dir, "config", "user.name", "Test Author");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "add docs");
  return dir;
}

function build(cwd: string, out: string, ...args: string[]): string {
  const r = spawnSync(
    process.execPath,
    [cli, "graph", "build", "-o", out, ...args],
    { cwd, encoding: "utf8", env: hermeticEnv() },
  );
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  return readFileSync(out, "utf8");
}

describe("collection pages are labelled relative to the config", () => {
  it("builds byte-identical Turtle from the root and from a subdirectory", () => {
    const repo = makeRepo();
    const outs = mkdtempSync(join(tmpdir(), "manni-graph-labels-out-"));
    const fromRoot = build(repo, join(outs, "root.ttl"));
    const viaFlag = build(
      join(repo, "sub"),
      join(outs, "flag.ttl"),
      "-c",
      "../manni.config.yaml",
    );
    const viaDiscovery = build(join(repo, "sub"), join(outs, "found.ttl"));

    expect(fromRoot).toContain('"docs/a.md"');
    expect(fromRoot).not.toContain("../");
    // Git provenance reached the pages: the commit's date and author.
    expect(fromRoot).toContain("2026-01-01T10:00:00Z");
    expect(fromRoot).toContain("Test Author");
    expect(viaFlag).toBe(fromRoot);
    expect(viaDiscovery).toBe(fromRoot);
  });

  it("exports the same iiRDS package from the root and from a subdirectory", () => {
    const repo = makeRepo();
    const outs = mkdtempSync(join(tmpdir(), "manni-graph-labels-pkg-"));
    const graphFile = join(outs, "g.ttl");
    build(repo, graphFile);
    const pack = (cwd: string, name: string): Buffer => {
      const out = join(outs, name);
      const r = spawnSync(
        process.execPath,
        [cli, "graph", "export", "iirds", "-g", graphFile, "-o", out],
        { cwd, encoding: "utf8", env: hermeticEnv() },
      );
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      return readFileSync(out);
    };
    const fromRoot = pack(repo, "root.iirds");
    expect(fromRoot.toString("latin1")).toContain("content/docs/a.md");
    expect(pack(join(repo, "sub"), "sub.iirds").equals(fromRoot)).toBe(true);
  });
});
