/**
 * `meta-provenance` (proposal 0046): which model proposed which metadata, one
 * entry per model. `fields` names the values by JSON Pointer and `evals` names
 * the evals by id, and `confidence` is keyed by either, which cannot collide
 * because a pointer starts with `/` and an id cannot.
 *
 * Two tools write it: `manni meta fill` records the fields it writes, and
 * `manni docevals fill` records the evals it writes. They merge the same way,
 * so the merge lives here rather than in either command.
 */

/** A name one run proposed, under `fields` or `evals`, and its confidence. */
export interface MetaProvenanceProposal {
  name: string;
  confidence: number;
}

/** Which list of an entry a run's proposals go under. */
export type MetaProvenanceKey = "fields" | "evals";

/** An entry after a merge: whatever it held, with the run's names and confidences. */
export interface MergedMetaProvenanceEntry {
  "generated-by": string;
  confidence: Record<string, number>;
  [other: string]: unknown;
}

export interface MergedMetaProvenance {
  /** The whole `meta-provenance` list, to write back. */
  list: unknown[];
  /** The entry the run merged into, as it now stands in `list`. */
  entry: MergedMetaProvenanceEntry;
  /** The entry's names under the merged key: its own first, then the run's new ones. */
  names: string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The page's `meta-provenance` list with one run's proposals merged in. The
 * first entry for `model` gains the new names under `key` after its own, and
 * their confidences; everything else in it, and every other entry, is kept.
 * Without one, a new entry is appended. `undefined` when the page holds
 * something other than a list, which there is no merging into.
 */
export function mergeMetaProvenance(
  held: unknown,
  model: string,
  key: MetaProvenanceKey,
  proposed: readonly MetaProvenanceProposal[],
): MergedMetaProvenance | undefined {
  if (held !== undefined && !Array.isArray(held)) return undefined;
  const list: unknown[] = held === undefined ? [] : [...(held as unknown[])];
  const at = list.findIndex((e) => isPlainRecord(e) && e["generated-by"] === model);
  const prior = list[at];
  const kept = isPlainRecord(prior) ? prior : {};
  const priorNames = kept[key];
  const names = Array.isArray(priorNames)
    ? (priorNames as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  const confidence: Record<string, number> = {};
  if (isPlainRecord(kept.confidence)) {
    for (const [k, v] of Object.entries(kept.confidence)) {
      if (typeof v === "number") confidence[k] = v;
    }
  }
  for (const p of proposed) {
    if (!names.includes(p.name)) names.push(p.name);
    confidence[p.name] = p.confidence;
  }
  const entry: MergedMetaProvenanceEntry = {
    ...kept,
    "generated-by": model,
    [key]: names,
    confidence,
  };
  if (at === -1) list.push(entry);
  else list[at] = entry;
  return { list, entry, names };
}
