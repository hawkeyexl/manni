/** `blockquotes:` - a plain count, the schema's `counted` shape. */

import type { ContentNode, Finding, SectionNode } from "../types.js";
import { blockquotesOf, checkCount, sectionContext, type Occurrences, type RuleContext } from "./index.js";

/** Checks the blockquotes a section holds directly. */
export function checkBlockquotes(
  section: SectionNode,
  rule: Occurrences | undefined,
): Finding[] {
  return checkBlockquotesIn(section.children, rule, sectionContext(section));
}

/** The reusable core: checks the blockquotes in any ordered content list. */
export function checkBlockquotesIn(
  content: ContentNode[],
  rule: Occurrences | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];
  return checkCount(blockquotesOf(content).length, rule, "blockquote", "blockquotes_count_error", ctx);
}
