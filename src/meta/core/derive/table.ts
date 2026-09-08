/**
 * The `derived` table (proposal 0040): what the evidence says each derivable
 * field should be, one row per file, as a read-only SQL view beside `docs`.
 *
 * `query` builds it when a statement names it, and a corpus check that names
 * it gets the same view — this module is what keeps the two from drifting.
 * It is a view over a backing table rather than a table, so that SQLite's own
 * `cannot modify derived because it is a view` refuses a write before any
 * effect gate has to: the value it holds is not stored anywhere, and the only
 * way to change it is to change the evidence.
 */
import type { DatabaseSync } from "node:sqlite";
import type { DocmetaConfig } from "../config.js";
import { bindValue, quoteIdent } from "../projection.js";
import { assertSourcesAvailable, deriveMetadata } from "./index.js";
import {
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  type DerivedRecord,
  type DeriveInput,
} from "./types.js";

/** The view's columns, in order: the path, every derivable field, the evidence. */
export const DERIVED_TABLE_COLUMNS = [
  "_path",
  ...DERIVABLE_FIELDS,
  "_sources",
] as const;

/** The view's name, and the backing table the rows actually sit in. */
export const DERIVED_VIEW = "derived";
const DERIVED_ROWS = "_derived_rows";

/**
 * Does the statement name the `derived` table? A whole-word search, and one
 * that deliberately over-triggers: `derived` inside a string literal or a
 * comment costs one always-correct build, while under-triggering would let a
 * catalog read observe a table that should have been there.
 */
export function mentionsDerived(sql: string): boolean {
  return /\bderived\b/i.test(sql);
}

/**
 * Create the backing table, load one row per record, and expose it as the
 * `derived` view. Values go through `bindValue`, so a list is JSON text
 * exactly as it is in `docs`; `_sources` is the JSON object
 * `{field: {source, evidence}}` over the non-null fields.
 */
export function createDerivedView(
  db: DatabaseSync,
  records: ReadonlyMap<string, DerivedRecord>,
): void {
  const columns = DERIVED_TABLE_COLUMNS.map(quoteIdent);
  db.exec(
    `CREATE TABLE ${DERIVED_ROWS} (${columns
      .map((c, i) => (i === 0 ? `${c} TEXT PRIMARY KEY` : `${c} TEXT`))
      .join(", ")})`,
  );
  const insert = db.prepare(
    `INSERT INTO ${DERIVED_ROWS} VALUES (${columns.map(() => "?").join(", ")})`,
  );
  db.exec("BEGIN");
  for (const [label, record] of records) {
    const sources: Record<string, { source: string; evidence: string }> = {};
    const values = DERIVABLE_FIELDS.map((field) => {
      const derived = record.fields[field];
      if (derived == null) return null;
      sources[field] = { source: derived.source, evidence: derived.evidence };
      return bindValue(derived.value);
    });
    insert.run(label, ...values, JSON.stringify(sources));
  }
  db.exec("COMMIT");
  db.exec(`CREATE VIEW ${DERIVED_VIEW} AS SELECT * FROM ${DERIVED_ROWS}`);
}

/** Where a table build stands: the run's directories and its config. */
export interface DeriveTableContext {
  cwd: string;
  base: string;
  configDir?: string;
  config: DocmetaConfig | null;
}

/**
 * Derive every field for the table's rows: all six, from the sources the
 * config allows (all three when it says nothing), with the forge cache on.
 * A requested source that cannot answer is the run's error, never an empty
 * column — the same rule `validate` and `derive` follow — and `hint` is the
 * caller's own way out.
 */
export async function deriveForTable(
  inputs: readonly DeriveInput[],
  ctx: DeriveTableContext,
  hint: string,
): Promise<Map<string, DerivedRecord>> {
  const derive = ctx.config?.derive;
  const result = await deriveMetadata(inputs, {
    cwd: ctx.cwd,
    base: ctx.base,
    ...(ctx.configDir !== undefined ? { configDir: ctx.configDir } : {}),
    sources: derive?.sources ?? [...DERIVE_SOURCES],
    fields: [...DERIVABLE_FIELDS],
    ...(derive?.codeowners !== undefined ? { codeowners: derive.codeowners } : {}),
    cache: true,
    now: () => new Date(),
  });
  assertSourcesAvailable(result.sources, hint);
  return result.records;
}
