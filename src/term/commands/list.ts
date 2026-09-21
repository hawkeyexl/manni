/** `manni term list`: the resolved entries, in load order. */
import type { Term, TermSet } from "../types.js";
import { loadTerms, type TermCommandOptions } from "./run.js";

export const LIST_FORMATS = ["pretty", "json", "csv"] as const;
export type ListFormat = (typeof LIST_FORMATS)[number];

export interface ListReport {
  terms: Term[];
  set: TermSet;
}

export async function runList(opts: TermCommandOptions): Promise<ListReport> {
  const { set } = await loadTerms(opts);
  return { terms: set.terms, set };
}
