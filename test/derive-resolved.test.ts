/**
 * The `resolved` table: the effective value per field — what the document
 * asserts when it carries the key, what the evidence says otherwise — beside
 * an `_origin` column saying which of the two answered.
 *
 * Driven against `node:sqlite` directly, the way the projection itself is
 * built: a `docs` table, a `derived` view over `_derived_rows`, then the
 * `resolved` view over both. The point under test is the SQL, so the rows go
 * in by hand rather than through a repository.
 */
import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  createDocsTable,
  loadSqlite,
  type ProjectionEntry,
} from "../src/meta/core/projection.js";
import {
  createDerivedView,
  createResolvedView,
  derivedColumns,
  mentionsResolved,
  RESOLVED_VIEW,
  resolvedColumns,
} from "../src/meta/core/derive/table.js";
import type { DeriveCommand, DerivedRecord } from "../src/meta/core/derive/types.js";

/** One `docs` row's worth of frontmatter, as the projection wants it. */
function entry(label: string, data: Record<string, unknown>): ProjectionEntry {
  return {
    label,
    extracted: {
      data,
      present: true,
      format: "markdown",
      lineFor: () => undefined,
    },
  };
}

/** One derived record: every field a plain `git`-sourced fact. */
function record(file: string, fields: Record<string, unknown>): DerivedRecord {
  return {
    file,
    fields: Object.fromEntries(
      Object.entries(fields).map(([field, value]) => [
        field,
        value === undefined
          ? null
          : { value, source: "git" as const, evidence: `commit for ${field}` },
      ]),
    ),
  };
}

interface Fixture {
  db: DatabaseSync;
  columns: string[];
}

/**
 * A database holding all three objects, with `docs` columns taken from the
 * entries' keys (plus `extraColumns`, for a key no file carries).
 */
async function build(options: {
  entries: readonly ProjectionEntry[];
  records?: readonly DerivedRecord[];
  commands?: Readonly<Record<string, DeriveCommand>>;
  extraColumns?: readonly string[];
}): Promise<Fixture> {
  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(":memory:");
  const keys = new Set<string>(options.extraColumns ?? []);
  for (const e of options.entries) for (const k of Object.keys(e.extracted.data)) keys.add(k);
  const docsColumns = [...keys].sort();
  createDocsTable(db, options.entries, docsColumns);
  createDerivedView(
    db,
    new Map((options.records ?? []).map((r) => [r.file, r])),
    derivedColumns(options.commands),
  );
  createResolvedView(db, docsColumns, options.commands);
  return { db, columns: resolvedColumns(docsColumns, options.commands) };
}

/** One `resolved` row by path, with `_origin` parsed. */
function rowFor(
  db: DatabaseSync,
  path: string,
): Record<string, unknown> & { origin: Record<string, string> } {
  const row = db.prepare(`SELECT * FROM resolved WHERE "_path" = ?`).get(path) as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) throw new Error(`no resolved row for ${path}`);
  const origin: unknown = JSON.parse(String(row["_origin"]));
  return { ...row, origin: origin as Record<string, string> };
}

describe("resolved: the view's shape", () => {
  it("names the view `resolved`", () => {
    expect(RESOLVED_VIEW).toBe("resolved");
  });

  it("carries the path, the docs columns, the fields docs lacks, then the evidence", () => {
    const columns = resolvedColumns(["owner", "title"], {
      "verified-against": { run: ["node", "-p", "1"], timeoutMs: 1000 },
    });
    expect(columns).toEqual([
      "_path",
      "owner",
      "title",
      "created",
      "last-updated",
      "authors",
      "reviewed-by",
      "last-reviewed",
      "verified-against",
      "_origin",
      "_sources",
    ]);
  });

  it("builds the view with exactly those columns, in that order", async () => {
    const { db, columns } = await build({
      entries: [entry("a.md", { title: "A", owner: "@a" })],
      commands: { "verified-against": { run: ["node", "-p", "1"], timeoutMs: 1000 } },
    });
    const info = db
      .prepare(`PRAGMA table_info(${RESOLVED_VIEW})`)
      .all() as { name: string }[];
    expect(info.map((c) => c.name)).toEqual(columns);
    db.close();
  });

  it("carries none of the docs system columns", async () => {
    // `_format`, `_present` and `_data` describe the file, not a value, so
    // they stay in `docs`. A statement that needs them joins on `_path`.
    const { db } = await build({ entries: [entry("a.md", { title: "A" })] });
    const names = (
      db.prepare(`PRAGMA table_info(${RESOLVED_VIEW})`).all() as { name: string }[]
    ).map((c) => c.name);
    expect(names).not.toContain("_format");
    expect(names).not.toContain("_present");
    expect(names).not.toContain("_data");
    expect(() => db.prepare(`SELECT _format FROM ${RESOLVED_VIEW}`)).toThrow(/no such column/);
    db.close();
  });
});

