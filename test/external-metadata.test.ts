/**
 * External metadata (proposal 0037): a private manifest joined to public
 * documents. Proposal 0041 moved the declaration: a manifest is
 * `externalMetadata:` on a collection, and it applies to that collection's
 * members and nothing else.
 *
 * The rules under test, each from a proposal this one inherits:
 *
 *  - A manifest's keys are merged into the document before schema resolution,
 *    so `validate`, `get`, `query` and `fill` all see one object (0005).
 *  - A document carrying a manifest-owned key is a finding, not a tiebreak
 *    (0020: the discarded value is exactly the one nobody checked).
 *  - A violation on a manifest-sourced value names the manifest file and line,
 *    while the finding's subject file stays the document (0001: identity).
 *  - Only the manifests of the collections a file belongs to are consulted,
 *    and two of them owning one key for one file is exit 2 (0041 rules 4, 5).
 *  - A manifest entry naming a document the run did not load is exit 2, when
 *    the run is the config corpus (0014, 0026 §4).
 *  - A manifest that cannot be read or does not fit the shape is exit 2.
 *
 * The parse-time refusals about a manifest entry live in
 * `test/collections.test.ts` now, against `parseCollections`, which is what
 * validates `externalMetadata:`.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  parseCollections,
  type CollectionConfig,
} from "../src/shared/collections.js";
import { memberOf } from "../src/meta/core/collections.js";
import {
  loadExternalMetadata,
  mergeExternalMetadata,
  orphanEntries,
  EXTERNAL_OWNED_SCHEMA,
  EXTERNAL_KEYWORD,
} from "../src/meta/core/external-metadata.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { runGet } from "../src/meta/commands/get.js";
import { runQuery } from "../src/meta/commands/query.js";
import { DocmetaError, type ExtractedMetadata } from "../src/meta/types.js";
import { assertPublishableBuiltinId } from "../src/meta/core/schema-registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "fixtures", "external-metadata");
const overlap = resolve(here, "fixtures", "external-metadata-overlap");

/** The fixture's own declaration, as `manni.config.yaml` there spells it. */
const COLLECTIONS = parseCollections(
  [
    {
      name: "pages",
      paths: ["docs/**/*.md"],
      externalMetadata: [{ file: "./docs-meta.yaml", keys: ["source", "jira"] }],
    },
  ],
  "manni.config.yaml",
  (message) => new DocmetaError(message),
);

/** One collection wrapping the given manifests, for a one-off shape. */
function withManifests(externalMetadata: unknown[]): CollectionConfig[] {
  return parseCollections(
    [{ name: "pages", paths: ["docs/**/*.md"], externalMetadata }],
    "manni.config.yaml",
    (message) => new DocmetaError(message),
  );
}

/**
 * The collections a label really belongs to — the same call the command cores
 * make, rather than a hand-written list, so a membership rule that changed
 * would fail here too.
 */
function members(
  label: string,
  collections: readonly CollectionConfig[] = COLLECTIONS,
  base = corpus,
): string[] {
  return memberOf(collections, base, base, label);
}

