/**
 * `cite update --recommit`: repair a `commit-sha` that does not contain the
 * lines it is recorded against.
 *
 * Such an entry is invisible to `check`. `classifyCitation` compares the pin
 * against the working tree first and returns `current` without ever consulting
 * the commit, so nothing reports it. It surfaces later, as a false
 * `source-never-true` the first time the source changes, which is severity
 * `error`. So the repair is asked for rather than offered.
 *
 * The hard case is the one that must be left alone. `update` follows a move
 * and keeps `commit`, so a pin whose lines drifted inside one commit still
 * names a commit that holds its bytes, at other line numbers. Re-minting those
 * would overwrite a real date with today's. Every case here is built from real
 * commits, because only git can tell the two apart.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runUpdate } from "../../src/cite/commands/update.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { SHALLOW_RECOMMIT, noGit } from "../../src/cite/core/git.js";
import { CiteError } from "../../src/cite/errors.js";
import type { UpdateOptions, UpdateRun } from "../../src/cite/types.js";
import { commitAll, git, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "fixtures", "cite", "src");
const LIMITS = readFileSync(join(SRC, "limits.ts"), "utf8");
/** `limits.ts` line 2, as the fixture ships it. */
const PIN_L2 = hashRange(LIMITS, { start: 2, end: 2 });
const TIMEOUT_LINE = "export const FETCH_TIMEOUT_MS = 10_000;";

interface EntrySpec {
  lines: number | string;
  integrity: string;
  commit?: string;
}

/** A page whose frontmatter carries one citation per spec. */
function writePage(repo: string, entries: EntrySpec[]): string {
  mkdirSync(join(repo, "docs"), { recursive: true });
  const body = entries.flatMap((e, i) => [
    `  - id: pin-${String(i)}`,
    "    source:",
    "      file: src/limits.ts",
    `      lines: ${String(e.lines)}`,
    `      integrity: ${e.integrity}`,
    ...(e.commit === undefined ? [] : [`      commit-sha: ${e.commit}`]),
  ]);
  const page = join(repo, "docs", "limits.md");
  writeFileSync(page, ["---", "citations:", ...body, "---", "Body.", ""].join("\n"), "utf8");
  return page;
}

function update(repo: string, over: Partial<UpdateOptions> = {}): Promise<UpdateRun> {
  return runUpdate({
    cwd: repo,
    inputs: ["docs/limits.md"],
    noConfig: true,
    env: {},
    recommit: true,
    ...over,
  });
}

