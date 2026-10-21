/**
 * Proposal 0097: the source end derives its baseline from the source file's
 * history, so a pin minted on a branch survives a squash, rebase or
 * cherry-pick merge that drops the branch commit it recorded.
 *
 * Every case is built from real commits at test time, because only git can
 * tell a pruned branch commit from a shallow boundary.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { SOURCE_HISTORY_UNAVAILABLE, gitClient } from "../../src/cite/core/git.js";
import { hashLines } from "../../src/cite/core/hash.js";
import { RULE_DESCRIPTIONS } from "../../src/cite/core/severity.js";
import { publicCitation } from "../../src/cite/reporters/json.js";
import { rewriteLine } from "../../src/cite/reporters/pretty.js";
import type { CheckOptions, CheckRun, GitClient, SourceEnd } from "../../src/cite/types.js";
import {
  commitAll,
  git,
  gitAvailable,
  makeTempRepo,
  mergeBranch,
  removeTempRepo,
  writeFile,
} from "../helpers/temp-repo.js";
import {
  MINTED,
  SOURCE_PATH,
  deleteAndPrune,
  gitAs,
  hasCommit,
  minted,
  pageText,
  sourceText,
  squashRepo,
} from "./fixtures/squash-repo.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTempRepo(dir);
});

function track<T extends { repo: string }>(made: T): T {
  dirs.push(made.repo);
  return made;
}

/** Line 12 of the pinned span rewritten, lines 10 and 14 kept. */
const EDITED = sourceText((n) => (n === 12 ? "export const LIMIT_12 = 9999;" : minted(n)));

async function check(repo: string, over: Partial<CheckOptions> = {}): Promise<{ run: CheckRun; notices: string[] }> {
  const notices: string[] = [];
  const run = await runCheck({
    cwd: repo,
    inputs: ["docs"],
    noConfig: true,
    env: {},
    onNotice: (notice) => notices.push(notice),
    ...over,
  });
  return { run, notices };
}

function sourceOf(run: CheckRun): SourceEnd | undefined {
  return run.pages[0]?.citations[0]?.source;
}

function messageOf(run: CheckRun): string | undefined {
  return run.pages[0]?.findings[0]?.message;
}

/** What the bin's exit code would be: 1 on an error-severity finding. */
function exitOf(run: CheckRun): number {
  return run.results.some((result) => !result.ok) ? 1 : 0;
}

/** A client that counts the calls the fast path must and must not make. */
function counted(repo: string): { git: GitClient; shows: () => number; walks: () => number } {
  const inner = gitClient(repo);
  let shows = 0;
  let walks = 0;
  const git: GitClient = {
    ...inner,
    showFile: (commit, path) => {
      shows++;
      return inner.showFile(commit, path);
    },
    pageCommits: (path, cap) => {
      walks++;
      return inner.pageCommits?.(path, cap) ?? Promise.resolve({ commits: [], shallow: false, truncated: false });
    },
  };
  return { git, shows: () => shows, walks: () => walks };
}

