import { describe, expect, it } from "vitest";
import {
  createDocsTable,
  loadSqlite,
  type ProjectionEntry,
} from "../src/meta/core/projection.js";

/** One `docs` row, keyed by `label`. */
function entry(label: string): ProjectionEntry {
  return {
    label,
    extracted: {
      data: { title: label },
      present: true,
      format: "markdown",
      lineFor: () => undefined,
    },
  };
}

describe("createDocsTable's transaction", () => {
  it("rolls back and leaves no transaction open when an insert fails", async () => {
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(":memory:");
    // Two rows with one `_path` break the primary key partway through.
    expect(() => {
      createDocsTable(db, [entry("a.md"), entry("a.md")], ["title"]);
    }).toThrow();
    // SQLite refuses a BEGIN inside an open transaction, so this passing
    // proves the failed one was closed.
    expect(() => {
      db.exec("BEGIN");
    }).not.toThrow();
    db.close();
  });
});
