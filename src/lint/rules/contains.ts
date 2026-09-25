/**
 * `contains:` - what a section (or an element's or list item's own content)
 * holds, in any order. Each listed kind dispatches to that kind's own check.
 */

import type { ContentNode, Finding, SectionNode } from "../types.js";
import { BLOCK_KINDS, sectionContext, type BlockRule, type RuleContext } from "./index.js";
import { checkParagraphsIn } from "./paragraphs.js";
import { checkCodeBlocksIn } from "./code-blocks.js";
import { checkListsIn } from "./lists.js";
import { checkTablesIn } from "./tables.js";
import { checkAdmonitionsIn } from "./admonitions.js";
import { checkImagesIn } from "./images.js";
import { checkBlockquotesIn } from "./blockquotes.js";
import { checkDefinitionListsIn } from "./definition-lists.js";
import { checkElementsIn } from "./elements.js";

/** Checks a section's own content against a `contains:` rule. */
export function checkContains(
  section: SectionNode,
  rule: BlockRule | undefined,
): Finding[] {
  return checkContainsIn(section.children, rule, sectionContext(section));
}

/**
 * The reusable core: checks any ordered content list against a `contains:`
 * rule - a section's content, a list item's `children`, an element's own
 * `children`, or one run of a `sequence` (which carries exactly one key).
 *
 * `BLOCK_KINDS` drives the dispatch so a ninth kind is one line here, not a
 * rewritten `if` chain.
 */
export function checkContainsIn(
  content: ContentNode[],
  rule: BlockRule | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const findings: Finding[] = [];
  for (const kind of BLOCK_KINDS) {
    switch (kind) {
      case "paragraphs":
        findings.push(...checkParagraphsIn(content, rule.paragraphs, ctx));
        break;
      case "codeBlocks":
        findings.push(...checkCodeBlocksIn(content, rule.codeBlocks, ctx));
        break;
      case "lists":
        findings.push(...checkListsIn(content, rule.lists, ctx));
        break;
      case "tables":
        findings.push(...checkTablesIn(content, rule.tables, ctx));
        break;
      case "admonitions":
        findings.push(...checkAdmonitionsIn(content, rule.admonitions, ctx));
        break;
      case "images":
        findings.push(...checkImagesIn(content, rule.images, ctx));
        break;
      case "blockquotes":
        findings.push(...checkBlockquotesIn(content, rule.blockquotes, ctx));
        break;
      case "definitionLists":
        findings.push(...checkDefinitionListsIn(content, rule.definitionLists, ctx));
        break;
      case "elements":
        findings.push(...checkElementsIn(content, rule.elements, ctx));
        break;
    }
  }
  return findings;
}