describe.skipIf(!gitAvailable())("the source end after a squash merge (0097)", () => {
  it("the fixture prunes the mint commit", () => {
    const { repo, mint, squash } = track(squashRepo());
    expect(hasCommit(repo, mint)).toBe(false);
    expect(hasCommit(repo, squash)).toBe(true);
  });

  it("reads current, with no notice, while nothing changed", async () => {
    const { repo } = track(squashRepo());
    const { run, notices } = await check(repo);
    expect(sourceOf(run)?.status).toBe("current");
    expect(exitOf(run)).toBe(0);
    expect(notices).toEqual([]);
  });

  it("names the squash commit when the source is edited", async () => {
    const { repo, mint, squash } = track(squashRepo());
    writeFile(repo, SOURCE_PATH, EDITED);
    commitAll(repo, "raise limit 12");

    const { run, notices } = await check(repo);

    const source = sourceOf(run);
    expect(source?.status).toBe("changed");
    expect(source?.commitSha).toBe(mint);
    expect(source?.baselineSha).toBe(squash);
    expect(source?.historyAvailable).toBe(true);
    expect(messageOf(run)).toMatch(
      new RegExp(`^changed since ${squash.slice(0, 7)}, 1 commit; now at lines 10-14\\. `),
    );
    expect(exitOf(run)).toBe(1);
    expect(notices).toEqual([]);
  });

  it("carries the recorded and the derived commit in the JSON form", async () => {
    const { repo, mint, squash } = track(squashRepo());
    writeFile(repo, SOURCE_PATH, EDITED);
    commitAll(repo, "raise limit 12");
    const { run } = await check(repo);
    const result = run.pages[0]?.citations[0];
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(publicCitation(result).source).toMatchObject({ commitSha: mint, baselineSha: squash });
  });

  it("follows a renamed source to its new path", async () => {
    const { repo } = track(squashRepo());
    mkdirSync(join(repo, "src", "config"), { recursive: true });
    git(repo, ["mv", SOURCE_PATH, "src/config/limits.ts"]);
    commitAll(repo, "move the limits");

    const { run } = await check(repo);

    const source = sourceOf(run);
    expect(source?.status).toBe("moved");
    expect(source?.newSrc).toBe("src/config/limits.ts:10-14");
    expect(messageOf(run)).toMatch(/^moved -> src\/config\/limits\.ts:10-14/);
    expect(exitOf(run)).toBe(0);
  });

  it("calls a pin that held at no commit never true", async () => {
    const { repo, mint } = track(squashRepo());
    writeFile(repo, "docs/page.md", pageText(mint, hashLines("no commit ever had this")));

    const { run } = await check(repo);

    expect(sourceOf(run)?.status).toBe("never-true");
    expect(sourceOf(run)?.baselineSha).toBeUndefined();
    expect(messageOf(run)).toMatch(
      /^never true: the pin held at no commit in the history of src\/limits\.ts\. /,
    );
    expect(exitOf(run)).toBe(1);
  });

  it("says once that a shallow clone's history ends before the pin held", async () => {
    const { repo, mint } = track(squashRepo());
    writeFile(repo, SOURCE_PATH, EDITED);
    commitAll(repo, "raise limit 12");
    const holder = mkdtempSync(join(tmpdir(), "docmeta-shallow-"));
    dirs.push(holder);
    const clone = join(holder, "clone");
    execFileSync("git", ["clone", "-q", "--depth", "1", pathToFileURL(repo).href, clone], {
      stdio: "ignore",
    });
    // Two pages, so a notice said per page would show.
    writeFile(clone, "docs/page.md", pageText(mint));
    writeFile(clone, "docs/other.md", pageText(mint));

    const { run, notices } = await check(clone);

    expect(sourceOf(run)?.historyAvailable).toBe(false);
    expect(sourceOf(run)?.baselineSha).toBeUndefined();
    expect(messageOf(run)).toMatch(/^changed \(history unavailable; fetch-depth: 0\)\. /);
    expect(exitOf(run)).toBe(1);
    expect(notices.filter((notice) => notice === SOURCE_HISTORY_UNAVAILABLE)).toHaveLength(1);
    expect(SOURCE_HISTORY_UNAVAILABLE).toBe(
      "the source history ends before the pin held; use fetch-depth: 0 to tell never-true from changed",
    );
    expect(notices.join("\n")).not.toContain("not found in history");
  });

  it("keeps walking past a commit where the path is absent", async () => {
    const { repo, squash } = track(squashRepo());
    git(repo, ["rm", "-q", SOURCE_PATH]);
    commitAll(repo, "drop the limits");
    writeFile(repo, SOURCE_PATH, EDITED);
    commitAll(repo, "bring the limits back");

    const { run } = await check(repo);

    expect(sourceOf(run)?.baselineSha).toBe(squash);
    expect(messageOf(run)).toMatch(new RegExp(`^changed since ${squash.slice(0, 7)}, 2 commits`));
  });

  it("reports the cap as history unavailable, with the notice", async () => {
    const { repo, mint } = track(squashRepo());
    writeFile(repo, SOURCE_PATH, EDITED);
    const inner = gitClient(repo);
    const capped: GitClient = {
      ...inner,
      pageCommits: () =>
        Promise.resolve({
          commits: [{ sha: git(repo, ["rev-parse", "HEAD"]), subject: "set the limits (#1)" }],
          shallow: false,
          truncated: true,
        }),
    };
    // HEAD is the squash, which holds the pin; the page pins text it never had.
    writeFile(repo, "docs/page.md", pageText(mint, hashLines("beyond the cap")));

    const { run, notices } = await check(repo, { gitClient: capped });

    expect(sourceOf(run)?.status).toBe("changed");
    expect(sourceOf(run)?.historyAvailable).toBe(false);
    expect(notices).toEqual([SOURCE_HISTORY_UNAVAILABLE]);
  });
});

