/**
 * SARIF for `check`: meta's renderer over the adapted results, with each rule
 * described in its own words and linked to its section of the rules page, and
 * each message the finding's own with its guidance, as term's renderer does.
 */
import { renderSarif } from "../../meta/index.js";
import { guidanceLines, type Guidance } from "../../shared/guidance.js";
import type { StrategyReport } from "../commands/findings.js";
import { RULE_ID_PREFIX, guidanceFor, isStrategyRule } from "../core/severity.js";

const INFORMATION_URI = "https://hawkeyexl.github.io/manni/strategy/";

/** The label meta's reporters put before a message: `(root) ` or `/<field> `. */
export const FIELD_LABEL = /^(?:\(root\)|\/(?:audiences|personas|journeys|audience|persona)) /;

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

function describe(rule: SarifRule): SarifRule {
  const name = rule.id.slice(RULE_ID_PREFIX.length + 1);
  if (!isStrategyRule(name)) return rule;
  const { description, guide } = guidanceFor(name);
  const text = description ?? "";
  return { id: rule.id, shortDescription: { text }, fullDescription: { text }, ...(guide === null ? {} : { helpUri: guide }) };
}

export function renderFindingsSarif(report: StrategyReport, opts: { onNotice?: (message: string) => void } = {}): string {
  const log = JSON.parse(
    renderSarif(report.results, {
      frame: report.frame,
      ...(opts.onNotice === undefined ? {} : { onNotice: opts.onNotice }),
      resultProperties: (error) => {
        const guidance = report.origin.get(error)?.guidance;
        return guidance === undefined ? undefined : { guidance };
      },
    }),
  ) as SarifLog;
  for (const run of log.runs) {
    run.tool.driver.informationUri = INFORMATION_URI;
    run.tool.driver.rules = run.tool.driver.rules.map(describe);
    for (const result of run.results) {
      const text = result.message.text.replace(FIELD_LABEL, "");
      result.message.text = [text, ...guidanceLines(result.properties?.guidance)].join("\n");
    }
  }
  return JSON.stringify(log, null, 2);
}
