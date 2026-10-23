/**
 * `manni strategy list`: the records as a tree, audience then persona then
 * journey. A record with several parents sits under each of them, and one
 * whose parents are not in the set sits at the top level.
 */
import { indexSet, type StrategyIndex } from "../core/check.js";
import { RECORD_TYPES, type StrategyRecord, type StrategySet } from "../types.js";
import { displayPath, loadStrategy, type StrategyCommandOptions } from "./run.js";

export const LIST_FORMATS = ["pretty", "json"] as const;
export type ListFormat = (typeof LIST_FORMATS)[number];

/** One record with what the set says about it. Paths are relative to the working directory. */
export interface RecordEntry {
  record: StrategyRecord;
  /** The records its parent field names that the set holds. */
  parents: StrategyRecord[];
  /** The records whose parent field names this one: personas of an audience, journeys of a persona. */
  children: StrategyRecord[];
  /** The pages that name the record directly. */
  pages: string[];
  /** The record's file, relative to the working directory. */
  file: string;
  /** Its depth in the tree. */
  depth: number;
}

export interface ListReport {
  /** In tree order. */
  entries: RecordEntry[];
  set: StrategySet;
}

const byId = new Intl.Collator("en", { numeric: true });

function sorted(records: readonly StrategyRecord[]): StrategyRecord[] {
  return [...records].sort((a, b) => byId.compare(a.id, b.id));
}

/** Every record, each with its parents, children and pages, parents before their children. */
export function entriesOf(set: StrategySet, cwd: string, base: string, index: StrategyIndex = indexSet(set)): RecordEntry[] {
  const entries: RecordEntry[] = [];
  const visit = (record: StrategyRecord, depth: number): void => {
    const children = sorted(index.childrenOf(record));
    entries.push({
      record,
      parents: index.parentsOf(record),
      children,
      pages: index.pagesNaming(record).map((page) => displayPath(page, cwd, base)),
      file: displayPath(record.file, cwd, base),
      depth,
    });
    for (const child of children) visit(child, depth + 1);
  };
  for (const type of RECORD_TYPES) {
    for (const record of sorted(set.records.filter((r) => r.type === type && index.parentsOf(r).length === 0))) {
      visit(record, 0);
    }
  }
  return entries;
}

export async function runList(opts: StrategyCommandOptions): Promise<ListReport> {
  const { cwd, run, set } = await loadStrategy(opts);
  return { entries: entriesOf(set, cwd, run.base), set };
}
