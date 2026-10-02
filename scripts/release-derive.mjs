/**
 * semantic-release plugin: re-stamp the docs' derived fields for the release.
 *
 * Runs in `prepare`, after `release-sync-versions.mjs` has rewritten the
 * install pins and before `@semantic-release/git` commits. The pages and the
 * manifests beside them, `<page>.meta.yaml`, are in that plugin's `assets`, so
 * the `chore(release): X.Y.Z` commit carries stamps that agree with it.
 *
 * A pin rewritten in a page is a body change, so the page's `last-updated`
 * and `provenance` stop agreeing with git the moment the sync runs. Without
 * this step `meta validate` failed on main after 3.0.0 and again after 4.0.0,
 * and every branch open at the time inherited the red until someone ran
 * `manni meta derive` and committed the result.
 *
 * The run is before the commit, so the rewritten bodies are uncommitted and
 * dated by the runner's clock. The release commit is made seconds later in
 * the same UTC day, so the stamps and the commit agree. It runs before the
 * citation update, because a stamp written into a page's frontmatter can move
 * the lines a citation pins, and the update has to see the final file.
 *
 * It runs on a prerelease too. The version sync skips one and leaves the
 * bodies alone, so derive finds nothing to change, and a page left stale by
 * some other route is no better committed stale on `next` than on `main`.
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
 * No paths, so the run covers the pages `derive.collections` names in
 * `manni.config.yaml`, and the sources it lists (git and CODEOWNERS), which
 * need no network. Writing, so neither `--dry-run` nor `--check`.
 */
export const DERIVE_ARGS = ["meta", "derive"];

/**
 * How long `manni meta derive` may take before the step gives up on it.
 *
 * The same bound and the same reasoning as `release-cite-update.mjs`: a hang
 * here stalls the job with nothing committed or published and no error to
 * repeat, and derive reads every page's history through git, which is how it
 * would stop making progress. Over this repo's 134 pages it took 21s on a
 * Windows laptop, where each git call costs most.
 */
export const TIMEOUT_MS = 120_000;

/**
 * What an outcome of `manni meta derive` means for the release.
 *
 * - `0`: every stale stamp was rewritten. Writing nothing is the common case
 *   on a prerelease and is this code too.
 * - `1`: some pages could not be stamped. The release continues with the rest
 *   re-stamped. `meta validate` reports the remainder on every pull request,
 *   so failing here would block a publish over something main was merged with.
 * - anything else: the run did not complete. Exit 2 is operational (no config,
 *   no history, no source), a timeout is a git operation that stopped making
 *   progress, and a null status without one is a signal or a failed spawn.
 *   This step runs in `prepare`, before `publish`, so failing here publishes
 *   nothing.
 */
export function verdict(status, timedOut = false) {
  if (timedOut) {
    return {
      fail: true,
      message:
        `manni meta derive did not finish within ${String(TIMEOUT_MS / 1000)}s and was stopped, ` +
        "so no page was re-stamped and nothing was committed or published. " +
        "It reads history through git, so check the checkout for a stale index lock.",
    };
  }
  if (status === 0) return { fail: false };
  if (status === 1) {
    return {
      fail: false,
      message:
        "manni meta derive re-stamped what it could, and some pages were not stamped. " +
        "The release carries the rest; run `manni meta validate` to see them.",
    };
  }
  const how = status === null ? "did not exit on its own" : `exited ${String(status)}`;
  return {
    fail: true,
    message: `manni meta derive ${how}, so no page was re-stamped.`,
  };
}

/**
 * The line this step leaves in the release log, taken from derive's own
 * summary, its last line: `N files, M changed, K fields written`.
 */
export function summarize(stdout) {
  const lines = (stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const summary = lines.at(-1);
  if (summary === undefined) return "manni meta derive printed no summary";
  return /^\d+ files?, 0 changed, 0 fields written$/.test(summary)
    ? "No page's stamps moved; the docs' derived fields are current"
    : summary;
}

export async function prepare(_pluginConfig, context) {
  const { logger, cwd, stdout, stderr } = context;
  const root = cwd ?? process.cwd();

  // The release workflow builds before it runs semantic-release. Say which
  // file is missing rather than let node report a module it cannot resolve.
  if (!existsSync(join(root, BIN))) {
    throw new Error(`Derived fields could not be re-stamped: ${BIN} is not built.`);
  }

  const run = spawnSync(process.execPath, [BIN, ...DERIVE_ARGS], {
    cwd: root,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });

  // Derive's own report is the record of what moved, so it goes to the
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
