/**
 * SARIF for `check` and `lint`. Meta's renderer builds the envelope, the
 * repository-relative uris and the fingerprints the baseline shares, from the
 * adapted results. What it cannot know is what a term rule is: it describes
 * every rule as a schema keyword, links meta's fix page, and prefixes each
 * message with the JSON Pointer of the field, `(root)` for a finding about a
 * whole entry. This renderer replaces those three with the term rule's own
 * description, a link to its section of the rules page, and the finding's own
 * message. Each result also carries the rule's guidance, in its message and
 * in `properties.guidance`.
 */
import { renderSarif } from "../../meta/index.js";
import { guidanceLines, type Guidance } from "../../shared/guidance.js";
import { RULE_ID_PREFIX, guidanceFor, isTermRule } from "../core/severity.js";
import type { TermReport } from "../commands/findings.js";
import { TERM_FIELDS } from "../types.js";

const INFORMATION_URI = "https://hawkeyexl.github.io/manni/term/";

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
  fullDescription?: { text: string };
  helpUri?: string;
}

interface SarifLog {
  runs: {
    tool: { driver: { informationUri: string; rules: SarifRule[] } };
    results: { ruleId: string; message: { text: string }; properties?: { guidance?: Guidance } }[];
  }[];
}

/**
 * A rule as the term tool describes it. A check rule links its section of the
 * rules page. A Vale rule takes its description and link from the first alert
 * of that check, when Vale gave them.
 */
function describe(rule: SarifRule, vale: ReadonlyMap<string, Guidance>): SarifRule {
  if (rule.id.startsWith(PROSE_PREFIX)) {
    const check = rule.id.slice(PROSE_PREFIX.length);
    const guidance = vale.get(rule.id);
    return {
      id: rule.id,
      shortDescription: { text: `Vale's ${check} rule flagged the prose of an entry's field.` },
      ...(guidance?.description == null ? {} : { fullDescription: { text: guidance.description } }),
      ...(guidance?.guide == null ? {} : { helpUri: guidance.guide }),
    };
  }
  const name = rule.id.slice(RULE_ID_PREFIX.length + 1);
  if (!isTermRule(name)) return rule;
  const { description, guide } = guidanceFor(name);
  const text = description ?? "";
  return {
    id: rule.id,
    shortDescription: { text },
    fullDescription: { text },
    ...(guide === null ? {} : { helpUri: guide }),
  };
}

export function renderFindingsSarif(report: TermReport, opts: { onNotice?: (message: string) => void } = {}): string {
  const log = JSON.parse(
    renderSarif(report.results, {
      frame: report.frame,
      ...(opts.onNotice === undefined ? {} : { onNotice: opts.onNotice }),
      resultProperties: (error) => {
        const guidance = report.origin.get(error)?.guidance;
        return guidance == null ? undefined : { guidance };
      },
    }),
  ) as SarifLog;
  for (const run of log.runs) {
    // The first alert of each Vale check speaks for its rule.
    const vale = new Map<string, Guidance>();
    for (const result of run.results) {
      const guidance = result.properties?.guidance;
      if (guidance !== undefined && result.ruleId.startsWith(PROSE_PREFIX) && !vale.has(result.ruleId)) {
        vale.set(result.ruleId, guidance);
      }
    }
    run.tool.driver.informationUri = INFORMATION_URI;
    run.tool.driver.rules = run.tool.driver.rules.map((rule) => describe(rule, vale));
    for (const result of run.results) {
      const text = result.message.text.replace(FIELD_LABEL, "");
      result.message.text = [text, ...guidanceLines(result.properties?.guidance)].join("\n");
    }
  }
  return JSON.stringify(log, null, 2);
}
