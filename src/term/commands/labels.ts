/**
 * The termbase as `meta fill` reads it: each term's label and id, from the
 * same config and the same files `manni term check` reads. Registered as the
 * family's term label source by this domain's CLI module (see
 * `src/shared/term-labels.ts`).
 */
import type { TermLabel, TermLabelRequest } from "../../shared/term-labels.js";
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
  return set.terms.map((term) => ({ label: term.record.label, id: term.id }));
}