describe.skipIf(!gitAvailable())("the fast path, and other merges (0097)", () => {
  /** A trunk with the unedited source, and a `feature` branch that mints the pin. */
  function branched(): { repo: string; trunk: string; mint: string } {
    const repo = makeTempRepo({ files: { [SOURCE_PATH]: sourceText(), "README.md": "# r\n" } });
    dirs.push(repo);
    commitAll(repo, "start");
    const trunk = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    git(repo, ["checkout", "-q", "-b", "feature"]);
    writeFile(repo, SOURCE_PATH, MINTED);
    const mint = commitAll(repo, "set the limits");
    git(repo, ["checkout", "-q", trunk]);
    // The trunk moves on, so a rebase or a pick makes a new commit.
    writeFile(repo, "README.md", "# r, later\n");
    commitAll(repo, "later");
    return { repo, trunk, mint };
  }

  it("reads an ancestor that holds the pin with one git show and no walk", async () => {
    const repo = makeTempRepo({ files: { [SOURCE_PATH]: MINTED } });
    dirs.push(repo);
    const mint = commitAll(repo, "set the limits");
    writeFile(repo, SOURCE_PATH, EDITED);
    commitAll(repo, "raise limit 12");
    writeFile(repo, "docs/page.md", pageText(mint));
    const counter = counted(repo);

    const { run } = await check(repo, { gitClient: counter.git });

    expect(sourceOf(run)?.baselineSha).toBe(mint);
    expect(counter.shows()).toBe(1);
    expect(counter.walks()).toBe(0);
  });

  it("never walks a merge-commit history", async () => {
    const { repo, trunk, mint } = branched();
    git(repo, ["checkout", "-q", trunk]);
    mergeBranch(repo, "feature", "2026-10-02T12:00:00+00:00");
    writeFile(repo, SOURCE_PATH, EDITED);
    commitAll(repo, "raise limit 12");
    writeFile(repo, "docs/page.md", pageText(mint));
    const counter = counted(repo);

    const { run } = await check(repo, { gitClient: counter.git });

    expect(sourceOf(run)?.baselineSha).toBe(mint);
    expect(counter.walks()).toBe(0);
  });

  it("derives the rebased commit after a rebase merge", async () => {
    const { repo, trunk, mint } = branched();
    git(repo, ["checkout", "-q", "feature"]);
    gitAs(repo, ["rebase", "-q", trunk]);
    const rebased = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["checkout", "-q", trunk]);
    git(repo, ["merge", "-q", "--ff-only", "feature"]);
    deleteAndPrune(repo, "feature");
    writeFile(repo, SOURCE_PATH, EDITED);
    commitAll(repo, "raise limit 12");
    writeFile(repo, "docs/page.md", pageText(mint));

    const { run } = await check(repo);

    expect(rebased).not.toBe(mint);
    expect(sourceOf(run)?.baselineSha).toBe(rebased);
    expect(messageOf(run)).toMatch(new RegExp(`^changed since ${rebased.slice(0, 7)}, 1 commit`));
  });

  it("derives the picked commit after a cherry-pick", async () => {
    const { repo, mint } = branched();
    gitAs(repo, ["cherry-pick", mint]);
    const picked = git(repo, ["rev-parse", "HEAD"]);
    deleteAndPrune(repo, "feature");
    writeFile(repo, SOURCE_PATH, EDITED);
    commitAll(repo, "raise limit 12");
    writeFile(repo, "docs/page.md", pageText(mint));

    const { run } = await check(repo);

    expect(picked).not.toBe(mint);
    expect(sourceOf(run)?.baselineSha).toBe(picked);
  });
});

describe.skipIf(!gitAvailable())("cite update --recommit after a squash merge (0097)", () => {
  function update(repo: string) {
    return runUpdate({ cwd: repo, inputs: ["docs"], noConfig: true, env: {}, recommit: true });
  }

  it("records the squash commit, not HEAD, and a second run rewrites nothing", async () => {
    const { repo, mint, squash } = track(squashRepo());
    // A later commit touches the source but keeps the pinned lines, so HEAD
    // holds the pin and is still not where the lines arrived.
    writeFile(repo, SOURCE_PATH, MINTED.replace("LINE_1 = 1", "LINE_1 = 0"));
    const head = commitAll(repo, "renumber line 1");

    const first = await update(repo);

    expect(first.pages[0]?.rewritten[0]).toMatchObject({
      reason: "recommitted",
      because: "not-in-history",
      fromCommit: mint,
      toCommit: squash,
    });
    const page = readFileSync(join(repo, "docs", "page.md"), "utf8");
    expect(page).toContain(`commit-sha: ${squash}`);
    expect(page).not.toContain(head);
    const row = first.pages[0]?.rewritten[0];
    expect(row).toBeDefined();
    if (row !== undefined) {
      expect(rewriteLine(row)).toContain(
        `commit ${mint.slice(0, 7)} -> ${squash.slice(0, 7)} (not in this branch's history)`,
      );
    }

    const second = await update(repo);
    expect(second.pages[0]?.rewritten ?? []).toEqual([]);
    expect(readFileSync(join(repo, "docs", "page.md"), "utf8")).toContain(`commit-sha: ${squash}`);
  });

  it("records where the lines arrived at the entry's own range, not where the bytes sat before", async () => {
    // The trunk held the pinned bytes one line lower, under a header. The
    // squash dropped the header, so lines 10-14 hold the pin from it on.
    const repo = makeTempRepo({ files: { [SOURCE_PATH]: `// header\n${MINTED}` } });
    dirs.push(repo);
    const before = commitAll(repo, "limits under a header");
    writeFile(repo, SOURCE_PATH, MINTED);
    const squash = commitAll(repo, "drop the header (#2)");
    const gone = "dec0de".repeat(6) + "abcd";
    writeFile(repo, "docs/page.md", pageText(gone));

    const run = await update(repo);

    expect(run.pages[0]?.rewritten[0]).toMatchObject({ fromCommit: gone, toCommit: squash });
    expect(readFileSync(join(repo, "docs", "page.md"), "utf8")).not.toContain(before);
  });
});

describe("the source-never-true rule description (0097)", () => {
  it("speaks of the source's history, not the recorded commit", () => {
    expect(RULE_DESCRIPTIONS["source-never-true"]).toBe(
      "The pin held at no commit in the source's history.",
    );
  });
});
