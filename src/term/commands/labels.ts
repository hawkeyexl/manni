/**
 * The termbase as `meta fill` and `graph build` read it: each term's label,
 * id, relations and notes, from the same config and the same files
 * `manni term check` reads. The `manni` umbrella registers it as the family's
 * term label source, loading this module on demand (see
 * `src/shared/term-labels.ts`).
 */
import type { TermLabel, TermLabelRequest } from "../../shared/term-labels.js";
import type { Term } from "../types.js";
import { resolveTermRun } from "../core/config.js";
import { loadSet } from "./run.js";

export async function termLabels(request: TermLabelRequest): Promise<TermLabel[]> {
  const run = await resolveTermRun({
    cwd: request.cwd,
    inputs: [],
    ...(request.configPath === undefined ? {} : { configPath: request.configPath }),
    ...(request.noConfig === true ? { noConfig: true } : {}),
  });
  // No collection and no manifest names a file, so there is no termbase.
  if (run.inputs.length === 0 && run.manifests.length === 0) return [];
  const set = await loadSet(run, { inputs: [], allowEmpty: true });
  return set.terms.map((term) => termLabel(term));
}

/** A term as the family reads it: only the keys it carries, so a bare entry stays `{label, id}`. */
function termLabel(term: Term): TermLabel {
  const r = term.record;
  const out: TermLabel = { label: r.label, id: term.id };
  if (term.language !== undefined) out.language = term.language;
  const lists = [
    ["alt-labels", "altLabels"],
    ["hidden-labels", "hiddenLabels"],
    ["broader", "broader"],
    ["narrower", "narrower"],
    ["related-terms", "related"],
    ["exact-matches", "exactMatches"],
    ["close-matches", "closeMatches"],
    ["broad-matches", "broadMatches"],
    ["narrow-matches", "narrowMatches"],
    ["related-matches", "relatedMatches"],
  ] as const;
  for (const [field, key] of lists) {
    const values = r[field];
    if (values !== undefined && values.length > 0) out[key] = values;
  }
  if (r.see !== undefined) out.see = r.see;
  if (r.definition !== undefined) out.definition = r.definition;
  if (r["scope-note"] !== undefined) out.scopeNote = r["scope-note"];
  if (r.notation !== undefined) out.notation = r.notation;
  // A line means something only with its file, so a term read from stdin has neither.
  if (term.location.path !== undefined) {
    out.file = term.location.path;
    out.line = term.location.line;
  }
  return out;
}
