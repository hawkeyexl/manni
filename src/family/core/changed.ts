/**
 * The files a session changed: the git working tree against `HEAD`.
 *
 * Modified, added, renamed (by the new name) and untracked files, staged or
 * not. A deleted file is not among them, since there is nothing left to
 * check. Paths come back absolute, resolved from `cwd`: porcelain status names
 * them from the repository root whatever directory git ran in.
 */
import { execFile } from "node:child_process";
import { posix, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  // shell:false: nothing here is ever parsed as shell syntax.
  const { stdout } = await run("git", args, {
    cwd,
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** Parse `git status --porcelain=v1 -z` into repository-relative paths. */
export function parsePorcelain(output: string): string[] {
  const fields = output.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i] ?? "";
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename or copy is followed by its old name, which is not a change to check.
    if (xy.includes("R") || xy.includes("C")) i++;
    if (xy.includes("D")) continue;
    paths.push(path);
  }
  return paths;
}

export interface ChangedTree {
  /** The changed files left to check, absolute. */
  files: string[];
  /**
   * Whether the tree differs from `HEAD` at all. A deletion alone leaves no
   * file to check, but it can still break a citation to what it removed.
   */
  dirty: boolean;
}

export async function changedFiles(cwd: string): Promise<ChangedTree> {
  // Rebased through `cwd`'s own prefix rather than resolved from the
  // top-level git prints: on Windows that is the long spelling of a path the
  // caller may hold in its 8.3 short form, and the two would never compare.
  const prefix = (await git(["rev-parse", "--show-prefix"], cwd)).trim();
  const status = await git(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    cwd,
  );
  return {
    files: parsePorcelain(status).map((path) => resolve(cwd, posix.relative(prefix, path))),
    dirty: status.length > 0,
  };
}
