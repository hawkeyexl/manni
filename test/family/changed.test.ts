import { execFileSync } from "node:child_process";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFiles, parsePorcelain } from "../../src/family/core/changed.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

describe("parsePorcelain", () => {
  it("keeps modified, added, renamed and untracked paths, and names the deleted ones apart", () => {
    const out = [" M a.md", "A  b.md", "R  new.md", "old.md", "?? c.md", " D gone.md", "D  gone2.md", ""].join("\0");
    expect(parsePorcelain(out)).toEqual({
      files: ["a.md", "b.md", "new.md", "c.md"],
      removed: ["old.md", "gone.md", "gone2.md"],
    });
  });

  it("keeps a copy's source, which is still there", () => {
    expect(parsePorcelain(["C  copy.md", "orig.md", ""].join("\0"))).toEqual({ files: ["copy.md"], removed: [] });
  });

  it("answers nothing for a clean tree", () => {
    expect(parsePorcelain("")).toEqual({ files: [], removed: [] });
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
    expect(await changedFiles(dir)).toEqual({ files: [], removed: [], dirty: false });
  });

  it("counts a deletion alone as a change, with no file left to check", async () => {
    dir = makeTempRepo({ files: { "a.md": "a\n", "b.md": "b\n" } });
    commitAll(dir, "init");
    rmSync(join(dir, "b.md"));
    expect(await changedFiles(dir)).toEqual({ files: [], removed: [join(dir, "b.md")], dirty: true });
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
    expect(changed.dirty).toBe(true);
    expect(changed.files.sort()).toEqual(
      ["docs/a.md", "docs/new.md", "docs/renamed.md"].map((p) => join(dir ?? "", p)).sort(),
    );
    expect(changed.removed.sort()).toEqual(["docs/b.md", "docs/c.md"].map((p) => join(dir ?? "", p)).sort());
  });
});
