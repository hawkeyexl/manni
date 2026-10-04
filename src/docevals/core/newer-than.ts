/**
 * `--newer-than <duration>`: which pages changed inside a window of time back
 * from now.
 *
 * A page's age is **detected, not switched**. A page git tracks, with no
 * uncommitted change in the page or in any manifest that supplied its evals,
 * takes the committer date of the last commit touching any of those files.
 * Every other page (untracked, modified, or outside a repository) takes the
 * newest mtime among them.
 *
 * The committed case is the reason this is not simply mtime. A fresh clone,
 * which is what CI runs on, stamps every file with the clone's time, so mtime
 * alone would read as "every page just changed". The modified case is the
 * reason it is not simply the commit date: an edit not yet committed is the
 * newest change there is, and the commit date predates it.
 *
 * Every git call goes through the injected `ExecFn`, so the suite never runs
 * git. A machine without git, or a directory outside a repository, is not an
 * error: every page is then "any other page" and takes its mtime.
 */
import { statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DocevalsError } from "../types.js";
import type { ExecFn, ExecResult } from "../graders/types.js";
import { changedKey } from "./since.js";

/** git can be slow on a cold index, but not this slow. */
const GIT_TIMEOUT_MS = 30_000;

/** The files that decide one page's age: the page, then its eval manifests. */
export interface PageAgeInput {
  /** Absolute path of the page file. */
  page: string;
  /** Absolute paths (or URLs) of the manifests that supplied its eval keys. */
  manifests: readonly string[];
}

/** What git says about the working tree, or `null` outside a repository. */
interface RepoState {
  topLevel: string;
  /** `changedKey`s of every file git tracks. */
  tracked: Set<string>;
  /** `changedKey`s of tracked files that differ from HEAD. */
  modified: Set<string>;
}

async function git(
  exec: ExecFn,
  args: string[],
  cwd: string,
): Promise<ExecResult> {
  const result = await exec(args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
  if (result.timedOut) {
    throw new DocevalsError(
      `--newer-than timed out: \`${args.join(" ")}\` took longer than ` +
        `${String(GIT_TIMEOUT_MS / 1000)}s in ${cwd}.`,
    );
  }
  return result;
}

/** NUL-terminated repo-relative paths to `changedKey`s. */
function keysOf(stdout: string, topLevel: string): Set<string> {
  const keys = new Set<string>();
  for (const rel of stdout.split("\0")) {
    if (rel !== "") keys.add(changedKey(resolve(topLevel, rel)));
  }
  return keys;
}

async function repoState(root: string, exec: ExecFn): Promise<RepoState | null> {
  const top = await git(exec, ["git", "rev-parse", "--show-toplevel"], root);
  // No git on PATH, or not a repository: every page takes its mtime.
  if (top.spawnError !== undefined || top.code !== 0) return null;
  const topLevel = top.stdout.trim();
  if (topLevel === "") return null;

  // `--full-name` so the paths are relative to the top level whatever the
  // working directory, and `-z` so `core.quotePath` cannot C-escape them.
  const tracked = await git(exec, ["git", "ls-files", "-z", "--full-name"], topLevel);
  if (tracked.code !== 0) return null;

  // Staged and unstaged edits alike. A repository with no commit has no HEAD,
  // and then every tracked file is uncommitted: the mtime rule applies.
  const diff = await git(
    exec,
    ["git", "--no-pager", "diff", "--name-only", "-z", "HEAD"],
    topLevel,
  );
  const trackedKeys = keysOf(tracked.stdout, topLevel);
  return {
    topLevel,
    tracked: trackedKeys,
    modified: diff.code === 0 ? keysOf(diff.stdout, topLevel) : trackedKeys,
  };
}

/** The newest mtime among `files`, skipping any that cannot be read (a URL). */
function newestMtime(files: readonly string[]): number {
  let newest = Number.NEGATIVE_INFINITY;
  for (const file of files) {
    try {
      newest = Math.max(newest, statSync(file).mtimeMs);
    } catch {
      // A URL manifest, or a file removed mid-run, has no mtime to offer.
    }
  }
  return newest;
}

/** Epoch milliseconds of the last commit touching any of `files`, if one did. */
async function lastCommit(
  files: readonly string[],
  repo: RepoState,
  exec: ExecFn,
): Promise<number | undefined> {
  const paths = files.map((f) => relative(repo.topLevel, f).replace(/\\/g, "/"));
  const log = await git(
    exec,
    ["git", "--no-pager", "log", "-1", "--format=%ct", "--", ...paths],
    repo.topLevel,
  );
  const seconds = Number.parseInt(log.stdout.trim(), 10);
  return log.code === 0 && Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/**
 * The epoch milliseconds each page last changed, in input order, by the rule
 * in this module's header.
 */
export async function pageAges(
  pages: readonly PageAgeInput[],
  root: string,
  exec: ExecFn,
): Promise<number[]> {
  const repo = await repoState(root, exec);
  const ages: number[] = [];
  for (const { page, manifests } of pages) {
    const files = [page, ...manifests];
    const committed =
      repo !== null &&
      files.every((f) => {
        const key = changedKey(f);
        return repo.tracked.has(key) && !repo.modified.has(key);
      });
    const fromGit = committed ? await lastCommit(files, repo, exec) : undefined;
    ages.push(fromGit ?? newestMtime(files));
  }
  return ages;
}
