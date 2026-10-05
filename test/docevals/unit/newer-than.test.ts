/**
 * `--newer-than <duration>`: grade only the pages that changed inside a window
 * of time back from now.
 *
 * A page's age is detected, not switched. A page git tracks with no
 * uncommitted change, in the page or its manifest, takes the committer date of
 * the last commit touching either. Any other page takes the newer file mtime.
 * The committed case matters because a fresh checkout stamps every file with
 * the clone's time, which would read as "everything just changed".
 *
 * Everything is driven through the injected `ExecFn`; no test here runs git.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runEvals, type EngineReport } from "../../../src/docevals/core/engine.js";
import { buildProgram } from "../../../src/docevals/cli.js";
import { renderPretty } from "../../../src/docevals/reporters/pretty.js";
import { renderMarkdown } from "../../../src/docevals/reporters/markdown.js";
import { renderGithub } from "../../../src/docevals/reporters/github.js";
import { DocevalsError } from "../../../src/docevals/types.js";
import type { ExecFn, ExecResult } from "../../../src/docevals/graders/types.js";

const OK: ExecResult = { code: 0, stdout: "", stderr: "", timedOut: false };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number): number => Date.now() - ms;

interface FakeRepo {
  /** Absolute top level; `undefined` makes `rev-parse` fail (not a repo). */
  topLevel?: string;
  /** Repo-relative files git tracks. */
  tracked?: string[];
  /** Repo-relative tracked files with an uncommitted change. */
  modified?: string[];
  /** Repo-relative file to the epoch milliseconds of its last commit. */
  committed?: Record<string, number>;
  /** Repo-relative files that differ between the `--since` ref and HEAD. */
  changedSinceRef?: string[];
}

/** A fake git answering only the questions the page-age rule asks. */
function fakeGit(repo: FakeRepo): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = [];
  const nul = (files: string[]): string => files.map((f) => `${f}\0`).join("");
  const exec: ExecFn = (cmd) => {
    calls.push(cmd);
    if (cmd.includes("rev-parse")) {
      return Promise.resolve(
        repo.topLevel === undefined
          ? { ...OK, code: 128, stderr: "fatal: not a git repository" }
          : { ...OK, stdout: `${repo.topLevel}\n` },
      );
    }
    if (cmd.includes("ls-files")) {
      return Promise.resolve({ ...OK, stdout: nul(repo.tracked ?? []) });
    }
    if (cmd.includes("diff")) {
      const last = cmd[cmd.length - 1] ?? "";
      return Promise.resolve({
        ...OK,
        stdout: nul(
          last.endsWith("...HEAD")
            ? (repo.changedSinceRef ?? [])
            : (repo.modified ?? []),
        ),
      });
    }
    if (cmd.includes("log")) {
      const paths = cmd.slice(cmd.indexOf("--") + 1);
      const times = paths
        .map((p) => repo.committed?.[p])
        .filter((t): t is number => t !== undefined);
      return Promise.resolve({
        ...OK,
        stdout: times.length === 0 ? "" : `${String(Math.floor(Math.max(...times) / 1000))}\n`,
      });
    }
    return Promise.resolve({ ...OK, code: 1, stderr: `unexpected: ${cmd.join(" ")}` });
  };
  return { exec, calls };
}

const CONFIG = [
  "collections:",
  "  - name: pages",
  '    paths: ["docs/**/*.md"]',
  "docevals:",
  "  defaults:",
  "    suite: reference",
  "  evals:",
  "    has-body:",
  "      assertion: The page has body text.",
  "      grader: tool:regex",
  "      options:",
  "        pattern: Body text",
  "      severity: error",
  "  suites:",
  "    reference:",
  "      target-pass-rate: 1.0",
  "      evals: [has-body]",
  "",
].join("\n");

const PAGE = ["---", "title: A page", "---", "", "# A page", "", "Body text.", ""].join(
  "\n",
);

/** Three pages, `alpha`, `beta` and `gamma`, every file stamped `mtime` ago. */
function scaffold(mtimeAgo = 0): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-newer-than-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const name of ["alpha", "beta", "gamma"]) {
    const file = join(root, "docs", `${name}.md`);
    writeFileSync(file, PAGE);
    const at = new Date(ago(mtimeAgo));
    utimesSync(file, at, at);
  }
  writeFileSync(join(root, "manni.config.yaml"), CONFIG);
  return root;
}

