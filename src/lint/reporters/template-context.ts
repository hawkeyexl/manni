/**
 * The lines printed under a finding to say what its template asks for. The
 * pretty, GitHub and SARIF reports share them, so all three say it the same
 * way.
 */
import type { Finding } from "../types.js";

/**
 * The template, the rule and its description, then the template's guide.
 * Empty when no template stands behind the finding.
 */
export function templateLines(finding: Finding): string[] {
  const t = finding.template;
  if (t == null) return [];
  const rule = t.rule === null ? "" : ` ${t.rule}`;
  const description = t.description === null ? "" : `: ${t.description}`;
  const head = `${t.id}${rule}${description}`;
  return t.guide === null ? [head] : [head, `Guide: ${t.guide}`];
}
