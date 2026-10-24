/**
 * A task run's temp directory: the seed copy, the docs copy relative to the
 * collection's glob base, and the workspace diff by content.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findConfigFile } from "../../src/shared/config-file.js";
import { copyPathFor, prepareRun, workspaceChanges } from "../../src/test/core/workspace.js";
import { writeTree } from "./task-run.js";

const REPO = join(import.meta.dirname, "fixtures", "tasks", "repo");
const toError = (m: string): Error => new Error(m);

let dir: string;
const roots: string[] = [];

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "manni-test-workspace-")));
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe("prepareRun", () => {
  it("copies the seed, and the collection holding the page relative to its glob base", async () => {
    cpSync(REPO, dir, { recursive: true });
    const file = await findConfigFile(dir, { section: "test", legacyNames: [], toError });
    const page = join(dir, "docs", "fix", "index.md");
    const run = await prepareRun({ kind: "path", display: "docs/fix/index.md", abs: page }, join(dir, "seed"), file);
    roots.push(run.root);
    expect(run.root).toBe(realpathSync.native(run.root));
    expect(relative(run.root, run.startCopy ?? "").split(sep).join("/")).toBe("docs/fix/index.md");
    expect(existsSync(join(run.root, "docs", "reference", "config.md"))).toBe(true);
    // Only the collection's pages: the strategy records stay behind.
    expect(existsSync(join(run.root, "docs", "strategy"))).toBe(false);
    expect(existsSync(join(run.workspaceDir, "docs", "install.md"))).toBe(true);
    expect(existsSync(run.globalDir)).toBe(true);
  });

  it("makes no docs copy for a URL start, and an empty workspace with no seed", async () => {
    const run = await prepareRun({ kind: "url", url: "https://example.com/" }, null, null);
    roots.push(run.root);
    expect(run.docsDir).toBeNull();
    expect(run.startCopy).toBeNull();
    expect(existsSync(join(run.root, "docs"))).toBe(false);
  });
});

// A collection file that resolves outside the copy's base (a symlink, another
// drive) is skipped, so nothing is ever written outside the run's docs copy.
describe("copyPathFor", () => {
  const base = join(tmpdir(), "site", "docs");

  it("places a file under the base at its path below the base", () => {
    expect(copyPathFor(base, join(base, "meta", "fix.md"))).toBe(join("meta", "fix.md"));
  });

  it("skips a file outside the base", () => {
    expect(copyPathFor(base, join(tmpdir(), "site", "secrets.md"))).toBeUndefined();
    expect(copyPathFor(base, join(tmpdir(), "elsewhere", "page.md"))).toBeUndefined();
  });
});

describe("workspaceChanges", () => {
  it("lists added, changed and removed files by content, as sorted POSIX paths", async () => {
    const seed = join(dir, "seed");
    const ws = join(dir, "ws");
    writeTree(seed, { "a.md": "a", "b/c.md": "c", "gone.md": "x", "same.md": "s" });
    writeTree(ws, { "a.md": "A", "b/c.md": "c", "same.md": "s", "z.md": "new", "b/new.md": "n" });
    expect(await workspaceChanges(seed, ws)).toEqual({
      added: ["b/new.md", "z.md"],
      changed: ["a.md"],
      removed: ["gone.md"],
    });
  });

  it("counts everything as added with no seed, and skips node_modules and .git", async () => {
    const ws = join(dir, "ws");
    writeTree(ws, { "a.md": "a", "node_modules/x/index.js": "x", ".git/HEAD": "ref" });
    mkdirSync(join(ws, "empty"));
    writeFileSync(join(ws, "b.md"), "b");
    expect(await workspaceChanges(null, ws)).toEqual({ added: ["a.md", "b.md"], changed: [], removed: [] });
  });
});
