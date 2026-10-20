/**
 * `--format github`: one workflow-command annotation per finding.
 *
 * There is no file to anchor to, since the check ran against a URL, so the
 * annotation carries the rule id as its title and names the page in the
 * message. After `%0A` come the first three failing elements, each with what
 * to change and its html, then the rule's guidance. Empty when the run is
 * clean, so a clean CI step logs nothing.
 *
 * One element that fails the same rule on several pages is one annotation,
 * naming the page count and the first page. A layout or shared component is
 * the usual cause, and GitHub shows only so many annotations per step, so the
 * repeats would hide the distinct issues.
 */
import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../shared/github.js";
import { guidanceLines } from "../../shared/guidance.js";
import type { CheckRun, Severity, Violation } from "../types.js";
import { MAX_NODES, htmlLine, nodeLine } from "./nodes.js";

/** The three levels a workflow command can carry. */
export type AnnotationLevel = "error" | "warning" | "notice";

/**
 * The annotation level for a finding of the given severity.
 *
 * The family scale (`src/shared/severity.ts`) was chosen to match GitHub's,
 * so the map is one-to-one and this is the identity. It stays a function,
 * and stays exported, because it is the seam: the translation from a
 * domain's severity to an output's levels happens here and nowhere else,
 * and a reporter for a sink with another scale (SARIF's `note`) would carry
 * its own. axe's four impacts were folded onto these three by the analyzer
 * (`severityOf`), before any reporter saw the finding. Proposal 0035,
 * stress test 10.
 */
export function annotationLevel(severity: Severity): AnnotationLevel {
  return severity;
}

/** One violation, and every page it fails on with the same elements. */
interface Group {
  violation: Violation;
  pages: string[];
}

export function renderGithub(run: CheckRun): string {
  // Each entry is a finished load annotation or a group still collecting pages.
  // A group is pushed once and its `pages` grow in place below, so by the time
  // the entries are rendered after the loop, every group lists all its pages.
  const entries: (string | Group)[] = [];
  const groups = new Map<string, Group>();
  for (const page of run.results) {
    if (page.error !== undefined) {
      // A page that did not load has no severity to translate. It is the most
      // serious thing a run can hold, so it is always an error.
      entries.push(
        `::error title=a11y/load::${escapeWorkflowCommandMessage(`${page.url}: ${page.error}`)}`,
      );
      continue;
    }
    for (const v of page.violations) {
      const key = groupKey(v);
      const group = groups.get(key);
      if (group !== undefined) {
        group.pages.push(page.url);
        continue;
      }
      const fresh = { violation: v, pages: [page.url] };
      groups.set(key, fresh);
      entries.push(fresh);
    }
  }
  return entries.map((e) => (typeof e === "string" ? e : annotation(e))).join("\n");
}

/** The rule and its elements, sorted, so the same failure on two pages shares a key. */
function groupKey(v: Violation): string {
  const nodes = v.nodes.map((n) => JSON.stringify([n.target, n.html])).sort();
  return JSON.stringify([v.id, nodes]);
}

function annotation({ violation: v, pages }: Group): string {
  const n = v.nodes.length;
  const nodes = `${n} node${n === 1 ? "" : "s"}`;
  const head =
    pages.length === 1
      ? `${v.help}: ${nodes} on ${pages[0] ?? ""}.`
      : `${v.help}: ${nodes} on ${pages.length} pages, first ${pages[0] ?? ""}. ` +
        "The same element fails on each page, so the fix likely belongs in a shared template.";
  const lines = [
    head,
    ...v.nodes.slice(0, MAX_NODES).flatMap((node) => [nodeLine(node), `  ${htmlLine(node)}`]),
    ...guidanceLines(v.guidance),
  ];
  const title = escapeWorkflowCommandProperty(`a11y/${v.id}`);
  return `::${annotationLevel(v.severity)} title=${title}::${escapeWorkflowCommandMessage(lines.join("\n"))}`;
}
