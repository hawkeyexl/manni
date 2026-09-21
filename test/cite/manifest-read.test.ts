/**
 * `ManifestSet.hold` reads the manifest off the disk, every run.
 *
 * `meta` keeps one parse of a manifest per path, `mtimeMs` and size, so that a
 * suite running one command many times over one corpus parses it once. That
 * cache must not reach this module. `hold` is the read a write is built on:
 * cite splices the bytes it read and writes the result back, and a compare of
 * those bytes against the file is what tells it another process got there
 * first. Served a cached parse, that comparison would answer about a file
 * nobody had looked at, and the other process's entry would be overwritten
 * with no sign anything had happened.
 *
 * The manifest below is replaced by a same-length edit whose `mtimeMs` is put
 * back to what it was, which is the one case the stat cannot see. `meta` is
 * asked for the same file in the same process, and answers from its cache.
 * `hold` reads the new bytes anyway.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExternalMetadata } from "../../src/meta/index.js";
import { ManifestSet } from "../../src/cite/core/manifest.js";
import type { CollectionConfig } from "../../src/shared/collections.js";

/** Two manifests of exactly the same byte length. */
const ALPHA = `pages/one.md:\n  owner: alpha\n`;
const BRAVO = `pages/one.md:\n  owner: bravo\n`;

/** Stamped rather than taken from the clock, so both writes carry it exactly. */
const WHEN = new Date(1_700_000_000_000);

let root: string;
let path: string;
let collections: CollectionConfig[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "manni-cite-manifest-"));
  path = join(root, "meta.yaml");
  mkdirSync(join(root, "pages"), { recursive: true });
  writeFileSync(path, ALPHA);
  utimesSync(path, WHEN, WHEN);
  collections = [
    {
      name: "site",
      paths: ["pages/**/*.md"],
      externalMetadata: [{ file: "./meta.yaml", keys: ["owner"] }],
    } as CollectionConfig,
  ];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const ownerOf = async (): Promise<unknown> => {
  const index = await loadExternalMetadata(collections, { configDir: root, base: root });
  return index?.byPath.get(join(root, "pages", "one.md"))?.get("owner")?.value;
};

describe("ManifestSet.hold", () => {
  it("reads the file, never a parse another command cached", async () => {
    expect(await ownerOf()).toBe("alpha");

    // Another process rewrites the entry. Same length, and the timestamp is
    // stamped back to what it was, so nothing a stat can see has changed.
    writeFileSync(path, BRAVO);
    utimesSync(path, WHEN, WHEN);

    // The cached parse is exactly as stale as it can get...
    expect(await ownerOf()).toBe("alpha");

    // ...and the read a write compares against is not served from it.
    const held = await new ManifestSet().hold({
      collection: "site",
      path,
      file: "meta.yaml",
      join: "path",
    });
    expect(held.before).toBe(BRAVO);
    expect(held.text).toBe(BRAVO);
  });
});
