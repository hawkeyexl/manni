/**
 * `manni strategy get <id>`: one record, matched by id without case. A miss
 * is a usage error that says how big the set is and, when an id is a few
 * edits away, which one.
 */
import { closestName } from "../../shared/closest-name.js";
import { indexSet } from "../core/check.js";
import { StrategyError } from "../errors.js";
import type { StrategyRecord } from "../types.js";
import { entriesOf, type RecordEntry } from "./list.js";
import { loadStrategy, plural, type StrategyCommandOptions } from "./run.js";

export const GET_FORMATS = ["pretty", "json"] as const;
export type GetFormat = (typeof GET_FORMATS)[number];

export interface GetOptions extends StrategyCommandOptions {
  /** The `<id>` argument, compared without case. */
  id: string;
}

export async function runGet(opts: GetOptions): Promise<RecordEntry> {
  const { cwd, run, set, steps, owns } = await loadStrategy(opts);
  const index = indexSet(set);
  const found = index.anyWithId(opts.id);
  const entry = found === undefined ? undefined : entriesOf(set, cwd, run.base, index, steps, owns).find((e) => e.record === found);
  if (entry !== undefined) return entry;
  throw new StrategyError(unknownRecordMessage(opts.id, set.records));
}

/** `no record "t9". 82 records; did you mean "t1"?`: a miss, the set's size and the nearest id. */
export function unknownRecordMessage(id: string, records: readonly StrategyRecord[]): string {
  const ids = records.map((r) => r.id);
  const nearest = closestName(id.toLowerCase(), ids.map((i) => i.toLowerCase()));
  const suggestion = ids.find((i) => i.toLowerCase() === nearest);
  const hint = suggestion === undefined ? "." : `; did you mean "${suggestion}"?`;
  return `no record "${id}". ${plural(records.length, "record")}${hint}`;
}
