/**
 * The git client, against a throwaway repository with two commits. Every
 * method is exercised once through the real binary; the argument-order checks
 * ride a pass-through wrapper over `execFile` that records what was run.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CiteError } from "../../src/cite/errors.js";
import { gitClient, noGit } from "../../src/cite/core/git.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const calls = vi.hoisted(() => [] as readonly string[][]);
/**
 * When set, `git rev-parse --verify …` fails this way instead of running: the
 * only way to reach `hasCommit`'s error path, since a repository that answers
 * `git show` cannot then fail `rev-parse` for a reason other than "absent".
 */
const verifyFailure = vi.hoisted(() => ({ current: undefined as { code: number; stderr: string } | undefined }));

/** The overloads of `execFile` leave its argv loosely typed; admit only a string list. */
function isArgv(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;
function isCallback(value: unknown): value is ExecCallback {
  return typeof value === "function";
}

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFile = ((...args: Parameters<typeof actual.execFile>) => {
    const argv: unknown = args[1];
    if (isArgv(argv)) (calls as string[][]).push([...argv]);
    const fake = verifyFailure.current;
    const callback: unknown = args[args.length - 1];
    if (fake !== undefined && isArgv(argv) && argv.includes("--verify") && isCallback(callback)) {
      queueMicrotask(() => {
        callback(Object.assign(new Error(`Command failed: git (exit ${String(fake.code)})`), { code: fake.code }), "", fake.stderr);
      });
      return new actual.ChildProcess();
    }
    return actual.execFile(...args);
  }) as typeof actual.execFile;
  return { ...actual, execFile };
});

const HAS_GIT = gitAvailable();
const UNKNOWN = "0123456789abcdef0123456789abcdef01234567";

const FIRST = "export const A = 1;\nexport const B = 2;\n";
const SECOND = "export const A = 1;\nexport const B = 3;\n";

