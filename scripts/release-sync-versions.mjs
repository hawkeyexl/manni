/**
 * semantic-release plugin: sync the docs' version pins to the release.
 *
 * Runs in `prepare`, after `@semantic-release/npm` has written the new version
 * and before `@semantic-release/git` commits. The scanned files are in git's
 * `assets`, so the `chore(release): X.Y.Z` commit and the tag on it already
 * carry the numbers that release makes true. Without this, every release made
 * the docs wrong, and the check in CI only found out on the next PR.
 *
 * It syncs to `nextRelease.version` rather than reading package.json, so it
 * does not depend on the npm plugin having run first.
 *
 * A prerelease is skipped. A `next` or `feat/**` build publishes to a channel,
 * and rewriting the stable docs to `2.1.0-next.1` would point every reader at
 * a version `latest` does not serve.
 *
 * semantic-release resolves a plugin given as a path against the working
 * directory and imports it. With no default export it uses the named exports,
 * so this exports `prepare` and nothing else a lifecycle step would call.
 */
import { REPO_ROOT, plural, syncVersions } from "./version-pins.mjs";

export async function prepare(_pluginConfig, context) {
  const { nextRelease, logger } = context;
  const { version } = nextRelease;

  if (version.includes("-") || nextRelease.channel) {
    logger.log(`Skipped version sync for prerelease ${version}`);
    return;
  }

  const { edits, files } = syncVersions(context.cwd ?? REPO_ROOT, { version });
  logger.log(
    `Synced ${plural(edits.length, "version pin")} in ${plural(files, "file")} for ${version}`,
  );
}
