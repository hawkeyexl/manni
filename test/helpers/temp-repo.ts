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
  // Retries for Windows, where a git child that has just exited can still
  // hold the directory for a moment and `rm` answers EPERM.
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** A minimal document that parses; the content is never what is under test. */
export const DOC = "---\ntitle: t\n---\n\n# t\n";

/**
 * Whether a `git` binary answers on this machine. Suites that build a real
 * repository pair this with `it.skipIf`, so a box without git skips rather
 * than fails for a reason unrelated to the code under test.
 */
export function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stage everything under `dir` and commit it. Returns the new commit's full
 * sha. Identity, signing, CRLF conversion and hooks are all pinned on the
 * command line so the result does not depend on the machine's global git
 * config: a signing key that prompts, an `autocrlf=true` that rewrites the
 * bytes a hash test depends on, or a global hooks path would each make this
 * helper flaky somewhere.
 */
export function commitAll(dir: string, message: string): string {
  const noHooks = mkdtempSync(join(tmpdir(), "docmeta-nohooks-"));
  const config = [
    "-c", "user.name=t",
    "-c", "user.email=t@example.invalid",
    "-c", "commit.gpgsign=false",
    "-c", "core.autocrlf=false",
    "-c", `core.hooksPath=${noHooks}`,
  ];
  try {
    execFileSync("git", [...config, "add", "-A"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", [...config, "commit", "-q", "-m", message], { cwd: dir, stdio: "ignore" });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  } finally {
    rmSync(noHooks, { recursive: true, force: true });
  }
}

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

/**
 * Merge `branch` into the checked-out branch with a real merge commit, dated
 * `authorDate` for author and committer alike. The merge must apply cleanly.
 * The checked-out branch stays checked out and gains the merge, so its tip
 * is the returned sha and `branch` is the merge's second parent.
 */
export function mergeBranch(dir: string, branch: string, authorDate: string): string {
  const env = { ...process.env, GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: authorDate };
  execFileSync(
    "git",
    [
      "-c", `user.name=${DEFAULT_AUTHOR.name}`,
      "-c", `user.email=${DEFAULT_AUTHOR.email}`,
      "merge", "-q", "--no-ff", "--no-verify", "-m", `merge ${branch}`, branch,
    ],
    { cwd: dir, stdio: "ignore", env },
  );
  return git(dir, ["rev-parse", "HEAD"]);
}

export interface SquashOptions {
  /** The branch whose tip's tree the squash commits. */
  branch: string;
  /** The base branch the squash lands on; checked out and moved to the squash. */
  onto: string;
  /** ISO 8601 with offset: the merge's date, for author and committer alike. */
  authorDate: string;
  /** Who merged. Defaults to someone who wrote none of the branch. */
  author?: { name: string; email: string };
  message?: string;
  /** Appended to the message as its own paragraph, as a host appends co-authors. */
  trailers?: string[];
}

/**
 * Replay a squash merge the way a host performs one (proposal 0069): one
 * commit on `onto` whose tree is the branch tip's, authored by the person
 * who merged, dated at the merge, with the trailers the host appends. Built
 * with `commit-tree`, so nothing of the branch's own commits survives but
 * their tree. The base branch is then checked out at the new commit.
 */
export function replaySquash(dir: string, opts: SquashOptions): string {
  const author = opts.author ?? { name: "Merger", email: "merger@example.com" };
  const tree = git(dir, ["rev-parse", `${opts.branch}^{tree}`]);
  const parent = git(dir, ["rev-parse", opts.onto]);
  const message = opts.message ?? `Squash ${opts.branch}`;
  const body =
    opts.trailers && opts.trailers.length > 0
      ? `${message}\n\n${opts.trailers.join("\n")}\n`
      : message;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_AUTHOR_DATE: opts.authorDate,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
    GIT_COMMITTER_DATE: opts.authorDate,
  };
  const sha = execFileSync("git", ["commit-tree", "--no-gpg-sign", tree, "-p", parent, "-m", body], {
    cwd: dir,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  git(dir, ["checkout", "-q", opts.onto]);
  git(dir, ["reset", "-q", "--hard", sha]);
  return sha;
}
