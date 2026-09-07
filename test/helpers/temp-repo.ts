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
