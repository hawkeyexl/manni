/**
 * Every read behind a manifest write is a read of the file, not a parse
 * `meta` cached.
 *
 * `meta` keeps one parse of a manifest per path, `mtimeMs` and size, so a
 * process that runs one command many times over one corpus parses it once.
 * That cache must not reach this module. `commit()` re-reads each manifest
 * immediately before replacing it, and compares what it finds against the
 * bytes the run spliced from: that comparison is the whole of the
 * compare-and-swap that stops two concurrent commands losing each other's
 * citations. Served a cached parse, it would compare against bytes nobody had
 * looked at, find them equal, and write over the other command's entry with
 * no sign anything had happened.
 *
 * The manifest below is rewritten by a same-length edit whose `mtimeMs` is
 * stamped back to what it was, which is the one change a stat cannot see.
 * `meta` is asked for the same file in the same process and answers from its
 * cache. The commit re-reads the file anyway, sees the concurrent entry,
 * replays onto it, and both entries survive.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExternalMetadata } from "../../src/meta/index.js";
import { ManifestSet } from "../../src/cite/core/manifest.js";
import type { CitationManifest } from "../../src/cite/core/sidecar.js";
import type { CollectionConfig } from "../../src/shared/collections.js";

/** Two manifests of exactly the same byte length. */
const ORIGINAL = `pages/one.md:
  citations:
    - id: aaa
pages/two.md:
  citations:
    - id: bbb
`;
const CONCURRENT = ORIGINAL.replace("id: bbb", "id: ccc");

/** Stamped rather than taken from the clock, so both writes carry it exactly. */
const WHEN = new Date(1_700_000_000_000);

let root: string;
let path: string;
let manifest: CitationManifest;
let collections: CollectionConfig[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "manni-cite-manifest-"));
  path = join(root, "meta.yaml");
  mkdirSync(join(root, "pages"), { recursive: true });
  writeFileSync(path, ORIGINAL);
  utimesSync(path, WHEN, WHEN);
  manifest = { collection: "site", path, file: "meta.yaml", join: "path" };
  collections = [
    {
      name: "site",
      paths: ["pages/**/*.md"],
      externalMetadata: [{ file: "./meta.yaml", keys: ["citations"] }],
    } as CollectionConfig,
  ];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** What `meta` says one page's citations are, through the cache it keeps. */
const citationsOf = async (page: string): Promise<string> => {
  const index = await loadExternalMetadata(collections, { configDir: root, base: root });
  const abs = join(root, ...page.split("/"));
  return JSON.stringify(index?.byPath.get(abs)?.get("citations")?.value ?? null);
};

describe("the compare-and-swap write", () => {
  it("re-reads the file, and a cached parse never stands in for it", async () => {
    expect(await citationsOf("pages/two.md")).toBe('[{"id":"bbb"}]');

    const set = new ManifestSet();
    await set.write(manifest, "pages/one.md", [{ id: "zzz" }], 0);

    // Another command rewrites a different entry while this run works. Same
    // length, and the timestamp is stamped back, so nothing a stat can see
    // has changed.
    writeFileSync(path, CONCURRENT);
    utimesSync(path, WHEN, WHEN);

    // `meta`'s parse of this file is now as stale as it can get...
    expect(await citationsOf("pages/two.md")).toBe('[{"id":"bbb"}]');

    // ...and the commit's re-read is not served from it. It finds the
    // concurrent entry, replays this run's splice onto what it found, and
    // writes both. A cached read would have compared equal and written the
    // other command's entry away.
    await set.commit();
    const landed = readFileSync(path, "utf8");
    expect(landed).toContain("id: ccc");
    expect(landed).toContain("id: zzz");

    // And that write dropped the cached parse, so the next read is of what
    // landed rather than of what the run started from.
    expect(await citationsOf("pages/two.md")).toBe('[{"id":"ccc"}]');
    expect(await citationsOf("pages/one.md")).toBe('[{"id":"zzz"}]');
  });

  it("reads the file in hold(), which is the base the compare is against", async () => {
    expect(await citationsOf("pages/two.md")).toBe('[{"id":"bbb"}]');

    writeFileSync(path, CONCURRENT);
    utimesSync(path, WHEN, WHEN);
    expect(await citationsOf("pages/two.md")).toBe('[{"id":"bbb"}]');

    const held = await new ManifestSet().hold(manifest);
    expect(held.before).toBe(CONCURRENT);
    expect(held.text).toBe(CONCURRENT);
  });
});
