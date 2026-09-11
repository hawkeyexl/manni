import { describe, it, expect, afterAll } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery, type QueryOptions } from "../src/meta/commands/query.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { loadSqlite } from "../src/meta/core/projection.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "fixtures", "collections");

/**
 * All cases run over `test/fixtures/collections/`: a config declaring three
 * collections (proposal 0041, which supersedes 0027) — `pages` over the whole
 * corpus, `authors` over the authors directory and `notes` over a deep-file
 * glob — with an override pointing at the last two and none at `pages`. An
 * `authors/` and `docs/` split, one file belonging to all three collections,
 * and one file naming its own `$schema`. Inputs come from the config's
 * `collections:`, so the run is the config-resolved corpus.
 */
function q(sql: string, extra: Partial<QueryOptions> = {}) {
  return runQuery({ sql, inputs: [], cwd: corpus, ...extra });
}

const tempDirs: string[] = [];
function tempCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "docmeta-collections-"));
  tempDirs.push(dir);
  cpSync(corpus, dir, { recursive: true });
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("collections (0041): views over membership", () => {
  it("a collection is a view of the members the run loaded", async () => {
    const run = await q("SELECT _path FROM authors ORDER BY _path");
    expect(run.rows).toEqual([
      { _path: "authors/ada.md" },
      { _path: "authors/deep.md" },
      { _path: "authors/grace.md" },
      { _path: "authors/self.md" },
    ]);
  });

  it("views overlap: a file in two collections appears in both", async () => {
    // 0041 rule 7, and the reversal of 0027's disjointness: membership is what
    // the config says the set contains, not which override won resolution, so
    // authors/deep.md is in `notes` *and* in `authors` — and in `pages` too.
    const notes = await q("SELECT _path FROM notes ORDER BY _path");
    expect(notes.rows).toEqual([{ _path: "authors/deep.md" }]);
    const both = await q(
      `SELECT a._path FROM authors a JOIN notes n ON n._path = a._path`,
    );
    expect(both.rows).toEqual([{ _path: "authors/deep.md" }]);
    const pages = await q(
      "SELECT count(*) AS n FROM pages WHERE _path = 'authors/deep.md'",
    );
    expect(pages.rows).toEqual([{ n: 1 }]);
  });

  it("a collection no override points at is still a view", async () => {
    // `pages` carries no `overrides[].collection`, so under 0027 it had no
    // view at all and `FROM pages` was a SQL error. It is a declared
    // collection, so it is a view.
    const run = await q("SELECT count(*) AS n FROM pages");
    expect(run.rows).toEqual([{ n: 6 }]);
  });

  it("a view with no loaded members is empty, not missing", async () => {
    // Positional `docs` loads no authors file, so `authors` and `notes` hold
    // nothing. 0014's rule is about the run's inputs, not about a view: a
    // query naming a declared collection must answer, not fail.
    const run = await runQuery({
      sql: "SELECT count(*) AS n FROM authors",
      inputs: ["docs"],
      cwd: corpus,
    });
    expect(run.rows).toEqual([{ n: 0 }]);
    const notes = await runQuery({
      sql: "SELECT _path FROM notes",
      inputs: ["docs"],
      cwd: corpus,
    });
    expect(notes.rows).toEqual([]);
  });

  it("a collection --collection did not select is still a view", async () => {
    // 0041 rule 11: every *declared* collection gets its view, so narrowing
    // the run never turns `FROM pages` into `no such table`. The view holds
    // the members the run loaded — authors/deep.md belongs to all three.
    const run = await runQuery({
      sql: "SELECT _path FROM pages ORDER BY _path",
      inputs: [],
      cwd: corpus,
      collections: ["notes"],
    });
    expect(run.rows).toEqual([{ _path: "authors/deep.md" }]);
  });

  it("the flagship join reads FROM authors instead of a GLOB self-join", async () => {
    const run = await q(
      `SELECT d._path, d.author FROM docs d
       LEFT JOIN authors a ON a.slug = d.author
       WHERE d.author IS NOT NULL AND a._path IS NULL`,
    );
    expect(run.rows).toEqual([{ _path: "docs/guide.md", author: "ghost" }]);
  });

  it("a file's own $schema does not move it out of the view, and says nothing", async () => {
    // 0027 § stress test 1 emitted a notice here, because membership followed
    // schema resolution. Under 0041 membership is the config's globs, so
    // authors/self.md is a plain member and there is nothing to explain.
    const notices: string[] = [];
    const run = await q("SELECT _path FROM authors WHERE _path LIKE '%self%'", {
      onNotice: (m) => notices.push(m),
    });
    expect(run.rows).toEqual([{ _path: "authors/self.md" }]);
    expect(notices).toEqual([]);
  });

  it("schemaTrust does not touch membership: a plain read resolves no schemas", async () => {
    // 0021's founding rule, which 0027 had to bend and 0041 restores. A
    // document `$schema` the trust settings would refuse cannot reach a view:
    // no resolution runs, so there is no refusal to demote a file over and no
    // notice to print, and the SELECT is unaffected.
    const dir = tempCopy();
    writeFileSync(
      join(dir, "manni.config.yaml"),
      `${readFileSync(join(dir, "manni.config.yaml"), "utf8")}  schemaTrust:\n    documentRefs: local\n`,
    );
    writeFileSync(
      join(dir, "authors", "url.md"),
      "---\n$schema: https://schemas.example.com/x.json\ntitle: URL\nslug: url\n---\nBody.\n",
    );
    const notices: string[] = [];
    const view = await runQuery({
      sql: "SELECT _path FROM authors WHERE _path LIKE '%url%'",
      inputs: [],
      cwd: dir,
      onNotice: (m) => notices.push(m),
    });
    expect(view.rows).toEqual([{ _path: "authors/url.md" }]);
    expect(notices).toEqual([]);
    // ...and the row itself is the ordinary one it always was.
    const table = await runQuery({
      sql: "SELECT title FROM docs WHERE _path = 'authors/url.md'",
      inputs: [],
      cwd: dir,
    });
    expect(table.rows).toEqual([{ title: "URL" }]);
  });

  it("views ride into the --db export", async () => {
    const dir = tempCopy();
    const out = join(dir, "export.db");
    await q("", { db: out });
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(out);
    try {
      const views = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
        .all() as { name: string }[];
      expect(views.map((v) => v.name)).toEqual(["authors", "notes", "pages"]);
      const rows = db.prepare("SELECT count(*) n FROM authors").all() as {
        n: number | bigint;
      }[];
      expect(Number(rows[0]?.n)).toBe(4);
    } finally {
      db.close();
    }
  });

  it("the effect gate never sees the views: a mutating diff is identical", async () => {
    const withViews = await q(
      "UPDATE docs SET title = 'Renamed' WHERE _path = 'docs/intro.md'",
      { dryRun: true },
    );
    const withoutViews = await runQuery({
      sql: "UPDATE docs SET title = 'Renamed' WHERE _path = 'docs/intro.md'",
      inputs: ["docs", "authors"],
      cwd: corpus,
      noConfig: true,
      dryRun: true,
    });
    expect(withViews.changes).toEqual([
      {
        file: "docs/intro.md",
        key: "title",
        from: "Intro",
        to: "Renamed",
        written: false,
      },
    ]);
    expect(withoutViews.changes).toEqual(withViews.changes);
  });

  it("a write through a view refuses with the write-through-docs remedy", async () => {
    let message = "";
    try {
      await q("UPDATE authors SET title = 'X'");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("cannot modify authors because it is a view");
    expect(message).toContain(
      'UPDATE docs … WHERE _path IN (SELECT _path FROM "authors")',
    );
  });

  // A collection name may contain spaces; the remedy must carry the whole
  // name, not the first word (a \S+ capture truncated "my authors" to "my").
  it("the remedy carries a view name containing spaces intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docmeta-spaced-view-"));
    tempDirs.push(dir);
    cpSync(corpus, dir, { recursive: true });
    writeFileSync(
      join(dir, "manni.config.yaml"),
      [
        "collections:",
        "  - name: pages",
        "    paths:",
        '      - "docs/**/*.md"',
        '      - "authors/**/*.md"',
        '  - name: "my authors"',
        "    paths:",
        '      - "authors/**"',
        "meta:",
        "  overrides:",
        '    - collection: "my authors"',
        "      schemas: [./author.schema.json]",
        "",
      ].join("\n"),
    );
    let message = "";
    try {
      await runQuery({
        sql: 'UPDATE "my authors" SET title = \'X\'',
        inputs: [],
        cwd: dir,
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("cannot modify my authors because it is a view");
    expect(message).toContain(
      'UPDATE docs … WHERE _path IN (SELECT _path FROM "my authors")',
    );
  });

  it("the 0024 split-set refusal names the groups it found", async () => {
    const dir = mkdtempSync(join(tmpdir(), "docmeta-ddl-split-"));
    tempDirs.push(dir);
    cpSync(corpus, dir, { recursive: true });
    writeFileSync(
      join(dir, "manni.config.yaml"),
      [
        "collections:",
        "  - name: authors",
        "    paths:",
        '      - "authors/**"',
        "  - name: guides",
        "    paths:",
        '      - "docs/**"',
        "meta:",
        "  overrides:",
        "    - collection: authors",
        "      schemas: [./author.schema.json]",
        "    - collection: guides",
        "      schemas: [./base.schema.json]",
        "",
      ].join("\n"),
    );
    rmSync(join(dir, "authors", "self.md"));
    let message = "";
    try {
      await runQuery({
        sql: "ALTER TABLE docs ADD COLUMN reviewed TEXT",
        inputs: [],
        cwd: dir,
        dryRun: true,
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("one schema set");
    expect(message).toContain("authors (authors/**)");
    expect(message).toContain("guides (docs/**)");
    expect(message).toContain("re-run over one group's files");
    // 0030: -s makes the set unanimous by construction, so the named-groups
    // spelling of the split refusal names it as the third remedy too.
    expect(message).toContain("pass -s");
  });

  it("a plain SELECT builds no views and says nothing", async () => {
    // Membership is path arithmetic (rule 10), but a statement that names no
    // collection should still pay nothing and print nothing: the views are
    // built lazily, and nothing in the build has an opinion to voice.
    const notices: string[] = [];
    const run = await q("SELECT _path FROM docs ORDER BY _path LIMIT 1", {
      onNotice: (m) => notices.push(m),
    });
    expect(run.rows).toEqual([{ _path: "authors/ada.md" }]);
    expect(notices).toEqual([]);
  });

  it("a case-variant collection reference still resolves lazily", async () => {
    // SQLite table names are case-insensitive: the engine reports
    // `no such table: Authors`, which must still case-fold to the configured
    // collection and trigger the build-and-retry.
    const run = await q('SELECT _path FROM "Authors" ORDER BY _path');
    expect(run.rows.map((r) => r._path)).toEqual([
      "authors/ada.md",
      "authors/deep.md",
      "authors/grace.md",
      "authors/self.md",
    ]);
  });

  it("a genuinely unknown table surfaces normally, without a rebuild loop", async () => {
    await expect(q("SELECT * FROM nowhere")).rejects.toThrow(
      /no such table: nowhere/,
    );
  });

  // Catalog-observing statements never raise `no such table`, so the lazy
  // retry cannot rescue them — they must see the views eagerly, exactly as
  // v4.8.0's always-eager build did.
  it("sqlite_master lists every collection view", async () => {
    const run = await q(
      "SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name",
    );
    expect(run.rows).toEqual([
      { name: "authors" },
      { name: "notes" },
      { name: "pages" },
    ]);
  });

  it("PRAGMA table_info(collection) reports the docs columns, not silence", async () => {
    const run = await q("PRAGMA table_info(authors)");
    expect(run.rows.map((r) => r.name)).toContain("_path");
    expect(run.rows.map((r) => r.name)).toContain("title");
  });

  it("CREATE VIEW onto a collection name refuses instead of shadowing", async () => {
    await expect(
      q("CREATE VIEW authors AS SELECT * FROM docs"),
    ).rejects.toThrow(/already exists/);
  });

  it("DROP VIEW of a collection is the silent no-op it always was", async () => {
    const run = await q("DROP VIEW authors");
    expect(run.changes).toEqual([]);
  });

  it("the retry path tolerates a collection name containing a newline", async () => {
    // The name embeds both a double quote and a newline. The SQL spells the
    // quote doubled (`a""` + newline + `b`), so the raw statement does not
    // contain the name as a substring and the eager pre-trigger deliberately
    // misses — this is the one spelling that still exercises the pure
    // build-and-retry path, where the engine's `no such table: a"\nb`
    // message spans a line break.
    const dir = mkdtempSync(join(tmpdir(), "docmeta-newline-view-"));
    tempDirs.push(dir);
    cpSync(corpus, dir, { recursive: true });
    writeFileSync(
      join(dir, "manni.config.yaml"),
      [
        "collections:",
        "  - name: pages",
        "    paths:",
        '      - "docs/**/*.md"',
        '      - "authors/**/*.md"',
        '  - name: "a\\"\\nb"',
        "    paths:",
        '      - "authors/**"',
        "meta:",
        "  overrides:",
        '    - collection: "a\\"\\nb"',
        "      schemas: [./author.schema.json]",
        "",
      ].join("\n"),
    );
    const run = await runQuery({
      sql: 'SELECT _path FROM "a""\nb" ORDER BY _path',
      inputs: [],
      cwd: dir,
    });
    expect(run.rows.map((r) => r._path)).toContain("authors/ada.md");
  });

  it("corpus checks read the same views", async () => {
    const dir = tempCopy();
    writeFileSync(
      join(dir, "manni.config.yaml"),
      `${readFileSync(join(dir, "manni.config.yaml"), "utf8")}  checks:
    - name: dangling-author
      query: >-
        SELECT d._path AS path, 'author' AS key,
               'no author page for "' || d.author || '"' AS message
        FROM docs d LEFT JOIN authors a ON a.slug = d.author
        WHERE d.author IS NOT NULL AND a._path IS NULL
`,
    );
    const run = await runValidate({ inputs: [], cwd: dir });
    const guide = run.results.find((r) => r.file === "docs/guide.md");
    expect(guide?.ok).toBe(false);
    expect(guide?.errors[0]?.schema).toBe("check:dangling-author");
    expect(guide?.errors[0]?.message).toContain('no author page for "ghost"');
  });
});
