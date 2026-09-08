/**
 * Build a throwaway git repository in a temp directory.
 *
 * `.gitignore`-aware discovery cannot be tested from `test/fixtures/`: a file
 * this repo's own `.gitignore` covers would never be committed, so the fixture
 * directory would arrive on CI *empty*. The test would then find nothing to
 * ignore, assert nothing was ignored, and pass for the wrong reason — a green
 * test proving nothing.
 *
 * So the repo is built at runtime instead, and `init: false` is the control:
 * the same tree with no `git init` must keep every file. That pairing is what
 * proves the *filter* excludes a file, rather than the fixture layout, and it
 * is also what catches a machine where `git` is absent and the filter silently
 * no-ops.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface TempRepoOptions {
  /** Relative posix path -> file contents. Parent directories are created. */
  files: Record<string, string>;
  /** Run `git init`. Set false for the control case: a tree with no repo. */
  init?: boolean;
}

/** Returns the absolute, symlink-resolved path of the new directory. */
export function makeTempRepo(opts: TempRepoOptions): string {
  // realpath, because macOS hands out /var/... for /private/var/... and
  // Windows can hand out an 8.3 short path; git reports the resolved form, and
  // a mismatch would look like "nothing was ignored".
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "docmeta-gitignore-")));
  for (const [rel, content] of Object.entries(opts.files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  if (opts.init !== false) {
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  }
  return dir;
}

/** Safe to call with `undefined`, so `afterEach` needs no guard of its own. */
export function removeTempRepo(dir: string | undefined): void {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

/** A minimal document that parses; the content is never what is under test. */
export const DOC = "---\ntitle: t\n---\n\n# t\n";

/** Run one git command in `dir` and return its trimmed stdout. */
export function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** Write (or overwrite) one file under `dir`, creating parent directories. */
export function writeFile(dir: string, rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

export interface CommitOptions {
  /** ISO 8601 with offset, e.g. `2020-01-02T03:04:05+02:00`. */
  authorDate?: string;
  author?: { name: string; email: string };
  /** Appended to the message as its own paragraph, one per line. */
  trailers?: string[];
}

const DEFAULT_AUTHOR = { name: "Ada", email: "ada@example.com" };

/**
 * Stage everything and commit it, returning the full sha. Identity and dates
 * are pinned per call so a test never inherits the machine's git config or
 * its clock. `--allow-empty` so a commit that changes nothing (a control
 * case) is still a commit.
 */
export function commit(dir: string, message: string, opts: CommitOptions = {}): string {
  const author = opts.author ?? DEFAULT_AUTHOR;
  const identity = [
    "-c",
    `user.name=${author.name}`,
    "-c",
    `user.email=${author.email}`,
  ];
  const env = { ...process.env };
  if (opts.authorDate !== undefined) {
    env.GIT_AUTHOR_DATE = opts.authorDate;
    env.GIT_COMMITTER_DATE = opts.authorDate;
  }
  const body =
    opts.trailers && opts.trailers.length > 0
      ? `${message}\n\n${opts.trailers.join("\n")}\n`
      : message;
  execFileSync("git", [...identity, "add", "-A"], { cwd: dir, stdio: "ignore", env });
  execFileSync(
    "git",
    [...identity, "commit", "-q", "--allow-empty", "--no-verify", "-m", body],
    { cwd: dir, stdio: "ignore", env },
  );
  return git(dir, ["rev-parse", "HEAD"]);
}
