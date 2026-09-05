/**
 * The project boundary: the nearest directory at or above `cwd` holding a
 * `.git` entry. A file or a directory, since a worktree's `.git` is a file.
 *
 * Two callers need it for opposite reasons and only one of them wants a
 * chain. Config discovery walks the chain and stops here. The SARIF reporter
 * needs the root itself, and needs "there is no repository" to be
 * distinguishable from "the repository root is where you are standing" — a
 * one-element chain conflates the two, and getting that wrong means emitting
 * paths GitHub silently drops.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findGitRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The directories a discovery walk may look in, nearest first.
 *
 * The walk stops at the project boundary `findGitRoot` reports, which is
 * included in the search. Only that one call touches the filesystem; the chain
 * itself is then assembled from path strings.
 *
 * With **no** boundary anywhere above cwd, only cwd is considered. A
 * project-scoped config has no meaning without a project, and walking on would
 * let a stray config file in a home or temp directory silently govern
 * unrelated runs — including this repo's own tests, which work in OS temp
 * directories under the user's home.
 */
export function searchPath(cwd: string): string[] {
  const start = resolve(cwd);
  const root = findGitRoot(start);
  if (root === null) return [start];
  const chain: string[] = [];
  let dir = start;
  for (;;) {
    chain.push(dir);
    if (dir === root) return chain;
    const parent = dirname(dir);
    // `root` is an ancestor of `start` by construction, so this is unreachable
    // — but a filesystem race (the boundary removed mid-walk) must not loop.
    if (parent === dir) return chain;
    dir = parent;
  }
}
