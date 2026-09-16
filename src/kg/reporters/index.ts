/**
 * What `-f` accepts, per verb.
 *
 * Each verb's renderer lives beside its command core (`renderCheck`,
 * `renderStats`, …); what belongs here is the *list*, stated once so the
 * union, the guard, the help text and the refusal sentence cannot drift
 * apart. It is the same shape a11y and cite keep (`A11Y_FORMATS`,
 * `REPORT_FORMATS`), which is why the sentence a user reads is the family's.
 *
 * Every verb takes `pretty | json`. `check` also takes `github`, because it is
 * the CI gate: it is the one kg verb whose output changes what a reviewer sees
 * on a pull request (proposal 0051 §2). It names its own list here rather than
 * widening the shared one, so no other verb advertises a format it cannot
 * render.
 */

/** The list every kg verb's `-f` accepts, in the order messages list them. */
export const KG_FORMATS = ["pretty", "json"] as const;
export type KgFormat = (typeof KG_FORMATS)[number];

/** `"pretty | json"`, for help text and the refusal sentence. */
export const KG_FORMAT_LIST: string = KG_FORMATS.join(" | ");

/** `check`'s list: the shared two plus the CI annotation format. */
export const CHECK_FORMATS = [...KG_FORMATS, "github"] as const;
export type CheckFormat = (typeof CHECK_FORMATS)[number];

/** `"pretty | json | github"`, for help text and the refusal sentence. */
export const CHECK_FORMAT_LIST: string = CHECK_FORMATS.join(" | ");
