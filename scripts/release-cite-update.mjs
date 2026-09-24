/**
 * semantic-release plugin: re-anchor the docs' citations to the release.
 *
 * Runs in `prepare`, after `@semantic-release/changelog` has prepended the new
 * section and before `@semantic-release/git` commits. Each page's manifest,
 * `<page>.citations.yaml` beside it, is in that plugin's `assets` by glob, so
 * the `chore(release): X.Y.Z` commit carries the re-anchored pins.
 *
 * Two pages cite `CHANGELOG.md` for what changed in 1.0, and semantic-release
 * prepends to that file on every release. So every release moved both pins,
 * and every branch open at the time went red on `docs-as-tests` at its next
 * push, each needing a merge and a `cite update` producing the same four-line
 * diff. Doing it here is the only point where the new changelog exists on disk
 * and the release commit has not been made yet.
 *
 * It runs on a prerelease too, unlike the version sync beside it. That one
 * skips a prerelease because rewriting the stable docs to `2.1.0-next.1` would
 * point readers at a version `latest` does not serve. A citation names no
 * version: it pins lines in a file, and `next` and `feat/**` prepend to the
 * same changelog and make the same release commit, so their pins move exactly
 * as `main`'s do.
 *
 * The update is plain — never `--accept`. A plain update shifts a moved pin's
 * recorded lines and cannot mis-pin; `--accept` re-mints over whatever occupies
 * a line, and a release is the worst place to do that unwatched.
 *
 * semantic-release resolves a plugin given as a path against the working
 * directory and imports it. With no default export it uses the named exports,
 * so `prepare` is the only lifecycle step this exports.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BIN = join("dist", "cli.js");

/**
 * How long `manni cite update` may take before the step gives up on it.
 *
 * A release step that hangs is worse than one that fails. By the time this
 * runs the changelog is written and the version bumped, and nothing is
 * committed or published yet, so a hang stalls the job at its least legible
 * moment: no commit, no tag, no npm release, and no error to repeat. `cite
 * update` resolves every source through git, so a stale `index.lock` or a
 * half-finished operation in the checkout is the realistic way it stops making
 * progress, and no amount of waiting fixes either.
 *
 * Measured over this repo's corpus of 4,143 citations: 2.5s for a run that
 * moves nothing, 5.0s for one that re-anchors the two changelog pins, the git
 * re-mint included. Sixty seconds is an order of magnitude above the slower of
 * those, which leaves room for a cold runner and for the corpus to grow
 * several times over before the number needs another look.
 *
 * It is also small enough to change nothing about the job's budget.
 * `release.yml` runs on `timeout-minutes: 20` and spends up to ten of them
 * polling npm after the publish, against a release step that reached that poll
 * five minutes in, so about four minutes are spare. A minute of
 * hang-detection keeps that spare; a longer bound would eat it, and a
 * cancelled job reports nothing at all.
 *
 * `release-sync-versions.mjs` has no bound and keeps none here. It rewrites
 * files and talks to no other process, so it does not hang the way a git
 * operation does; giving it one is its own change.
 */
export const TIMEOUT_MS = 60_000;

/**
 * What an outcome of `manni cite update` means for the release.
 *
 * - `0`: everything it found, it fixed. Writing nothing is the common case and
 *   is this code too.
 * - `1`: it rewrote what had moved and left a finding it cannot fix on its own,
 *   a reworded claim being the usual one. The release continues. The pins that
 *   moved are still re-anchored in the commit, and a changed claim is a docs
 *   bug that `cite check` already reports on every pull request, so failing
 *   here would block a publish over something `main` was merged with.
 * - anything else: the update did not run to completion. Exit 2 is operational
 *   (no config, no git history, no build), a timeout is a git operation that
 *   stopped making progress, and a null status without one is a signal or a
 *   failed spawn. Nothing was re-anchored, so the release commit would carry
 *   stale pins and hand the drift to every open branch anyway. This step runs
 *   in `prepare`, before `publish`, so failing here publishes nothing.
 */
export function verdict(status, timedOut = false) {
  if (timedOut) {
    return {
      fail: true,
      message:
        `manni cite update did not finish within ${String(TIMEOUT_MS / 1000)}s and was stopped, ` +
        "so no citation was re-anchored and nothing was committed or published. " +
        "It resolves sources through git, so check the checkout for a stale index lock.",
    };
  }
  if (status === 0) return { fail: false };
  if (status === 1) {
    return {
      fail: false,
      message:
        "manni cite update rewrote what had moved and left findings it cannot fix on its own. " +
        "The release carries the re-anchored pins; run `manni cite check` to see the rest.",
    };
  }
  const how = status === null ? "did not exit on its own" : `exited ${String(status)}`;
  return {
    fail: true,
    message: `manni cite update ${how}, so no citation was re-anchored.`,
  };
}

/**
 * The line this step leaves in the release log, taken from the command's own
 * report rather than counted again here.
 *
 * `cite update` prints a config notice, then one line per rewrite, then a
 * one-line summary: `N citations rewritten in M files, K skipped`. The summary
 * is the last of those and is the whole of what a release log needs.
 *
 * Most releases move nothing, so the quiet path is the common one and says so
 * in words. Saying the citations were re-anchored on a run that re-anchored
 * none describes what the step is for, which is no use to someone scanning a
 * log afterwards for what a release actually did.
 */
export function summarize(stdout) {
  const lines = (stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const summary = lines.at(-1);
  if (summary === undefined) return "manni cite update printed no summary";
  // Only an entirely empty run is quiet: a run that rewrote nothing but
  // skipped something has something to report, and reports it verbatim.
  return /^0 citations? rewritten in 0 files, 0 skipped$/.test(summary)
    ? "No citation moved; the docs' pins are current"
    : summary;
}

export async function prepare(_pluginConfig, context) {
  const { logger, cwd, stdout, stderr } = context;
  const root = cwd ?? process.cwd();

  // The release workflow builds before it runs semantic-release. Say which
  // file is missing rather than let node report a module it cannot resolve.
  if (!existsSync(join(root, BIN))) {
    throw new Error(`Citations could not be re-anchored: ${BIN} is not built.`);
  }

  const run = spawnSync(process.execPath, [BIN, "cite", "update"], {
    cwd: root,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });

  // The command's own report is the record of what moved, so it goes to the
  // release log whichever way the run went.
  if (run.stdout) (stdout ?? process.stdout).write(run.stdout);
  if (run.stderr) (stderr ?? process.stderr).write(run.stderr);

  const { fail, message } = verdict(run.status, run.error?.code === "ETIMEDOUT");
  if (fail) {
    throw new Error(message, { cause: run.error });
  }
  logger.log(summarize(run.stdout));
  if (message) logger.log(message);
}
