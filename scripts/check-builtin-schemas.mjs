/**
 * Immutability check for the published built-in schemas.
 *
 * manni serves each built-in from the docs site at a version-pinned URL, and
 * the value of a pinned URL is that its content never changes. Nothing else
 * stops a PR editing `src/meta/schemas/okf/0.1.json`, which would silently change the
 * contract for every external consumer of that URL — including consumers who
 * never upgraded manni at all. This repo has already done that once
 * (`f7e611b fix(schemas): require type on the Diataxis vocabulary`), which was
 * defensible for a bundled schema and would not be for a published one.
 *
 * So: `src/meta/schemas/manifest.json` records `sha256-<hex>` over each file's exact
 * bytes, and this asserts that
 *
 *   - no **existing** entry's hash has changed;
 *   - no entry has lost its source file (a published URL must not start 404ing);
 *   - every source file is recorded (adding an entry is free — run the sync);
 *   - `docs/public/schemas/**` is byte-identical to `src/meta/schemas/**`.
 *
 * Usage:
 *   node scripts/check-builtin-schemas.mjs
 * Exit 0 = in sync, 1 = drift found, 2 = setup error.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "meta", "schemas");
const PUBLIC = path.join(ROOT, "docs", "public", "schemas");
const MANIFEST = path.join(SRC, "manifest.json");

/** Every `<dir>/<file>.json` under `base`, posix-keyed. Missing dir = []. */
function jsonKeys(base) {
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return null;
  }
  const keys = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const file of readdirSync(path.join(base, entry.name))) {
      if (file.endsWith(".json")) keys.push(`${entry.name}/${file}`);
    }
  }
  return keys.sort();
}

const bytesOf = (base, key) => readFileSync(path.join(base, ...key.split("/")));
const hashOf = (bytes) =>
  `sha256-${createHash("sha256").update(bytes).digest("hex")}`;

// ---------------------------------------------------------------------------
// 1. Setup — anything wrong here is exit 2, not a drift report.
// ---------------------------------------------------------------------------
const sourceKeys = jsonKeys(SRC);
if (!sourceKeys || sourceKeys.length === 0) {
  console.error(`schemas:check: found no built-in schemas under ${SRC}.`);
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (err) {
  console.error(
    `schemas:check: could not read src/meta/schemas/manifest.json — run \`npm run schemas:sync\` to create it.\n${err.message}`,
  );
  process.exit(2);
}
if (
  !manifest ||
  manifest.version !== 1 ||
  typeof manifest.schemas !== "object" ||
  manifest.schemas === null ||
  Array.isArray(manifest.schemas)
) {
  console.error(
    'schemas:check: src/meta/schemas/manifest.json is malformed — expected {"version": 1, "schemas": {"<dir>/<version>.json": "sha256-<hex>"}}.',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 2. Compare.
// ---------------------------------------------------------------------------
const problems = [];
const recorded = manifest.schemas;
const recordedKeys = Object.keys(recorded);

if (recordedKeys.join("\u0000") !== [...recordedKeys].sort().join("\u0000")) {
  problems.push(
    "manifest: keys are not sorted, which turns every addition into a merge conflict",
  );
}

// Existing entries: the hash may not change, and the file may not vanish.
for (const key of recordedKeys) {
  let bytes;
  try {
    bytes = bytesOf(SRC, key);
  } catch {
    problems.push(
      `manifest: \`${key}\` is recorded but src/meta/schemas no longer has it — its published URL would start 404ing`,
    );
    continue;
  }
  const found = hashOf(bytes);
  if (found !== recorded[key]) {
    problems.push(
      `immutability: \`${key}\` has changed since it was published\n      expected ${recorded[key]}\n      found    ${found}`,
    );
  }
}

// New source files need an entry; adding one is free.
for (const key of sourceKeys) {
  if (!(key in recorded)) {
    problems.push(`manifest: \`${key}\` is not recorded`);
  }
}

// The published copies.
const publicKeys = jsonKeys(PUBLIC);
if (!publicKeys) {
  problems.push(
    "published copies: docs/public/schemas does not exist, so the site serves nothing",
  );
} else {
  for (const key of sourceKeys) {
    if (!publicKeys.includes(key)) {
      problems.push(`published copies: \`${key}\` is missing from docs/public/schemas`);
      continue;
    }
    if (!bytesOf(PUBLIC, key).equals(bytesOf(SRC, key))) {
      problems.push(
        `published copies: \`${key}\` differs from src/meta/schemas — the site would serve a schema manni does not use`,
      );
    }
  }
  for (const key of publicKeys) {
    if (!sourceKeys.includes(key)) {
      problems.push(
        `published copies: \`${key}\` is served but has no source in src/meta/schemas`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Report.
// ---------------------------------------------------------------------------
if (problems.length === 0) {
  console.log(
    `schemas:check: ${sourceKeys.length} built-in schemas match the manifest and the published copies ✓`,
  );
  process.exit(0);
}
console.error("schemas:check: the published built-in schemas are out of sync:");
for (const p of problems.sort()) console.error(`  - ${p}`);
console.error(
  "\nMissing entries and stale copies are fixed by `npm run schemas:sync`. A CHANGED hash is not: " +
    "a published URL is immutable, so ship the fix as a new version file (`okf/0.2.json`) and leave " +
    "the published one alone. Then re-run `npm run schemas:check`.",
);
process.exit(1);
