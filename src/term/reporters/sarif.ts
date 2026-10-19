/**
 * SARIF for `check` and `lint`. Meta's renderer builds the envelope, the
 * repository-relative uris and the fingerprints the baseline shares, from the
 * adapted results. What it cannot know is what a term rule is: it describes
 * every rule as a schema keyword, links meta's fix page, and prefixes each
 * message with the JSON Pointer of the field, `(root)` for a finding about a
 * whole entry. This renderer replaces those three with the term rule's own
 * description, a link to its section of the rules page, and the finding's own
 * message.
 */
import { renderSarif } from "../../meta/index.js";
import { RULE_ID_PREFIX, isTermRule } from "../core/severity.js";
import type { TermReport } from "../commands/findings.js";
import { TERM_FIELDS, type TermRule } from "../types.js";

const INFORMATION_URI = "https://hawkeyexl.github.io/manni/term/";

/** The rules reference, whose sections are anchored by rule name. */
const RULES_URI = "https://hawkeyexl.github.io/manni/term/reference/rules/";

/** What each `check` rule is, as the rules reference's table says it. */
const RULE_DESCRIPTIONS: Readonly<Record<TermRule, string>> = {
  "undefined-term": "A page's concepts: names no entry, by label, id or alt-label.",
  "duplicate-id": "Two entries share an id.",
  "label-collision": "Two entries claim the same preferred label, ignoring case.",
  "alt-label-collision": "An entry's alt-label is another entry's preferred label, ignoring case.",
  "dangling-reference": "A value of broader, narrower, related-terms or see names no entry, by label or by id.",
  "broader-cycle": "A chain of broader returns to where it started.",
  "see-not-empty": "An entry with see also carries a definition.",
  "missing-definition": "An entry has neither a definition nor see.",
  "conflicting-matches": "One IRI is listed under two of an entry's match kinds.",
  "asymmetric-hierarchy": "A names B as broader, and B omits A from narrower, or the reverse.",
  "alt-label-reference": "A page's concepts: names an entry by one of its alt-labels.",
  "abstract-too-long": "An abstract is longer than term.abstractMaxLength.",
  "unused-term": "No page's concepts: names the entry.",
  "hierarchy-outside-termbase":
    "A page's graph: block gives a term a broader, narrower or related concept its own entry does not list.",
  "label-overlap": "A hidden-label or alt-label repeats one of the entry's own names, or a hidden-label is another entry's label or alt-label.",
  "asymmetric-related": "A names B in related-terms, and B omits A.",
  "related-in-hierarchy": "A related term is also broader or narrower than the entry, at any depth.",
  "ambiguous-alt-label": "Two entries share an alt-label, ignoring case.",
  "deprecated-label": "The entry's label is deprecated or superseded in its designations.",
  "related-siblings": "Two related terms share a broader term.",
  "orphan-term": "An entry has no broader, narrower or related term, in a termbase with a hierarchy.",
  "keyword-candidate": "A free keyword is on several pages and names no term.",
};

const PROSE_PREFIX = `${RULE_ID_PREFIX}/prose/`;

/**
 * The label meta's reporters put before a message: `(root) ` for a finding
 * about the whole entry, `/<field> ` for one about a field. Nothing else ever
 * opens a term finding's adapted message.
 */
export const FIELD_LABEL = new RegExp(`^(?:\\(root\\)|/(?:${TERM_FIELDS.join("|")})) `);

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  helpUri?: string;
}

interface SarifLog {
  runs: {
    tool: { driver: { informationUri: string; rules: SarifRule[] } };
    results: { message: { text: string } }[];
  }[];
}

/** A rule as the term tool describes it: a check rule links its section, a Vale rule links nothing manni documents. */
function describe(rule: SarifRule): SarifRule {
  if (rule.id.startsWith(PROSE_PREFIX)) {
    const check = rule.id.slice(PROSE_PREFIX.length);
    return { id: rule.id, shortDescription: { text: `Vale's ${check} rule flagged the prose of an entry's field.` } };
  }
  const name = rule.id.slice(RULE_ID_PREFIX.length + 1);
  if (!isTermRule(name)) return rule;
  return { id: rule.id, shortDescription: { text: RULE_DESCRIPTIONS[name] }, helpUri: `${RULES_URI}#${name}` };
}

export function renderFindingsSarif(report: TermReport, opts: { onNotice?: (message: string) => void } = {}): string {
  const log = JSON.parse(
    renderSarif(report.results, {
      frame: report.frame,
      ...(opts.onNotice === undefined ? {} : { onNotice: opts.onNotice }),
    }),
  ) as SarifLog;
  for (const run of log.runs) {
    run.tool.driver.informationUri = INFORMATION_URI;
    run.tool.driver.rules = run.tool.driver.rules.map(describe);
    for (const result of run.results) result.message.text = result.message.text.replace(FIELD_LABEL, "");
  }
  return JSON.stringify(log, null, 2);
}