describe("derived: the backing table's transaction", () => {
  it("rolls back and leaves no transaction open when an insert fails", async () => {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(":memory:");
    // A circular value cannot become JSON text, so its insert throws partway
    // through the transaction.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => {
      createDerivedView(
        db,
        new Map([["a.md", record("a.md", { owner: circular })]]),
        derivedColumns(),
      );
    }).toThrow();
    // SQLite refuses a BEGIN inside an open transaction, so this passing
    // proves the failed one was closed.
    expect(() => {
      db.exec("BEGIN");
    }).not.toThrow();
    db.close();
  });
});

describe("resolved: which side answers", () => {
  it("gives the asserted value when the document carries the key", async () => {
    const { db } = await build({
      entries: [entry("a.md", { owner: "@a" })],
      records: [record("a.md", { owner: "@b" })],
    });
    const row = rowFor(db, "a.md");
    expect(row["owner"]).toBe("@a");
    expect(row.origin["owner"]).toBe("asserted");
    db.close();
  });

  it("gives the derived value when the document does not", async () => {
    const { db } = await build({
      entries: [entry("a.md", { title: "A" })],
      records: [record("a.md", { owner: "@b" })],
    });
    const row = rowFor(db, "a.md");
    expect(row["owner"]).toBe("@b");
    expect(row.origin["owner"]).toBe("derived");
    expect(row.origin["title"]).toBe("asserted");
    db.close();
  });

  it("counts an explicit null in frontmatter as asserted", async () => {
    const { db } = await build({
      entries: [entry("a.md", { owner: null })],
      records: [record("a.md", { owner: "@b" })],
    });
    const row = rowFor(db, "a.md");
    expect(row["owner"]).toBeNull();
    expect(row.origin["owner"]).toBe("asserted");
    db.close();
  });

  it("leaves a field neither side has NULL and out of _origin", async () => {
    const { db } = await build({
      entries: [entry("a.md", { title: "A" })],
      records: [record("a.md", { owner: undefined })],
    });
    const row = rowFor(db, "a.md");
    expect(row["owner"]).toBeNull();
    expect(Object.keys(row.origin)).toEqual(["title"]);
    db.close();
  });

  it("resolves a file with no derived row to its asserted values", async () => {
    const { db } = await build({
      entries: [entry("a.md", { title: "A", owner: "@a" })],
      records: [],
    });
    const row = rowFor(db, "a.md");
    expect(row["owner"]).toBe("@a");
    expect(row.origin).toEqual({ title: "asserted", owner: "asserted" });
    expect(row["_sources"]).toBeNull();
    db.close();
  });

  it("passes _sources through from the derived row", async () => {
    const { db } = await build({
      entries: [entry("a.md", { title: "A" })],
      records: [record("a.md", { owner: "@b" })],
    });
    const row = rowFor(db, "a.md");
    const sources: unknown = JSON.parse(String(row["_sources"]));
    expect(sources).toEqual({
      owner: { source: "git", evidence: "commit for owner" },
    });
    db.close();
  });

  it("resolves a hyphenated field, a dotted one, and one with a quote", async () => {
    const commands: Record<string, DeriveCommand> = {
      'says"hi': { run: ["node", "-p", "1"], timeoutMs: 1000 },
      "spec.version": { run: ["node", "-p", "1"], timeoutMs: 1000 },
    };
    const { db } = await build({
      entries: [entry("a.md", { "last-updated": "2026-01-01", 'says"hi': "asserted!" })],
      records: [
        record("a.md", {
          "last-updated": "2020-01-01",
          "spec.version": "3",
          'says"hi': "derived!",
        }),
      ],
      commands,
    });
    const row = rowFor(db, "a.md");
    expect(row["last-updated"]).toBe("2026-01-01");
    expect(row["spec.version"]).toBe("3");
    expect(row['says"hi']).toBe("asserted!");
    expect(row.origin).toEqual({
      "last-updated": "asserted",
      "spec.version": "derived",
      'says"hi': "asserted",
    });
    db.close();
  });
});

describe("resolved: read-only", () => {
  it("refuses a write, because it is a view", async () => {
    const { db } = await build({
      entries: [entry("a.md", { owner: "@a" })],
      records: [record("a.md", { owner: "@b" })],
    });
    expect(() => {
      db.exec(`UPDATE resolved SET "owner" = '@c'`);
    }).toThrow(/cannot modify resolved because it is a view/);
    db.close();
  });
});

describe("mentionsResolved", () => {
  it.each([
    "SELECT * FROM resolved",
    'select * from "resolved"',
    "SELECT * FROM docs JOIN resolved USING (_path)",
    "UPDATE resolved SET owner = 1",
    "INSERT INTO resolved VALUES (1)",
    "DROP TABLE resolved",
    "CREATE VIEW resolved AS SELECT 1",
  ])("is true for %s", (sql) => {
    expect(mentionsResolved(sql)).toBe(true);
  });

  it.each([
    "SELECT 'resolved' FROM docs",
    "SELECT owner AS resolved FROM docs",
    "SELECT * FROM unresolved",
    "SELECT * FROM resolved_snapshot",
  ])("is false for %s", (sql) => {
    expect(mentionsResolved(sql)).toBe(false);
  });
});

// `resolved` is a reserved collection name, beside `derived` and
// `_derived_rows`. Since proposal 0041 a view name belongs to a collection,
// not an override, so test/collections.test.ts covers it in every casing.
