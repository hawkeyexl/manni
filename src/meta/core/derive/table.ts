/**
 * The `derived` table (proposal 0040): what the evidence says each derivable
 * field should be, one row per file, as a read-only SQL view beside `docs`.
 *
 * `query` builds it when a statement names it, and a corpus check that names
 * it gets the same view — this module is what keeps the two from drifting.
 * It is a view over a backing table rather than a table, so that SQLite's own
 * `cannot modify derived because it is a view` refuses a write before any
 * effect gate has to: the value it holds is not stored anywhere, and the only
 * way to change it is to change the evidence. Both objects are transient: a
 * `--db` export drops them before the handle closes, so a frozen derived
 * value never outlives the run that computed it.
 */
import type { DatabaseSync } from "node:sqlite";
import type { DocmetaConfig } from "../config.js";
import { bindValue, quoteIdent } from "../projection.js";
import { assertSourcesAvailable, deriveMetadata } from "./index.js";
import {
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  type DerivableField,
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
export const DERIVED_ROWS = "_derived_rows";

/**
 * Does the statement name the `derived` table? The search wants `derived`
 * where a table goes — after FROM, JOIN, UPDATE, INTO, TABLE or VIEW, bare
 * or double-quoted — so that the word inside a string literal, a comment or
 * a column alias does not spawn git for nothing. A spelling this misses
 * (`main.derived`, a CTE that shadows it) is caught by the engine's own
 * `no such table: derived`, which `query` rescues with a lazy build.
 */
export function mentionsDerived(sql: string): boolean {
  return /\b(?:from|join|update|into|table|view)\s+(?:"derived"|derived\b)/i.test(sql);
}

/**
 * The derivable fields a statement can read: every one of them when it
 * selects `*` or reads `_sources` (the evidence spans all six), otherwise
 * the field names it spells out, quoted or not. `owner` is not `owners` and
 * `created` is not `recreated`, and the hyphen inside `last-updated` counts
 * as part of the name. Over-triggering costs one source consulted for
 * nothing; under-triggering would leave a named column NULL, so a field
 * that appears anywhere in the text — a literal, a comment — is derived.
 */
export function fieldsForSql(sql: string): DerivableField[] {
  if (sql.includes("*") || /\b_sources\b/i.test(sql)) return [...DERIVABLE_FIELDS];
  return DERIVABLE_FIELDS.filter((field) =>
    new RegExp(`(?<![\\w-])${field}(?![\\w-])`, "i").test(sql),
  );
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
 * Derive the table's rows: `fields` — what the caller's statements can read,
 * see `fieldsForSql` — from the sources the config allows (all four when it
 * says nothing), with the review cache on. The view keeps every column, and
 * a field not derived is NULL in it; only a source some named field needs
 * is consulted, so a statement reading `owner` never spawns `gh`. A
 * requested source that cannot answer is the run's error, never an empty
 * column — the same rule `validate` and `derive` follow — and `hint` is the
 * caller's own way out.
 */
export async function deriveForTable(
  inputs: readonly DeriveInput[],
  ctx: DeriveTableContext,
  hint: string,
  fields: readonly DerivableField[],
): Promise<Map<string, DerivedRecord>> {
  const derive = ctx.config?.derive;
  const result = await deriveMetadata(inputs, {
    cwd: ctx.cwd,
    base: ctx.base,
    ...(ctx.configDir !== undefined ? { configDir: ctx.configDir } : {}),
    sources: derive?.sources ?? [...DERIVE_SOURCES],
    fields,
    ...(derive?.codeowners !== undefined ? { codeowners: derive.codeowners } : {}),
    cache: true,
    now: () => new Date(),
  });
  assertSourcesAvailable(result.sources, hint);
  return result.records;
}
