/**
 * meta's writers on a `{page}` manifest (proposal 0058): `relocate` moves
 * each page's value into the page's own manifest, creating it, and pulls
 * values back out of every page's file; `keyHome`, which `fill`, `derive`
 * and `query` route through, names the page's own manifest; and `derive`
 * places a page's `provenance` there too. Each case runs on a private copy of
 * its fixture.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { relocateFailed, runRelocate } from "../src/meta/commands/relocate.js";
import { renderRelocate } from "../src/meta/reporters/relocate.js";
import { keyHome, relocationContext } from "../src/meta/core/relocation.js";
import { resolveRunConfig } from "../src/meta/core/config.js";
import { Validator } from "../src/meta/core/validator.js";
import { schemaLoadOptions } from "../src/meta/core/schema-registry.js";
import { provenanceManifests, provenancePlace } from "../src/meta/core/derive/provenance-place.js";
import type { CollectionConfig } from "../src/shared/collections.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "per-page");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-per-page-${name}-`));
  dirs.push(dir);
  cpSync(join(fixtures, name), dir, { recursive: true });
  return dir;
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");
const yamlOf = (dir: string, file: string): unknown => parseYaml(read(dir, file));
const pretty = (result: Awaited<ReturnType<typeof runRelocate>>): string =>
  renderRelocate(result, "pretty", { color: false });

describe("relocate: out of the pages, into a manifest per page", () => {
  it("moves each page's values into its own new file and empties the pages", async () => {
    const dir = copy("relocate-out");
    const result = await runRelocate({ inputs: [], cwd: dir });

    expect(pretty(result)).toBe(
      [
        "docs/a.md",
        "    owner      → docs/a.citations.yaml:2",
        "    citations  → docs/a.citations.yaml:3",
        "docs/b.md",
        "    citations  → docs/b.citations.yaml:2",
        "2 files, 3 values moved to 2 manifests",
      ].join("\n"),
    );
    expect(relocateFailed(result)).toBe(false);
    expect(yamlOf(dir, "docs/a.citations.yaml")).toEqual({
      "docs/a.md": { owner: "platform", citations: [{ id: "one", source: { file: "src/a.ts" } }] },
    });
    expect(yamlOf(dir, "docs/b.citations.yaml")).toEqual({
      "docs/b.md": { citations: [{ id: "two", source: { file: "src/b.ts" } }] },
    });
    expect(read(dir, "docs/a.md")).toBe("---\ntitle: A\n---\n# A\n");
    expect(read(dir, "docs/b.md")).toBe("---\ntitle: B\n---\n# B\n");
    // The config already declared the pattern, so it is not touched.
    expect(read(dir, "manni.config.yaml")).toBe(read(join(fixtures, "relocate-out"), "manni.config.yaml"));
  });

  it("names each page's own manifest under --dry-run, and writes nothing", async () => {
    const dir = copy("relocate-out");
    const result = await runRelocate({ inputs: [], cwd: dir, dryRun: true, fields: ["citations"] });
    expect(pretty(result)).toBe(
      [
        "docs/a.md",
        "    citations  → docs/a.citations.yaml",
        "docs/b.md",
        "    citations  → docs/b.citations.yaml",
        "2 files, 2 values would move to 2 manifests",
      ].join("\n"),
    );
    expect(existsSync(join(dir, "docs/a.citations.yaml"))).toBe(false);
  });

  it("creates a mirrored manifest's directory", async () => {
    const dir = copy("relocate-mirrored");
    const result = await runRelocate({ inputs: [], cwd: dir, fields: ["citations"] });
    expect(result.files).toEqual([
      {
        file: "docs/guide/page.md",
        moved: [
          { key: "citations", to: "manifest", manifest: "meta/docs/guide/page.citations.yaml", line: 2, reason: "owned" },
        ],
        stayed: [],
        beyond: false,
      },
    ]);
    expect(yamlOf(dir, "meta/docs/guide/page.citations.yaml")).toEqual({
      "docs/guide/page.md": { citations: [{ id: "one", source: { file: "src/a.ts" } }] },
    });
  });

  it("prints the pattern on the keys-added line, and each page's file on its move", async () => {
    const dir = copy("relocate-add");
    const result = await runRelocate({ inputs: [], cwd: dir });
    expect(pretty(result)).toBe(
      [
        "Adding citations to {page}.citations.yaml's keys moves it out of every page in collection site.",
        "docs/a.md",
        "    citations  → docs/a.citations.yaml:3",
        "1 file, 1 value moved to 1 manifest",
      ].join("\n"),
    );
    expect(yamlOf(dir, "docs/a.citations.yaml")).toEqual({
      "docs/a.md": { owner: "platform", citations: [{ id: "one", source: { file: "src/a.ts" } }] },
    });
  });
});

describe("relocate: out of every page's manifest, back into the pages (0058 § 4 step 2)", () => {
  it("pulls each page's values back and undeclares the pattern", async () => {
    const dir = copy("relocate-back");
    const result = await runRelocate({
      inputs: [],
      cwd: dir,
      fields: ["citations"],
      cliSchemas: ["./page.schema.json"],
    });

    expect(pretty(result)).toBe(
      [
        "Removing citations from {page}.citations.yaml's keys moves it into every page in collection site.",
        "{page}.citations.yaml no longer owns any keys and is no longer declared; delete it when you are ready.",
        "docs/a.md",
        "    citations  ← docs/a.citations.yaml",
        "docs/b.md",
        "    citations  ← docs/b.citations.yaml",
        "2 files, 2 values moved into pages",
      ].join("\n"),
    );
    expect(read(dir, "docs/a.md")).toContain("citations:");
    expect(read(dir, "docs/b.md")).toContain("id: two");
    expect(read(dir, "docs/uncited.md")).toBe("---\ntitle: Uncited\n---\n# Uncited\n");
    expect(yamlOf(dir, "manni.config.yaml")).toEqual({
      collections: [{ name: "site", paths: ["docs/**/*.md"] }],
    });
  });
});

describe("keyHome on a {page} manifest", () => {
  it("names the page's own manifest, which need not exist yet", async () => {
    const dir = copy("relocate-back");
    const run = await resolveRunConfig({ cwd: dir, inputs: [] });
    const ctx = relocationContext(run, {
      cwd: dir,
      targets: [],
      validator: new Validator(schemaLoadOptions({ root: dir, fileBase: dir })),
    });
    expect(await keyHome(ctx, "docs/uncited.md", {}, "citations")).toEqual({
      kind: "manifest",
      collection: "site",
      file: "docs/uncited.citations.yaml",
      absPath: join(dir, "docs", "uncited.citations.yaml"),
      join: "path",
      entry: "docs/uncited.md",
      perPage: true,
    });
  });
});

describe("derive places provenance in the page's own manifest", () => {
  it("resolves {page} for the page being derived", () => {
    const root = join(tmpdir(), "manni-provenance-root");
    const collections: CollectionConfig[] = [
      {
        name: "site",
        paths: ["docs/**/*.md"],
        exclude: [],
        externalMetadata: [{ file: "{page}.provenance.yaml", keys: ["provenance"] }],
      },
    ];
    const manifests = provenanceManifests(collections, root, root);
    const place = provenancePlace("docs/a.md", {}, manifests, collections, root, root);
    expect(place).toMatchObject({
      absPath: join(root, "docs", "a.provenance.yaml"),
      entry: "docs/a.md",
      join: "path",
      manifest: { absPath: join(root, "docs", "a.provenance.yaml"), file: "docs/a.provenance.yaml", perPage: true },
    });
  });
});
