import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { buildSourceIndex, obfuscatePath, readSource } from "../../src/cite/core/sources.js";
import { parseSrc } from "../../src/cite/core/range.js";
import type { GitClient } from "../../src/cite/types.js";
import { makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const require = createRequire(import.meta.url);
const ladder = require("../../docs/proposals/0044/ladders/drift-examples.cjs") as {
  obfuscate(path: string, salt: string): string;
};

const SALT = "SALT-LADDER";

/** A client that answers with a fixed list; nothing else is reachable. */
function fakeGit(files: string[], available = true): GitClient {
  const unreachable = () => Promise.reject(new Error("not expected here"));
  return {
    available: () => Promise.resolve(available),
    head: () => Promise.resolve(null),
    lsFiles: () => Promise.resolve(files),
    showFile: unreachable,
    subjectsSince: unreachable,
    diffSince: unreachable,
  };
}

/**
 * Whether this process may create a link of the given kind. A file symlink is
 * a privilege on Windows; a directory junction is not, and on POSIX the
 * "junction" type is simply a directory symlink. Probed once, so the cases
 * below skip visibly instead of passing for the wrong reason.
 */
function canLink(kind: "file" | "junction"): boolean {
  const dir = makeTempRepo({ init: false, files: { "target/x": "x\n" } });
  try {
    const target = kind === "file" ? join(dir, "target", "x") : join(dir, "target");
    symlinkSync(target, join(dir, "probe"), kind);
    return true;
  } catch {
    return false;
  } finally {
    removeTempRepo(dir);
  }
}
const FILE_SYMLINKS = canLink("file");
const DIR_LINKS = canLink("junction");

describe("obfuscatePath", () => {
  it("is ~ and the first sixteen hex of sha256(salt + LF + path)", () => {
    const token = obfuscatePath("src/limits.ts", SALT);
    expect(token).toMatch(/^~[0-9a-f]{16}$/);
    expect(token).toBe(ladder.obfuscate("src/limits.ts", SALT));
    expect(obfuscatePath("src/limits.ts", "")).toBe(ladder.obfuscate("src/limits.ts", ""));
    expect(obfuscatePath("docs/release notes/v1.2.md", "s")).toBe(ladder.obfuscate("docs/release notes/v1.2.md", "s"));
  });

  it("depends on the salt and on the path", () => {
    expect(obfuscatePath("src/limits.ts", "other")).not.toBe(obfuscatePath("src/limits.ts", SALT));
    expect(obfuscatePath("src/other.ts", SALT)).not.toBe(obfuscatePath("src/limits.ts", SALT));
  });
});

describe("buildSourceIndex", () => {
  let repo: string | undefined;
  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  describe("walk regime (no git)", () => {
    it("lists every regular file under the root as a posix relative path, dotfiles included", async () => {
      repo = makeTempRepo({
        init: false,
        files: {
          "src/limits.ts": "x\n",
          "docs/release notes/v1.2.md": "y\n",
          ".hidden/rc": "z\n",
          "top.txt": "t\n",
        },
      });
      const index = await buildSourceIndex(repo, SALT);
      expect([...index.files()].sort()).toEqual([
        ".hidden/rc",
        "docs/release notes/v1.2.md",
        "src/limits.ts",
        "top.txt",
      ]);
      expect(index.has("src/limits.ts")).toBe(true);
      expect(index.has("docs/release notes/v1.2.md")).toBe(true);
    });

    it("ignores .git and node_modules", async () => {
      repo = makeTempRepo({
        init: false,
        files: {
          "a.txt": "a\n",
          ".git/HEAD": "ref\n",
          ".git/objects/ab/cd": "o\n",
          "node_modules/pkg/index.js": "j\n",
          "sub/node_modules/pkg/index.js": "j\n",
        },
      });
      const index = await buildSourceIndex(repo, SALT);
      expect([...index.files()]).toEqual(["a.txt"]);
    });

    it("is what a real git init with no client falls back to", async () => {
      repo = makeTempRepo({ files: { "a.txt": "a\n" } });
      const index = await buildSourceIndex(repo, SALT);
      expect([...index.files()]).toEqual(["a.txt"]);
    });

    it("walks when the client reports git unavailable, or when git is off", async () => {
      repo = makeTempRepo({ init: false, files: { "a.txt": "a\n", "b.txt": "b\n" } });
      const off = await buildSourceIndex(repo, SALT, { git: false, gitClient: fakeGit(["a.txt"]) });
      expect([...off.files()].sort()).toEqual(["a.txt", "b.txt"]);
      const unavailable = await buildSourceIndex(repo, SALT, { gitClient: fakeGit(["a.txt"], false) });
      expect([...unavailable.files()].sort()).toEqual(["a.txt", "b.txt"]);
    });

    it.skipIf(!FILE_SYMLINKS)("drops a file symlink, even one that points outside the root", async () => {
      repo = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
      const outside = makeTempRepo({ init: false, files: { "secret.txt": "s\n" } });
      try {
        symlinkSync(join(outside, "secret.txt"), join(repo, "leak.txt"));
        symlinkSync(join(repo, "a.txt"), join(repo, "self.txt"));
        const index = await buildSourceIndex(repo, SALT);
        expect([...index.files()]).toEqual(["a.txt"]);
      } finally {
        removeTempRepo(outside);
      }
    });

    it.skipIf(!DIR_LINKS)("does not descend into a directory link that leaves the root", async () => {
      repo = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
      const outside = makeTempRepo({ init: false, files: { "secret.txt": "s\n" } });
      try {
        symlinkSync(outside, join(repo, "outdir"), "junction");
        const index = await buildSourceIndex(repo, SALT);
        expect([...index.files()]).toEqual(["a.txt"]);
        expect(index.has("outdir/secret.txt")).toBe(false);
      } finally {
        removeTempRepo(outside);
      }
    });
  });

  describe("git regime", () => {
    it("takes the tracked list from the client", async () => {
      repo = makeTempRepo({
        init: false,
        files: { "a.txt": "a\n", "untracked.txt": "u\n", "sub/b.txt": "b\n" },
      });
      const index = await buildSourceIndex(repo, SALT, { gitClient: fakeGit(["a.txt", "sub/b.txt"]) });
      expect([...index.files()].sort()).toEqual(["a.txt", "sub/b.txt"]);
      expect(index.has("untracked.txt")).toBe(false);
    });

    it("drops a tracked path that is absent from the working tree", async () => {
      repo = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
      const index = await buildSourceIndex(repo, SALT, { gitClient: fakeGit(["a.txt", "gone.txt"]) });
      expect([...index.files()]).toEqual(["a.txt"]);
    });

    it("drops a tracked path that resolves outside the root", async () => {
      repo = makeTempRepo({ init: false, files: { "inner/a.txt": "a\n", "outer.txt": "o\n" } });
      const root = join(repo, "inner");
      const index = await buildSourceIndex(root, SALT, { gitClient: fakeGit(["a.txt", "../outer.txt"]) });
      expect([...index.files()]).toEqual(["a.txt"]);
    });

    it.skipIf(!FILE_SYMLINKS)("drops a tracked symlink", async () => {
      repo = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
      symlinkSync(join(repo, "a.txt"), join(repo, "link.txt"));
      const index = await buildSourceIndex(repo, SALT, { gitClient: fakeGit(["a.txt", "link.txt"]) });
      expect([...index.files()]).toEqual(["a.txt"]);
    });

    it.skipIf(!DIR_LINKS)("drops a tracked path that reaches outside through a directory link", async () => {
      // The file itself is regular, so `lstat` admits it; only the realpath
      // check sees that it lives outside the root.
      repo = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
      const outside = makeTempRepo({ init: false, files: { "secret.txt": "s\n" } });
      try {
        symlinkSync(outside, join(repo, "outdir"), "junction");
        const index = await buildSourceIndex(repo, SALT, {
          gitClient: fakeGit(["a.txt", "outdir/secret.txt"]),
        });
        expect([...index.files()]).toEqual(["a.txt"]);
      } finally {
        removeTempRepo(outside);
      }
    });
  });

  describe("resolve / has", () => {
    it("resolves a token minted from a listed path, and nothing else", async () => {
      repo = makeTempRepo({ init: false, files: { "src/limits.ts": "x\n", "src/a.txt": "a\n" } });
      const index = await buildSourceIndex(repo, SALT);
      expect(index.resolve(obfuscatePath("src/limits.ts", SALT))).toBe("src/limits.ts");
      expect(index.resolve(obfuscatePath("src/a.txt", SALT))).toBe("src/a.txt");
      expect(index.resolve(obfuscatePath("src/limits.ts", "other"))).toBeUndefined();
      expect(index.resolve(obfuscatePath("src/missing.ts", SALT))).toBeUndefined();
    });

    it("matches paths exactly, as posix relative spellings", async () => {
      repo = makeTempRepo({ init: false, files: { "src/limits.ts": "x\n" } });
      const index = await buildSourceIndex(repo, SALT);
      expect(index.has("src/limits.ts")).toBe(true);
      expect(index.has("./src/limits.ts")).toBe(false);
      expect(index.has("src\\limits.ts")).toBe(false);
      expect(index.has("SRC/limits.ts")).toBe(false);
      expect(index.has("limits.ts")).toBe(false);
    });

    it("returns a read-only file list", async () => {
      repo = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
      const index = await buildSourceIndex(repo, SALT);
      expect(Object.isFrozen(index.files())).toBe(true);
    });
  });
});

describe("readSource", () => {
  let repo: string | undefined;
  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  it("reads a listed path", async () => {
    repo = makeTempRepo({ init: false, files: { "src/limits.ts": "x\ny\n" } });
    const index = await buildSourceIndex(repo, SALT);
    await expect(readSource(repo, index, parseSrc("src/limits.ts:2"))).resolves.toEqual({
      kind: "ok",
      resolvedPath: "src/limits.ts",
      text: "x\ny\n",
    });
  });

  it("resolves a token through the index", async () => {
    repo = makeTempRepo({ init: false, files: { "src/limits.ts": "x\n" } });
    const index = await buildSourceIndex(repo, SALT);
    const token = obfuscatePath("src/limits.ts", SALT);
    await expect(readSource(repo, index, parseSrc(`${token}:1`))).resolves.toEqual({
      kind: "ok",
      resolvedPath: "src/limits.ts",
      text: "x\n",
    });
  });

  it("refuses a path the index lacks, even when the file exists", async () => {
    repo = makeTempRepo({ init: false, files: { "a.txt": "a\n", "untracked.txt": "u\n" } });
    const index = await buildSourceIndex(repo, SALT, { gitClient: fakeGit(["a.txt"]) });
    await expect(readSource(repo, index, parseSrc("untracked.txt"))).resolves.toEqual({
      kind: "missing",
      reason: "untracked",
    });
  });

  it("refuses a token that resolves to nothing", async () => {
    repo = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
    const index = await buildSourceIndex(repo, SALT);
    await expect(readSource(repo, index, parseSrc(obfuscatePath("a.txt", "wrong")))).resolves.toEqual({
      kind: "missing",
      reason: "unresolved-token",
    });
  });

  it("reports a listed file it cannot read", async () => {
    repo = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
    const index = await buildSourceIndex(repo, SALT);
    rmSync(join(repo, "a.txt"));
    mkdirSync(join(repo, "a.txt"));
    await expect(readSource(repo, index, parseSrc("a.txt"))).resolves.toEqual({
      kind: "missing",
      reason: "unreadable",
    });
  });
});
