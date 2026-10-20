/**
 * How the pretty and github reports show the elements a rule failed on: the
 * selector with axe's statement of what to change, then the element's html.
 */
import type { ViolationNode } from "../types.js";

/** How many failing elements are listed under one rule. */
export const MAX_NODES = 3;

/** The longest html snippet shown, in characters, before `…`. */
const MAX_HTML = 200;

/** `<selector>  → <what to change>`, on one line. */
export function nodeLine(node: ViolationNode): string {
  return `${node.target}  → ${oneLine(node.summary)}`;
}

/** The element's html on one line, cut at 200 characters. */
export function htmlLine(node: ViolationNode): string {
  const html = node.html.replace(/\s+/g, " ").trim();
  return html.length > MAX_HTML ? `${html.slice(0, MAX_HTML)}…` : html;
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
