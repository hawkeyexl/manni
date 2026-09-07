/**
 * A thin git client. Every call is `execFile("git", args, { cwd: root,
 * windowsHide: true, maxBuffer: 32 MiB })` with `-c core.quotepath=false`,
 * `--end-of-options` before a commit, `--` before a path, and `<commit>:./<path>`
 * for `show` so the path resolves against the root, not the repository top.
 * Results are memoized per (call, commit, path). The commit is validated
 * against the schema's hex pattern by the caller before it reaches here.
 */
import type { GitClient } from "../types.js";
import { notImplemented } from "./not-implemented.js";

export function gitClient(root: string): GitClient {
  return notImplemented("gitClient", root);
}

/** A client that answers "no git": `available()` false, everything else empty. */
export function noGit(): GitClient {
  return notImplemented("noGit");
}
