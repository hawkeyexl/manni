/**
 * Safeguard layer 1: a model judging its own output shows self-preference
 * bias (proposal 0046, § The self-preference-bias check).
 *
 * Two axes, reported apart because the remedy differs.
 *
 * - **Content.** The judge is among the machines attributed for what the
 *   eval's `target` reads: `provenance` for `body` (the default), the `fields`
 *   of `meta-provenance` for `frontmatter`, both for `raw`, and none for a
 *   companion file, which carries its own record if it is a page. The check
 *   covers the whole body, because `target` has no form that names lines.
 * - **Criterion.** A `meta-provenance` entry for the judge lists this eval's
 *   id under `evals`: the judge proposed the assertion it is now grading.
 *
 * Content wins when both hold. Neither is a failure: bias skews a verdict, it
 * does not prevent one forming, so ADR 01022's "no verdict fails" rule does
 * not apply, and erroring would punish a single-model corpus with no second
 * provider to reach for.
 */
import { metaProvenanceEntries, provenanceEntries } from "../../meta/internal.js";
import type { ResolvedEval, ResolvedPagePlan } from "../core/resolve.js";
import { DEFAULT_TARGET } from "../core/target.js";
import type { EvalResult } from "../types.js";

export type SelfPreference = NonNullable<EvalResult["selfPreference"]>;

/** A self-preference mark, and the sentence that explains it. */
export interface SelfPreferenceFinding extends SelfPreference {
  /** Without the file: the warning prefixes it, a problem carries it. */
  message: string;
}

const remedy = (evalId: string): string =>
  `, and it is also the judge. Self-judging favors the author; give "${evalId}" a model: of its own.`;

/** Whether the eval's judge, `model`, produced what the eval grades or the eval itself. */
export function selfPreferenceOf(
  plan: ResolvedPagePlan,
  ev: ResolvedEval,
  model: string,
): SelfPreferenceFinding | undefined {
  const data = plan.page.frontmatter.data;
  const meta = metaProvenanceEntries(data["meta-provenance"]).filter(
    (e) => e["generated-by"] === model,
  );
  const target = ev.target ?? DEFAULT_TARGET;
  const readsBody = target === "body" || target === "raw";
  const readsFields = target === "frontmatter" || target === "raw";

  if (readsBody && provenanceEntries(data.provenance).some((e) => e["generated-by"] === model)) {
    return {
      axis: "content",
      model,
      message: `provenance names ${model} for the body this eval grades${remedy(ev.name)}`,
    };
  }
  if (readsFields && meta.some((e) => e.fields.length > 0)) {
    return {
      axis: "content",
      model,
      message: `meta-provenance names ${model} for the fields this eval grades${remedy(ev.name)}`,
    };
  }
  if (meta.some((e) => e.evals.includes(ev.name))) {
    return {
      axis: "criterion",
      model,
      message: `meta-provenance says ${model} proposed "${ev.name}"${remedy(ev.name)}`,
    };
  }
  return undefined;
}
