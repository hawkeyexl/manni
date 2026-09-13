/**
 * Rewrite every stale version pin copied into the docs.
 *
 * The fix `npm run docs:check-versions` names. It changes the version text of
 * each stale pin and nothing else on the line, so a trailing comment, a quote
 * and CRLF line endings all survive. The release runs the same rewrite through
 * `scripts/release-sync-versions.mjs`; the rules live in
 * `scripts/version-pins.mjs`.
 *
 * Usage:
 *   node scripts/sync-versions.mjs [root]
 * Exit 0 = written (or already current), 2 = setup error.
 */
import { REPO_ROOT, VersionsSetupError, plural, syncVersions } from "./version-pins.mjs";

const root = process.argv[2] ?? REPO_ROOT;

let result;
try {
  result = syncVersions(root);
} catch (err) {
  if (!(err instanceof VersionsSetupError)) throw err;
  console.error(`versions: ${err.message}`);
  process.exit(2);
}

for (const edit of result.edits) {
  console.log(`${edit.file}:${edit.line}: ${edit.before} -> ${edit.after}`);
}

console.log(
  result.edits.length === 0
    ? "versions: all pins current"
    : `versions: ${plural(result.edits.length, "pin")} updated in ${plural(result.files, "file")}`,
);
