/**
 * The family document surface through the real CLI (proposal 0051 §1 and §6):
 * `build` and `fill` take `[paths...]`, `--collection`, `--exclude`, `-c` and
 * `--no-config`; every refusal is exit 2; and git is detected rather than
 * switched, so a corpus that is not a repository builds with one warning.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { hermeticEnv } from "../helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const collections = join(root, "test", "kg", "fixtures", "collections");

function kg(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, "kg", ...args], {
    encoding: "utf8",
    cwd,
    env: hermeticEnv(),
  });
}

describe("manni kg build: the document surface", () => {
  it("selects a subset with --collection", () => {
    const out = join(mkdtempSync(join(tmpdir(), "manni-kg-coll-")), "g.ttl");
    const r = kg(["build", "--collection", "guides", "-o", out], collections);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/2 docs/);
  });

  it("repeats --exclude, one glob per occurrence", () => {
    const out = join(mkdtempSync(join(tmpdir(), "manni-kg-excl-")), "g.ttl");
    const r = kg(
      ["build", "--exclude", "**/draft.md", "--exclude", "**/post.md", "-o", out],
      collections,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/1 docs/);
  });

  it("takes positional paths under --no-config", () => {
    const out = join(mkdtempSync(join(tmpdir(), "manni-kg-paths-")), "g.ttl");
    const r = kg(["build", "guides", "--no-config", "-o", out], collections);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/2 docs/);
  });

  it("refuses --collection beside paths, exit 2", () => {
    const r = kg(["build", "guides", "--collection", "guides"], collections);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: --collection selects a configured collection; it cannot be combined with paths.\n",
    );
  });

  it("refuses --collection with no config, exit 2", () => {
    const r = kg(["build", "--collection", "guides", "--no-config"], collections);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: --collection needs a config file to select from.\n",
    );
  });

  it("refuses an undeclared collection, listing the configured ones", () => {
    const r = kg(["build", "--collection", "nope"], collections);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(
      /^manni: no collection named "nope" in .*manni\.config\.yaml\. Configured: guides, blog\.\n$/,
    );
  });

  it("refuses a run with no paths and no collections, exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-none-"));
    const r = kg(["build"], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: No files to build. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.\n",
    );
    const f = kg(["fill"], dir);
    expect(f.status).toBe(2);
    expect(f.stderr).toBe(
      "manni: No files to fill. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.\n",
    );
  });

  it("refuses stdin, exit 2", () => {
    const r = kg(["build", "-"], collections);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "manni: kg build reads files, not stdin: a graph node needs a path.\n",
    );
    const f = kg(["fill", "-"], collections);
    expect(f.status).toBe(2);
    expect(f.stderr).toBe(
      "manni: kg fill reads files, not stdin: a graph node needs a path.\n",
    );
  });

  it("refuses kg.inputs and kg.exclude by name, exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-moved-"));
    writeFileSync(join(dir, "a.md"), "# A\n");
    for (const key of ["inputs", "exclude"] as const) {
      writeFileSync(
        join(dir, "manni.config.yaml"),
        `kg:\n  ${key}: ["*.md"]\n`,
      );
      const r = kg(["build", "a.md"], dir);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(
        `"${key}" is no longer a kg key. Document sets are declared once for every tool, under a top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections`,
      );
    }
  });
});

describe("manni kg build: git is detected, not switched", () => {
  it("says so once and builds the rest when the corpus is not a repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-nogit-"));
    writeFileSync(join(dir, "a.md"), "# A\n");
    const out = join(dir, "g.ttl");
    const r = kg(["build", "a.md", "-o", out], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Wrote");
    // The consequence first, then git's own reason for it, which names a temp
    // directory and so is matched by shape.
    expect(r.stderr).toMatch(
      /^manni: the graph has no revision history or commit agents: .+\n$/,
    );
  });
});
