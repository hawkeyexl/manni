/**
 * What judged a finding, and the lines printed under it to say so (proposal
 * 0089). Every domain's reporters share them, so a finding says what its rule
 * asks for the same way in pretty, GitHub, SARIF and JUnit output.
 *
 * Generalized from lint's template context (proposal 0088), whose released
 * `template` key carries this same shape.
 */

/** The rule behind a finding, as every domain carries it. */
export interface Guidance {
  /** What judged the finding: a template ref, a schema id, a shapes id, a rule namespace. */
  id: string;
  /** The rule within it, or `null` when the finding names none. */
  rule: string | null;
  /** What the rule is for, written for the person who fixes it, or `null`. */
  description: string | null;
  /** An http(s) URL to read more, or `null`. */
  guide: string | null;
}

/**
 * The id, the rule and its description, then the guide. Empty when nothing
 * stands behind the finding, so a caller can treat `[]` as "print nothing".
 * A head with no text is left out rather than printed as a blank line.
 */
export function guidanceLines(g: Guidance | null | undefined): string[] {
  if (g == null) return [];
  const rule = g.rule === null ? "" : ` ${g.rule}`;
  const description = g.description === null ? "" : `: ${g.description}`;
  const head = `${g.id}${rule}${description}`;
  const lines = head === "" ? [] : [head];
  return g.guide === null ? lines : [...lines, `Guide: ${g.guide}`];
}
