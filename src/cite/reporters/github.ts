/**
 * GitHub workflow commands, one per finding:
 * `::error file=<file>,line=<n>,title=<ruleId>::<id or src> (<src>): <message>`
 * with `::warning` and `::notice` for the lower levels: the family scale is
 * GitHub's, so the level is the severity. The rule's guidance lines follow
 * the message after `%0A`. Uses meta's escapes. A baselined
 * finding is not an annotation; a clean run is the empty string.
 */
import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../meta/internal.js";
import { guidanceLines } from "../../shared/guidance.js";
import { errorSite } from "../core/adapt.js";
import type { CheckRun, CitationFinding, CiteRule } from "../types.js";
import { resultFor, splitBaselined } from "./pretty.js";

/**
 * The rules whose message already names what it is about: every claim,
 * marker and anchor message is written as a sentence about the entry, so
 * prefixing it with the subject again would say the name twice. Exported so
 * a test asserting the composed messages reads this set rather than a copy.
 */
export const NAMES_ITS_SUBJECT = new Set<CiteRule>([
  "claim-moved",
  "claim-moved-ambiguous",
  "claim-changed",
  "marker-orphan",
  "marker-invalid",
  "marker-repeated",
  "anchor-invalid",
]);

/**
 * `<id> (<src>): <message>`, or `<src>: <message>` when the entry has no id.
 * A message that names its own subject, by its rule or by opening with the
 * id (an `entry-invalid` about a pin prefix does), is left to say it once.
 * SARIF and JUnit carry the same message. `serves`, the page's `Serves …`
 * sentence (proposal 0105), follows it when the page names a record.
 */
export function findingMessage(finding: CitationFinding, serves?: string): string {
  const text = subjectMessage(finding);
  return serves === undefined ? text : `${text} ${serves}`;
}

function subjectMessage(finding: CitationFinding): string {
  const subject = finding.id ?? finding.src;
  if (subject === undefined) return finding.message;
  if (NAMES_ITS_SUBJECT.has(finding.rule)) return finding.message;
  if (finding.id !== undefined && finding.message.startsWith(finding.id)) return finding.message;
  const where = finding.id !== undefined && finding.src !== undefined ? ` (${finding.src})` : "";
  return `${subject}${where}: ${finding.message}`;
}

export function renderCheckGithub(run: CheckRun): string {
  const lines: string[] = [];
  run.pages.forEach((page, index) => {
    const { reported } = splitBaselined(page, resultFor(run, index));
    const serves = run.impact?.serves.get(page.file);
    for (const finding of reported) {
      // A finding about an entry a manifest owns is annotated on the
      // manifest, unless that manifest is outside the tree, where an
      // annotation would land nowhere: then the page carries it.
      const site = errorSite(finding);
      const params = [`file=${escapeWorkflowCommandProperty(site.file ?? page.file)}`];
      if (site.line !== undefined) params.push(`line=${String(site.line)}`);
      params.push(`title=${escapeWorkflowCommandProperty(finding.ruleId)}`);
      const message = [findingMessage(finding, serves), ...guidanceLines(finding.guidance)].join("\n");
      lines.push(`::${finding.severity} ${params.join(",")}::${escapeWorkflowCommandMessage(message)}`);
    }
  });
  return lines.join("\n");
}
