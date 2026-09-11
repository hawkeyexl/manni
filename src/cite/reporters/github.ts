/**
 * GitHub workflow commands, one per finding:
 * `::error file=<file>,line=<n>,title=<ruleId>::<id or src> (<src>): <message>`
 * with `::warning` and `::notice` for the lower levels: the family scale is
 * GitHub's, so the level is the severity. Uses meta's escapes. A baselined
 * finding is not an annotation; a clean run is the empty string.
 */
import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../meta/internal.js";
import type { CheckRun, CitationFinding, CiteRule } from "../types.js";
import { resultFor, splitBaselined } from "./pretty.js";

/**
 * The rules whose message already names what it is about: every claim,
 * marker and anchor message is written as a sentence about the entry, so
 * prefixing it with the subject again would say the name twice.
 */
const NAMES_ITS_SUBJECT = new Set<CiteRule>([
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
 */
function annotationMessage(finding: CitationFinding): string {
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
    for (const finding of reported) {
      // A finding about an entry a manifest owns is annotated on the manifest.
      const params = [`file=${escapeWorkflowCommandProperty(finding.file ?? page.file)}`];
      if (finding.line !== undefined) params.push(`line=${String(finding.line)}`);
      params.push(`title=${escapeWorkflowCommandProperty(finding.ruleId)}`);
      lines.push(
        `::${finding.severity} ${params.join(",")}::${escapeWorkflowCommandMessage(annotationMessage(finding))}`,
      );
    }
  });
  return lines.join("\n");
}
