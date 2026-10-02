/** `definitionLists:` - a plain count, the schema's `counted` shape. */

import type { ContentNode, Finding, SectionNode } from "../types.js";
import {
  checkCount,
  definitionListsOf,
  sectionContext,
  type Occurrences,
  type RuleContext,
} from "./index.js";

/** Checks the definition lists a section holds directly. */
export function checkDefinitionLists(
  section: SectionNode,
  rule: Occurrences | undefined,
): Finding[] {
  return checkDefinitionListsIn(section.children, rule, sectionContext(section));
}

/** The reusable core: checks the definition lists in any ordered content list. */
export function checkDefinitionListsIn(
  content: ContentNode[],
  rule: Occurrences | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];
  return checkCount(
    definitionListsOf(content).length,
    rule,
    "definition list",
    "definition_lists_count_error",
    ctx,
  );
}
