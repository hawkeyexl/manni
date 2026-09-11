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
 *
 * The columns are the run's: the six built-in fields, then one per key of
 * `derive.commands` (proposal 0042), so a command-derived field is read
 * exactly as a built-in one is.
 */
import type { DatabaseSync } from "node:sqlite";
import type { DocmetaConfig } from "../config.js";
import { bindValue, quoteIdent, RESERVED } from "../projection.js";
import { commandsOf } from "./config.js";
import { assertSourcesAvailable, deriveMetadata } from "./index.js";
import {
  DERIVE_SOURCES,
  derivableFields,
  type DerivableField,
  type DeriveCommand,
  type DerivedRecord,
  type DeriveInput,
} from "./types.js";

/** The view's name, and the backing table the rows actually sit in. */
export const DERIVED_VIEW = "derived";
export const DERIVED_ROWS = "_derived_rows";

/** The third table: the effective value per field, over `docs` and the rows. */
export const RESOLVED_VIEW = "resolved";

/** The two columns `resolved` adds past the fields: which side, and why. */
const ORIGIN_COLUMN = "_origin";
const SOURCES_COLUMN = "_sources";

/** The view's columns, in order: the path, every derivable field, the evidence. */
export function derivedColumns(commands?: Readonly<Record<string, DeriveCommand>>): string[] {
  return ["_path", ...derivableFields(commands), SOURCES_COLUMN];
}

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
 * The derivable fields a statement can read, out of `fields` — the run's
 * own list, see `derivableFields`: every one of them when it selects `*`, or
 * reads `_sources` or `_origin` (the evidence and the origin map span them
 * all), otherwise the field names
 * it spells out, quoted or not. `owner` is not `owners` and `created` is
 * not `recreated`, and the hyphen inside `last-updated` counts as part of
 * the name; a command key is matched as written, whatever it contains.
 * Over-triggering costs one source consulted for nothing; under-triggering
 * would leave a named column NULL, so a field that appears anywhere in the
 * text — a literal, a comment — is derived.
 */
