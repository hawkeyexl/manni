/**
 * Sidecar metadata (proposal 0034): a private manifest joined to public
 * documents.
 *
 * The rules under test, each from a proposal this one inherits:
 *
 *  - A sidecar's keys are merged into the document before schema resolution,
 *    so `validate`, `get`, `query` and `fill` all see one object (0005).
 *  - A document carrying a sidecar-owned key is a finding, not a tiebreak
 *    (0020: the discarded value is exactly the one nobody checked).
 *  - A violation on a sidecar-sourced value names the manifest file and line,
 *    while the finding's subject file stays the document (0001: identity).
 *  - A manifest entry naming a document the run did not load is exit 2, when
 *    the run is the config corpus (0014, 0026 §4).
 *  - A manifest that cannot be read or does not fit the shape is exit 2.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseConfig } from "../src/meta/core/config.js";
import {
  loadSidecars,
  mergeSidecars,
  orphanEntries,
  SIDECAR_OWNED_SCHEMA,
  SIDECAR_KEYWORD,
} from "../src/meta/core/sidecars.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { runGet } from "../src/meta/commands/get.js";
import { runQuery } from "../src/meta/commands/query.js";
import { DocmetaError, type ExtractedMetadata } from "../src/meta/types.js";
import { assertPublishableBuiltinId } from "../src/meta/core/schema-registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "fixtures", "sidecars");

const CONFIG = parseConfig(
  ["sidecars:", "  - file: ./docs-meta.yaml", "    keys: [source, jira]"].join(
    "\n",
  ),
  "manni.config.yaml",
);

function doc(data: Record<string, unknown>, lines: Record<string, number> = {}): ExtractedMetadata {
  return {
    data,
    present: true,
    format: "markdown",
    lineFor: (pointer) => lines[pointer.replace(/^\//, "")],
  };
}

describe("sidecars: loading a manifest", () => {
  it("returns null when the config declares no sidecars", async () => {
    expect(await loadSidecars(null, { configDir: corpus, base: corpus })).toBeNull();
    expect(await loadSidecars({}, { configDir: corpus, base: corpus })).toBeNull();
  });

  it("indexes entries by absolute document path, with the manifest line of each key", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    expect(index).not.toBeNull();
    const auth = index?.byPath.get(resolve(corpus, "docs/auth.md"));
    expect(auth?.get("source")).toEqual({
      value: "internal/auth-design.md",
      file: "docs-meta.yaml",
      line: 3,
    });
    expect(auth?.get("jira")?.line).toBe(4);
    expect(index?.owners.get("jira")).toBe("docs-meta.yaml");
    expect(index?.entries.map((e) => e.spelled)).toEqual([
      "docs/auth.md",
      "docs/billing.md",
      "docs/ops.md",
    ]);
  });

  it("reports the manifest path relative to the run's base", async () => {
    const index = await loadSidecars(CONFIG, {
      configDir: corpus,
      base: resolve(corpus, "docs"),
    });
    expect(index?.owners.get("jira")).toBe("../docs-meta.yaml");
  });

  const bad = (file: string) =>
    loadSidecars(
      { sidecars: [{ file, keys: ["jira"] }] },
      { configDir: corpus, base: corpus },
    );

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

  it("is an operational error when an entry supplies a key the sidecar does not own", async () => {
    await expect(bad("./bad-unowned-key.yaml")).rejects.toThrow(
      /bad-unowned-key\.yaml:1: "docs\/auth\.md" sets "team", which this sidecar does not own/,
    );
  });

  it("refuses $schema in an entry by name", async () => {
    await expect(bad("./bad-schema-key.yaml")).rejects.toThrow(
      /never chooses the schema/,
    );
  });
});

describe("sidecars: merging into a document", () => {
  it("adds the owned keys and locates each at its manifest line", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    const merged = mergeSidecars("docs/auth.md", doc({ title: "Auth" }), index, corpus);
    expect(merged.extracted.data).toEqual({
      title: "Auth",
      source: "internal/auth-design.md",
      jira: "PLAT-412",
    });
    expect(merged.collisions).toEqual([]);
    expect(merged.locate("/jira")).toEqual({ file: "docs-meta.yaml", line: 4 });
    expect(merged.locate("jira")).toEqual({ file: "docs-meta.yaml", line: 4 });
    expect(merged.locate("/title")).toBeUndefined();
    // The document's own positions are untouched: a sidecar key is not in it.
    expect(merged.extracted.lineFor("jira")).toBeUndefined();
  });

  it("leaves present, format and the document's positions alone", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    const original = doc({ title: "Auth" }, { title: 2 });
    const merged = mergeSidecars("docs/auth.md", original, index, corpus);
    expect(merged.extracted.present).toBe(true);
    expect(merged.extracted.format).toBe("markdown");
    expect(merged.extracted.lineFor("title")).toBe(2);
  });

  it("reports a document carrying an owned key as a collision, keeping the document's value", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    const merged = mergeSidecars(
      "docs/ops.md",
      doc({ title: "Ops", jira: "PLAT-9" }, { jira: 3 }),
      index,
      corpus,
    );
    expect(merged.collisions).toEqual(["jira"]);
    expect(merged.extracted.data.jira).toBe("PLAT-9");
    expect(merged.locate("/jira")).toBeUndefined();
  });

  it("flags an owned key in a document that has no manifest entry at all", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    const merged = mergeSidecars("docs/new.md", doc({ jira: "PLAT-1" }), index, corpus);
    expect(merged.collisions).toEqual(["jira"]);
  });

  it("is a pass-through with no index", () => {
    const original = doc({ title: "t" });
    const merged = mergeSidecars("docs/x.md", original, null, corpus);
    expect(merged.extracted).toBe(original);
    expect(merged.collisions).toEqual([]);
    expect(merged.locate("/title")).toBeUndefined();
  });

  it("never merges into stdin", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    const merged = mergeSidecars("<stdin>", doc({ title: "t" }), index, corpus);
    expect(merged.extracted.data).toEqual({ title: "t" });
  });
});

describe("sidecars: orphan entries", () => {
  it("names every entry the run did not load", async () => {
    const index = await loadSidecars(
      { sidecars: [{ file: "./docs-meta.orphan.yaml", keys: ["jira"] }] },
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
});

describe("sidecars: the finding identity", () => {
  it("reserves the sidecar namespace beside check:", () => {
    expect(() => {
      assertPublishableBuiltinId("sidecar:anything");
    }).toThrow(/reserved/);
    expect(SIDECAR_OWNED_SCHEMA).toBe("sidecar:owned");
    expect(SIDECAR_KEYWORD).toBe("sidecar");
  });
});

describe("sidecars: validate", () => {
  const run = (configPath = resolve(corpus, "manni.config.yaml")) =>
    runValidate({ cwd: corpus, configPath, inputs: [] });

  it("validates the merged object, attributing a sidecar value to the manifest", async () => {
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
      schema: "sidecar:owned",
      keyword: "sidecar",
      subject: "jira",
      instancePath: "/jira",
      line: 3,
    });
    expect(ops?.errors[0]?.file).toBeUndefined();
    expect(ops?.errors[0]?.message).toMatch(/owned by sidecar docs-meta\.yaml/);

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
    expect(r.results[0]?.errors.every((e) => e.keyword !== "sidecar")).toBe(true);
  });

  it("merges under positional paths too, with labels relative to cwd", async () => {
    // Labels are relative to the working directory under positional paths,
    // and so is the manifest's reported path. The schema is named on the
    // command line because the config's override glob is written for
    // config-relative labels (an existing property of overrides, not of
    // sidecars).
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

describe("sidecars: get and query see the merged object", () => {
  it("get reads a sidecar key", async () => {
    const r = await runGet({
      cwd: corpus,
      configPath: resolve(corpus, "manni.config.yaml"),
      inputs: [],
      fields: ["jira"],
    });
    const auth = r.find((x) => x.file === "docs/auth.md");
    expect(auth?.values.jira).toBe("PLAT-412");
  });

  it("query projects a sidecar key as a column", async () => {
    const r = await runQuery({
      cwd: corpus,
      configPath: resolve(corpus, "manni.config.yaml"),
      inputs: [],
      sql: "SELECT _path, jira FROM docs WHERE jira = 'PLAT-412'",
      dryRun: true,
    });
    expect(r.rows).toEqual([{ _path: "docs/auth.md", jira: "PLAT-412" }]);
  });

  it("query refuses to write a sidecar-owned key", async () => {
    await expect(
      runQuery({
        cwd: corpus,
        configPath: resolve(corpus, "manni.config.yaml"),
        inputs: [],
        sql: "UPDATE docs SET jira = 'PLAT-1' WHERE _path = 'docs/auth.md'",
        dryRun: true,
      }),
    ).rejects.toThrow(
      /"docs\/auth\.md": "jira" is owned by sidecar docs-meta\.yaml; edit the sidecar file instead/,
    );
  });

  it("query refuses to delete a row whose keys a sidecar owns", async () => {
    await expect(
      runQuery({
        cwd: corpus,
        configPath: resolve(corpus, "manni.config.yaml"),
        inputs: [],
        sql: "DELETE FROM docs WHERE _path = 'docs/auth.md'",
        dryRun: true,
      }),
    ).rejects.toThrow(/owned by sidecar/);
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
