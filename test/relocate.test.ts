/**
 * `manni meta relocate` (proposal 0047): put every value where its schema's
 * `x-manni-location` mark and the config's manifests say it belongs, in both
 * directions, creating the collection, manifest and config entry a value
 * needs. Each case runs on a private copy of its fixture.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { relocateFailed, runRelocate } from "../src/meta/commands/relocate.js";
import { renderRelocate } from "../src/meta/reporters/relocate.js";
import {
  applyRelocation,
  keyHome,
  offerPrompt,
  planRelocation,
  relocationContext,
  relocationOffers,
} from "../src/meta/core/relocation.js";
import { resolveRunConfig } from "../src/meta/core/config.js";
import { Validator } from "../src/meta/core/validator.js";
import { schemaLoadOptions } from "../src/meta/core/schema-registry.js";
import { writeFileAtomic } from "../src/meta/core/write-file.js";
import { DocmetaError } from "../src/meta/types.js";
import { startSchemaServer } from "./helpers/schema-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "location");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A private copy of one fixture directory. */
function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-${name}-`));
  dirs.push(dir);
  cpSync(join(fixtures, name), dir, { recursive: true });
  return dir;
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");
const yamlOf = (dir: string, file: string): unknown => parseYaml(read(dir, file));
const pretty = (result: Awaited<ReturnType<typeof runRelocate>>): string =>
  renderRelocate(result, "pretty", { color: false });

describe("relocate: a collection with no manifest yet (rung 1, 2)", () => {
  it("creates the manifest, declares it, and moves every external value out of the pages", async () => {
    const dir = copy("relocate-create");
    const result = await runRelocate({ inputs: [], cwd: dir });

    expect(pretty(result)).toBe(
      [
        "Created site.metadata.yaml; collections[site].externalMetadata[0] owns owner, authors.",
        "docs/faq.md",
        "    owner    → site.metadata.yaml:2",
        "docs/install.md",
        "    authors  → site.metadata.yaml:4",
        "    owner    → site.metadata.yaml:6",
        "2 files, 3 values moved to 1 manifest",
      ].join("\n"),
    );
    expect(relocateFailed(result)).toBe(false);
    expect(yamlOf(dir, "site.metadata.yaml")).toEqual({
      "docs/faq.md": { owner: "platform" },
      "docs/install.md": { authors: ["ada"], owner: "platform" },
    });
    expect(read(dir, "manni.config.yaml")).toBe(
      [
        "meta:",
        "  schemas: [./steward.schema.json]",
        "collections:",
        "  - name: site",
        '    paths: ["docs/**/*.md"]',
        "    externalMetadata:",
        "      - file: ./site.metadata.yaml",
        "        keys: [owner, authors]",
        "",
      ].join("\n"),
    );
    expect(read(dir, "docs/install.md")).toBe("---\ntitle: Install\n---\n# Install\n");
    expect(read(dir, "docs/faq.md")).toBe("---\ntitle: FAQ\n---\n# FAQ\n");

    // Converged: a second run finds nothing to do.
    const again = await runRelocate({ inputs: [], cwd: dir });
    expect(pretty(again)).toBe("0 files, nothing to move");
  });

  it("previews under --dry-run and writes nothing", async () => {
    const dir = copy("relocate-create");
    const config = read(dir, "manni.config.yaml");
    const result = await runRelocate({ inputs: [], cwd: dir, dryRun: true });

    expect(pretty(result)).toBe(
      [
        "Would create site.metadata.yaml; collections[site].externalMetadata[0] would own owner, authors.",
        "docs/faq.md",
        "    owner    → site.metadata.yaml",
        "docs/install.md",
        "    authors  → site.metadata.yaml",
        "    owner    → site.metadata.yaml",
        "2 files, 3 values would move to 1 manifest",
      ].join("\n"),
    );
    expect(existsSync(join(dir, "site.metadata.yaml"))).toBe(false);
    expect(read(dir, "manni.config.yaml")).toBe(config);
    expect(read(dir, "docs/install.md")).toContain("owner: platform");
  });

  it("refuses a manifest path that exists and is not declared (U6)", async () => {
    const dir = copy("relocate-create");
    writeFileSync(join(dir, "site.metadata.yaml"), "# someone else's\n");
    await expect(runRelocate({ inputs: [], cwd: dir })).rejects.toThrow(
      "site.metadata.yaml already exists and is not a manifest of collection site; declare it under externalMetadata, or move it.",
    );
  });

  it("refuses a --fields name with no mark and no owning manifest (U3)", async () => {
    const dir = copy("relocate-create");
    await expect(
      runRelocate({ inputs: [], cwd: dir, fields: ["owner", "nope"] }),
    ).rejects.toThrow(
      '"nope" has no x-manni-location mark and no owning manifest for any file in this run.',
    );
  });
});

describe("relocate: narrowed to one page, widened to the collection (rung 3, R2)", () => {
  it("moves the key out of every member page and says how many lie beyond the named paths", async () => {
    const dir = copy("relocate-narrow");
    const result = await runRelocate({ inputs: ["docs/install.md"], fields: ["owner"], cwd: dir });

    expect(pretty(result)).toBe(
      [
        "Adding owner to docs-meta.yaml's keys moves it out of every page in collection site, 2 beyond the paths you named.",
        "docs/install.md",
        "    owner    → docs-meta.yaml:3",
        "… (2 more files)",
        "3 files, 3 values moved to 1 manifest",
      ].join("\n"),
    );
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({
      "docs/install.md": { authors: ["ada"], owner: "platform" },
      "docs/faq.md": { owner: "support" },
      "docs/guide.md": { owner: "platform" },
    });
    expect(yamlOf(dir, "manni.config.yaml")).toMatchObject({
      collections: [{ externalMetadata: [{ file: "./docs-meta.yaml", keys: ["authors", "owner"] }] }],
    });
    for (const page of ["docs/install.md", "docs/faq.md", "docs/guide.md"]) {
      expect(read(dir, page)).not.toContain("owner:");
    }
  });
});

describe("relocate: both directions in one run (rung 4, R3)", () => {
  it("moves a page-preferring key back into every page and an external one out", async () => {
    const dir = copy("relocate-both");
    const result = await runRelocate({ inputs: [], cwd: dir });

    expect(pretty(result)).toBe(
      [
        "Removing title from docs-meta.yaml's keys moves it into every page in collection site.",
        "Adding owner to docs-meta.yaml's keys moves it out of every page in collection site.",
        "docs/faq.md",
        "    title    ← docs-meta.yaml",
        "docs/install.md",
        "    title    ← docs-meta.yaml",
        "    owner    → docs-meta.yaml:3",
        "2 files, 3 values moved: 2 into pages, 1 into 1 manifest",
      ].join("\n"),
    );
    expect(read(dir, "docs-meta.yaml")).toBe(
      "# Titles live here for now.\ndocs/install.md:\n  owner: platform\n",
    );
    expect(yamlOf(dir, "manni.config.yaml")).toMatchObject({
      collections: [{ externalMetadata: [{ file: "./docs-meta.yaml", keys: ["owner"] }] }],
    });
    expect(read(dir, "docs/install.md")).toBe("---\ntitle: Install\n---\n# Install\n");
    // The frontmatter writer's own layout: it pads a flow list it re-emits.
    expect(read(dir, "docs/faq.md")).toBe("---\ntags: [ help ]\ntitle: FAQ\n---\n# FAQ\n");
  });

  it("undeclares a manifest whose keys empty, and leaves the file on disk (R3)", async () => {
    const dir = copy("relocate-both");
    const manifest = read(dir, "docs-meta.yaml");
    const result = await runRelocate({ inputs: [], cwd: dir, fields: ["title"] });

    expect(pretty(result)).toBe(
      [
        "Removing title from docs-meta.yaml's keys moves it into every page in collection site.",
        "docs-meta.yaml no longer owns any keys and is no longer declared; delete it when you are ready.",
        "docs/faq.md",
        "    title    ← docs-meta.yaml",
        "docs/install.md",
        "    title    ← docs-meta.yaml",
        "2 files, 2 values moved into pages",
      ].join("\n"),
    );
    expect(read(dir, "docs-meta.yaml")).toBe(manifest);
    expect(yamlOf(dir, "manni.config.yaml")).toEqual({
      meta: { schemas: ["./steward.schema.json"] },
      collections: [{ name: "site", paths: ["docs/**/*.md"] }],
    });
  });

  it("renders the scripting form (rung 8)", async () => {
    const dir = copy("relocate-both");
    const result = await runRelocate({ inputs: [], cwd: dir, dryRun: true });
    expect(JSON.parse(renderRelocate(result, "json"))).toEqual({
      dryRun: true,
      config: { file: "manni.config.yaml", created: false, collectionsCreated: [], pathsAdded: [] },
      manifests: [
        {
          file: "docs-meta.yaml",
          collection: "site",
          created: false,
          keysAdded: ["owner"],
          keysRemoved: ["title"],
          undeclared: false,
        },
      ],
      files: [
        {
          file: "docs/faq.md",
          moved: [{ key: "title", to: "page", from: "docs-meta.yaml", reason: "preferred" }],
          stayed: [],
        },
        {
          file: "docs/install.md",
          moved: [
            { key: "title", to: "page", from: "docs-meta.yaml", reason: "preferred" },
            { key: "owner", to: "manifest", manifest: "docs-meta.yaml", reason: "preferred" },
          ],
          stayed: [],
        },
      ],
      summary: { files: 2, moved: 3, stayed: 0, manifestsCreated: 0 },
    });
  });
});

describe("relocate: where a page with no collection goes (§3 cases 2 and 3)", () => {
  it("creates collection default from the run's targets when none is declared (rung 5)", async () => {
    const dir = copy("relocate-default");
    const result = await runRelocate({ inputs: ["docs/", "guides/intro.md"], cwd: dir });

    expect(pretty(result)).toBe(
      [
        "Created collection default (paths: docs/**, guides/intro.md) and default.metadata.yaml; it owns authors, owner.",
        "docs/install.md",
        "    authors  → default.metadata.yaml:2",
        "    owner    → default.metadata.yaml:4",
        "guides/intro.md",
        "    owner    → default.metadata.yaml:6",
        "2 files, 3 values moved to 1 manifest",
      ].join("\n"),
    );
    expect(yamlOf(dir, "manni.config.yaml")).toEqual({
      meta: { schemas: ["./steward.schema.json"] },
      collections: [
        {
          name: "default",
          paths: ["docs/**", "guides/intro.md"],
          externalMetadata: [{ file: "./default.metadata.yaml", keys: ["authors", "owner"] }],
        },
      ],
    });
    expect(read(dir, "guides/other.md")).toContain("owner: support");
  });

  it("creates manni.config.yaml when there is no config file", async () => {
    const dir = copy("relocate-default");
    rmSync(join(dir, "manni.config.yaml"));
    const result = await runRelocate({
      inputs: ["guides/intro.md"],
      cliSchemas: [join(dir, "steward.schema.json")],
      cwd: dir,
    });
    expect(result.config).toMatchObject({ file: "manni.config.yaml", created: true });
    expect(pretty(result).split("\n")[0]).toBe("Created manni.config.yaml.");
    expect(yamlOf(dir, "manni.config.yaml")).toEqual({
      collections: [
        {
          name: "default",
          paths: ["guides/intro.md"],
          externalMetadata: [{ file: "./default.metadata.yaml", keys: ["owner"] }],
        },
      ],
    });
  });

  it("appends the target to the one collection's paths (case 3)", async () => {
    const dir = copy("relocate-outside");
    const result = await runRelocate({ inputs: ["notes/"], cwd: dir });

    expect(pretty(result)).toBe(
      [
        "Added notes/** to collection site's paths; docs-meta.yaml now owns owner, authors.",
        "notes/stray.md",
        "    authors  → docs-meta.yaml:4",
        "    owner    → docs-meta.yaml:6",
        "1 file, 2 values moved to 1 manifest",
      ].join("\n"),
    );
    expect(yamlOf(dir, "manni.config.yaml")).toMatchObject({
      collections: [
        {
          paths: ["docs/**/*.md", "notes/**"],
          externalMetadata: [{ file: "./docs-meta.yaml", keys: ["owner", "authors"] }],
        },
      ],
    });
    expect(result.config.pathsAdded).toEqual([{ collection: "site", path: "notes/**" }]);
  });
});

describe("relocate: values that stay (rung 7)", () => {
  it("names each value that cannot move, with its reason, and exits 1", async () => {
    const dir = copy("relocate-stays");
    const result = await runRelocate({ inputs: ["docs/", "api/", "notes/stray.md"], cwd: dir });

    expect(pretty(result)).toBe(
      [
        "api/joined.md",
        "    owner    → api-meta.yaml:3",
        "api/nojoin.md",
        "    owner    stays: this document has no id, which api-meta.yaml joins on",
        "docs/differ.md",
        "    owner    stays: the page and docs-meta.yaml hold different values",
        "docs/native.rst",
        "    owner    stays: the rst format cannot write this document's metadata",
        "docs/same.md",
        "    owner    → docs-meta.yaml:4",
        "    team     → docs-meta.yaml:5",
        "notes/stray.md",
        "    owner    stays: this document is in none of the 2 collections, so it has no manifest",
        "6 files, 3 values moved to 2 manifests, 4 stayed",
      ].join("\n"),
    );
    expect(relocateFailed(result)).toBe(true);
    const same = result.files.find((f) => f.file === "docs/same.md");
    expect(same?.moved).toEqual([
      { key: "owner", to: "manifest", manifest: "docs-meta.yaml", line: 4, reason: "preferred" },
      { key: "team", to: "manifest", manifest: "docs-meta.yaml", line: 5, reason: "owned" },
    ]);
    expect(result.files.find((f) => f.file === "api/nojoin.md")?.stayed).toMatchObject([
      { key: "owner", reason: "no-join-value" },
    ]);

    // The join field never moves, even marked external.
    expect(read(dir, "api/joined.md")).toBe("---\nid: auth\ntitle: Joined\n---\n# Joined\n");
    expect(yamlOf(dir, "api-meta.yaml")).toEqual({ auth: { owner: "platform" } });
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({
      "docs/differ.md": { owner: "manifest-team" },
      "docs/same.md": { owner: "platform", team: "writers" },
    });
    expect(read(dir, "docs/differ.md")).toContain("owner: page-team");
    expect(read(dir, "docs/native.rst")).toBe(":owner: platform\n\nNative\n======\n");
    expect(read(dir, "notes/stray.md")).toContain("owner: platform");
    expect(yamlOf(dir, "manni.config.yaml")).toEqual(
      parseYaml(readFileSync(join(fixtures, "relocate-stays", "manni.config.yaml"), "utf8")),
    );
  });

  it("leaves a value a URL manifest owns, in either direction", async () => {
    const server = await startSchemaServer({
      "/owners.yaml": { body: "docs/b.md:\n  title: From the URL\n", contentType: "text/yaml" },
    });
    try {
      const dir = copy("relocate-create");
      writeFileSync(
        join(dir, "manni.config.yaml"),
        [
          "meta:",
          "  schemas: [./steward.schema.json]",
          "collections:",
          "  - name: site",
          '    paths: ["docs/**/*.md"]',
          "    externalMetadata:",
          `      - file: ${server.url}/owners.yaml`,
          "        keys: [owner, title]",
          "",
        ].join("\n"),
      );
      rmSync(join(dir, "docs"), { recursive: true });
      cpSync(join(fixtures, "relocate-create", "docs"), join(dir, "docs"), { recursive: true });
      rmSync(join(dir, "docs", "install.md"));
      writeFileSync(join(dir, "docs", "faq.md"), "---\nowner: platform\n---\n# FAQ\n");
      writeFileSync(join(dir, "docs", "b.md"), "---\ntags: [b]\n---\n# B\n");

      const result = await runRelocate({ inputs: [], cwd: dir });
      expect(result.files).toMatchObject([
        { file: "docs/b.md", moved: [], stayed: [{ key: "title", reason: "url-manifest" }], beyond: false },
        { file: "docs/faq.md", moved: [], stayed: [{ key: "owner", reason: "url-manifest" }], beyond: false },
      ]);
      expect(relocateFailed(result)).toBe(true);
      expect(pretty(result)).toContain(
        `    title    stays: ${server.url}/owners.yaml is fetched and cannot be written`,
      );
    } finally {
      await server.close();
    }
  });
});

describe("relocate: usage refusals", () => {
  it("refuses stdin (U1)", async () => {
    await expect(runRelocate({ inputs: ["-"], cwd: copy("relocate-create") })).rejects.toThrow(
      "relocate moves values between documents and a collection's manifest, and stdin is not a document on disk.",
    );
  });

  it("refuses --no-config (U2)", async () => {
    await expect(
      runRelocate({ inputs: ["docs/"], noConfig: true, cwd: copy("relocate-create") }),
    ).rejects.toThrow(
      "relocate writes collections: and externalMetadata: to the config file, and --no-config rules one out.",
    );
  });

  it("refuses a run with no inputs and no config (U7)", async () => {
    const dir = copy("relocate-default");
    rmSync(join(dir, "manni.config.yaml"));
    const run = runRelocate({ inputs: [], cwd: dir });
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(runRelocate({ inputs: [], cwd: dir })).rejects.toThrow("No files to relocate.");
  });
});

describe("relocate: a key leaving keys: while another page carries it", () => {
  async function planIn(dir: string, files: string[]) {
    const run = await resolveRunConfig({ cwd: dir, inputs: [] });
    const ctx = relocationContext(run, {
      cwd: dir,
      targets: [],
      validator: new Validator(schemaLoadOptions({ root: dir, fileBase: dir })),
    });
    return { ctx, plan: await planRelocation(ctx, { files }) };
  }

  it("leaves the unmarked page's copy on the page, in either order", async () => {
    for (const order of [["docs/a.md", "docs/b.md"], ["docs/b.md", "docs/a.md"]]) {
      const dir = copy("relocate-removed-owned");
      const { ctx, plan } = await planIn(dir, order);
      expect(plan.result.manifests).toMatchObject([
        { file: "docs-meta.yaml", keysAdded: [], keysRemoved: ["title"], keys: ["team"] },
      ]);
      expect(plan.result.files).toEqual([
        {
          file: "docs/a.md",
          moved: [{ key: "title", to: "page", from: "docs-meta.yaml", reason: "preferred" }],
          stayed: [],
          beyond: false,
        },
      ]);
      await applyRelocation(ctx, plan);
      expect(read(dir, "docs/b.md")).toBe("---\ntitle: B\n---\n# B\n");
      expect(yamlOf(dir, "docs-meta.yaml")).toEqual({ "docs/a.md": { team: "writers" } });
      expect(read(dir, "docs/a.md")).toContain("title: A");
    }
  });

  it("leaves the copy on the page when the manifest is undeclared", async () => {
    const dir = copy("relocate-removed-owned");
    writeFileSync(
      join(dir, "manni.config.yaml"),
      read(dir, "manni.config.yaml").replace("keys: [title, team]", "keys: [title]"),
    );
    writeFileSync(join(dir, "docs-meta.yaml"), "docs/a.md:\n  title: A\n");
    const result = await runRelocate({ inputs: [], cwd: dir });
    expect(result.manifests).toMatchObject([{ keysRemoved: ["title"], undeclared: true }]);
    expect(relocateFailed(result)).toBe(false);
    expect(read(dir, "docs/b.md")).toBe("---\ntitle: B\n---\n# B\n");
    expect(read(dir, "docs-meta.yaml")).toBe("docs/a.md:\n  title: A\n");
  });

  it("moves the manifest's value for the unmarked page in, or names a disagreement", async () => {
    const dir = copy("relocate-removed-owned");
    writeFileSync(join(dir, "docs-meta.yaml"), "docs/a.md:\n  title: A\n  team: writers\ndocs/b.md:\n  title: B\n");
    const same = await runRelocate({ inputs: [], cwd: dir, dryRun: true });
    expect(same.files.find((f) => f.file === "docs/b.md")?.moved).toEqual([
      { key: "title", to: "page", from: "docs-meta.yaml", reason: "preferred" },
    ]);

    writeFileSync(join(dir, "docs-meta.yaml"), "docs/a.md:\n  title: A\n  team: writers\ndocs/b.md:\n  title: Other\n");
    const differ = await runRelocate({ inputs: [], cwd: dir, dryRun: true });
    expect(differ.files.find((f) => f.file === "docs/b.md")?.stayed).toMatchObject([
      { key: "title", reason: "values-differ" },
    ]);
    expect(relocateFailed(differ)).toBe(true);
  });

  it("moves the copy out again when a page blocks the removal", async () => {
    const dir = copy("relocate-removed-owned");
    writeFileSync(join(dir, "docs", "c.rst"), "Body text.\n");
    writeFileSync(join(dir, "docs-meta.yaml"), "docs/a.md:\n  title: A\n  team: writers\ndocs/c.rst:\n  title: C\n");
    for (const order of [["docs/a.md", "docs/b.md", "docs/c.rst"], ["docs/c.rst", "docs/b.md", "docs/a.md"]]) {
      const { plan } = await planIn(dir, order);
      expect(plan.result.manifests).toMatchObject([{ keysRemoved: [], keys: ["title", "team"] }]);
      expect(plan.result.files).toMatchObject([
        { file: "docs/b.md", moved: [{ key: "title", to: "manifest", reason: "owned" }], stayed: [] },
        { file: "docs/c.rst", moved: [], stayed: [{ key: "title", reason: "read-only-format" }] },
      ]);
    }
  });
});

describe("relocate: fixes from review", () => {
  it("moves every key the manifest owns out of a page a paths: change covers, whatever --fields names", async () => {
    const dir = copy("relocate-outside");
    const result = await runRelocate({ inputs: ["notes/"], fields: ["authors"], cwd: dir });
    expect(result.files).toMatchObject([
      {
        file: "notes/stray.md",
        moved: [
          { key: "authors", to: "manifest", reason: "preferred" },
          { key: "owner", to: "manifest", reason: "preferred" },
        ],
        stayed: [],
      },
    ]);
    expect(relocateFailed(result)).toBe(false);
    expect(read(dir, "notes/stray.md")).toBe("---\ntitle: Stray\n---\n# Stray\n");
  });

  it("reads a page the run never named with its own extractor, not --as", async () => {
    const dir = copy("relocate-as-sibling");
    const result = await runRelocate({ inputs: ["docs/a.md"], as: "markdown", cwd: dir });
    expect(relocateFailed(result)).toBe(false);
    const html = read(dir, "docs/b.html");
    expect(html).not.toContain("---");
    expect(html).toContain('<meta name="title" content="B">');
    expect(read(dir, "docs/a.md")).toContain("title: A");
  });

  it("names a sibling it cannot parse as unreadable, rather than refusing the run", async () => {
    const dir = copy("relocate-narrow");
    writeFileSync(join(dir, "docs", "broken.md"), "---\nowner: [unclosed\n---\n# Broken\n");
    const result = await runRelocate({ inputs: ["docs/install.md"], fields: ["owner"], cwd: dir });
    const broken = result.files.find((f) => f.file === "docs/broken.md");
    expect(broken).toMatchObject({ beyond: true, moved: [], stayed: [{ key: "owner", reason: "unreadable" }] });
    expect(broken?.stayed[0]?.detail).toMatch(/^this document could not be parsed: Invalid YAML frontmatter: [^\n]*[^:\n]$/);
    expect(pretty(result)).toContain("docs/broken.md\n    owner    stays: this document could not be parsed: Invalid YAML frontmatter: ");
    expect(relocateFailed(result)).toBe(true);
    expect(read(dir, "docs/install.md")).not.toContain("owner:");
    expect(JSON.parse(renderRelocate(result, "json"))).toMatchObject({
      files: expect.arrayContaining([{ file: "docs/broken.md", moved: [], stayed: [{ key: "owner", reason: "unreadable" }] }]),
    });
  });

  it("keeps a key in keys: while an unreadable sibling's manifest entry sets it", async () => {
    const dir = copy("relocate-both");
    writeFileSync(join(dir, "docs", "broken.md"), "---\ntitle: [unclosed\n---\n# Broken\n");
    writeFileSync(join(dir, "docs-meta.yaml"), `${read(dir, "docs-meta.yaml")}docs/broken.md:\n  title: Broken\n`);
    const result = await runRelocate({ inputs: ["docs/faq.md"], cwd: dir, fields: ["title"], dryRun: true });
    // The removal is held back, so no title moves into any page.
    expect(result.manifests).toEqual([]);
    expect(result.files).toMatchObject([
      { file: "docs/broken.md", moved: [], stayed: [{ key: "title", reason: "unreadable" }], beyond: true },
    ]);
    expect(relocateFailed(result)).toBe(true);
  });

  it("resolves a glob target with .. or an absolute base against the working directory", async () => {
    const dir = copy("relocate-default");
    await runRelocate({
      inputs: ["../guides/*.md"],
      cwd: join(dir, "docs"),
      configPath: join(dir, "manni.config.yaml"),
    });
    expect(yamlOf(dir, "manni.config.yaml")).toMatchObject({
      collections: [{ name: "default", paths: ["guides/*.md"] }],
    });

    const abs = copy("relocate-default");
    await runRelocate({ inputs: [`${abs.replace(/\\/g, "/")}/guides/*.md`], cwd: abs });
    expect(yamlOf(abs, "manni.config.yaml")).toMatchObject({
      collections: [{ name: "default", paths: ["guides/*.md"] }],
    });
  });
});

describe("relocation core: the API later commands use", () => {
  async function context(dir: string, inputs: string[] = []) {
    const run = await resolveRunConfig({ cwd: dir, inputs });
    return relocationContext(run, { cwd: dir, targets: inputs, validator: new Validator(schemaLoadOptions({ root: dir, fileBase: dir })),
    });
  }

  it("plans without writing, and applying updates the run's collections in place", async () => {
    const dir = copy("relocate-create");
    const ctx = await context(dir);
    const plan = await planRelocation(ctx, { files: ["docs/faq.md", "docs/install.md"] });
    expect(existsSync(join(dir, "site.metadata.yaml"))).toBe(false);
    const [docs] = ctx.declaredCollections;
    expect(docs?.externalMetadata).toEqual([]);

    const result = await applyRelocation(ctx, plan);
    expect(result.summary.moved).toBe(3);
    expect(docs?.externalMetadata).toEqual([
      { file: "./site.metadata.yaml", keys: ["owner", "authors"] },
    ]);
    expect(ctx.collections[0]).toBe(docs);
  });

  /** A writer that fails `path`'s `nth` write (1-based) and writes everything else. */
  function failing(
    fails: { path: string; nth: number; reason: string }[],
  ): (path: string, text: string) => Promise<void> {
    const seen = new Map<string, number>();
    return async (path, text) => {
      const n = (seen.get(path) ?? 0) + 1;
      seen.set(path, n);
      const fail = fails.find((f) => f.path === path && f.nth === n);
      if (fail !== undefined) throw new Error(fail.reason);
      await writeFileAtomic(path, text);
    };
  }
  const snapshot = (dir: string, files: string[]): Record<string, string | null> =>
    Object.fromEntries(files.map((f) => [f, existsSync(join(dir, f)) ? read(dir, f) : null]));

  it("rolls a reverse move back when a page write fails, so the value is never lost", async () => {
    const dir = copy("relocate-both");
    const files = ["docs-meta.yaml", "manni.config.yaml", "docs/faq.md", "docs/install.md"];
    const before = snapshot(dir, files);
    const ctx = await context(dir);
    // title leaves the manifest for the pages; the manifest and config writes land first.
    const plan = await planRelocation(ctx, { files: ["docs/faq.md", "docs/install.md"] });
    expect(plan.writes.map((w) => w.kind)).toEqual(["manifest", "config", "page", "page"]);
    const [site] = ctx.declaredCollections;
    const declared = structuredClone(site?.externalMetadata);

    const write = failing([{ path: join(dir, "docs", "faq.md"), nth: 1, reason: "disk full" }]);
    const run = applyRelocation(ctx, plan, { write });
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(run).rejects.toThrow(
      "Could not write docs/faq.md: disk full. Nothing was changed: the 2 files already written were restored.",
    );
    expect(snapshot(dir, files)).toEqual(before);
    // The run's collections are left as the config still declares them.
    expect(site?.externalMetadata).toEqual(declared);
  });

  it("removes a manifest it created when a later page write fails", async () => {
    const dir = copy("relocate-create");
    const files = ["site.metadata.yaml", "manni.config.yaml", "docs/faq.md", "docs/install.md"];
    const before = snapshot(dir, files);
    expect(before["site.metadata.yaml"]).toBeNull();
    const ctx = await context(dir);
    const plan = await planRelocation(ctx, { files: ["docs/faq.md", "docs/install.md"] });
    expect(plan.writes.map((w) => w.kind)).toEqual(["manifest", "config", "page", "page"]);

    const write = failing([{ path: join(dir, "docs", "install.md"), nth: 1, reason: "disk full" }]);
    await expect(applyRelocation(ctx, plan, { write })).rejects.toThrow(
      "Could not write docs/install.md: disk full. Nothing was changed: the 3 files already written were restored.",
    );
    expect(snapshot(dir, files)).toEqual(before);
    expect(ctx.declaredCollections[0]?.externalMetadata).toEqual([]);
  });

  it("names a file it could not restore", async () => {
    const dir = copy("relocate-create");
    const ctx = await context(dir);
    const plan = await planRelocation(ctx, { files: ["docs/faq.md", "docs/install.md"] });
    const write = failing([
      { path: join(dir, "docs", "install.md"), nth: 1, reason: "disk full" },
      { path: join(dir, "manni.config.yaml"), nth: 2, reason: "read-only file system" },
    ]);
    await expect(applyRelocation(ctx, plan, { write })).rejects.toThrow(
      "Could not write docs/install.md: disk full. The run was rolled back, but manni.config.yaml could not be restored: read-only file system. Restore it from version control.",
    );
    // What could be restored was.
    expect(existsSync(join(dir, "site.metadata.yaml"))).toBe(false);
    expect(read(dir, "docs/faq.md")).toContain("owner: platform");
  });

  it("refuses to apply a plan over a file that changed since it was planned", async () => {
    const dir = copy("relocate-create");
    const ctx = await context(dir);
    const plan = await planRelocation(ctx, { files: ["docs/faq.md", "docs/install.md"] });
    writeFileSync(join(dir, "docs", "install.md"), "---\ntitle: Install\nowner: docs\n---\n# Install\n");
    const run = applyRelocation(ctx, plan);
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(run).rejects.toThrow(
      "docs/install.md changed after the relocation was planned, so nothing was written. Run the command again.",
    );
    expect(existsSync(join(dir, "site.metadata.yaml"))).toBe(false);
    expect(read(dir, "docs/faq.md")).toContain("owner: platform");
  });

  it("words the writers' offer (P1) and validate's (P2) from the plan", async () => {
    const created = copy("relocate-create");
    const plan = await planRelocation(await context(created), {
      files: ["docs/faq.md", "docs/install.md"],
    });
    const [offer] = relocationOffers(plan);
    expect(offer === undefined ? undefined : offerPrompt(offer, "write")).toEqual({
      notice:
        "collection site has no manifest for owner, authors, which their schemas prefer in external metadata.",
      question: "Create site.metadata.yaml, add it to manni.config.yaml, and move them out of 2 pages? ",
    });

    const narrow = copy("relocate-narrow");
    const narrowPlan = await planRelocation(await context(narrow, ["docs/install.md"]), {
      files: ["docs/install.md"],
      fields: ["owner"],
    });
    const [widened] = relocationOffers(narrowPlan);
    expect(widened === undefined ? undefined : offerPrompt(widened, "write").question).toBe(
      "Add owner to docs-meta.yaml's keys and move them out of 3 pages? ",
    );

    const both = copy("relocate-both");
    const bothPlan = await planRelocation(await context(both), {
      files: ["docs/faq.md", "docs/install.md"],
    });
    const [mixed] = relocationOffers(bothPlan);
    expect(mixed === undefined ? undefined : offerPrompt(mixed, "validate")).toEqual({
      notice:
        "in collection site, 1 value in 1 page prefers external metadata and 2 values in docs-meta.yaml prefer the page.",
      question: "Move them (remove title from docs-meta.yaml's keys, add owner to docs-meta.yaml's keys)? ",
    });

    const outside = copy("relocate-outside");
    const outsidePlan = await planRelocation(await context(outside, ["notes/"]), {
      files: ["notes/stray.md"],
    });
    const [grown] = relocationOffers(outsidePlan);
    expect(grown === undefined ? undefined : offerPrompt(grown, "write").question).toBe(
      "Add notes/** to collection site's paths, add authors to docs-meta.yaml's keys, and move them out of 1 page? ",
    );

    const fresh = copy("relocate-default");
    const freshPlan = await planRelocation(await context(fresh, ["docs/"]), {
      files: ["docs/install.md"],
    });
    const [made] = relocationOffers(freshPlan);
    expect(made === undefined ? undefined : offerPrompt(made, "write")).toEqual({
      notice:
        "no collection has a manifest for authors, owner, which their schemas prefer in external metadata.",
      question:
        "Create collection default (paths: docs/**), with default.metadata.yaml, in manni.config.yaml, and move them out of 1 page? ",
    });

    // One key reads in the singular.
    const oneKeyPlan = await planRelocation(await context(fresh, ["docs/"]), {
      files: ["docs/install.md"],
      fields: ["owner"],
    });
    const [single] = relocationOffers(oneKeyPlan);
    expect(single === undefined ? undefined : offerPrompt(single, "write").notice).toBe(
      "no collection has a manifest for owner, which the schema prefers in external metadata.",
    );
    expect(widened === undefined ? undefined : offerPrompt(widened, "write").notice).toBe(
      "collection site has no manifest for owner, which the schema prefers in external metadata.",
    );
  });

  it("refuses a config that exists but cannot be read, rather than planning on discovery's copy", async () => {
    const dir = copy("relocate-default");
    const ctx = await context(dir, ["docs/"]);
    rmSync(join(dir, "manni.config.yaml"));
    mkdirSync(join(dir, "manni.config.yaml"));
    const plan = planRelocation(ctx, { files: ["docs/install.md"] });
    await expect(plan).rejects.toBeInstanceOf(DocmetaError);
    await expect(planRelocation(ctx, { files: ["docs/install.md"] })).rejects.toThrow(
      /^Config file manni\.config\.yaml could not be read: /,
    );

    // A config removed since discovery is planned on discovery's copy.
    const gone = copy("relocate-default");
    const goneCtx = await context(gone, ["docs/"]);
    rmSync(join(gone, "manni.config.yaml"));
    await expect(planRelocation(goneCtx, { files: ["docs/install.md"] })).resolves.toMatchObject({
      configPath: join(gone, "manni.config.yaml"),
    });
  });

  it("plans a home for a key a writer is about to set, before any page holds it", async () => {
    const dir = copy("relocate-narrow");
    const ctx = await context(dir, ["docs/install.md"]);
    const plan = await planRelocation(ctx, {
      files: ["docs/install.md"],
      fields: ["reviewed"],
      require: new Map([["docs/install.md", ["reviewed"]]]),
    });
    expect(plan.result.manifests).toMatchObject([
      { file: "docs-meta.yaml", keysAdded: ["reviewed"], created: false },
    ]);
    expect(plan.result.files).toEqual([]);
  });

  it("answers where a key lives, or where it would go", async () => {
    const dir = copy("relocate-stays");
    const ctx = await context(dir, ["docs/", "api/", "notes/"]);
    expect(keyHome(ctx, "docs/same.md", { owner: "platform" }, "owner")).toMatchObject({
      kind: "manifest",
      collection: "site",
      file: "docs-meta.yaml",
      join: "path",
      entry: "docs/same.md",
    });
    expect(keyHome(ctx, "api/joined.md", { id: "auth" }, "owner")).toMatchObject({
      kind: "manifest",
      collection: "api",
      join: "id",
      entry: "auth",
    });
    expect(keyHome(ctx, "api/nojoin.md", {}, "owner")).toMatchObject({ kind: "manifest", entry: undefined });
    expect(keyHome(ctx, "docs/same.md", {}, "authors")).toEqual({
      kind: "unowned",
      home: {
        kind: "collection",
        collection: "site",
        manifest: "docs-meta.yaml",
        createsManifest: false,
        createsCollection: false,
      },
    });
    expect(keyHome(ctx, "notes/stray.md", {}, "owner")).toEqual({
      kind: "unowned",
      home: { kind: "none", reason: "collections", collections: 2 },
    });
  });
});
