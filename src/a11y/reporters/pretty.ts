/**
 * `--format pretty`: the report a person reads in a terminal.
 *
 * One line per page, and under a failing page one line per rule followed by
 * the first three elements that failed it, each with axe's own statement of
 * which condition was not met. That per-element line is the deterministic
 * remediation: which rule, which selector, what to change.
 *
 * Colors carry the meanings meta already gave them: ✓ green, ✗ red, URLs
 * cyan, and impact from dim (minor) through yellow (moderate) to red
 * (serious) and bold red (critical).
 */
import { palette, type Colors } from "../../shared/color.js";
import {
  IMPACTS,
  type CheckRun,
  type Impact,
  type PageResult,
  type Violation,
} from "../types.js";
import type { RenderOptions } from "./index.js";

/** How many failing elements are listed under one rule before `(+N more)`. */
const MAX_NODES = 3;

export function renderPretty(run: CheckRun, opts: RenderOptions): string {
  const c = palette(opts.color);
  const { summary } = run;
  const lines: string[] = [];

  const where =
    summary.sitemap === null
      ? "no sitemap; followed links"
      : `sitemap: ${c.cyan(summary.sitemap)}`;
  lines.push(`Checked ${summary.checked} of ${summary.discovered} pages (${where})`);

  for (const page of run.results) {
    if (page.error !== undefined) {
      lines.push(`${c.red("✗")} ${c.cyan(page.url)}  could not load: ${page.error}`);
      continue;
    }
    if (page.violations.length === 0) {
      if (!opts.quiet) lines.push(`${c.green("✓")} ${c.cyan(page.url)}  score ${scoreText(page)}`);
      continue;
    }
    lines.push(
      `${c.red("✗")} ${c.cyan(page.url)}  score ${scoreText(page)}  ${impactCounts(page.violations, c)}`,
    );
    for (const v of page.violations) lines.push(...violationLines(v, c));
  }

  const failed = summary.failed;
  const footer =
    `${summary.violations} violation${summary.violations === 1 ? "" : "s"} on ${failed} of ${summary.checked} pages` +
    (summary.skipped > 0 ? `; ${summary.skipped} skipped (--max-pages)` : "");
  lines.push("");
  lines.push(failed > 0 ? c.red(footer) : c.green(footer));
  return lines.join("\n");
}

function scoreText(page: PageResult): string {
  return page.score === null ? "n/a" : String(page.score);
}

/** `2 serious, 1 minor`: most severe first, zeros omitted. */
function impactCounts(violations: Violation[], c: Colors): string {
  const counts: Record<Impact, number> = { minor: 0, moderate: 0, serious: 0, critical: 0 };
  for (const v of violations) counts[v.impact] += 1;
  return [...IMPACTS]
    .reverse()
    .filter((impact) => counts[impact] > 0)
    .map((impact) => paintImpact(`${counts[impact]} ${impact}`, impact, c))
    .join(", ");
}

function violationLines(v: Violation, c: Colors): string[] {
  const n = v.nodes.length;
  const lines = [
    `    ${paintImpact(v.impact, v.impact, c)}  ${v.id}  ${n} node${n === 1 ? "" : "s"}  ${v.help}  ${c.dim(v.helpUrl)}`,
  ];
  for (const node of v.nodes.slice(0, MAX_NODES)) {
    lines.push(`      ${node.target}  → ${oneLine(node.summary)}`);
  }
  if (n > MAX_NODES) lines.push(c.dim(`      (+${n - MAX_NODES} more)`));
  return lines;
}

/**
 * axe's failureSummary is a heading line followed by one indented line per
 * unmet condition. On one line: the heading, then the conditions joined by
 * `; `.
 */
function oneLine(summary: string): string {
  const [head, ...rest] = summary
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (head === undefined) return "";
  return rest.length === 0 ? head : `${head} ${rest.join("; ")}`;
}

function paintImpact(text: string, impact: Impact, c: Colors): string {
  switch (impact) {
    case "minor":
      return c.dim(text);
    case "moderate":
      return c.yellow(text);
    case "serious":
      return c.red(text);
    case "critical":
      return c.bold(c.red(text));
  }
}