const ALL = ["docs/alpha.md", "docs/beta.md", "docs/gamma.md", "manni.config.yaml"];

const graded = (report: EngineReport): string[] =>
  [...new Set(report.evalResults.map((r) => r.file))].sort();

async function run(
  cwd: string,
  repo: FakeRepo,
  options: Record<string, unknown> = {},
): Promise<EngineReport> {
  const { exec } = fakeGit(repo);
  return runEvals({ cwd, generate: false, exec, newerThan: "7d", ...options });
}

describe("--newer-than: a page git tracks with nothing uncommitted", () => {
  it("is selected when its last commit falls inside the window", async () => {
    const cwd = scaffold();
    const report = await run(cwd, {
      topLevel: cwd,
      tracked: ALL,
      committed: {
        "docs/alpha.md": ago(HOUR),
        "docs/beta.md": ago(30 * DAY),
        "docs/gamma.md": ago(30 * DAY),
      },
    });
    expect(graded(report)).toEqual(["docs/alpha.md"]);
    expect(report.newerThan).toEqual({ duration: "7d", pagesSelected: 1, pagesTotal: 3 });
  });

  it("is left out when its last commit is older, however fresh its mtime", async () => {
    // A fresh clone stamps every file with the clone's time. The commit date
    // is what says when the page last changed.
    const cwd = scaffold(0);
    const report = await run(cwd, {
      topLevel: cwd,
      tracked: ALL,
      committed: {
        "docs/alpha.md": ago(30 * DAY),
        "docs/beta.md": ago(30 * DAY),
        "docs/gamma.md": ago(30 * DAY),
      },
    });
    expect(graded(report)).toEqual([]);
    expect(report.newerThan?.pagesSelected).toBe(0);
    expect(report.exitCode).toBe(0);
  });
});

describe("--newer-than: a page with an uncommitted change", () => {
  it("takes its mtime, not its last commit", async () => {
    const cwd = scaffold(0);
    const report = await run(cwd, {
      topLevel: cwd,
      tracked: ALL,
      modified: ["docs/beta.md"],
      committed: {
        "docs/alpha.md": ago(30 * DAY),
        "docs/beta.md": ago(30 * DAY),
        "docs/gamma.md": ago(30 * DAY),
      },
    });
    expect(graded(report)).toEqual(["docs/beta.md"]);
  });

  it("is left out when the edit itself is older than the window", async () => {
    const cwd = scaffold(30 * DAY);
    const report = await run(cwd, {
      topLevel: cwd,
      tracked: ALL,
      modified: ["docs/beta.md"],
      committed: { "docs/beta.md": ago(HOUR) },
    });
    expect(graded(report)).not.toContain("docs/beta.md");
  });
});

describe("--newer-than: a page git does not track", () => {
  it("takes its mtime", async () => {
    const cwd = scaffold(0);
    const report = await run(cwd, {
      topLevel: cwd,
      tracked: ["docs/alpha.md", "docs/beta.md", "manni.config.yaml"],
      committed: {
        "docs/alpha.md": ago(30 * DAY),
        "docs/beta.md": ago(30 * DAY),
      },
    });
    expect(graded(report)).toEqual(["docs/gamma.md"]);
  });

  it("is left out when its mtime is older than the window", async () => {
    const cwd = scaffold(30 * DAY);
    const report = await run(cwd, { topLevel: cwd, tracked: [] });
    expect(graded(report)).toEqual([]);
  });

  it("reads every page by mtime outside a git repository", async () => {
    const cwd = scaffold(0);
    const report = await run(cwd, {});
    expect(graded(report)).toEqual(["docs/alpha.md", "docs/beta.md", "docs/gamma.md"]);
  });
});

