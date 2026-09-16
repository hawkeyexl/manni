/**
 * What `-f` accepts, per verb.
 *
 * Each verb's renderer lives beside its command core (`renderCheck`,
 * `renderStats`, …); what belongs here is the *list*, stated once so the
 * union, the guard, the help text and the refusal sentence cannot drift
 * apart. It is the same shape a11y and cite keep (`A11Y_FORMATS`,
 * `REPORT_FORMATS`), which is why the sentence a user reads is the family's.
 *
 * Every verb takes `pretty | json` today. `check` gains `github` when it
 * becomes a CI gate (proposal 0051 §2); that verb then names its own list
 * here rather than widening this one.
 */

/** The list every kg verb's `-f` accepts, in the order messages list them. */
export const KG_FORMATS = ["pretty", "json"] as const;
export type KgFormat = (typeof KG_FORMATS)[number];

/** `"pretty | json"`, for help text and the refusal sentence. */
export const KG_FORMAT_LIST: string = KG_FORMATS.join(" | ");
