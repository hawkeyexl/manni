/**
 * `manni strategy get <id>`: one record, matched by id without case. A miss
 * is a usage error that says how big the set is and, when an id is a few
 * edits away, which one.
 */
import { closestName } from "../../shared/closest-name.js";
import { indexSet } from "../core/check.js";
import { StrategyError } from "../errors.js";
import { entriesOf, type RecordEntry } from "./list.js";
import { loadStrategy, plural, type StrategyCommandOptions } from "./run.js";

export const GET_FORMATS = ["pretty", "json"] as const;
export type GetFormat = (typeof GET_FORMATS)[number];

export interface GetOptions extends StrategyCommandOptions {
  /** The `<id>` argument, compared without case. */
  id: string;
}

export async function runGet(opts: GetOptions): Promise<RecordEntry> {
  const { cwd, run, set, steps } = await loadStrategy(opts);
  const index = indexSet(set);
  const found = index.anyWithId(opts.id);
  const entry = found === undefined ? undefined : entriesOf(set, cwd, run.base, index, steps).find((e) => e.record === found);
  if (entry !== undefined) return entry;
  const ids = set.records.map((r) => r.id);
  const nearest = closestName(opts.id.toLowerCase(), ids.map((id) => id.toLowerCase()));
  const suggestion = ids.find((id) => id.toLowerCase() === nearest);
  const hint = suggestion === undefined ? "." : `; did you mean "${suggestion}"?`;
  throw new StrategyError(`no record "${opts.id}". ${plural(set.records.length, "record")}${hint}`);
}