function doc(data: Record<string, unknown>, lines: Record<string, number> = {}): ExtractedMetadata {
  return {
    data,
    present: true,
    format: "markdown",
    lineFor: (pointer) => lines[pointer.replace(/^\//, "")],
  };
}

describe("external metadata: loading a manifest", () => {
  it("returns null when no collection declares a manifest", async () => {
    expect(await loadExternalMetadata([], { configDir: corpus, base: corpus })).toBeNull();
    expect(
      await loadExternalMetadata(withManifests([]), { configDir: corpus, base: corpus }),
    ).toBeNull();
  });

  it("indexes entries by absolute document path, with the manifest line of each key", async () => {
    const index = await loadExternalMetadata(COLLECTIONS, { configDir: corpus, base: corpus });
    expect(index).not.toBeNull();
    const auth = index?.byPath.get(resolve(corpus, "docs/auth.md"));
    expect(auth?.get("source")).toEqual({
      value: "internal/auth-design.md",
      collection: "pages",
      file: "docs-meta.yaml",
      line: 3,
    });
    expect(auth?.get("jira")?.line).toBe(4);
    // A list, because two collections may each own one key (0041 rule 5).
    expect(index?.owners.get("jira")).toEqual([
      { collection: "pages", file: "docs-meta.yaml" },
    ]);
    expect(index?.entries.map((e) => e.spelled)).toEqual([
      "docs/auth.md",
      "docs/billing.md",
      "docs/ops.md",
    ]);
  });

  it("reports the manifest path relative to the run's base", async () => {
    const index = await loadExternalMetadata(COLLECTIONS, {
      configDir: corpus,
      base: resolve(corpus, "docs"),
    });
    expect(index?.owners.get("jira")).toEqual([
      { collection: "pages", file: "../docs-meta.yaml" },
    ]);
  });

  const bad = (file: string) =>
    loadExternalMetadata(withManifests([{ file, keys: ["jira"] }]), {
      configDir: corpus,
      base: corpus,
    });

  it("is an operational error when the manifest is missing", async () => {
    await expect(bad("./no-such.yaml")).rejects.toThrow(DocmetaError);
    await expect(bad("./no-such.yaml")).rejects.toThrow(/no-such\.yaml/);
  });

  it("is an operational error when the manifest is not a mapping", async () => {
    await expect(bad("./bad-not-mapping.yaml")).rejects.toThrow(
      /bad-not-mapping\.yaml: the manifest must be a mapping/,
    );
  });

  it("is an operational error when an entry is not a mapping", async () => {
    await expect(bad("./bad-entry-scalar.yaml")).rejects.toThrow(
      /bad-entry-scalar\.yaml:1: "docs\/auth\.md" must be a mapping of owned keys/,
    );
  });

  it("is an operational error when an entry supplies a key the manifest does not own", async () => {
    await expect(bad("./bad-unowned-key.yaml")).rejects.toThrow(
      /bad-unowned-key\.yaml:1: "docs\/auth\.md" sets "team", which this manifest does not own/,
    );
  });

  it("is an operational error when a manifest names one document twice", async () => {
    await expect(bad("./bad-duplicate-path.yaml")).rejects.toThrow(
      /bad-duplicate-path\.yaml:5: "docs\/auth\.md" is named twice \(first at line 1\)/,
    );
  });

  it("refuses $schema in an entry by name", async () => {
    await expect(bad("./bad-schema-key.yaml")).rejects.toThrow(
      /never chooses the schema/,
    );
  });
});

describe("external metadata: merging into a document", () => {
  it("adds the owned keys and locates each at its manifest line", async () => {
    const index = await loadExternalMetadata(COLLECTIONS, { configDir: corpus, base: corpus });
    const merged = mergeExternalMetadata(
      "docs/auth.md",
      doc({ title: "Auth" }),
      index,
      members("docs/auth.md"),
      corpus,
    );
    expect(merged.extracted.data).toEqual({
      title: "Auth",
      source: "internal/auth-design.md",
      jira: "PLAT-412",
    });
    expect(merged.collisions).toEqual([]);
    expect(merged.locate("/jira")).toEqual({ file: "docs-meta.yaml", line: 4 });
    expect(merged.locate("jira")).toEqual({ file: "docs-meta.yaml", line: 4 });
    expect(merged.locate("/title")).toBeUndefined();
    // The document's own positions are untouched: a manifest key is not in it.
    expect(merged.extracted.lineFor("jira")).toBeUndefined();
  });

  it("leaves present, format and the document's positions alone", async () => {
    const index = await loadExternalMetadata(COLLECTIONS, { configDir: corpus, base: corpus });
    const original = doc({ title: "Auth" }, { title: 2 });
    const merged = mergeExternalMetadata(
      "docs/auth.md",
      original,
      index,
      members("docs/auth.md"),
      corpus,
    );
    expect(merged.extracted.present).toBe(true);
    expect(merged.extracted.format).toBe("markdown");
    expect(merged.extracted.lineFor("title")).toBe(2);
  });

  it("reports a document carrying an owned key as a collision, keeping the document's value", async () => {
    const index = await loadExternalMetadata(COLLECTIONS, { configDir: corpus, base: corpus });
    const merged = mergeExternalMetadata(
      "docs/ops.md",
      doc({ title: "Ops", jira: "PLAT-9" }, { jira: 3 }),
      index,
      members("docs/ops.md"),
      corpus,
    );
    expect(merged.collisions).toEqual([
      { key: "jira", file: "docs-meta.yaml", collection: "pages" },
    ]);
    expect(merged.extracted.data.jira).toBe("PLAT-9");
    expect(merged.locate("/jira")).toBeUndefined();
  });

  it("flags an owned key in a document that has no manifest entry at all", async () => {
    const index = await loadExternalMetadata(COLLECTIONS, { configDir: corpus, base: corpus });
    const merged = mergeExternalMetadata(
      "docs/new.md",
      doc({ jira: "PLAT-1" }),
      index,
      members("docs/new.md"),
      corpus,
    );
    expect(merged.collisions).toEqual([
      { key: "jira", file: "docs-meta.yaml", collection: "pages" },
    ]);
  });

  it("is a pass-through with no index", () => {
    const original = doc({ title: "t" });
    const merged = mergeExternalMetadata(
      "docs/x.md",
      original,
      null,
      members("docs/x.md"),
      corpus,
    );
    expect(merged.extracted).toBe(original);
    expect(merged.collisions).toEqual([]);
    expect(merged.locate("/title")).toBeUndefined();
  });

  it("merges nothing into a file that belongs to no collection", async () => {
    // The manifest still names `docs/auth.md`, and the index still holds the
    // path entry — but a run whose collection excludes the file consults no
    // manifest for it (0041 rule 4). A key it carries itself is not a
    // collision either: nothing owns that key *for this file*.
    const scoped = parseCollections(
      [
        {
          name: "pages",
          paths: ["docs/**/*.md"],
          exclude: ["docs/auth.md"],
          externalMetadata: [
            { file: "./docs-meta.yaml", keys: ["source", "jira"] },
          ],
        },
      ],
      "manni.config.yaml",
      (message) => new DocmetaError(message),
    );
    const index = await loadExternalMetadata(scoped, { configDir: corpus, base: corpus });
    expect(index?.byPath.get(resolve(corpus, "docs/auth.md"))).toBeDefined();
    expect(members("docs/auth.md", scoped)).toEqual([]);

    const original = doc({ title: "Auth", jira: "PLAT-9" });
    const merged = mergeExternalMetadata(
      "docs/auth.md",
      original,
      index,
      members("docs/auth.md", scoped),
      corpus,
    );
    expect(merged.extracted).toBe(original);
    expect(merged.extracted.data).toEqual({ title: "Auth", jira: "PLAT-9" });
    expect(merged.collisions).toEqual([]);
    expect(merged.joins).toEqual([]);
    expect(merged.locate("/jira")).toBeUndefined();
  });

  it("is an operational error when two of a file's collections own one key", async () => {
    // The narrow collection sits inside the wide one, and both own `owner`.
    // Legal at parse time — two collections may each own a key — and decided
    // per file, because only a file in *both* is ambiguous. Picking a winner
    // would be the tiebreak 0020 and 0037 refuse (0041 rule 5).
    const collections = parseCollections(
      [
        {
          name: "guides",
          paths: ["docs/**/*.md"],
          externalMetadata: [{ file: "./guides-meta.yaml", keys: ["owner"] }],
        },
        {
          name: "api",
          paths: ["docs/api/**/*.md"],
          externalMetadata: [{ file: "./api-meta.yaml", keys: ["owner"] }],
        },
      ],
      "manni.config.yaml",
      (message) => new DocmetaError(message),
    );
    const index = await loadExternalMetadata(collections, {
      configDir: overlap,
      base: overlap,
    });
    expect(members("docs/api/auth.md", collections, overlap)).toEqual([
      "guides",
      "api",
    ]);

    expect(() =>
      mergeExternalMetadata(
        "docs/api/auth.md",
        doc({ title: "Auth" }),
        index,
        members("docs/api/auth.md", collections, overlap),
        overlap,
      ),
    ).toThrow(DocmetaError);
    expect(() =>
      mergeExternalMetadata(
        "docs/api/auth.md",
        doc({ title: "Auth" }),
        index,
        members("docs/api/auth.md", collections, overlap),
        overlap,
      ),
      // Declaration order, not manifest order: the pair reads the way the
      // config is written, so "narrow one collection" names a real edit.
    ).toThrow(
      'docs/api/auth.md: "owner" is owned by manifests in two of its collections, guides (guides-meta.yaml) and api (api-meta.yaml); a key has one manifest per file. Narrow one collection\'s paths or exclude.',
    );

    // A page in one of the two is untouched, which is why the refusal is per
    // file rather than at parse time.
    const only = mergeExternalMetadata(
      "docs/guides/intro.md",
      doc({ title: "Intro" }),
      index,
      members("docs/guides/intro.md", collections, overlap),
      overlap,
    );
    expect(only.extracted.data).toEqual({ title: "Intro", owner: "docs-team" });
  });

  it("never merges into stdin", async () => {
    const index = await loadExternalMetadata(COLLECTIONS, { configDir: corpus, base: corpus });
    // Membership is hand-written here on purpose: `memberOf` already answers
    // `[]` for stdin, and passing that would exercise the non-member branch
    // instead of the label check this test is about.
    const merged = mergeExternalMetadata("<stdin>", doc({ title: "t" }), index, ["pages"], corpus);
    expect(merged.extracted.data).toEqual({ title: "t" });
  });
});

describe("external metadata: orphan entries", () => {
  it("names every entry the run did not load", async () => {
    const index = await loadExternalMetadata(
      withManifests([{ file: "./docs-meta.orphan.yaml", keys: ["jira"] }]),
      { configDir: corpus, base: corpus },
    );
    const orphans = orphanEntries(index, ["docs/auth.md", "docs/new.md"], corpus);
    expect(orphans.map((o) => o.spelled)).toEqual(["docs/gone.md"]);
    expect(orphans[0]?.file).toBe("docs-meta.orphan.yaml");
    expect(orphans[0]?.line).toBe(3);
  });

  it("is empty with no index", () => {
    expect(orphanEntries(null, [], corpus)).toEqual([]);
  });

  /**
   * Proposal 0041 rule 6. Naming collections does not reshape the corpus, it
   * *chooses* one: the run loaded all of every collection it named, so a stale
   * entry of a named collection is still stale. A CI job narrowed to one
   * collection would otherwise silently lose this check.
   */
  it("still names an orphan of a collection the run selected (0041 rule 6)", async () => {
    const index = await loadExternalMetadata(
      withManifests([{ file: "./docs-meta.orphan.yaml", keys: ["jira"] }]),
      { configDir: corpus, base: corpus },
    );
    const orphans = orphanEntries(
      index,
      ["docs/auth.md", "docs/new.md"],
      corpus,
      ["pages"],
    );
    expect(orphans.map((o) => o.spelled)).toEqual(["docs/gone.md"]);
  });

  it("ignores an orphan of a collection the run did not select", async () => {
    const index = await loadExternalMetadata(
      withManifests([{ file: "./docs-meta.orphan.yaml", keys: ["jira"] }]),
      { configDir: corpus, base: corpus },
    );
    // The entry belongs to `pages`; this run claimed to cover only `blog`, so
    // it never looked at the documents `pages` names and cannot call one stale.
    expect(
      orphanEntries(index, ["docs/auth.md", "docs/new.md"], corpus, ["blog"]),
    ).toEqual([]);
  });
});

describe("external metadata: the finding identity", () => {
  it("reserves the external namespace beside check:", () => {
    expect(() => {
      assertPublishableBuiltinId("external:anything");
    }).toThrow(/reserved/);
    expect(EXTERNAL_OWNED_SCHEMA).toBe("external:owned");
    expect(EXTERNAL_KEYWORD).toBe("external");
  });
});

describe("external metadata: validate", () => {
  const run = (configPath = resolve(corpus, "manni.config.yaml")) =>
    runValidate({ cwd: corpus, configPath, inputs: [] });

  it("validates the merged object, attributing a manifest value to the manifest", async () => {
    const r = await run();
    const byFile = new Map(r.results.map((x) => [x.file, x]));

    // Everything the schema wants arrived from the manifest.
    expect(byFile.get("docs/auth.md")?.ok).toBe(true);

    // The manifest's value is wrong, and the finding says where it lives while
    // staying filed under the document.
    const billing = byFile.get("docs/billing.md");
    expect(billing?.ok).toBe(false);
    expect(billing?.errors).toHaveLength(1);
    expect(billing?.errors[0]).toMatchObject({
      keyword: "pattern",
      instancePath: "/jira",
      file: "docs-meta.yaml",
      line: 6,
    });

    // No entry: the schema's own `required` says so, against the document.
    const fresh = byFile.get("docs/new.md");
    expect(fresh?.errors.map((e) => e.keyword)).toEqual(["required"]);
    expect(fresh?.errors[0]?.file).toBeUndefined();

    // The document carries the owned key itself.
    const ops = byFile.get("docs/ops.md");
    expect(ops?.errors).toHaveLength(1);
    expect(ops?.errors[0]).toMatchObject({
      schema: "external:owned",
      keyword: "external",
      subject: "jira",
      instancePath: "/jira",
      line: 3,
    });
    expect(ops?.errors[0]?.file).toBeUndefined();
    expect(ops?.errors[0]?.message).toMatch(
      /owned by manifest docs-meta\.yaml \(collection pages\)/,
    );

    expect(r.summary.failed).toBe(3);
  });

  it("is an operational error when an entry names a document the corpus run did not load", async () => {
    await expect(run(resolve(corpus, "manni.orphan.config.yaml"))).rejects.toThrow(
      /docs-meta\.orphan\.yaml:3 names "docs\/gone\.md", which this run did not load/,
    );
  });

  it("does not check for orphans when the run is scoped to named paths", async () => {
    // The orphan config sets no schemas, so the built-in default judges the
    // file; what matters here is that the run *ran* instead of exiting 2.
    const r = await runValidate({
      cwd: corpus,
      configPath: resolve(corpus, "manni.orphan.config.yaml"),
      inputs: ["docs/auth.md"],
    });
    expect(r.results.map((x) => x.file)).toEqual(["docs/auth.md"]);
    expect(r.results[0]?.errors.every((e) => e.keyword !== "external")).toBe(true);
  });

  it("merges under positional paths too, with labels relative to cwd", async () => {
    // Labels are relative to the working directory under positional paths,
    // and so is the manifest's reported path. The schema is named on the
    // command line because the config's override points at a collection whose
    // globs are config-relative (an existing property of overrides, not of
    // external metadata). Membership is measured from the config directory either
    // way,
    // so `billing.md` is still a member of `pages`.
    const r = await runValidate({
      cwd: resolve(corpus, "docs"),
      configPath: resolve(corpus, "manni.config.yaml"),
      inputs: ["billing.md"],
      cliSchemas: [resolve(corpus, "private.schema.json")],
    });
    expect(r.results[0]?.errors[0]).toMatchObject({
      keyword: "pattern",
      file: "../docs-meta.yaml",
      line: 6,
    });
  });
});

describe("external metadata: get and query see the merged object", () => {
  it("get reads a manifest key", async () => {
    const r = await runGet({
      cwd: corpus,
      configPath: resolve(corpus, "manni.config.yaml"),
      inputs: [],
      fields: ["jira"],
    });
    const auth = r.find((x) => x.file === "docs/auth.md");
    expect(auth?.values.jira).toBe("PLAT-412");
  });

  it("query projects a manifest key as a column", async () => {
    const r = await runQuery({
      cwd: corpus,
      configPath: resolve(corpus, "manni.config.yaml"),
      inputs: [],
      sql: "SELECT _path, jira FROM docs WHERE jira = 'PLAT-412'",
      dryRun: true,
    });
    expect(r.rows).toEqual([{ _path: "docs/auth.md", jira: "PLAT-412" }]);
  });

  it("query refuses to write a manifest-owned key", async () => {
    await expect(
      runQuery({
        cwd: corpus,
        configPath: resolve(corpus, "manni.config.yaml"),
        inputs: [],
        sql: "UPDATE docs SET jira = 'PLAT-1' WHERE _path = 'docs/auth.md'",
        dryRun: true,
      }),
    ).rejects.toThrow(
      /"docs\/auth\.md": "jira" is owned by manifest docs-meta\.yaml; edit the manifest instead/,
    );
  });

  it("query refuses to delete a row whose keys a manifest owns", async () => {
    await expect(
      runQuery({
        cwd: corpus,
        configPath: resolve(corpus, "manni.config.yaml"),
        inputs: [],
        sql: "DELETE FROM docs WHERE _path = 'docs/auth.md'",
        dryRun: true,
      }),
    ).rejects.toThrow(/owned by manifest/);
  });

  it("query refuses to rename a document that has a manifest entry", async () => {
    await expect(
      runQuery({
        cwd: corpus,
        configPath: resolve(corpus, "manni.config.yaml"),
        inputs: [],
        sql: "UPDATE docs SET _path = 'docs/auth2.md' WHERE _path = 'docs/auth.md'",
        dryRun: true,
      }),
    ).rejects.toThrow(/docs-meta\.yaml names it/);
  });
});
