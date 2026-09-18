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
import type { GitClient, PageCommit, PageHistory, ShownFile } from "../types.js";

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
  /**
   * Whether the repository is shallow. A shallow oldest commit has a parent
   * nobody fetched, so a walk that runs out of commits there has not reached
   * the beginning of anything.
   */
  const shallow = (): Promise<boolean> =>
    once("shallow", async () => {
      const out = await run(root, ["rev-parse", "--is-shallow-repository"]);
      return out.ok && out.stdout.trim() === "true";
    });

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

    pageCommits: (path, cap) =>
      once(`commits\0${String(cap)}\0${path}`, async (): Promise<PageHistory> => {
        if (!(await available())) return { commits: [], shallow: false, truncated: false };
        // One more than the cap, so a list the cap cut short says so rather
        // than reading as a history that simply ended there.
        // `--topo-order`, because the default date order interleaves the
        // lineages either side of a merge. A walk back through an interleaved
        // list reads one branch's commits as if they came before the other's.
        const out = await run(root, [
          "log",
          `--format=%H${UNIT}%s`,
          "--topo-order",
          `-n${String(cap + 1)}`,
          "HEAD",
          "--",
          path,
        ]);
        if (!out.ok) throw failed("log", out);
        const commits: PageCommit[] = [];
        for (const line of out.stdout.split(/\r?\n/)) {
          if (line === "") continue;
          const at = line.indexOf(UNIT);
          if (at === -1) continue;
          commits.push({ sha: line.slice(0, at), subject: line.slice(at + 1) });
        }
        const truncated = commits.length > cap;
        return { commits: commits.slice(0, cap), shallow: await shallow(), truncated };
      }),
  };
}

/** The separator between a commit's hash and its subject: never in either. */
const UNIT = "";

/**
 * What a run says, once, when git is not there and the run wanted it: a
 * citation carries a commit, or `--show-diff` asked for diffs, so history
 * would have been read. Said through `onNotice`; never a finding.
 */
export const GIT_UNAVAILABLE_HISTORY =
  "git is not available here, so citations are checked without history: no never-true, no reanchored claims, no diffs, no commit subjects.";

/**
 * What a run says, once, when a claim's walk ran out of commits before the
 * pin held: a shallow checkout, or the 256-commit cap. Without the rest of
 * the history a layout change and an edit read the same.
 */
export const PAGE_HISTORY_UNAVAILABLE =
  "the page history ends before the pin held; use fetch-depth: 0 to tell reanchored claims from changed ones";

/** What `add` and `update --accept` say, once, when a commit would have been recorded and git is not there. */
export const GIT_UNAVAILABLE_COMMIT = "git is not available here, so the citation records no commit.";

/**
 * A client that answers "no git": `available()` false, everything else empty.
 * What a caller passes as `gitClient` to run without git where git is there.
 */
export function noGit(): GitClient {
  return {
    available: () => Promise.resolve(false),
    head: () => Promise.resolve(null),
    lsFiles: () => Promise.resolve([]),
    showFile: () => Promise.resolve({ missing: "commit" }),
    subjectsSince: () => Promise.resolve([]),
    diffSince: () => Promise.resolve(""),
    pageCommits: () => Promise.resolve({ commits: [], shallow: false, truncated: false }),
  };
}
