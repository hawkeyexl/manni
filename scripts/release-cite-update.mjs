/**
 * semantic-release plugin: re-anchor the docs' citations to the release.
 *
 * Runs in `prepare`, after `@semantic-release/changelog` has prepended the new
 * section and before `@semantic-release/git` commits. `site.metadata.yaml` is
 * in that plugin's `assets`, so the `chore(release): X.Y.Z` commit carries the
 * re-anchored pins.
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
 * What an exit code from `manni cite update` means for the release.
 *
 * - `0`: everything it found, it fixed. Writing nothing is the common case and
 *   is this code too.
 * - `1`: it rewrote what had moved and left a finding it cannot fix on its own,
 *   a reworded claim being the usual one. The release continues. The pins that
 *   moved are still re-anchored in the commit, and a changed claim is a docs
 *   bug that `cite check` already reports on every pull request, so failing
 *   here would block a publish over something `main` was merged with.
 * - anything else: the update did not run. Exit 2 is operational — no config,
 *   no git history, no build — and a null status is a signal or a failed spawn.
 *   Nothing was re-anchored, so the release commit would carry stale pins and
 *   hand the drift to every open branch anyway. This step is in `prepare`,
 *   before `publish`, so failing here publishes nothing.
 */
export function verdict(status) {
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
  });

  // The command's own report is the record of what moved, so it goes to the
  // release log whichever way the run went.
  if (run.stdout) (stdout ?? process.stdout).write(run.stdout);
  if (run.stderr) (stderr ?? process.stderr).write(run.stderr);

  const { fail, message } = verdict(run.status);
  if (fail) {
    throw new Error(message, { cause: run.error });
  }
  if (message) {
    logger.log(message);
    return;
  }
  logger.log("Re-anchored the docs' citations");
}