describe.skipIf(!gitAvailable())("cite update --recommit", () => {
  let repo = "";
  afterEach(() => {
    removeTempRepo(repo);
    repo = "";
  });

  /**
   * A commit that cannot hold the pin: line 2 is rewritten, so its new text is
   * nowhere in the file as `first` recorded it. The entry pins the new text
   * and dates it to `first`, which is what minting over an uncommitted edit
   * leaves behind.
   */
  function repoWithUnsupportedCommit(): { first: string; second: string; pin: string } {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    const edited = LIMITS.replace(TIMEOUT_LINE, "export const FETCH_TIMEOUT_MS = 30_000;");
    writeFileSync(join(repo, "src", "limits.ts"), edited, "utf8");
    const second = commitAll(repo, "raise the timeout");
    return { first, second, pin: hashRange(edited, { start: 2, end: 2 }) };
  }

  it("re-records the commit, and leaves the pin itself untouched", async () => {
    const { first, second, pin } = repoWithUnsupportedCommit();
    const page = writePage(repo, [{ lines: 2, integrity: pin, commit: first }]);

    const run = await update(repo);

    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    const after = readFileSync(page, "utf8");
    expect(after).toContain(`commit-sha: ${second}`);
    expect(after).not.toContain(first);
    // Only the date moved.
    expect(after).toContain(`integrity: ${pin}`);
    expect(after).toContain("lines: 2");
  });

  it("names both commits in the report, as a source rewrite", async () => {
    const { first, second, pin } = repoWithUnsupportedCommit();
    writePage(repo, [{ lines: 2, integrity: pin, commit: first }]);

    const run = await update(repo);

    expect(run.pages[0]?.rewritten[0]).toMatchObject({
      end: "source",
      reason: "recommitted",
      status: "current",
      because: "not-contained",
      fromCommit: first,
      toCommit: second,
    });
  });

  /**
   * The 768-entry case on this repo's own manifest. `update` moved `src` and
   * kept `commit`, so the lines drifted but the commit still holds the bytes.
   * Re-minting here would destroy a real provenance date.
   */
  it("leaves a pin alone when its lines merely drifted inside the commit", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    writeFileSync(join(repo, "src", "limits.ts"), `// a header\n${LIMITS}`, "utf8");
    commitAll(repo, "add a header");
    // Line 3 now, line 2 at `first`: the same bytes, a different line number.
    const page = writePage(repo, [{ lines: 3, integrity: PIN_L2, commit: first }]);

    const run = await update(repo);

    expect(run).toMatchObject({ rewritten: 0, exitCode: 0 });
    expect(readFileSync(page, "utf8")).toContain(`commit-sha: ${first}`);
  });

  // A full clone lacks only commits outside its history, so one git cannot
  // read is re-recorded. A shallow clone cannot tell; see the suite below.
  it("re-records a commit git cannot read, in a full clone", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const head = commitAll(repo, "add limits");
    const absent = "dec0de".repeat(6) + "abcd";
    const page = writePage(repo, [{ lines: 2, integrity: PIN_L2, commit: absent }]);

    const run = await update(repo);

    expect(run).toMatchObject({ rewritten: 1, exitCode: 0 });
    expect(run.pages[0]?.rewritten[0]).toMatchObject({
      reason: "recommitted",
      because: "not-in-history",
      fromCommit: absent,
      toCommit: head,
    });
    expect(readFileSync(page, "utf8")).toContain(`commit-sha: ${head}`);
  });

  it("adds no commit-sha to an entry that records none", async () => {
    const { pin } = repoWithUnsupportedCommit();
    const page = writePage(repo, [{ lines: 2, integrity: pin }]);

    const run = await update(repo);

    expect(run).toMatchObject({ rewritten: 0, exitCode: 0 });
    expect(readFileSync(page, "utf8")).not.toContain("commit-sha");
  });

  it("does nothing without the flag, because check reported nothing", async () => {
    const { first, pin } = repoWithUnsupportedCommit();
    const page = writePage(repo, [{ lines: 2, integrity: pin, commit: first }]);

    const run = await update(repo, { recommit: false });

    expect(run).toMatchObject({ rewritten: 0, exitCode: 0 });
    expect(readFileSync(page, "utf8")).toContain(`commit-sha: ${first}`);
  });

  it("writes nothing under --dry-run", async () => {
    const { first, pin } = repoWithUnsupportedCommit();
    const page = writePage(repo, [{ lines: 2, integrity: pin, commit: first }]);

    const run = await update(repo, { dryRun: true });

    expect(run).toMatchObject({ rewritten: 1 });
    expect(readFileSync(page, "utf8")).toContain(`commit-sha: ${first}`);
  });

  it("repairs only the entry --only names", async () => {
    const { first, second, pin } = repoWithUnsupportedCommit();
    // Both spans cover the rewritten line 2, so neither holds at `first`.
    const page = writePage(repo, [
      { lines: 2, integrity: pin, commit: first },
      { lines: "1-3", integrity: hashRange(readFileSync(join(repo, "src", "limits.ts"), "utf8"), { start: 1, end: 3 }), commit: first },
    ]);

    const run = await update(repo, { only: ["pin-1"] });

    expect(run).toMatchObject({ rewritten: 1, exitCode: 0 });
    const after = readFileSync(page, "utf8");
    // The named entry moved on; the other kept the commit it could not support.
    expect(after).toContain(`commit-sha: ${second}`);
    expect(after).toContain(`commit-sha: ${first}`);
  });

  it("refuses without git, since nothing can be verified", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    commitAll(repo, "add limits");
    writePage(repo, [{ lines: 2, integrity: PIN_L2, commit: "a".repeat(40) }]);

    await expect(update(repo, { gitClient: noGit() })).rejects.toThrow(
      "--recommit needs git to verify recorded commits, and git is not available here.",
    );
    await expect(update(repo, { gitClient: noGit() })).rejects.toBeInstanceOf(CiteError);
  });
});

/**
 * A squash merge leaves the branch's own commit out of main. A pin minted on
 * the branch records that commit, which still holds the lines, so the
 * containment test above passes it. It is repaired because it is outside
 * HEAD's history, and only where git can say so. A shallow clone cannot.
 */
