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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runUpdate } from "../../src/cite/commands/update.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { noGit } from "../../src/cite/core/git.js";
import { CiteError } from "../../src/cite/errors.js";
import type { UpdateOptions, UpdateRun } from "../../src/cite/types.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

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

  it("leaves a commit git cannot read alone, so a shallow clone degrades", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    commitAll(repo, "add limits");
    const absent = "dec0de".repeat(6) + "abcd";
    const page = writePage(repo, [{ lines: 2, integrity: PIN_L2, commit: absent }]);

    const run = await update(repo);

    expect(run).toMatchObject({ rewritten: 0, exitCode: 0 });
    expect(readFileSync(page, "utf8")).toContain(`commit-sha: ${absent}`);
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
