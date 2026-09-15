/**
 * `manni meta query` writes on manifest-owned keys (proposal 0047 §4): a
 * write to a key a local manifest owns lands in the document's manifest
 * entry, planned in phase one with the page edits, and a value its schema
 * prefers in external metadata with no manifest gets the P1 offer on a
 * terminal, or a page write plus W1 off one. Each case runs on a private
 * copy of its fixture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runQuery, type QueryOptions } from "../src/meta/commands/query.js";
import { renderQuery } from "../src/meta/reporters/query.js";
import { resetWarnings } from "../src/shared/warn.js";
import { ENCRYPTION_KEY_ENV } from "../src/shared/encryption-key.js";
import { decryptValue, isEncryptedValue } from "../src/shared/encryption.js";
import { startSchemaServer } from "./helpers/schema-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "location");
/** A fixed test key: never the developer's. */
const KEY = "0123456789abcdef0123456789abcdef";

const dirs: string[] = [];
let stderr: string[] = [];
beforeEach(() => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-${name}-`));
  dirs.push(dir);
  cpSync(join(fixtures, name), dir, { recursive: true });
  return dir;
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");
const yamlOf = (dir: string, file: string): unknown => parseYaml(read(dir, file));

function q(dir: string, sql: string, extra: Partial<QueryOptions> = {}) {
  return runQuery({ cwd: dir, inputs: [], sql, ...extra });
}

describe("query on a path-joined manifest", () => {
  it("UPDATE SET writes the document's manifest entry, not the page", async () => {
    const dir = copy("query-path");
    const run = await q(dir, "UPDATE docs SET owner = 'web' WHERE _path = 'docs/auth.md'");
    expect(run.changes).toEqual([
      { file: "docs/auth.md", key: "owner", from: "platform", to: "web", written: true, manifest: "docs-meta.yaml" },
    ]);
    expect(read(dir, "docs-meta.yaml")).toBe("# Owners, by page.\ndocs/auth.md:\n  owner: web\n  team: identity\n");
    expect(read(dir, "docs/auth.md")).toBe("---\ntitle: Auth\n---\n# Auth\n");
  });

  it("UPDATE SET creates the entry when the document has none", async () => {
    const dir = copy("query-path");
    await q(dir, "UPDATE docs SET owner = 'payments' WHERE _path = 'docs/billing.md'");
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({
      "docs/auth.md": { owner: "platform", team: "identity" },
      "docs/billing.md": { owner: "payments" },
    });
    expect(read(dir, "docs/billing.md")).toBe(read(join(fixtures, "query-path"), "docs/billing.md"));
  });

  it("SET k = NULL removes the key, and the entry once it is empty", async () => {
    const dir = copy("query-path");
    await q(dir, "UPDATE docs SET team = NULL WHERE _path = 'docs/auth.md'");
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({ "docs/auth.md": { owner: "platform" } });
    const run = await q(dir, "UPDATE docs SET owner = NULL WHERE _path = 'docs/auth.md'");
    expect(run.changes).toEqual([
      { file: "docs/auth.md", key: "owner", from: "platform", deleted: true, written: true, manifest: "docs-meta.yaml" },
    ]);
    expect(yamlOf(dir, "docs-meta.yaml")).toBeNull();
  });

  it("SET k = explicit_null() writes k: null into the entry", async () => {
    const dir = copy("query-path");
    await q(dir, "UPDATE docs SET owner = explicit_null() WHERE _path = 'docs/auth.md'");
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({ "docs/auth.md": { owner: null, team: "identity" } });
  });

  it("a key rename carries the value from the page into the manifest", async () => {
    const dir = copy("query-path");
    const run = await q(dir, "UPDATE docs SET owner = old_owner, old_owner = NULL WHERE _path = 'docs/billing.md'");
    expect(run.changes).toEqual([
      { file: "docs/billing.md", key: "owner", renamedFrom: "old_owner", to: "payments", written: true, manifest: "docs-meta.yaml" },
    ]);
    expect(read(dir, "docs/billing.md")).toBe("---\ntitle: Billing\n---\n# Billing\n");
    expect(yamlOf(dir, "docs-meta.yaml")).toMatchObject({ "docs/billing.md": { owner: "payments" } });
  });

  it("a key rename carries the value from the manifest into the page", async () => {
    const dir = copy("query-path");
    await q(dir, "UPDATE docs SET old_owner = owner, owner = NULL WHERE _path = 'docs/auth.md'");
    expect(read(dir, "docs/auth.md")).toBe("---\ntitle: Auth\nold_owner: platform\n---\n# Auth\n");
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({ "docs/auth.md": { team: "identity" } });
  });

  it("SET _path renames the manifest entry in the same apply", async () => {
    const dir = copy("query-path");
    const run = await q(dir, "UPDATE docs SET _path = 'docs/login.md' WHERE _path = 'docs/auth.md'");
    expect(run.changes).toEqual([
      { file: "docs/auth.md", renamed: "docs/login.md", written: true, manifest: "docs-meta.yaml" },
    ]);
    expect(existsSync(join(dir, "docs/login.md"))).toBe(true);
    expect(read(dir, "docs-meta.yaml")).toBe("# Owners, by page.\ndocs/login.md:\n  owner: platform\n  team: identity\n");
  });

  it("INSERT puts owned keys in a new entry and the rest in the new page", async () => {
    const dir = copy("query-path");
    const run = await q(dir, "INSERT INTO docs (_path, title, owner) VALUES ('docs/new.md', 'New', 'web')");
    expect(run.changes?.[0]).toMatchObject({ file: "docs/new.md", created: true, manifest: "docs-meta.yaml" });
    expect(read(dir, "docs/new.md")).toContain("title: New");
    expect(read(dir, "docs/new.md")).not.toContain("owner");
    expect(yamlOf(dir, "docs-meta.yaml")).toMatchObject({ "docs/new.md": { owner: "web" } });
  });

  it("DELETE strips the block and removes the document's entry", async () => {
    const dir = copy("query-path");
    const run = await q(dir, "DELETE FROM docs WHERE _path = 'docs/auth.md'");
    expect(run.changes?.[0]).toMatchObject({ file: "docs/auth.md", cleared: true, manifest: "docs-meta.yaml" });
    expect(read(dir, "docs/auth.md")).toBe("# Auth\n");
    expect(yamlOf(dir, "docs-meta.yaml")).toBeNull();
  });

  it("ALTER TABLE DROP COLUMN removes the key from every manifest entry, keys: unchanged", async () => {
    const dir = copy("query-path");
    await q(dir, "UPDATE docs SET team = 'billing' WHERE _path = 'docs/billing.md'");
    await q(dir, "ALTER TABLE docs DROP COLUMN team");
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({
      "docs/auth.md": { owner: "platform" },
    });
    expect(read(dir, "manni.config.yaml")).toContain("keys: [owner, team]");
  });

  it("--dry-run writes nothing and names the manifest in pretty and json", async () => {
    const dir = copy("query-path");
    const run = await q(dir, "UPDATE docs SET owner = 'web' WHERE _path = 'docs/billing.md'", { dryRun: true });
    expect(read(dir, "docs-meta.yaml")).toBe(read(join(fixtures, "query-path"), "docs-meta.yaml"));
    expect(JSON.parse(JSON.stringify(run.changes))).toEqual([
      { file: "docs/billing.md", key: "owner", to: "web", written: false, manifest: "docs-meta.yaml" },
    ]);
    expect(renderQuery(run, { dryRun: true })).toContain("docs/billing.md: owner: (unset) -> web  [docs-meta.yaml]");
  });

  it("writes a marked value's ciphertext into the manifest", async () => {
    const dir = copy("query-path");
    const schema = JSON.parse(read(dir, "steward.schema.json")) as { properties: Record<string, object> };
    schema.properties.owner = { ...schema.properties.owner, "x-manni-encrypt": true };
    writeFileSync(join(dir, "steward.schema.json"), JSON.stringify(schema));
    const run = await q(dir, "UPDATE docs SET owner = 'web' WHERE _path = 'docs/auth.md'", { env: { [ENCRYPTION_KEY_ENV]: KEY } });
    expect(run.changes?.[0]).toMatchObject({ to: "(encrypted)", manifest: "docs-meta.yaml" });
    const held = (yamlOf(dir, "docs-meta.yaml") as Record<string, { owner: unknown }>)["docs/auth.md"]?.owner;
    expect(typeof held === "string" && isEncryptedValue(held)).toBe(true);
    const opened = decryptValue(held as string, KEY, "meta");
    expect(opened.ok && opened.value).toBe("web");
  });

  it("DELETE of a page with no block removes only its manifest entry", async () => {
    const dir = copy("query-path");
    writeFileSync(join(dir, "docs/auth.md"), "# Auth\n");
    const run = await q(dir, "DELETE FROM docs WHERE _path = 'docs/auth.md'");
    expect(run.changes?.[0]).toMatchObject({ file: "docs/auth.md", cleared: true, manifest: "docs-meta.yaml" });
    expect(read(dir, "docs/auth.md")).toBe("# Auth\n");
    expect(yamlOf(dir, "docs-meta.yaml")).toBeNull();
  });

  it("refuses a _path move that takes a named document out of its manifest's collection", async () => {
    const dir = copy("query-path");
    await expect(q(dir, "UPDATE docs SET _path = 'notes/auth.md' WHERE _path = 'docs/auth.md'")).rejects.toThrow(
      '"docs/auth.md" -> "notes/auth.md": manifest docs-meta.yaml names it, and the new path is not a page of collection site; keep the move inside the collection, or edit the manifest first.',
    );
    expect(existsSync(join(dir, "docs/auth.md"))).toBe(true);
  });

  it("refuses RENAME COLUMN of an owned key with the existing message", async () => {
    const dir = copy("query-path");
    await expect(q(dir, "ALTER TABLE docs RENAME COLUMN owner TO steward")).rejects.toThrow(
      '"docs/auth.md": "owner" is owned by manifest docs-meta.yaml; edit the manifest instead.',
    );
    expect(read(dir, "steward.schema.json")).toBe(read(join(fixtures, "query-path"), "steward.schema.json"));
  });

  it("refuses any write to a URL manifest (M6), before anything is written", async () => {
    const server = await startSchemaServer({
      "/owners.yaml": { body: "docs/auth.md:\n  owner: platform\n", contentType: "text/yaml" },
    });
    try {
      const dir = copy("query-path");
      writeFileSync(
        join(dir, "manni.config.yaml"),
        [
          "meta:",
          "  schemas: [./steward.schema.json]",
          "collections:",
          "  - name: site",
          '    paths: ["docs/**/*.md"]',
          "    externalMetadata:",
          "      - file: ./docs-meta.yaml",
          "        keys: [team]",
          `      - file: ${server.url}/owners.yaml`,
          "        keys: [owner]",
          "",
        ].join("\n"),
      );
      writeFileSync(join(dir, "docs-meta.yaml"), "docs/auth.md:\n  team: identity\n");
      await expect(
        q(dir, "UPDATE docs SET team = 'web', owner = 'web' WHERE _path = 'docs/auth.md'"),
      ).rejects.toThrow(
        `"owner" is owned by manifest ${server.url}/owners.yaml, which is fetched and cannot be written; set it in that repository.`,
      );
      expect(read(dir, "docs-meta.yaml")).toBe("docs/auth.md:\n  team: identity\n");
    } finally {
      await server.close();
    }
  });
});

describe("query: a manifest of a collection --collection leaves out", () => {
  it("refuses to write into it at plan time, and writes nothing", async () => {
    const dir = copy("query-path");
    writeFileSync(
      join(dir, "manni.config.yaml"),
      [
        "meta:",
        "  schemas: [./steward.schema.json]",
        "collections:",
        "  - name: a",
        '    paths: ["docs/**/*.md"]',
        "  - name: b",
        '    paths: ["docs/**/*.md"]',
        "    externalMetadata:",
        "      - file: ./docs-meta.yaml",
        "        keys: [owner, team]",
        "",
      ].join("\n"),
    );
    await expect(
      q(dir, "UPDATE docs SET owner = 'x' WHERE owner IS NULL", { collections: ["a"] }),
    ).rejects.toThrow(
      '"docs/auth.md": "owner" is owned by manifest docs-meta.yaml of collection b, which --collection leaves out; include it or edit the manifest.',
    );
    expect(read(dir, "docs-meta.yaml")).toBe(read(join(fixtures, "query-path"), "docs-meta.yaml"));
    expect(read(dir, "docs/billing.md")).toBe(read(join(fixtures, "query-path"), "docs/billing.md"));
  });

  it("refuses a _path move of a page that manifest names, and moves nothing", async () => {
    const dir = copy("query-narrow-path");
    await expect(
      q(dir, "UPDATE docs SET _path = 'docs/moved.md' WHERE _path = 'docs/x.md'", { collections: ["a"] }),
    ).rejects.toThrow(
      '"docs/x.md": manifest b-meta.yaml of collection b names it, which --collection leaves out; include it or rename the entry first.',
    );
    expect(existsSync(join(dir, "docs/x.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/moved.md"))).toBe(false);
    expect(read(dir, "b-meta.yaml")).toBe(read(join(fixtures, "query-narrow-path"), "b-meta.yaml"));
  });

  it("moves a page that manifest does not name", async () => {
    const dir = copy("query-narrow-path");
    await q(dir, "UPDATE docs SET _path = 'docs/moved.md' WHERE _path = 'docs/y.md'", { collections: ["a"] });
    expect(existsSync(join(dir, "docs/moved.md"))).toBe(true);
    expect(read(dir, "b-meta.yaml")).toBe(read(join(fixtures, "query-narrow-path"), "b-meta.yaml"));
  });

  it("refuses a DELETE of a page that manifest names by path, and strips nothing", async () => {
    const dir = copy("query-narrow-path");
    await expect(q(dir, "DELETE FROM docs WHERE _path = 'docs/x.md'", { collections: ["a"] })).rejects.toThrow(
      '"docs/x.md": manifest b-meta.yaml of collection b names it, which --collection leaves out; include it or remove the entry first.',
    );
    expect(read(dir, "docs/x.md")).toBe(read(join(fixtures, "query-narrow-path"), "docs/x.md"));
    expect(read(dir, "b-meta.yaml")).toBe(read(join(fixtures, "query-narrow-path"), "b-meta.yaml"));
  });

  it("refuses a DELETE that would strip the join value that manifest matches", async () => {
    const dir = copy("query-narrow-join");
    await expect(q(dir, "DELETE FROM docs WHERE _path = 'docs/x.md'", { collections: ["a"] })).rejects.toThrow(
      '"docs/x.md": manifest b-meta.yaml of collection b names it, which --collection leaves out; include it or remove the entry first.',
    );
    expect(read(dir, "docs/x.md")).toBe(read(join(fixtures, "query-narrow-join"), "docs/x.md"));
  });

  it("moves a page that manifest names by a field, which the page carries with it", async () => {
    const dir = copy("query-narrow-join");
    await q(dir, "UPDATE docs SET _path = 'docs/moved.md' WHERE _path = 'docs/x.md'", { collections: ["a"] });
    expect(read(dir, "docs/moved.md")).toBe(read(join(fixtures, "query-narrow-join"), "docs/x.md"));
    expect(read(dir, "b-meta.yaml")).toBe(read(join(fixtures, "query-narrow-join"), "b-meta.yaml"));
  });
});

describe("query on a field-joined manifest", () => {
  it("UPDATE SET writes the entry keyed by the page's join value", async () => {
    const dir = copy("query-join");
    await q(dir, "UPDATE docs SET owner = 'web' WHERE _path = 'docs/auth.md'");
    expect(read(dir, "docs-meta.yaml")).toBe("auth-guide:\n  owner: web\n");
  });

  it("refuses a page that lacks the join value, and writes nothing (all-or-nothing)", async () => {
    const dir = copy("query-join");
    await expect(q(dir, "UPDATE docs SET owner = 'web', title = 'T'")).rejects.toThrow(
      '"docs/noid.md": "owner" is owned by manifest docs-meta.yaml, which joins on "id", and this document has no id; set id first.',
    );
    expect(read(dir, "docs-meta.yaml")).toBe("auth-guide:\n  owner: platform\n");
    expect(read(dir, "docs/auth.md")).toBe("---\nid: auth-guide\ntitle: Auth\n---\n# Auth\n");
  });

  it("DELETE strips the block and removes the entry the join value matched", async () => {
    const dir = copy("query-join");
    await q(dir, "DELETE FROM docs WHERE _path = 'docs/auth.md'");
    expect(read(dir, "docs/auth.md")).toBe("# Auth\n");
    expect(yamlOf(dir, "docs-meta.yaml")).toBeNull();
  });

  it("refuses a new join value that names another document's entry, and writes nothing", async () => {
    const dir = copy("query-join");
    await expect(
      q(dir, "UPDATE docs SET id = 'auth-guide', owner = 'hijack' WHERE _path = 'docs/noid.md'"),
    ).rejects.toThrow(
      '"docs/noid.md": "id" "auth-guide" names the entry of another document in manifest docs-meta.yaml; choose another value.',
    );
    await expect(q(dir, "UPDATE docs SET id = 'auth-guide' WHERE _path = 'docs/noid.md'")).rejects.toThrow(
      '"docs/noid.md": "id" "auth-guide" names the entry of another document in manifest docs-meta.yaml; choose another value.',
    );
    expect(read(dir, "docs-meta.yaml")).toBe("auth-guide:\n  owner: platform\n");
    expect(read(dir, "docs/noid.md")).toBe("---\ntitle: No id\n---\n# No id\n");
  });

  it("refuses an INSERT whose join value names an existing entry", async () => {
    const dir = copy("query-join");
    await expect(
      q(dir, "INSERT INTO docs (_path, id, owner) VALUES ('docs/new.md', 'auth-guide', 'hijack')"),
    ).rejects.toThrow(
      '"docs/new.md": "id" "auth-guide" names the entry of another document in manifest docs-meta.yaml; choose another value.',
    );
    expect(read(dir, "docs-meta.yaml")).toBe("auth-guide:\n  owner: platform\n");
    expect(existsSync(join(dir, "docs/new.md"))).toBe(false);
  });

  it("a new join value no entry names gets a new entry", async () => {
    const dir = copy("query-join");
    await q(dir, "UPDATE docs SET id = 'fresh', owner = 'web' WHERE _path = 'docs/noid.md'");
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({ "auth-guide": { owner: "platform" }, fresh: { owner: "web" } });
  });

  it("still refuses changing the join field of a document with an entry", async () => {
    const dir = copy("query-join");
    await expect(q(dir, "UPDATE docs SET id = 'other' WHERE _path = 'docs/auth.md'")).rejects.toThrow(
      '"docs/auth.md": "id" is the field manifest docs-meta.yaml joins on, and this document has an entry; change the manifest first.',
    );
  });
});

describe("query: a value that prefers external metadata with no manifest (P1, W1)", () => {
  const wrote = (): string => stderr.join("");

  it("off a terminal: writes the pages and warns once per collection (W1)", async () => {
    const dir = copy("query-path");
    const run = await q(dir, "UPDATE docs SET reviewer = 'ada'");
    expect(run.changes?.every((c) => !("manifest" in c))).toBe(true);
    expect(read(dir, "docs/auth.md")).toContain("reviewer: ada");
    expect(wrote()).toBe(
      "manni: wrote reviewer to 2 pages in collection site; the schema prefers external metadata, and no manifest owns it. Run manni meta relocate to move it.\n",
    );
  });

  it("under --dry-run the warning reads would write, and nothing is asked", async () => {
    const dir = copy("query-path");
    const confirm = vi.fn(() => Promise.resolve(true));
    await q(dir, "UPDATE docs SET reviewer = 'ada'", { dryRun: true, confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(wrote()).toContain("manni: would write reviewer to 2 pages in collection site;");
  });

  it("with no collections: the give-it-a-manifest wording", async () => {
    const dir = copy("query-path");
    writeFileSync(join(dir, "manni.config.yaml"), "meta:\n  schemas: [./steward.schema.json]\n");
    await q(dir, "UPDATE docs SET reviewer = 'ada' WHERE _path = 'docs/billing.md'", { inputs: ["docs/"] });
    expect(wrote()).toBe(
      "manni: wrote reviewer to 1 page; the schema prefers external metadata. Run manni meta relocate to give it a manifest.\n",
    );
  });

  it("a page in none of several collections gets W2", async () => {
    const dir = copy("query-path");
    writeFileSync(
      join(dir, "manni.config.yaml"),
      [
        "meta:",
        "  schemas: [./steward.schema.json]",
        "collections:",
        "  - name: a",
        '    paths: ["a/**"]',
        "  - name: b",
        '    paths: ["b/**"]',
        "",
      ].join("\n"),
    );
    await q(dir, "UPDATE docs SET reviewer = 'ada'", { inputs: ["docs/"] });
    expect(wrote()).toBe(
      "manni: wrote reviewer to 2 pages that are in none of the 2 collections; the schema prefers external metadata, and only a collection has a manifest.\n",
    );
  });

  it("on a terminal, yes: relocates, then the write lands in the manifest (P1)", async () => {
    const dir = copy("query-path");
    const notices: string[] = [];
    const questions: string[] = [];
    const relocated = vi.fn();
    const run = await q(dir, "UPDATE docs SET reviewer = 'ada'", {
      onNotice: (m) => notices.push(m),
      confirm: (question) => {
        questions.push(question);
        return Promise.resolve(true);
      },
      onRelocated: relocated,
    });
    expect(notices).toContain(
      "collection site has no manifest for reviewer, which the schema prefers in external metadata.",
    );
    expect(questions).toEqual(["Add reviewer to docs-meta.yaml's keys? "]);
    expect(relocated).toHaveBeenCalledTimes(1);
    expect(run.changes?.every((c) => "manifest" in c && c.manifest === "docs-meta.yaml")).toBe(true);
    expect(read(dir, "manni.config.yaml")).toContain("keys: [owner, team, reviewer]");
    expect(yamlOf(dir, "docs-meta.yaml")).toEqual({
      "docs/auth.md": { owner: "platform", team: "identity", reviewer: "ada" },
      "docs/billing.md": { reviewer: "ada" },
    });
    expect(read(dir, "docs/auth.md")).not.toContain("reviewer");
    expect(wrote()).toBe("");
  });

  it("on a terminal, no: writes the pages and warns (W1)", async () => {
    const dir = copy("query-path");
    const run = await q(dir, "UPDATE docs SET reviewer = 'ada'", {
      onNotice: () => undefined,
      confirm: () => Promise.resolve(false),
    });
    expect(run.changes?.some((c) => "manifest" in c)).toBe(false);
    expect(read(dir, "docs/billing.md")).toContain("reviewer: ada");
    expect(read(dir, "manni.config.yaml")).toContain("keys: [owner, team]\n");
    expect(wrote()).toContain("manni: wrote reviewer to 2 pages in collection site;");
  });
});