describe.skipIf(!gitAvailable())("cite update --recommit, for a commit outside HEAD's history", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) removeTempRepo(dir);
  });


  /**
   * The trunk starts with a README. A side branch adds `src/limits.ts` as
   * `onBranch`, and the trunk then commits `onTrunk` separately, which is what
   * a squash merge leaves behind. HEAD is the trunk's commit.
   */
  function squashed(onBranch: string, onTrunk: string): { repo: string; side: string; head: string } {
    const repo = makeTempRepo({ files: { "README.md": "# r\n" } });
    dirs.push(repo);
    commitAll(repo, "start");
    const trunk = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    git(repo, ["checkout", "-q", "-b", "side"]);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "limits.ts"), onBranch, "utf8");
    const side = commitAll(repo, "on the branch");
    git(repo, ["checkout", "-q", trunk]);
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "limits.ts"), onTrunk, "utf8");
    const head = commitAll(repo, "squashed");
    return { repo, side, head };
  }

  function updateIn(repo: string, notices: string[] = []): Promise<UpdateRun> {
    return runUpdate({
      cwd: repo,
      inputs: ["docs/limits.md"],
      noConfig: true,
      env: {},
      recommit: true,
      onNotice: (notice) => notices.push(notice),
    });
  }

  it("re-records a branch commit the trunk never took to HEAD, saying why", async () => {
    const { repo, side, head } = squashed(LIMITS, LIMITS);
    const page = writePage(repo, [{ lines: 2, integrity: PIN_L2, commit: side }]);

    const run = await updateIn(repo);

    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten[0]).toMatchObject({
      end: "source",
      reason: "recommitted",
      status: "current",
      because: "not-in-history",
      fromCommit: side,
      toCommit: head,
    });
    const after = readFileSync(page, "utf8");
    expect(after).toContain(`commit-sha: ${head}`);
    expect(after).toContain(`integrity: ${PIN_L2}`);
  });

  it("names the history when the commit is outside it and lacks the lines too", async () => {
    // The branch kept the old timeout and the trunk raised it. The pin is the
    // trunk's line, recorded against the branch commit, which fails both
    // tests. History is asked first, because it costs no file read.
    const edited = LIMITS.replace(TIMEOUT_LINE, "export const FETCH_TIMEOUT_MS = 30_000;");
    const { repo, side, head } = squashed(LIMITS, edited);
    const pin = hashRange(edited, { start: 2, end: 2 });
    writePage(repo, [{ lines: 2, integrity: pin, commit: side }]);

    const run = await updateIn(repo);

    expect(run.pages[0]?.rewritten[0]).toMatchObject({
      because: "not-in-history",
      fromCommit: side,
      toCommit: head,
    });
  });

  it("leaves a pin at an ancestor of HEAD alone", async () => {
    const { repo, head: ancestor } = squashed(LIMITS, LIMITS);
    writeFileSync(join(repo, "README.md"), "# r, later\n", "utf8");
    commitAll(repo, "later");
    const page = writePage(repo, [{ lines: 2, integrity: PIN_L2, commit: ancestor }]);

    const run = await updateIn(repo);

    expect(run).toMatchObject({ rewritten: 0, exitCode: 0 });
    expect(readFileSync(page, "utf8")).toContain(`commit-sha: ${ancestor}`);
  });

  it("leaves a pin alone when HEAD does not hold its lines", async () => {
    // The branch raised the timeout and the trunk did not. The working tree
    // carries the branch's line uncommitted, so the entry is current, and HEAD
    // still cannot support it.
    const edited = LIMITS.replace(TIMEOUT_LINE, "export const FETCH_TIMEOUT_MS = 30_000;");
    const { repo, side } = squashed(edited, LIMITS);
    writeFileSync(join(repo, "src", "limits.ts"), edited, "utf8");
    const pin = hashRange(edited, { start: 2, end: 2 });
    const page = writePage(repo, [{ lines: 2, integrity: pin, commit: side }]);

    const run = await updateIn(repo);

    expect(run).toMatchObject({ rewritten: 0, exitCode: 0 });
    expect(readFileSync(page, "utf8")).toContain(`commit-sha: ${side}`);
  });

  it("leaves it alone in a shallow clone, and says why once", async () => {
    const { repo, side } = squashed(LIMITS, LIMITS);
    const holder = mkdtempSync(join(tmpdir(), "docmeta-shallow-"));
    dirs.push(holder);
    const clone = join(holder, "clone");
    execFileSync("git", ["clone", "-q", "--depth", "1", pathToFileURL(repo).href, clone], {
      stdio: "ignore",
    });
    // Two entries, so a notice said per entry would show.
    const page = writePage(clone, [
      { lines: 2, integrity: PIN_L2, commit: side },
      { lines: 2, integrity: PIN_L2, commit: side },
    ]);
    const notices: string[] = [];

    const run = await updateIn(clone, notices);

    expect(run).toMatchObject({ rewritten: 0, exitCode: 0 });
    expect(readFileSync(page, "utf8")).toContain(`commit-sha: ${side}`);
    expect(notices.filter((notice) => notice === SHALLOW_RECOMMIT)).toHaveLength(1);
  });

  it("says nothing about shallowness in a full clone", async () => {
    const { repo, side } = squashed(LIMITS, LIMITS);
    writePage(repo, [{ lines: 2, integrity: PIN_L2, commit: side }]);
    const notices: string[] = [];

    await updateIn(repo, notices);

    expect(notices).not.toContain(SHALLOW_RECOMMIT);
  });
});
