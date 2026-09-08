/**
 * A thin git client. Every call is `execFile("git", args, { cwd: root,
 * windowsHide: true, maxBuffer: 32 MiB })` with `-c core.quotepath=false`,
 * `--end-of-options` before a commit, `--` before a path, and `<commit>:./<path>`
 * for `show` so the path resolves against the root, not the repository top.
 * Results are memoized per (call, commit, path). The commit is validated
 * against the schema's hex pattern by the caller before it reaches here.
 */
import { execFile } from "node:child_process";
import { CiteError } from "../errors.js";
import type { GitClient, ShownFile } from "../types.js";

const MAX_BUFFER = 32 * 1024 * 1024;

/** Stderr shapes `git show` uses for a revision it does not have. */
const NO_COMMIT = /invalid object name|bad revision|unknown revision|bad object/i;
/**
 * Stderr shapes for a path absent from the tree at a revision. Git uses these
 * for an unknown *full-length* commit too (`path 'x' does not exist in
 * '<40 hex>'`; only an abbreviated unknown commit says "invalid object name"),
 * so a path-shaped failure is trusted only once `rev-parse --verify` has said
 * the commit exists. A shallow clone must degrade to "history unavailable",
 * never to "never true".
 */
const NO_PATH = /does not exist in|exists on disk, but not in|path .* does not exist/i;

type Outcome =
  | { ok: true; stdout: string }
  /** `code` is git's exit status; absent when git could not be run at all. */
  | { ok: false; stderr: string; message: string; code?: number };

function run(root: string, args: readonly string[]): Promise<Outcome> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-c", "core.quotepath=false", ...args],
      { cwd: root, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const failure: Outcome = { ok: false, stderr, message: error.message };
          if (typeof error.code === "number") failure.code = error.code;
          resolve(failure);
        } else resolve({ ok: true, stdout });
      },
    );
  });
}

/** `git` at `root`, as a client; see the module comment for the call shapes. */
export function gitClient(root: string): GitClient {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, compute: () => Promise<T>): Promise<T> => {
    const held = memo.get(key);
    if (held !== undefined) return held as Promise<T>;
    const made = compute();
    memo.set(key, made);
    return made;
  };

  const available = (): Promise<boolean> =>
    once("available", async () => (await run(root, ["rev-parse", "--show-toplevel"])).ok);

  const failed = (verb: string, outcome: Extract<Outcome, { ok: false }>): CiteError =>
    new CiteError(`git ${verb} failed: ${outcome.stderr.trim() || outcome.message}`);

  /**
   * Whether the repository has the commit. `--verify --quiet` exits 1 for an
   * object it does not have, and that alone is "no": any other failure is
   * git itself failing, and reading it as "no" would turn a broken checkout
   * into shallow-clone advice.
   */
  const hasCommit = (commit: string): Promise<boolean> =>
    once(`has\0${commit}`, async () => {
      const out = await run(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${commit}^{commit}`]);
      if (out.ok) return true;
      if (out.code === 1) return false;
      throw failed("rev-parse", out);
    });

  return {
    available,

    head: () =>
      once("head", async () => {
        if (!(await available())) return null;
        const out = await run(root, ["rev-parse", "HEAD"]);
        return out.ok ? out.stdout.trim() : null;
      }),

    lsFiles: () =>
      once("ls-files", async () => {
        if (!(await available())) return [];
        const out = await run(root, ["ls-files", "-z"]);
        if (!out.ok) throw failed("ls-files", out);
        return out.stdout.split("\0").filter((entry) => entry !== "");
      }),

    showFile: (commit, path) =>
      once(`show\0${commit}\0${path}`, async (): Promise<ShownFile> => {
        const out = await run(root, ["show", "--end-of-options", `${commit}:./${path}`]);
        if (out.ok) return { text: out.stdout };
        if (NO_COMMIT.test(out.stderr)) return { missing: "commit" };
        if (NO_PATH.test(out.stderr)) {
          return (await hasCommit(commit)) ? { missing: "path" } : { missing: "commit" };
        }
        throw failed("show", out);
      }),

    subjectsSince: (commit, path) =>
      once(`log\0${commit}\0${path}`, async () => {
        const out = await run(root, ["log", "--format=%s", "--end-of-options", `${commit}..HEAD`, "--", path]);
        if (!out.ok) throw failed("log", out);
        return out.stdout.split(/\r?\n/).filter((line) => line !== "");
      }),

    diffSince: (commit, path) =>
      once(`diff\0${commit}\0${path}`, async () => {
        const out = await run(root, ["diff", "--end-of-options", commit, "--", path]);
        if (!out.ok) throw failed("diff", out);
        return out.stdout;
      }),
  };
}

/** A client that answers "no git": `available()` false, everything else empty. */
export function noGit(): GitClient {
  return {
    available: () => Promise.resolve(false),
    head: () => Promise.resolve(null),
    lsFiles: () => Promise.resolve([]),
    showFile: () => Promise.resolve({ missing: "commit" }),
    subjectsSince: () => Promise.resolve([]),
    diffSince: () => Promise.resolve(""),
  };
}
