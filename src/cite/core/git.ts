/**
 * A thin git client. Every call is `execFile("git", args, { cwd: root,
 * windowsHide: true, maxBuffer: 32 MiB })` with `-c core.quotepath=false`,
 * `--end-of-options` before a commit, `--` before a path, and `<commit>:./<path>`
 * for `show` so the path resolves against the root, not the repository top.
 * Results are memoized per (call, commit, path). The commit is validated
 * against the schema's hex pattern by the caller before it reaches here.
 */
import { execFile, spawn } from "node:child_process";
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

function run(root: string, args: readonly string[], maxBuffer = MAX_BUFFER): Promise<Outcome> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-c", "core.quotepath=false", ...args],
      { cwd: root, windowsHide: true, maxBuffer, encoding: "utf8" },
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

/**
 * `git` at `root`, as a client; see the module comment for the call shapes.
 * `rev` stands in for `HEAD` everywhere the client names it, so a client at
 * an older commit answers as `HEAD` would have there (proposal 0092). Only
 * `diffSince` differs: at `HEAD` it diffs against the working tree, as it
 * always did, and at another commit against that commit's tree.
 */
export function gitClient(root: string, rev = "HEAD"): GitClient {
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

    shallow,

    // `merge-base --is-ancestor` exits 0 for yes and 1 for no. For a commit
    // it does not have it exits 128, `Not a valid commit name`, which reads
    // as git failing. So `hasCommit` answers first, and is required rather
    // than an optimization: a commit git lacks is in no history it holds,
    // which is a no, and exactly the pin a deleted branch leaves behind.
    isAncestor: (commit, of) =>
      once(`ancestor\0${commit}\0${of}`, async () => {
        if (!(await hasCommit(commit))) return false;
        const out = await run(root, ["merge-base", "--is-ancestor", "--end-of-options", commit, of]);
        if (out.ok) return true;
        if (out.code === 1) return false;
        throw failed("merge-base", out);
      }),

    head: () =>
      once("head", async () => {
        if (!(await available())) return null;
        // `--verify`, because a bare `rev-parse` echoes `--end-of-options` back.
        const out = await run(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`]);
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
        const out = await run(root, ["log", "--format=%s", "--end-of-options", `${commit}..${rev}`, "--", path]);
        if (!out.ok) throw failed("log", out);
        return out.stdout.split(/\r?\n/).filter((line) => line !== "");
      }),

    // The revision is written out, `HEAD` for a check: with no second revision
    // git compares the commit to the working tree, and this list is committed
    // changes only, so a move that is merely saved is never followed into a
    // page (0055 stress test 8).
    changedSince: (commit) =>
      once(`changed\0${commit}`, async () => {
        if (!(await available())) return [];
        const out = await run(root, ["diff", "--name-only", "--end-of-options", commit, rev]);
        if (!out.ok) throw failed("diff", out);
        return out.stdout.split(/\r?\n/).filter((line) => line !== "");
      }),

    diffSince: (commit, path) =>
      once(`diff\0${commit}\0${path}`, async () => {
        const against = rev === "HEAD" ? [commit] : [commit, rev];
        const out = await run(root, ["diff", "--end-of-options", ...against, "--", path]);
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
          "--end-of-options",
          rev,
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
 * citation carries a commit, a pin no longer holds where it was recorded, or
 * `--show-diff` asked for diffs, so history would have been read. Said
 * through `onNotice`; never a finding.
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

/**
 * What a run says, once, when a source's walk ran out of commits before the
 * pin held: a shallow checkout, or the 256-commit cap (proposal 0097).
 * Without the rest of the history a pin that never held and one that changed
 * read the same.
 */
export const SOURCE_HISTORY_UNAVAILABLE =
  "the source history ends before the pin held; use fetch-depth: 0 to tell never-true from changed";

/**
 * What `update --recommit` says, once, in a shallow clone. A commit the clone
 * lacks may still be in the history, so only the containment test ran.
 */
export const SHALLOW_RECOMMIT =
  "this clone is shallow, so --recommit re-recorded only commits that do not contain their lines. Fetch full history to check the rest.";

/** What `add` and `update --accept` say, once, when a commit would have been recorded and git is not there. */
export const GIT_UNAVAILABLE_COMMIT = "git is not available here, so the citation records no commit.";

/**
 * A source-git notice as one checkout says it: bare for the root, after
 * `<repo>: ` for a checkout `cite.repos` names (proposal 0100). A run says
 * each string once, so each checkout says it once.
 */
export function checkoutNotice(repo: string | undefined, text: string): string {
  return repo === undefined ? text : `${repo}: ${text}`;
}

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
    changedSince: () => Promise.resolve([]),
    pageCommits: () => Promise.resolve({ commits: [], shallow: false, truncated: false }),
  };
}

// --- The history walk's git calls (proposal 0092) ---

/**
 * Room for a whole repository's first-parent log, renames and all. A
 * long-lived repository's log can exceed smaller ceilings, and execFile fails
 * outright when its output overflows the buffer.
 */
const LOG_BUFFER = 1024 * 1024 * 1024;

const ZERO = /^0+$/;

function gitFailed(verb: string, outcome: Extract<Outcome, { ok: false }>): CiteError {
  return new CiteError(`git ${verb} failed: ${outcome.stderr.trim() || outcome.message}`);
}

/**
 * One path a commit changed against its first parent. `blob` is what the path
 * holds after the commit, absent when the commit deleted it. A rename is two
 * changes, the old path deleted and the new one added with `from` set.
 */
export interface TreeChange {
  path: string;
  blob?: string;
  /** git's file mode: `120000` is a symlink, `160000` a submodule. */
  mode?: string;
  from?: string;
}

export interface WalkCommit {
  sha: string;
  /** Committer time, in epoch seconds. */
  time: number;
  subject: string;
  changes: TreeChange[];
}

/**
 * `HEAD`'s first-parent history, oldest first, each commit with what it
 * changed against its first parent. `--root` lists the first commit's files,
 * so the changes replayed in order rebuild every commit's tree. Renames are
 * git's own detection (`-M`).
 */
export async function firstParentLog(root: string): Promise<WalkCommit[]> {
  const out = await run(
    root,
    [
      "log",
      "--first-parent",
      "--diff-merges=first-parent",
      "--root",
      "-M",
      "--raw",
      "--no-abbrev",
      "-z",
      "--format=%x01%H%x02%ct%x02%s",
      "HEAD",
    ],
    LOG_BUFFER,
  );
  if (!out.ok) throw gitFailed("log", out);
  const commits: WalkCommit[] = [];
  for (const record of out.stdout.split("\x01")) {
    if (record === "") continue;
    const end = record.indexOf("\0");
    const [sha, time, ...subject] = (end === -1 ? record : record.slice(0, end)).split("\x02");
    if (sha === undefined || time === undefined) continue;
    const tokens = end === -1 ? [] : record.slice(end + 1).replace(/^\n/, "").split("\0");
    const changes: TreeChange[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const meta = tokens[i];
      if (meta === undefined || !meta.startsWith(":")) continue;
      const [, mode, , blob, status] = meta.slice(1).split(" ");
      const path = tokens[++i];
      if (path === undefined || blob === undefined || status === undefined) continue;
      const added: TreeChange = ZERO.test(blob) ? { path } : { path, blob, ...(mode === undefined ? {} : { mode }) };
      if (status.startsWith("R") || status.startsWith("C")) {
        const to = tokens[++i];
        if (to === undefined) continue;
        if (status.startsWith("R")) changes.push({ path });
        changes.push({ ...added, path: to, ...(status.startsWith("R") ? { from: path } : {}) });
      } else changes.push(added);
    }
    commits.push({ sha, time: Number(time), subject: subject.join("\x02"), changes });
  }
  return commits.reverse();
}

/** The repository's top directory, or `null` outside a work tree. */
export async function topLevel(root: string): Promise<string | null> {
  const out = await run(root, ["rev-parse", "--show-toplevel"]);
  return out.ok ? out.stdout.trim() : null;
}

/** Every commit `HEAD` reaches, by hash: its committer time and its parents. */
export async function commitGraph(root: string): Promise<Map<string, { time: number; parents: string[] }>> {
  const out = await run(root, ["log", "--format=%H %ct %P", "HEAD"], LOG_BUFFER);
  if (!out.ok) throw gitFailed("log", out);
  const graph = new Map<string, { time: number; parents: string[] }>();
  for (const line of out.stdout.split(/\r?\n/)) {
    const [sha, time, ...parents] = line.trim().split(" ");
    if (sha === undefined || sha === "" || time === undefined) continue;
    graph.set(sha, { time: Number(time), parents: parents.filter((p) => p !== "") });
  }
  return graph;
}

/** Every tag and the commit it names. A tag name holds no space, so a space separates. */
export async function tagCommits(root: string): Promise<{ name: string; commit: string }[]> {
  const out = await run(root, [
    "for-each-ref",
    "--format=%(refname:strip=2) %(objectname) %(*objectname)",
    "refs/tags",
  ]);
  if (!out.ok) throw gitFailed("for-each-ref", out);
  const tags: { name: string; commit: string }[] = [];
  for (const line of out.stdout.split(/\r?\n/)) {
    const [name, object, peeled] = line.trim().split(" ");
    if (name === undefined || name === "" || object === undefined) continue;
    // An annotated tag names its tag object; the peeled hash is the commit.
    tags.push({ name, commit: peeled !== undefined && peeled !== "" ? peeled : object });
  }
  return tags;
}

/** Blobs read through one long-running `git cat-file --batch`, in request order. */
export interface BlobReader {
  read(blob: string): Promise<string>;
  close(): void;
}

export function blobReader(root: string): BlobReader {
  const child = spawn("git", ["cat-file", "--batch"], {
    cwd: root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const waiting: { resolve: (text: string) => void; reject: (error: Error) => void }[] = [];
  let buffer = Buffer.alloc(0);
  const drain = (): void => {
    for (;;) {
      const next = waiting[0];
      const nl = buffer.indexOf(10);
      if (next === undefined || nl === -1) return;
      const header = buffer.subarray(0, nl).toString("utf8").split(" ");
      const size = Number(header[2]);
      if (header[1] === "missing" || !Number.isInteger(size)) {
        buffer = buffer.subarray(nl + 1);
        waiting.shift();
        next.reject(new CiteError(`git cat-file failed: ${header.join(" ")}`));
        continue;
      }
      if (buffer.length < nl + 2 + size) return;
      const text = buffer.subarray(nl + 1, nl + 1 + size).toString("utf8");
      buffer = buffer.subarray(nl + 2 + size);
      waiting.shift();
      next.resolve(text);
    }
  };
  const failAll = (error: Error): void => {
    for (const next of waiting.splice(0)) next.reject(error);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    drain();
  });
  child.on("error", failAll);
  child.on("close", () => {
    failAll(new CiteError("git cat-file ended early"));
  });
  return {
    read: (blob) =>
      new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
        child.stdin.write(`${blob}\n`);
      }),
    close: () => {
      child.stdin.end();
    },
  };
}
