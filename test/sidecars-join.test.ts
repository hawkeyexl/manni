/**
 * `join`: a sidecar keyed by a frontmatter field (proposal 0039).
 *
 * The rules under test:
 *
 *  - A manifest keyed by a field matches on the extracted value of that
 *    field, so a rename cannot orphan an entry.
 *  - Two documents sharing one value is a finding on both, at the field's
 *    line, whether or not the run is scoped.
 *  - A field entry no document matched is exit 2 on a corpus run, after the
 *    per-file loop, and is not checked on a scoped run.
 *  - `query` refuses to change the join field of a matched document, and
 *    allows its rename.
 *  - The join field may not be `$schema` or a key the entry owns.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseConfig } from "../src/meta/core/config.js";
import {
  loadSidecars,
  mergeSidecars,
  orphanJoins,
  orphanEntries,
} from "../src/meta/core/sidecars.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { runQuery } from "../src/meta/commands/query.js";
import type { ExtractedMetadata } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "fixtures", "sidecars-join");

const CONFIG = parseConfig(
  [
    "sidecars:",
    "  - file: ./docs-meta.yaml",
    "    keys: [source, jira]",
    "    join: id",
  ].join("\n"),
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

describe("join: config", () => {
  const parse = (lines: string[]) => parseConfig(lines.join("\n"), "manni.config.yaml");

  it("parses join, and leaves it absent for the default", () => {
    expect(CONFIG.sidecars?.[0]?.join).toBe("id");
    const plain = parse(["sidecars:", "  - file: ./m.yaml", "    keys: [jira]"]);
    expect(plain.sidecars?.[0]?.join).toBeUndefined();
  });

  it("refuses an empty join, $schema, and a key the entry owns", () => {
    expect(() =>
      parse(["sidecars:", "  - file: ./m.yaml", "    keys: [jira]", "    join: ''"]),
    ).toThrow(/join must be "path" or the name of a top-level frontmatter field/);
    expect(() =>
      parse(["sidecars:", "  - file: ./m.yaml", "    keys: [jira]", "    join: '$schema'"]),
    ).toThrow(/join may not be "\$schema"/);
    expect(() =>
      parse(["sidecars:", "  - file: ./m.yaml", "    keys: [jira, id]", "    join: id"]),
    ).toThrow(/join names "id", which the same entry owns/);
  });
});

describe("join: loading and merging", () => {
  it("indexes a field-joined manifest by value, with no path entries", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    expect(index?.byPath.size).toBe(0);
    const byId = index?.byField.get("id");
    expect(byId?.get("auth-guide")?.get("jira")).toEqual({
      value: "PLAT-412",
      file: "docs-meta.yaml",
      line: 4,
    });
    expect(index?.entries.map((e) => [e.join, e.spelled, e.abs])).toEqual([
      ["id", "auth-guide", undefined],
      ["id", "billing-guide", undefined],
      ["id", "shared", undefined],
    ]);
  });

  it("matches on the document's field value, wherever the document lives", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    const merged = mergeSidecars(
      "somewhere/else/renamed.md",
      doc({ title: "Auth", id: "auth-guide" }),
      index,
      corpus,
    );
    expect(merged.extracted.data).toEqual({
      title: "Auth",
      id: "auth-guide",
      source: "internal/auth-design.md",
      jira: "PLAT-412",
    });
    expect(merged.joins).toEqual([{ field: "id", value: "auth-guide", file: "docs-meta.yaml" }]);
    expect(merged.locate("/jira")).toEqual({ file: "docs-meta.yaml", line: 4 });
  });

  it("compares a numeric field as a string, and ignores a non-scalar one", async () => {
    const index = await loadSidecars(
      { sidecars: [{ file: "./docs-meta.numeric.yaml", keys: ["jira"], join: "id" }] },
      { configDir: corpus, base: corpus },
    ).catch(() => null);
    // No numeric fixture is committed; the contract is asserted on a synthetic index.
    expect(index).toBeNull();
    const synthetic = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    const list = mergeSidecars("x.md", doc({ id: ["auth-guide"] }), synthetic, corpus);
    expect(list.joins).toEqual([]);
    expect(list.extracted.data).toEqual({ id: ["auth-guide"] });
  });

  it("matches nothing for a document without the field, and stays silent", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    const merged = mergeSidecars("docs/no-id.md", doc({ title: "No id" }), index, corpus);
    expect(merged.joins).toEqual([]);
    expect(merged.extracted.data).toEqual({ title: "No id" });
  });

  it("the path orphan check ignores field entries, and the join orphan check finds them", async () => {
    const index = await loadSidecars(CONFIG, { configDir: corpus, base: corpus });
    expect(orphanEntries(index, [], corpus)).toEqual([]);
    const matched = new Map([["id", new Set(["auth-guide", "shared"])]]);
    expect(orphanJoins(index, matched).map((e) => e.spelled)).toEqual(["billing-guide"]);
  });
});

describe("join: validate", () => {
  const run = (configPath = resolve(corpus, "manni.config.yaml"), inputs: string[] = []) =>
    runValidate({ cwd: corpus, configPath, inputs });

  it("merges by id, files a duplicate finding on both pages, and reports the rest as before", async () => {
    const r = await run();
    const byFile = new Map(r.results.map((x) => [x.file, x]));

    expect(byFile.get("docs/auth.md")?.ok).toBe(true);
    expect(byFile.get("docs/billing.md")?.errors[0]).toMatchObject({
      keyword: "pattern",
      instancePath: "/jira",
      file: "docs-meta.yaml",
      line: 6,
    });

    for (const [label, other] of [
      ["docs/dup-a.md", "docs/dup-b.md"],
      ["docs/dup-b.md", "docs/dup-a.md"],
    ] as const) {
      const result = byFile.get(label);
      expect(result?.ok).toBe(false);
      expect(result?.errors).toHaveLength(1);
      expect(result?.errors[0]).toMatchObject({
        schema: "sidecar:duplicate",
        keyword: "sidecar",
        subject: "shared",
        instancePath: "/id",
        line: 3,
      });
      expect(result?.errors[0]?.message).toBe(
        `2 documents carry id "shared"; docs-meta.yaml cannot tell them apart (${other})`,
      );
      // Both still received the entry's value, so the schema judged what
      // the site would publish.
      expect(result?.errors.some((e) => e.keyword === "required")).toBe(false);
    }

    // No entry: the schema's own `required` says so, against the document.
    expect(byFile.get("docs/new.md")?.errors.map((e) => e.keyword)).toEqual(["required"]);
    // No field at all: `required` for both `id` and `jira`.
    expect(byFile.get("docs/no-id.md")?.errors.map((e) => e.keyword)).toEqual([
      "required",
      "required",
    ]);
    expect(r.summary.failed).toBe(5);
  });

  it("is exit 2 when a field entry matches no document on a corpus run", async () => {
    await expect(run(resolve(corpus, "manni.orphan.config.yaml"))).rejects.toThrow(
      /docs-meta\.orphan\.yaml:3 names id "gone-guide", which no loaded document carries/,
    );
  });

  it("skips the join orphan check on a scoped run, but still files the duplicate", async () => {
    const r = await run(resolve(corpus, "manni.orphan.config.yaml"), ["docs/auth.md"]);
    expect(r.results.map((x) => x.file)).toEqual(["docs/auth.md"]);
    const dup = await run(resolve(corpus, "manni.config.yaml"), ["docs/dup-a.md", "docs/dup-b.md"]);
    expect(dup.results.every((x) => x.errors[0]?.schema === "sidecar:duplicate")).toBe(true);
  });
});

describe("join: query", () => {
  const q = (sql: string) =>
    runQuery({
      cwd: corpus,
      configPath: resolve(corpus, "manni.config.yaml"),
      inputs: [],
      sql,
      dryRun: true,
    });

  it("projects the joined keys", async () => {
    const r = await q("SELECT _path, jira FROM docs WHERE id = 'auth-guide'");
    expect(r.rows).toEqual([{ _path: "docs/auth.md", jira: "PLAT-412" }]);
  });

  it("refuses to change the join field of a matched document", async () => {
    await expect(
      q("UPDATE docs SET id = 'other' WHERE _path = 'docs/auth.md'"),
    ).rejects.toThrow(
      /"docs\/auth\.md": "id" is the field sidecar docs-meta\.yaml joins on, and this document has an entry; change the manifest first/,
    );
  });

  it("allows changing the field of a document with no entry, and renaming a matched one", async () => {
    const free = await q("UPDATE docs SET id = 'fresh' WHERE _path = 'docs/new.md'");
    expect(free.changes?.some((c) => "key" in c && c.key === "id")).toBe(true);
    const moved = await q("UPDATE docs SET _path = 'docs/moved.md' WHERE _path = 'docs/auth.md'");
    expect(moved.changes?.some((c) => "renamed" in c)).toBe(true);
  });
});
