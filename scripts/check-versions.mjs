/**
 * Drift-check for the version pins copied into the docs.
 *
 * A reader copies `uses: hawkeyexl/manni@v2`, `npx @hawkeyexl/manni@2`, a
 * pre-commit `rev:`, `actions/checkout@v7` or `node-version: 24` out of a
 * snippet, and each of those was typed by hand. They went stale without anyone
 * noticing: 16 snippets still said `@v0` while npm served 2.0.0, and the
 * third-party pins lagged the repo's own workflows by three majors.
 *
 * The release keeps them current (`scripts/release-sync-versions.mjs`). This
 * catches the rest, and above all a Dependabot PR that bumps an action in a
 * workflow: it goes red here, and the message names the command that fixes it
 * in that same PR. The rules live in `scripts/version-pins.mjs`.
 *
 * A prerelease version stands the check down, on the same rule the release
 * plugin skips on (`isPrerelease`, shared from `version-pins.mjs`). A
 * `feat/**` branch publishes to a prerelease channel, so its `chore(release):`
 * commit leaves `2.9.0-cite-marker-ids.1` in package.json while the docs still
 * pin the stable version. The plugin refuses to rewrite them, so this cannot
 * ask that it has. Before that, every feat branch was permanently red here
 * from its first prerelease on, through no fault of its author.
 *
 * Usage:
 *   node scripts/check-versions.mjs [root]
 * Exit 0 = all current (or skipped), 1 = a pin is stale, 2 = setup error.
 */
import {
  REPO_ROOT,
  VersionsSetupError,
  declaredVersion,
  isPrerelease,
  plural,
  scanVersions,
} from "./version-pins.mjs";

const root = process.argv[2] ?? REPO_ROOT;

// Said out loud rather than exited on quietly: a green log has to show that the
// check stood down, and which version made it.
const version = declaredVersion(root);
if (isPrerelease(version)) {
  console.log(
    `versions: skipped, package.json is the prerelease ${version}; the release syncs pins to stable versions only`,
  );
  process.exit(0);
}

let scanned;
try {
  scanned = scanVersions(root);
} catch (err) {
  if (!(err instanceof VersionsSetupError)) throw err;
  console.error(`versions: ${err.message}`);
  process.exit(2);
}

let checked = 0;
let stale = 0;
for (const { file, pins } of scanned) {
  for (const pin of pins) {
    checked += 1;
    if (!pin.stale) continue;
    stale += 1;
    console.error(
      `${file}:${pin.line}: ${pin.before} — ${pin.reason}; run npm run docs:sync-versions`,
    );
  }
}

if (stale > 0) {
  console.error(`versions: ${plural(checked, "pin")} checked, ${stale} stale`);
  process.exit(1);
}

console.log(`versions: ${plural(checked, "pin")} checked, all current`);