export function fieldsForSql(sql: string, fields: readonly DerivableField[]): DerivableField[] {
  if (sql.includes("*") || /\b_(?:sources|origin)\b/i.test(sql)) return [...fields];
  return fields.filter((field) =>
    new RegExp(`(?<![\\w-])${escapeRegExp(field)}(?![\\w-])`, "i").test(sql),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create the backing table, load one row per record, and expose it as the
 * `derived` view. `columns` is the run's list (`derivedColumns`), and the
 * values are placed by it, so the view and the rows agree by construction.
 * Values go through `bindValue`, so a list is JSON text exactly as it is in
 * `docs`; `_sources` is the JSON object `{field: {source, evidence}}` over
 * the non-null fields.
 */
export function createDerivedView(
  db: DatabaseSync,
  records: ReadonlyMap<string, DerivedRecord>,
  columns: readonly string[],
): void {
  const quoted = columns.map(quoteIdent);
  db.exec(
    `CREATE TABLE ${DERIVED_ROWS} (${quoted
      .map((c, i) => (i === 0 ? `${c} TEXT PRIMARY KEY` : `${c} TEXT`))
      .join(", ")})`,
  );
  const insert = db.prepare(
    `INSERT INTO ${DERIVED_ROWS} VALUES (${quoted.map(() => "?").join(", ")})`,
  );
  const fields = columns.slice(1, -1);
  db.exec("BEGIN");
  // Committed or rolled back, never left open: the caller may keep using the
  // handle after a failed insert, and every later statement would otherwise
  // run inside the half-built transaction.
  let committed = false;
  try {
    for (const [label, record] of records) {
      const sources: Record<string, { source: string; evidence: string }> = {};
      const values = fields.map((field) => {
        const derived = record.fields[field];
        if (derived == null) return null;
        sources[field] = { source: derived.source, evidence: derived.evidence };
        return bindValue(derived.value);
      });
      insert.run(label, ...values, JSON.stringify(sources));
    }
    db.exec("COMMIT");
    committed = true;
  } finally {
    if (!committed) db.exec("ROLLBACK");
  }
  db.exec(`CREATE VIEW ${DERIVED_VIEW} AS SELECT * FROM ${DERIVED_ROWS}`);
}

/**
 * Every column `resolved` carries, in order: `_path`, the `docs` data columns,
 * then any derivable field `docs` does not already have, then `_origin` and
 * `_sources`. A docs column that is also a derivable field appears once, in
 * the position `docs` gives it, so the field list only ever adds.
 *
 * The system columns are skipped: `_path` is already first, and `_format`,
 * `_present` and `_data` are facts about the document rather than values a
 * source could state. A frontmatter key spelled `_origin` or `_sources` is
 * skipped for the same reason a reserved one is — the column is taken.
 */
export function resolvedColumns(
  docsColumns: readonly string[],
  commands?: Readonly<Record<string, DeriveCommand>>,
): string[] {
  const columns = ["_path"];
  const seen = new Set<string>(["_path", ORIGIN_COLUMN, SOURCES_COLUMN]);
  for (const column of docsColumns) {
    if (seen.has(column) || RESERVED.has(column)) continue;
    seen.add(column);
    columns.push(column);
  }
  for (const field of derivableFields(commands)) {
    if (seen.has(field)) continue;
    seen.add(field);
    columns.push(field);
  }
  columns.push(ORIGIN_COLUMN, SOURCES_COLUMN);
  return columns;
}

/**
 * Does the statement name the `resolved` table? The twin of `mentionsDerived`,
 * with the same shape and the same reason: `resolved` where a table goes, so
 * that a column alias or the word inside `unresolved` does not build a view —
 * and, more to the point, does not spawn git behind it.
 */
export function mentionsResolved(sql: string): boolean {
  return /\b(?:from|join|update|into|table|view)\s+(?:"resolved"|resolved\b)/i.test(sql);
}

/** One field name as a SQLite JSON path step: `$."last-updated"`. */
function jsonPath(field: string): string {
  // JSON.stringify quotes and escapes exactly the way SQLite's path parser
  // reads a quoted label — `\"` for a quote, `\\` for a backslash — and the
  // way the label was written into `_data` in the first place.
  return `$.${JSON.stringify(field)}`;
}

/** Any string as a SQL string literal (doubling internal apostrophes). */
function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Create the `resolved` view: one row per `docs` row, holding the effective
 * value of every field — what the document asserts when it carries the key,
 * what the evidence derived otherwise — plus `_origin` saying which of the two
 * answered, and the derived row's `_sources` unchanged. Call after
 * `createDocsTable` and `createDerivedView`.
 *
 * **Presence is decided by `_data`, never by NULL.** A docs column is NULL
 * both when the key is absent and when the document writes `key: null`, and
 * those are opposite answers: an explicit null is an assertion, and the
 * derived value must not overwrite it. So each field asks
 * `json_type(_data, '$."field"') IS NOT NULL`, which is true for a JSON null
 * and false for an absent key.
 *
 * `_origin` is `json_patch('{}', json_object(…))` over a CASE per field that
 * yields `'asserted'`, `'derived'`, or NULL. `json_object` alone would keep
 * the NULL members — a field neither side has would read as present with a
 * null origin — and RFC 7396 merge-patch, which `json_patch` implements, is
 * exactly the "a null member deletes the key" rule that drops them. One patch
 * call does the whole object, so the shape stays flat however many fields the
 * run carries.
 *
 * The join is a LEFT JOIN, so a file the derive run has no row for keeps its
 * asserted values with an all-`asserted` `_origin` and a NULL `_sources`.
 *
 * Read-only by construction: SQLite refuses a write to a view with no
 * INSTEAD OF trigger, and there is none. The effective value is not stored
 * anywhere, so the only way to change it is to change the document or the
 * evidence.
 *
 * Call it after `createDocsTable` and `createDerivedView`. SQLite accepts a
 * view over a table that does not exist yet and fails only at the first read,
 * as `no such table: main._derived_rows`, far from the call that got the
 * order wrong.
 */
export function createResolvedView(
  db: DatabaseSync,
  docsColumns: readonly string[],
  commands?: Readonly<Record<string, DeriveCommand>>,
): void {
  const columns = resolvedColumns(docsColumns, commands);
  const fields = columns.slice(1, -2);
  const inDocs = new Set(docsColumns);
  const inDerived = new Set(derivableFields(commands));

  const selects = [`d.${quoteIdent("_path")} AS ${quoteIdent("_path")}`];
  const origin: string[] = [];
  for (const field of fields) {
    const path = sqlString(jsonPath(field));
    const asserted = `json_type(d.${quoteIdent("_data")}, ${path}) IS NOT NULL`;
    // A field with no docs column can only be asserted by an inconsistent
    // table, but `_data` answers for it either way and costs nothing here.
    const assertedValue = inDocs.has(field)
      ? `d.${quoteIdent(field)}`
      : `d.${quoteIdent("_data")} ->> ${path}`;
    if (inDerived.has(field)) {
      const derivedValue = `r.${quoteIdent(field)}`;
      selects.push(
        `CASE WHEN ${asserted} THEN ${assertedValue} ELSE ${derivedValue} END AS ${quoteIdent(field)}`,
      );
      origin.push(
        `${sqlString(field)}, CASE WHEN ${asserted} THEN 'asserted' WHEN ${derivedValue} IS NOT NULL THEN 'derived' END`,
      );
    } else {
      // A docs-only column: no source states it, so the document always wins.
      selects.push(`${assertedValue} AS ${quoteIdent(field)}`);
      origin.push(`${sqlString(field)}, CASE WHEN ${asserted} THEN 'asserted' END`);
    }
  }
  selects.push(
    `json_patch('{}', json_object(${origin.join(", ")})) AS ${quoteIdent(ORIGIN_COLUMN)}`,
  );
  selects.push(`r.${quoteIdent(SOURCES_COLUMN)} AS ${quoteIdent(SOURCES_COLUMN)}`);

  db.exec(
    `CREATE VIEW ${RESOLVED_VIEW} AS SELECT ${selects.join(", ")} FROM docs d LEFT JOIN ${DERIVED_ROWS} r USING (${quoteIdent("_path")})`,
  );
}

/** Where a table build stands: the run's directories and its config. */
export interface DeriveTableContext {
  cwd: string;
  base: string;
  configDir?: string;
  config: DocmetaConfig | null;
  /** Whether the GitHub or GitLab review cache may answer; `--no-cache` clears it. */
  cache: boolean;
  /** The clock an uncommitted body change is dated by; default `new Date()`. */
  now?: () => Date;
}

/**
 * Derive the table's rows: `fields` — what the caller's statements can read,
 * see `fieldsForSql` — from the sources the config allows (all five when it
 * says nothing), with the review cache on. The view keeps every column, and
 * a field not derived is NULL in it; only a source some named field needs
 * is consulted, so a statement reading `owner` never spawns `gh`, and a
 * configured command runs only when its field is read. A requested source
 * that cannot answer is the run's error, never an empty column — the same
 * rule `validate` and `derive` follow — and `hint` is the caller's own way
 * out.
 */
export async function deriveForTable(
  inputs: readonly DeriveInput[],
  ctx: DeriveTableContext,
  hint: string,
  fields: readonly DerivableField[],
): Promise<Map<string, DerivedRecord>> {
  const derive = ctx.config?.derive;
  const commands = commandsOf(derive);
  const result = await deriveMetadata(inputs, {
    cwd: ctx.cwd,
    base: ctx.base,
    ...(ctx.configDir !== undefined ? { configDir: ctx.configDir } : {}),
    sources: derive?.sources ?? [...DERIVE_SOURCES],
    fields,
    ...(derive?.codeowners !== undefined ? { codeowners: derive.codeowners } : {}),
    ...(commands !== undefined ? { commands } : {}),
    cache: ctx.cache,
    now: ctx.now ?? (() => new Date()),
  });
  assertSourcesAvailable(result.sources, hint);
  return result.records;
}
