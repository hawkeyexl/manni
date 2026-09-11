/**
 * Collection views, and the membership adapter that decides what a collection
 * contains.
 *
 * `memberOf` is proposal 0041's rule 10: which collections a file belongs to,
 * as path arithmetic against the config file's directory. It is what external
 * metadata attaches to, what an `overrides[].collection` resolves through, and
 * — since 0041 rule 7 — what a SQL view holds.
 *
 * One meaning of "collection", everywhere. 0027 built each view from the files
 * an override *won schema resolution for*, so views were disjoint, only a
 * collection an override pointed at had a view at all, and a file whose own
 * `$schema` outranked the override was announced as not being in it. 0041
 * makes a view the set the config says it is: every declared collection is a
 * view, two views may overlap, and `FROM authors` reads as "the files the
 * authors collection selects".
 *
 * That restores 0021's founding rule, which 0027 had to bend: a plain read
 * resolves no schemas. Nothing in this module resolves anything, so there is
 * no trust refusal to demote a file over, no per-file walk to pay for, and no
 * notice to print. Resolution still honours `overrides[].collection` — it
 * matches through `memberOf` in `resolve-schema.ts`, which is untouched.
 *
 * Shared by both projection consumers — `query` and the corpus checks
 * `validate` runs — so the two cannot drift on what a collection contains.
 */
import type { DatabaseSync } from "node:sqlite";
import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import { isMember, type CollectionConfig } from "../../shared/collections.js";
import { STDIN_LABEL } from "./load-files.js";
import { quoteIdent, type ProjectionEntry } from "./projection.js";

/**
 * Names of the collections this file belongs to, in declaration order.
 *
 * Where the two bases meet. A run labels files relative to `base` — the
 * working directory for positional paths, the config's directory otherwise —
 * while membership is decided relative to the config file's directory, because
 * that is where a collection's globs were written (0004). So the label is
 * resolved against `base` and then measured from `configDir`.
 *
 * Pure path arithmetic (0041 rule 10): no `stat`, nothing that can fail, and
 * nothing that costs per file. Stdin and anything outside `configDir` are
 * members of nothing — stdin because there is no file behind it, and `isMember`
 * refuses a `../` path on its own.
 */
export function memberOf(
  collections: readonly CollectionConfig[],
  configDir: string,
  base: string,
  label: string,
): string[] {
  if (collections.length === 0) return [];
  if (label === STDIN_LABEL) return [];
  const rel = relative(configDir, resolvePath(base, label))
    .split(sep)
    .join("/");
  // `relative` gives back an *absolute* path when the two sides share no root
  // — a different drive letter on Windows. That is as far outside the config
  // directory as a path can be, and it carries no `../` for `isMember` to
  // refuse, so it is refused here.
  if (isAbsolute(rel)) return [];
  return collections.filter((c) => isMember(c, rel)).map((c) => c.name);
}

/**
 * Narrow a walked file set to the files that belong to a selected collection
 * (proposal 0041 rule 9).
 *
 * The walk applies the family-wide ignores and `--exclude` only, because a
 * collection's `paths:` and `exclude:` are two halves of one statement and the
 * walk sees just the first half. Without this second pass a collection's
 * `exclude:` shaped its SQL view but not what a bare run read, so one config
 * gave two different answers about the same collection — the ambiguity 0041
 * exists to remove.
 *
 * Apply it **only** when the inputs came from the collections. A path someone
 * typed is theirs, and no collection's exclusions filter it (rule 3); the
 * caller decides, which is why this takes the already-walked list rather than
 * consulting `fromCollections` itself.
 */
export function retainMembers(
  files: readonly string[],
  membersFor: (label: string) => readonly string[],
): string[] {
  return files.filter((label) => membersFor(label).length > 0);
}

/** One collection, with the loaded files that belong to it. */
export interface Collection {
  name: string;
  /** `_path` labels of the member files. May be empty — an empty view. */
  members: string[];
}

/**
 * The declared collection names, in declaration order — the one list every
 * "is this a collection?" consumer shares: the view builder below, and
 * `query`'s eager-build trigger and lazy-retry match. Callers that compare
 * case-insensitively use `String.prototype.toLowerCase`, whose Unicode fold
 * is looser than SQLite's ASCII-only fold — that mismatch can only
 * over-trigger a harmless eager build or rebuild, never miss a real match.
 */
export function collectionNames(
  collections: readonly CollectionConfig[] | undefined,
): string[] {
  return (collections ?? []).map((c) => c.name);
}

export interface CollectionParams {
  /**
   * Every collection the config **declares** — not just the ones `--collection`
   * selected, and not just the ones an override points at. Each one is a view
   * (0041 rule 11), so narrowing a run never turns `FROM blog` into a SQL
   * error; it turns it into a view holding whatever of `blog` the run loaded.
   * Optional so the checks' run context can be this very shape; absent, or
   * empty, means there are no collections and so no views.
   */
  collections?: readonly CollectionConfig[];
  /**
   * The config file's directory: what a collection's globs are measured from
   * (0004). Only read when there is a collection to build a view for, which is
   * only ever true when a config governs the run.
   */
  configDir?: string;
  /** Directory the run's file labels are relative to (`RunConfig.base`). */
  base?: string;
}

/**
 * Compute every declared collection's member list from the loaded entries.
 *
 * Membership is the config's own arithmetic — `memberOf`, the same function
 * external metadata and `overrides[].collection` go through — so a view holds
 * exactly the loaded files the collection selects, and a file in two
 * collections is in both views. Nothing here resolves a schema, opens a file,
 * or can fail.
 */
export function collectCollections(
  entries: readonly ProjectionEntry[],
  params: CollectionParams,
): Collection[] {
  const declared = params.collections ?? [];
  if (declared.length === 0) return [];
  // A collection can only be declared by a config file, so both bases are set
  // whenever there is a view to build; the fallbacks keep the arithmetic total
  // rather than optional.
  const base = params.base ?? ".";
  const configDir = params.configDir ?? base;

  const members = new Map<string, string[]>();
  for (const entry of entries) {
    for (const name of memberOf(declared, configDir, base, entry.label)) {
      const list = members.get(name);
      if (list) list.push(entry.label);
      else members.set(name, [entry.label]);
    }
  }
  return declared.map((c) => ({ name: c.name, members: members.get(c.name) ?? [] }));
}

/** One member path as a SQL string literal (doubling internal quotes). */
function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Create one view per collection on an open database that already holds the
 * `docs` table.
 *
 * Each view is built from the computed member list — literal paths, `WHERE 0`
 * for an empty collection — never from a SQL translation of the config glob:
 * picomatch and SQLite `GLOB` are different languages, and membership was
 * already decided by the code that owns the decision. The IN-list scales past
 * any real corpus (0027 § stress test 4: SQLite's SQL-length ceiling is
 * ~1 GB; ten thousand long-ish paths are under a megabyte).
 *
 * Views live in `sqlite_master`, outside the two snapshots effect judgment
 * diffs (`SELECT * FROM docs`, `PRAGMA table_info(docs)`), so the effect gate
 * never sees them — and a `--db` export carries them, which is a feature.
 */
export function createCollectionViews(
  db: DatabaseSync,
  collections: readonly Collection[],
): void {
  for (const c of collections) {
    const where =
      c.members.length === 0
        ? "0"
        : `_path IN (${c.members.map(quoteSqlString).join(", ")})`;
    db.exec(
      `CREATE VIEW ${quoteIdent(c.name)} AS SELECT * FROM docs WHERE ${where}`,
    );
  }
}