describe.skipIf(!HAS_GIT)("gitClient", () => {
  let repo: string;
  let first: string;
  let second: string;

  beforeAll(() => {
    repo = makeTempRepo({
      files: {
        "src/limits.ts": FIRST,
        "sub/inner.txt": "inner\n",
        "docs/release notes.md": "notes\n",
      },
    });
    first = commitAll(repo, "add limits");
    writeFileSync(join(repo, "src", "limits.ts"), SECOND, "utf8");
    writeFileSync(join(repo, "sub", "later.txt"), "later\n", "utf8");
    second = commitAll(repo, "raise B to 3");
    // An uncommitted edit, so diffSince sees the working tree.
    writeFileSync(join(repo, "src", "limits.ts"), SECOND + "export const C = 4;\n", "utf8");
  });

  afterEach(() => {
    (calls as string[][]).length = 0;
  });

  it("available() and head() answer for a repository", async () => {
    const git = gitClient(repo);
    expect(await git.available()).toBe(true);
    expect(await git.head()).toBe(second);
  });

  it("available() is false and head() null outside a repository", async () => {
    const bare = makeTempRepo({ init: false, files: { "a.txt": "a\n" } });
    try {
      const git = gitClient(bare);
      expect(await git.available()).toBe(false);
      expect(await git.head()).toBeNull();
      expect(await git.lsFiles()).toEqual([]);
    } finally {
      removeTempRepo(bare);
    }
  });

  it("lsFiles() lists tracked files as posix paths, spaces intact", async () => {
    const files = await gitClient(repo).lsFiles();
    expect(files.sort()).toEqual(["docs/release notes.md", "src/limits.ts", "sub/inner.txt", "sub/later.txt"]);
  });

  it("lsFiles() from a subdirectory root is relative to that root", async () => {
    const files = await gitClient(join(repo, "sub")).lsFiles();
    expect(files.sort()).toEqual(["inner.txt", "later.txt"]);
  });

  it("showFile() returns the bytes at a commit", async () => {
    const git = gitClient(repo);
    expect(await git.showFile(first, "src/limits.ts")).toEqual({ text: FIRST });
    expect(await git.showFile(second, "src/limits.ts")).toEqual({ text: SECOND });
  });

  it("showFile() resolves the path against the root, not the repository top", async () => {
    const git = gitClient(join(repo, "sub"));
    expect(await git.showFile(second, "inner.txt")).toEqual({ text: "inner\n" });
    expect(await git.showFile(second, "sub/inner.txt")).toEqual({ missing: "path" });
  });

  it("showFile() reports an unknown commit and a path absent at a commit", async () => {
    const git = gitClient(repo);
    expect(await git.showFile(UNKNOWN, "src/limits.ts")).toEqual({ missing: "commit" });
    expect(await git.showFile(first, "sub/later.txt")).toEqual({ missing: "path" });
    expect(await git.showFile(first, "never/was.txt")).toEqual({ missing: "path" });
  });

  it("subjectsSince() lists commit subjects touching the path, newest first", async () => {
    const git = gitClient(repo);
    expect(await git.subjectsSince(first, "src/limits.ts")).toEqual(["raise B to 3"]);
    expect(await git.subjectsSince(second, "src/limits.ts")).toEqual([]);
    expect(await git.subjectsSince(first, "sub/inner.txt")).toEqual([]);
  });

  it("diffSince() is the working tree against the commit", async () => {
    const git = gitClient(repo);
    const diff = await git.diffSince(first, "src/limits.ts");
    expect(diff).toContain("-export const B = 2;");
    expect(diff).toContain("+export const B = 3;");
    expect(diff).toContain("+export const C = 4;");
    expect(await git.diffSince(first, "sub/inner.txt")).toBe("");
  });

  it("showFile() reads exit 1 from rev-parse as no such commit, and any other failure as a CiteError", async () => {
    // A path absent at a known commit is what sends showFile through `rev-parse --verify`.
    try {
      verifyFailure.current = { code: 128, stderr: "fatal: not a git repository: '/nowhere/.git'\n" };
      const broken = gitClient(repo).showFile(first, "never/was.txt");
      await expect(broken).rejects.toBeInstanceOf(CiteError);
      await expect(broken).rejects.toThrow("git rev-parse failed: fatal: not a git repository: '/nowhere/.git'");
      verifyFailure.current = { code: 1, stderr: "" };
      expect(await gitClient(repo).showFile(first, "never/was.txt")).toEqual({ missing: "commit" });
    } finally {
      verifyFailure.current = undefined;
    }
  });

  it("subjectsSince() and diffSince() reject an unknown commit as CiteError", async () => {
    const git = gitClient(repo);
    await expect(git.subjectsSince(UNKNOWN, "src/limits.ts")).rejects.toBeInstanceOf(CiteError);
    await expect(git.diffSince(UNKNOWN, "src/limits.ts")).rejects.toBeInstanceOf(CiteError);
  });

  it("memoizes every method per argument tuple", async () => {
    const git = gitClient(repo);
    await git.available();
    await git.available();
    await git.head();
    await git.head();
    await git.lsFiles();
    await git.lsFiles();
    await git.showFile(first, "src/limits.ts");
    await git.showFile(first, "src/limits.ts");
    await git.showFile(first, "sub/inner.txt");
    await git.subjectsSince(first, "src/limits.ts");
    await git.subjectsSince(first, "src/limits.ts");
    await git.diffSince(first, "src/limits.ts");
    await git.diffSince(first, "src/limits.ts");
    const kinds = calls.map((argv) => argv.filter((a) => !a.startsWith("-c") && a !== "core.quotepath=false")[0]);
    expect(kinds.filter((k) => k === "rev-parse")).toHaveLength(2);
    expect(kinds.filter((k) => k === "ls-files")).toHaveLength(1);
    expect(kinds.filter((k) => k === "show")).toHaveLength(2);
    expect(kinds.filter((k) => k === "log")).toHaveLength(1);
    expect(kinds.filter((k) => k === "diff")).toHaveLength(1);
  });

  it("prefixes every call with core.quotepath=false and puts the commit after --end-of-options", async () => {
    const git = gitClient(repo);
    await git.lsFiles();
    await git.showFile(first, "src/limits.ts");
    await git.subjectsSince(first, "src/limits.ts");
    await git.diffSince(first, "src/limits.ts");
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const argv of calls) {
      expect(argv.slice(0, 2)).toEqual(["-c", "core.quotepath=false"]);
    }
    const show = calls.find((argv) => argv.includes("show"));
    const log = calls.find((argv) => argv.includes("log"));
    const diff = calls.find((argv) => argv.includes("diff"));
    expect(show).toBeDefined();
    expect(log).toBeDefined();
    expect(diff).toBeDefined();
    if (!show || !log || !diff) return;
    const after = (argv: string[]): string[] => argv.slice(argv.indexOf("--end-of-options") + 1);
    expect(after(show)).toEqual([`${first}:./src/limits.ts`]);
    expect(after(log)).toEqual([`${first}..HEAD`, "--", "src/limits.ts"]);
    expect(after(diff)).toEqual([first, "--", "src/limits.ts"]);
    expect(show.indexOf("--end-of-options")).toBeGreaterThan(0);
  });
});

describe("noGit", () => {
  it("answers no git for every method", async () => {
    const git = noGit();
    expect(await git.available()).toBe(false);
    expect(await git.head()).toBeNull();
    expect(await git.lsFiles()).toEqual([]);
    expect(await git.showFile("0123456", "a.txt")).toEqual({ missing: "commit" });
    expect(await git.subjectsSince("0123456", "a.txt")).toEqual([]);
    expect(await git.diffSince("0123456", "a.txt")).toBe("");
  });
});
