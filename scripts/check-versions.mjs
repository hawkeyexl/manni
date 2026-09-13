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
 * Usage:
 *   node scripts/check-versions.mjs [root]
 * Exit 0 = all current, 1 = a pin is stale, 2 = setup error.
 */
import { REPO_ROOT, VersionsSetupError, plural, scanVersions } from "./version-pins.mjs";

const root = process.argv[2] ?? REPO_ROOT;

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
