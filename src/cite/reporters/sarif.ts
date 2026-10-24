/**
 * SARIF for `check`. Meta's renderer builds the envelope, the
 * repository-relative uris and the fingerprints the baseline shares, from the
 * adapted results. What it cannot know is what a cite rule is: it describes
 * every rule as a schema keyword, links meta's fix page, and prefixes each
 * message with the JSON Pointer of the entry, `(root)` for a finding about no
 * entry. This renderer replaces those three with the cite rule's own
 * description, a link to its section of the cite fix page, and the message
 * the github annotation carries, which names the citation the pointer only
 * numbered. Each result also carries the rule's guidance, in its message and
 * in `properties.guidance`. A message is no part of a fingerprint, so the
 * baseline is unaffected.
 */
import { renderSarif, type FieldError, type ValidationResult } from "../../meta/index.js";
import { guidanceLines } from "../../shared/guidance.js";
import { errorSite } from "../core/adapt.js";
import { RULE_ID_PREFIX, guidanceFor, isCiteRule } from "../core/severity.js";
import type { CheckRun, CitationFinding } from "../types.js";
import { findingMessage } from "./github.js";

const INFORMATION_URI = "https://hawkeyexl.github.io/manni/cite/";

/**
 * The label meta's reporters put before a message: `(root) ` for a finding
 * about no entry, `/citations/N ` for one about an entry. Nothing else ever
 * opens a cite finding's adapted message.
 */
export const ENTRY_LABEL = /^(?:\(root\)|\/citations\/\d+) /;

export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
}

/** As much of meta's SARIF as this renderer and its tests read back. */
export interface SarifLog {
  runs: {
    tool: { driver: { informationUri: string; rules: SarifRule[] } };
    results: { ruleId: string; message: { text: string }; properties?: Record<string, unknown> }[];
  }[];
}

/**
 * The adapted results with each message rewritten by `compose`, the github
 * annotation's message unless told otherwise. An error is paired with its
 * finding by rule, entry, line and message, as the baseline split pairs them;
 * the baseline has already dropped the errors it forgives. `paired` hears
 * each rewritten error with the finding it came from.
 */
export function withFindingMessages(
  run: CheckRun,
  compose: (finding: CitationFinding, serves?: string) => string = findingMessage,
  paired?: (error: FieldError, finding: CitationFinding) => void,
): ValidationResult[] {
  return run.results.map((result) => {
    const page = run.pages.find((p) => p.file === result.file);
    if (page === undefined) return result;
    const serves = run.impact?.serves.get(page.file);
    const errors = result.errors.map((error) => {
      const finding = page.findings.find(
        (f) =>
          f.rule === error.keyword &&
          (f.index === undefined ? "" : `/citations/${String(f.index)}`) === error.instancePath &&
          f.message === error.message &&
          (errorSite(f).line ?? null) === (error.line ?? null),
      );
      if (finding === undefined) return error;
      const rewritten = { ...error, message: compose(finding, serves) };
      paired?.(rewritten, finding);
      return rewritten;
    });
    return { ...result, errors };
  });
}

/** A rule as the citation tool describes it, linked to its section of the fix page. */
function describe(rule: SarifRule): SarifRule {
  const name = rule.id.slice(RULE_ID_PREFIX.length + 1);
  if (!isCiteRule(name)) return rule;
  const { description, guide } = guidanceFor(name);
  const text = description ?? "";
  return {
    id: rule.id,
    shortDescription: { text },
    fullDescription: { text },
    ...(guide === null ? {} : { helpUri: guide }),
  };
}

export function renderCheckSarif(run: CheckRun, opts: { onNotice?: (message: string) => void } = {}): string {
  const origin = new Map<FieldError, CitationFinding>();
  const results = withFindingMessages(
    run,
    (finding, serves) => [findingMessage(finding, serves), ...guidanceLines(finding.guidance)].join("\n"),
    (error, finding) => origin.set(error, finding),
  );
  const log = JSON.parse(
    renderSarif(results, {
      frame: run.frame,
      ...(opts.onNotice === undefined ? {} : { onNotice: opts.onNotice }),
      resultProperties: (error) => {
        const guidance = origin.get(error)?.guidance;
        return guidance == null ? undefined : { guidance };
      },
    }),
  ) as SarifLog;
  for (const sarifRun of log.runs) {
    sarifRun.tool.driver.informationUri = INFORMATION_URI;
    sarifRun.tool.driver.rules = sarifRun.tool.driver.rules.map(describe);
    for (const result of sarifRun.results) result.message.text = result.message.text.replace(ENTRY_LABEL, "");
  }
  return JSON.stringify(log, null, 2);
}
