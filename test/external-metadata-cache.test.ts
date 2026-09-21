/**
 * The parsed-manifest cache (a performance defect, and the two correctness
 * rules that bound the fix).
 *
 * `loadExternalMetadata` is called once per command, and a suite that runs one
 * command sixteen times over the same corpus read and parsed the same manifest
 * sixteen times. At this repository's manifest size that parse is almost the
 * whole cost of such a run.
 *
 * One parse is now kept per manifest, keyed on the file's absolute path, its
 * `mtimeMs` and its size, alongside the declaration it was read under — a
 * manifest named by two collections, or joined on two different fields, parses
 * once for each, because the parse's result differs.
 *
 * `mtimeMs` plus size cannot see a same-size edit written inside one clock
 * tick. So the stat is a backstop, not the mechanism: `writeFileAtomic` drops
 * the entry for the path it wrote, and that is what makes a write visible to
 * the next read in the same process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runValidate } from "../src/meta/commands/validate.js";
import { writeFileAtomic } from "../src/meta/core/write-file.js";

/** Every path `node:fs/promises` was asked to read, in order. */
const { reads } = vi.hoisted(() => ({ reads: [] as string[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = (...args: unknown[]): unknown => {
    reads.push(String(args[0]));
    const original = actual.readFile as (...a: unknown[]) => unknown;
    return original(...args);
  };
  return { ...actual, readFile };
});

const CONFIG = `collections:
  - name: site
    paths: ["docs/**/*.md"]
    externalMetadata:
      - file: ./meta.yaml
        keys: [owner]

meta:
  overrides:
    - collection: site
      schemas:
        - ./owner.schema.json
`;

const SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "owner": { "const": "alpha" } },
  "required": ["owner"]
}
`;

/** Two manifests of exactly the same byte length, one of which validates. */
const ALPHA = `docs/one.md:\n  owner: alpha\n`;
const BRAVO = `docs/one.md:\n  owner: bravo\n`;

let root: string;
let manifest: string;

beforeEach(() => {
  reads.length = 0;
  root = mkdtempSync(join(tmpdir(), "manni-manifest-cache-"));
  manifest = join(root, "meta.yaml");
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "manni.config.yaml"), CONFIG);
  writeFileSync(join(root, "owner.schema.json"), SCHEMA);
  writeFileSync(manifest, ALPHA);
  writeFileSync(join(root, "docs", "one.md"), "---\ntitle: One\n---\n\nBody.\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** How many times the manifest itself was read off the disk. */
const manifestReads = (): number => reads.filter((p) => p === manifest).length;

describe("the parsed-manifest cache", () => {
  it("reads one manifest once across repeated runs, not once per run", async () => {
    const first = await runValidate({ inputs: [], cwd: root });
    expect(first.results).toHaveLength(1);
    expect(first.results[0]?.errors).toEqual([]);
    expect(manifestReads()).toBe(1);

    await runValidate({ inputs: [], cwd: root });
    await runValidate({ inputs: [], cwd: root });
    await runValidate({ inputs: [], cwd: root });

    expect(manifestReads()).toBe(1);
  });

  it("re-reads a manifest a write in this process changed", async () => {
    const before = await runValidate({ inputs: [], cwd: root });
    expect(before.results[0]?.errors).toEqual([]);

    // The normal write path, and a replacement of exactly the same length as
    // what it replaces: `mtimeMs` and size cannot tell the two apart, so only
    // the invalidation the write performs can.
    await writeFileAtomic(manifest, BRAVO);

    const after = await runValidate({ inputs: [], cwd: root });
    const errors = after.results[0]?.errors ?? [];
    expect(errors).toHaveLength(1);
    expect(errors[0]?.instancePath).toBe("/owner");
    expect(manifestReads()).toBe(2);
  });
});
