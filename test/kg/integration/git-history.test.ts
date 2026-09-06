import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectGitHistory } from "../../../src/kg/core/git.js";
import { hermeticEnv } from "../helpers/git-env.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", env: hermeticEnv() });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dockg-githist-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.name", "Test Author");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "commit.gpgsign", "false");
  const env = {
    GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z",
  };
  writeFileSync(join(dir, "old-name.md"), "# Guide\n");
  execFileSync("git", ["add", "-A"], {
    cwd: dir,
    env: hermeticEnv(env),
  });
  execFileSync("git", ["commit", "-q", "-m", "add guide"], {
    cwd: dir,
    env: hermeticEnv(env),
  });
  const env2 = {
    GIT_AUTHOR_DATE: "2026-02-01T10:00:00Z",
    GIT_COMMITTER_DATE: "2026-02-01T10:00:00Z",
  };
  renameSync(join(dir, "old-name.md"), join(dir, "new-name.md"));
  execFileSync("git", ["add", "-A"], {
    cwd: dir,
    env: hermeticEnv(env2),
  });
  execFileSync("git", ["commit", "-q", "-m", "rename guide"], {
    cwd: dir,
    env: hermeticEnv(env2),
  });
  return dir;
}

describe("collectGitHistory (real repo)", () => {
  it("reads dates, authors, and rename chains from an actual git history", async () => {
    const dir = makeRepo();
    const history = await collectGitHistory(dir);

    expect(history.headTime).toContain("2026-02-01");
    const file = history.files.get("new-name.md")!;
    expect(file).toBeDefined();
    expect(file.created).toContain("2026-01-01");
    expect(file.modified).toContain("2026-02-01");
    expect(file.authors).toEqual(["Test Author"]);
    expect(file.renamedFrom).toEqual(["old-name.md"]);
  });

  it("keys paths relative to the collection cwd (monorepo subdirectory builds)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-gitsub-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.name", "Test Author");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "commit.gpgsign", "false");
    const env = {
      GIT_AUTHOR_DATE: "2026-01-01T10:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T10:00:00Z",
    };
    mkdirSync(join(dir, "site"));
    writeFileSync(join(dir, "site", "guide.md"), "# G\n");
    writeFileSync(join(dir, "root.md"), "# R\n");
    execFileSync("git", ["add", "-A"], {
      cwd: dir,
      env: hermeticEnv(env),
    });
    execFileSync("git", ["commit", "-q", "-m", "add"], {
      cwd: dir,
      env: hermeticEnv(env),
    });

    // Collect FROM the subdirectory — the corpus path there is "guide.md".
    const history = await collectGitHistory(join(dir, "site"));
    expect(history.files.has("guide.md")).toBe(true);
    expect(history.files.has("site/guide.md")).toBe(false);
    // out-of-scope files don't leak in
    expect(history.files.has("root.md")).toBe(false);
  });

  it("is deterministic: two collections are deep-equal", async () => {
    const dir = makeRepo();
    const a = await collectGitHistory(dir);
    const b = await collectGitHistory(dir);
    expect(Object.fromEntries(a.files)).toEqual(Object.fromEntries(b.files));
    expect(a.headTime).toBe(b.headTime);
  });
});
