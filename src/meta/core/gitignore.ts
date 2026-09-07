/**
 * Ask git which paths `.gitignore` covers.
 *
 * Delegated to `git check-ignore` rather than reimplemented. Gitignore is not a
 * flat pattern list: precedence stacks across nested `.gitignore` files,
 * directory-only patterns and leading-`/` anchoring change what a pattern means,
 * `**` differs from glob `**`, and `.git/info/exclude` and `core.excludesFile`
 * contribute rules that are not in the tree at all. The rule that settles it is
 * that a negation cannot re-include a file below an excluded directory — given
 * `tmp/` then `!keep.md`, git still ignores `docs/tmp/keep.md`. No translation
 * into picomatch patterns expresses that, and being subtly wrong here silently
 * changes which files get validated.
 *
 * One subprocess per repository the candidates live in, fed that repository's
 * candidates on stdin — one per run in the ordinary single-checkout case. Measured at
 * 5,000 candidates: 0.111 s with none ignored, 0.260 s with half ignored.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, relative, resolve, sep } from "node:path";
import { findGitRoot } from "../../shared/git-root.js";

export interface GitignoreAnswer {
  /** Ignored paths, spelled exactly as they were handed in. */
  ignored: Set<string>;
  /**
   * Whether git answered at all. False means there is no repository here, no
   * `git` on `PATH`, or git failed — in which case **nothing** is filtered.
   */
  available: boolean;
}

/** Said once, on stderr, when a run explicitly asked for filtering it did not get. */
export const GITIGNORE_UNAVAILABLE =
  ".gitignore filtering was requested but git could not answer here (no repository, or no git on PATH); no files were skipped.";

const unavailable = (): GitignoreAnswer => ({
  ignored: new Set(),
  available: false,
});

/**
 * `paths` are relative to `cwd`, posix-style, spelled however the caller
 * spelled them; the answer uses the same spelling.
 *
 * Candidates may lie in more than one repository (proposal 0034): a config in
 * one checkout whose `paths:` reach into another, or a nested checkout under
 * the run's own root. `git check-ignore` refuses a path outside the repository
 * it runs in with exit 128, and it must not be allowed to refuse for the whole
 * batch — one cross-root candidate then switched filtering off for every file
 * in the run, silently, while the notice blamed a missing repository. So the
 * candidates are grouped by the repository that contains them and git is asked
 * once per root, from that root, with paths relative to it. A candidate inside
 * no repository is kept: there is no `.gitignore` that could cover it.
 *
 * `available` is false only when git failed to answer for a repository that
 * exists, or when no candidate was in any repository at all — the two cases
 * where filtering was asked for and nothing could be filtered.
 */
export async function gitIgnored(
  paths: string[],
  cwd: string,
): Promise<GitignoreAnswer> {
  // Nothing to ask about. Skipping the subprocess also keeps a run over
  // explicitly named files alone from reporting git as unavailable.
  if (paths.length === 0) {
    return { ignored: new Set<string>(), available: true };
  }

  // Group by containing repository. The root walk is one `existsSync` per
  // directory level and memoized per directory, so a 5,000-file corpus in a
  // handful of directories costs a handful of walks.
  const rootOf = new Map<string, string | null>();
  const byRoot = new Map<string, { rel: string; spelled: string }[]>();
  let inSomeRepo = false;
  for (const spelled of paths) {
    const abs = resolve(cwd, spelled);
    const dir = dirname(abs);
    let root = rootOf.get(dir);
    if (root === undefined) {
      root = findGitRoot(dir);
      rootOf.set(dir, root);
    }
    if (root === null) continue;
    inSomeRepo = true;
    const rel = relative(root, abs).split(sep).join("/");
    const bucket = byRoot.get(root);
    if (bucket) bucket.push({ rel, spelled });
    else byRoot.set(root, [{ rel, spelled }]);
  }
  if (!inSomeRepo) return unavailable();

  const ignored = new Set<string>();
  let available = true;
  for (const [root, bucket] of byRoot) {
    const answer = await checkIgnore(
      bucket.map((b) => b.rel),
      root,
    );
    if (!answer.available) {
      available = false;
      continue;
    }
    for (const b of bucket) {
      if (answer.ignored.has(b.rel)) ignored.add(b.spelled);
    }
  }
  return { ignored, available };
}

/** One `git check-ignore` run, from `cwd`, over paths relative to it. */
function checkIgnore(paths: string[], cwd: string): Promise<GitignoreAnswer> {
  return new Promise((settle) => {
    let done = false;
    const finish = (answer: GitignoreAnswer): void => {
      if (done) return;
      done = true;
      settle(answer);
    };

    // Explicitly typed rather than relying on evolving-`let` inference, so
    // the stream handles below are checked rather than merely assumed.
    let child: ChildProcessWithoutNullStreams;
    try {
      // -z: NUL-delimited in *and* out. Newline delimiting would corrupt a
      // filename containing a newline, for no benefit.
      child = spawn("git", ["check-ignore", "--stdin", "-z"], {
        cwd,
        windowsHide: true,
      });
    } catch {
      finish(unavailable());
      return;
    }

    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    // Drain stderr so a chatty git cannot fill the pipe and stall.
    child.stderr.resume();
    // No binary on PATH lands here rather than throwing from spawn().
    child.on("error", () => {
      finish(unavailable());
    });
    // A dead child makes the pipe write fail; that is reported by 'error'/'close'.
    child.stdin.on("error", () => {});

    child.on("close", (code) => {
      // Exit 1 means *nothing matched* — a successful answer meaning "keep
      // everything", not a failure. Treating it as one would make the filter
      // silently no-op on every clean repo, which is the whole common case.
      // Only a real failure (128 outside a repo, or a signal, which is null)
      // means git could not answer.
      if (code !== 0 && code !== 1) {
        finish(unavailable());
        return;
      }
      finish({
        ignored: new Set(out.split("\0").filter((p) => p !== "")),
        available: true,
      });
    });

    child.stdin.end(paths.join("\0"));
  });
}
