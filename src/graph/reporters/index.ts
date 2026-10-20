/**
 * What `-f` accepts, per verb.
 *
 * Each verb's renderer lives beside its command core (`renderCheck`,
 * `renderStats`, …); what belongs here is the *list*, stated once so the
 * union, the guard, the help text and the refusal sentence cannot drift
 * apart. It is the same shape a11y and cite keep (`A11Y_FORMATS`,
 * `REPORT_FORMATS`), which is why the sentence a user reads is the family's.
 *
 * Every verb takes `pretty | json`. `check` also takes `github` and `sarif`,
 * because it is the CI gate: it is the one graph verb whose output changes what
 * a reviewer sees on a pull request (proposal 0051 §2), and code scanning reads
 * SARIF (proposal 0089). It names its own list here rather than widening the
 * shared one, so no other verb advertises a format it cannot render.
 */

/** The list every graph verb's `-f` accepts, in the order messages list them. */
export const GRAPH_FORMATS = ["pretty", "json"] as const;
export type GraphFormat = (typeof GRAPH_FORMATS)[number];

/** `"pretty | json"`, for help text and the refusal sentence. */
export const GRAPH_FORMAT_LIST: string = GRAPH_FORMATS.join(" | ");

/** `check`'s list: the shared two plus the two CI formats. */
export const CHECK_FORMATS = [...GRAPH_FORMATS, "github", "sarif"] as const;
export type CheckFormat = (typeof CHECK_FORMATS)[number];

/** `shapes show`'s list: the shared two plus a frontmatter skeleton. */
export const SHAPES_SHOW_FORMATS = [...GRAPH_FORMATS, "markdown"] as const;

/** `"pretty | json | markdown"`, for help text and the refusal sentence. */
export const SHAPES_SHOW_FORMAT_LIST: string = SHAPES_SHOW_FORMATS.join(" | ");

/** `"pretty | json | github | sarif"`, for help text and the refusal sentence. */
export const CHECK_FORMAT_LIST: string = CHECK_FORMATS.join(" | ");
