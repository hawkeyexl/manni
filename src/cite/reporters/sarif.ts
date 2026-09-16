/**
 * SARIF for `check`. Meta's renderer builds the envelope, the
 * repository-relative uris and the fingerprints the baseline shares, from the
 * adapted results. What it cannot know is what a cite rule is: it describes
 * every rule as a schema keyword, links meta's fix page, and prefixes each
 * message with the JSON Pointer of the entry, `(root)` for a finding about no
 * entry. This renderer replaces those three with the cite rule's own
 * description, a link to its row of the citations reference, and the message
 * the github annotation carries, which names the citation the pointer only
 * numbered. A message is no part of a fingerprint, so the baseline is
 * unaffected.
 */
import { renderSarif, type ValidationResult } from "../../meta/index.js";
import { errorSite } from "../core/adapt.js";
import { RULE_ID_PREFIX, isCiteRule } from "../core/severity.js";
import type { CheckRun, CiteRule } from "../types.js";
import { findingMessage } from "./github.js";

const INFORMATION_URI = "https://hawkeyexl.github.io/manni/cite/";

/** The citations reference, whose rule tables anchor each row by rule name. */
const RULES_URI = "https://hawkeyexl.github.io/manni/cite/reference/citations/";

/** What each rule is, as the citations reference's tables say it. */
const RULE_DESCRIPTIONS: Readonly<Record<CiteRule, string>> = {
  "source-moved": "The cited source lines moved to one other place in the file.",
  "source-moved-ambiguous": "The cited source lines now match at several places in the file.",
  "source-changed": "The cited source lines changed since the citation pinned them.",
  "source-never-true": "The pin never matched the source at the recorded commit.",
  "source-missing": "The cited source file is not tracked under the root, or cannot be decrypted.",
  "claim-moved": "The cited sentence moved to other lines of the page.",
  "claim-moved-ambiguous": "The cited sentence now appears at several places on the page.",
  "claim-changed": "The cited sentence was edited since the citation pinned it.",
  "marker-orphan": "A marker names an id no citation has.",
  "marker-invalid": "A marker is malformed, or the page has too many markers.",
  "marker-repeated": "Two markers name the same citation id.",
  "anchor-invalid": "A citation's anchor cannot work.",
  "entry-invalid": "A citation entry is malformed.",
  "quote-drift": "A quoted block no longer reproduces its source.",
};

/**
 * The label meta's reporters put before a message: `(root) ` for a finding
 * about no entry, `/citations/N ` for one about an entry. Nothing else ever
 * opens a cite finding's adapted message.
 */
export const ENTRY_LABEL = /^(?:\(root\)|\/citations\/\d+) /;

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

/**
 * The adapted results with each message rewritten as the github annotation
 * says it. An error is paired with its finding by rule, entry, line and
 * message, as the baseline split pairs them; the baseline has already
 * dropped the errors it forgives.
 */
export function withFindingMessages(run: CheckRun): ValidationResult[] {
  return run.results.map((result) => {
    const page = run.pages.find((p) => p.file === result.file);
    if (page === undefined) return result;
    const errors = result.errors.map((error) => {
      const finding = page.findings.find(
        (f) =>
          f.rule === error.keyword &&
          (f.index === undefined ? "" : `/citations/${String(f.index)}`) === error.instancePath &&
          f.message === error.message &&
          (errorSite(f).line ?? null) === (error.line ?? null),
      );
      return finding === undefined ? error : { ...error, message: findingMessage(finding) };
    });
    return { ...result, errors };
  });
}

/** A rule as the citation tool describes it. */
function describe(rule: SarifRule): SarifRule {
  const name = rule.id.slice(RULE_ID_PREFIX.length + 1);
  if (!isCiteRule(name)) return rule;
  return { id: rule.id, shortDescription: { text: RULE_DESCRIPTIONS[name] }, helpUri: `${RULES_URI}#${name}` };
}

export function renderCheckSarif(run: CheckRun, opts: { onNotice?: (message: string) => void } = {}): string {
  const log = JSON.parse(
    renderSarif(withFindingMessages(run), {
      frame: run.frame,
      ...(opts.onNotice === undefined ? {} : { onNotice: opts.onNotice }),
    }),
  ) as SarifLog;
  for (const sarifRun of log.runs) {
    sarifRun.tool.driver.informationUri = INFORMATION_URI;
    sarifRun.tool.driver.rules = sarifRun.tool.driver.rules.map(describe);
    for (const result of sarifRun.results) result.message.text = result.message.text.replace(ENTRY_LABEL, "");
  }
  return JSON.stringify(log, null, 2);
}
