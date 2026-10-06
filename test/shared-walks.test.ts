import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTargetSet, withSharedWalks } from "../src/meta/core/load-files.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tree(): string {
  dir = mkdtempSync(join(tmpdir(), "manni-walks-"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs/a.md"), "# A\n");
  return dir;
}

const walk = (cwd: string, inputs = ["docs/**/*.md"]) =>
  resolveTargetSet({ inputs, cwd, respectGitignore: false }).then((r) => r.files);

describe("withSharedWalks", () => {
  it("walks a target set once inside the scope", async () => {
    const cwd = tree();
    await withSharedWalks(async () => {
      expect(await walk(cwd)).toEqual(["docs/a.md"]);
      writeFileSync(join(cwd, "docs/b.md"), "# B\n");
      expect(await walk(cwd)).toEqual(["docs/a.md"]);
    });
  });

  it("walks afresh outside the scope, and for a different target set", async () => {
    const cwd = tree();
    await withSharedWalks(async () => {
      await walk(cwd);
      writeFileSync(join(cwd, "docs/b.md"), "# B\n");
      expect(await walk(cwd, ["docs/*.md"])).toEqual(["docs/a.md", "docs/b.md"]);
    });
    expect(await walk(cwd)).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("hands each caller its own copy", async () => {
    const cwd = tree();
    await withSharedWalks(async () => {
      (await walk(cwd)).push("mutated");
      expect(await walk(cwd)).toEqual(["docs/a.md"]);
    });
  });

  it("does not keep a walk that failed", async () => {
    const cwd = tree();
    await withSharedWalks(async () => {
      await expect(walk(cwd, ["docs/missing.md"])).rejects.toThrow();
      writeFileSync(join(cwd, "docs/missing.md"), "# M\n");
      expect(await walk(cwd, ["docs/missing.md"])).toEqual(["docs/missing.md"]);
    });
  });
});
