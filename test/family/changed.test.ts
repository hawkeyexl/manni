import { execFileSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFiles, parsePorcelain } from "../../src/family/core/changed.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

describe("parsePorcelain", () => {
  it("keeps modified, added, renamed and untracked paths, and drops deleted ones", () => {
    const out = [" M a.md", "A  b.md", "R  new.md", "old.md", "?? c.md", " D gone.md", "D  gone2.md", ""].join("\0");
    expect(parsePorcelain(out)).toEqual(["a.md", "b.md", "new.md", "c.md"]);
  });

  it("answers nothing for a clean tree", () => {
    expect(parsePorcelain("")).toEqual([]);
  });
});

describe.skipIf(!gitAvailable())("changedFiles", () => {
  let dir: string | undefined;
  afterEach(() => {
    removeTempRepo(dir);
    dir = undefined;
  });

  it("is empty on a clean tree", async () => {
    dir = makeTempRepo({ files: { "a.md": "a\n" } });
    commitAll(dir, "init");
    expect(await changedFiles(dir)).toEqual([]);
  });

  it("names every change against HEAD, absolute, from a subdirectory too", async () => {
    dir = makeTempRepo({ files: { "docs/a.md": "a\n", "docs/b.md": "b\n", "docs/c.md": "c\n" } });
    commitAll(dir, "init");
    writeFileSync(join(dir, "docs/a.md"), "changed\n");
    renameSync(join(dir, "docs/b.md"), join(dir, "docs/renamed.md"));
    execFileSync("git", ["add", "-A"], { cwd: dir });
    rmSync(join(dir, "docs/c.md"));
    writeFileSync(join(dir, "docs/new.md"), "new\n");

    const changed = await changedFiles(join(dir, "docs"));
    expect(changed.sort()).toEqual(
      ["docs/a.md", "docs/new.md", "docs/renamed.md"].map((p) => join(dir ?? "", p)).sort(),
    );
  });
});
