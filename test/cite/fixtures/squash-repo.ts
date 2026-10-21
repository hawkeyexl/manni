/**
 * A repository a squash merge has passed through, built at test time
 * (proposal 0097). No `.git` is committed: a nested repository would arrive
 * on CI as an empty directory, and the test would pass for the wrong reason.
 *
 * `docs/page.md` pins `src/limits.ts:10-14`. The pin was minted on `feature`,
 * which was squash-merged onto the trunk as `squash`. The branch was then
 * deleted and pruned, so the mint commit is gone, as it is from a fresh clone
 * once the host deletes a merged branch.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashRange } from "../../../src/cite/core/hash.js";
import { commitAll, git, makeTempRepo, replaySquash, writeFile } from "../../helpers/temp-repo.js";

export const SOURCE_PATH = "src/limits.ts";

/** Twenty numbered lines; the branch rewrites 10-14, the pinned span. */
export function sourceText(edit: (n: number) => string | undefined = () => undefined): string {
  const lines: string[] = [];
  for (let n = 1; n <= 20; n++) lines.push(edit(n) ?? `export const LINE_${String(n)} = ${String(n)};`);
  return `${lines.join("\n")}\n`;
}

/** What the branch wrote at lines 10-14: the text the pin covers. */
export function minted(n: number): string | undefined {
  return n >= 10 && n <= 14 ? `export const LIMIT_${String(n)} = ${String(n * 100)};` : undefined;
}

export const MINTED = sourceText(minted);
export const PIN = hashRange(MINTED, { start: 10, end: 14 });

/** The page, pinning the source at `commit`. */
export function pageText(commit: string, integrity = PIN, file = SOURCE_PATH): string {
  return [
    "---",
    "citations:",
    "  - id: limits-default",
    "    source:",
    `      file: ${file}`,
    "      lines: 10-14",
    `      integrity: ${integrity}`,
    `      commit-sha: ${commit}`,
    "---",
    "The limits are set in hundreds.",
    "",
  ].join("\n");
}

/** Identity, signing and hooks pinned, so a machine's git config cannot leak in. */
export function gitAs(dir: string, args: string[]): string {
  const noHooks = mkdtempSync(join(tmpdir(), "docmeta-nohooks-"));
  try {
    return execFileSync(
      "git",
      [
        "-c", "user.name=t",
        "-c", "user.email=t@example.invalid",
        "-c", "commit.gpgsign=false",
        "-c", "core.autocrlf=false",
        "-c", `core.hooksPath=${noHooks}`,
        ...args,
      ],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } finally {
    rmSync(noHooks, { recursive: true, force: true });
  }
}

/** Delete `branch` and drop every object only it reached. */
export function deleteAndPrune(repo: string, branch: string): void {
  git(repo, ["branch", "-q", "-D", branch]);
  git(repo, ["reflog", "expire", "--expire=now", "--all"]);
  git(repo, ["gc", "-q", "--prune=now"]);
}

/** Whether the repository still has `commit`. */
export function hasCommit(repo: string, commit: string): boolean {
  try {
    git(repo, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export interface SquashRepo {
  repo: string;
  trunk: string;
  /** The branch commit the pin was minted at, now pruned. */
  mint: string;
  /** The squash commit the trunk took instead. */
  squash: string;
}

/** The trunk, a branch that minted the pin, its squash, and the prune. */
export function squashRepo(): SquashRepo {
  const repo = makeTempRepo({ files: { [SOURCE_PATH]: sourceText(), "README.md": "# r\n" } });
  commitAll(repo, "start");
  const trunk = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  git(repo, ["checkout", "-q", "-b", "feature"]);
  writeFile(repo, SOURCE_PATH, MINTED);
  const mint = commitAll(repo, "set the limits");
  const squash = replaySquash(repo, {
    branch: "feature",
    onto: trunk,
    authorDate: "2026-10-01T12:00:00+00:00",
    message: "set the limits (#1)",
  });
  deleteAndPrune(repo, "feature");
  writeFile(repo, "docs/page.md", pageText(mint));
  return { repo, trunk, mint, squash };
}