// A corpus that keeps its evals in manifests edits an eval by editing the
// manifest. The page file is untouched, and keying on it alone would scope
// that edit out.
describe("--newer-than: a page whose eval manifest changed", () => {
  const cwd = resolve(import.meta.dirname, "../fixtures/manifest/per-page");

  it("is selected by a recent commit to the manifest alone", async () => {
    const report = await run(cwd, {
      topLevel: cwd,
      tracked: ["docs/install.md", "docs/install.evals.yaml", "manni.config.yaml"],
      committed: {
        "docs/install.md": ago(30 * DAY),
        "docs/install.evals.yaml": ago(HOUR),
      },
    });
    expect(graded(report)).toEqual(["docs/install.md"]);
  });

  it("is left out when neither the page nor the manifest moved", async () => {
    const report = await run(cwd, {
      topLevel: cwd,
      tracked: ["docs/install.md", "docs/install.evals.yaml", "manni.config.yaml"],
      committed: {
        "docs/install.md": ago(30 * DAY),
        "docs/install.evals.yaml": ago(30 * DAY),
      },
    });
    expect(graded(report)).toEqual([]);
  });
});

describe("--newer-than with --since", () => {
  it("grades only the pages that satisfy both", async () => {
    const cwd = scaffold();
    const report = await run(
      cwd,
      {
        topLevel: cwd,
        tracked: ALL,
        changedSinceRef: ["docs/alpha.md", "docs/gamma.md"],
        committed: {
          "docs/alpha.md": ago(30 * DAY),
          "docs/beta.md": ago(HOUR),
          "docs/gamma.md": ago(HOUR),
        },
      },
      { since: "origin/main" },
    );
    expect(graded(report)).toEqual(["docs/gamma.md"]);
    expect(report.since).toEqual({ ref: "origin/main", pagesSelected: 1, pagesTotal: 3 });
    expect(report.newerThan).toEqual({ duration: "7d", pagesSelected: 1, pagesTotal: 3 });
  });

  it("names both in the scope line", async () => {
    const cwd = scaffold();
    const report = await run(
      cwd,
      {
        topLevel: cwd,
        tracked: ALL,
        changedSinceRef: ["docs/gamma.md"],
        committed: { "docs/gamma.md": ago(HOUR) },
      },
      { since: "origin/main" },
    );
    expect(renderPretty(report, { color: false })).toContain(
      "Scoped to 1 of 3 page(s) changed since origin/main and in the last 7d.",
    );
  });
});

describe("--newer-than: what the reporters say", () => {
  it("says nothing was evaluated when no page is new enough", async () => {
    const cwd = scaffold(30 * DAY);
    const report = await run(cwd, { topLevel: cwd, tracked: [] });
    const line = "No pages changed in the last 7d — nothing was evaluated.";
    expect(renderPretty(report, { color: false })).toContain(line);
    expect(renderMarkdown(report)).toContain("No pages changed in the last 7d");
    expect(renderGithub(report)).toContain(`::notice title=manni docevals::${line}`);
  });

  it("names the window it scoped to", async () => {
    const cwd = scaffold(0);
    const report = await run(cwd, { topLevel: cwd, tracked: [] });
    expect(renderPretty(report, { color: false })).toContain(
      "Scoped to 3 of 3 page(s) changed in the last 7d.",
    );
  });
});

describe("--newer-than: refusals", () => {
  it("refuses a value that is not a duration, before running anything", async () => {
    const cwd = scaffold();
    const { exec, calls } = fakeGit({ topLevel: cwd, tracked: ALL });
    const err = await runEvals({ cwd, generate: false, exec, newerThan: "7y" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DocevalsError);
    expect((err as Error).message).toBe(
      '--newer-than must be a duration such as 30m, 24h, 7d or 2w, got "7y"',
    );
    expect(calls).toEqual([]);
  });

  it("cannot be combined with --write-baseline", async () => {
    const cwd = scaffold();
    await expect(
      run(cwd, { topLevel: cwd, tracked: ALL }, { writeBaseline: true }),
    ).rejects.toThrow(/--since or --newer-than/);
  });
});

describe("the --newer-than flag", () => {
  it("is on run, and its help points CI at --since", () => {
    const run = buildProgram().commands.find((c) => c.name() === "run");
    const flag = run?.options.find((o) => o.long === "--newer-than");
    expect(flag?.flags).toBe("--newer-than <duration>");
    expect(flag?.description).toContain("--since");
  });
});
