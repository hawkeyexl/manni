/**
 * `paragraphs:` - paragraph counts and a per-paragraph pattern.
 *
 * v1 took a cycling `patterns: string[]`; v2 simplifies to one `pattern`
 * every paragraph in the run must match, per proposal 0061's block-rule
 * vocabulary.
 */

import type { ContentNode, Finding, SectionNode } from "../types.js";
import {
  checkCount,
  compilePattern,
  paragraphsOf,
  sectionContext,
  type ParagraphsRule,
  type RuleContext,
} from "./index.js";

/** Checks the paragraphs a section holds directly. */
export function checkParagraphs(
  section: SectionNode,
  rule: ParagraphsRule | undefined,
): Finding[] {
  return checkParagraphsIn(section.children, rule, sectionContext(section));
}

/**
 * The reusable core: checks the paragraphs in any ordered content list.
 *
 * Used for a section's own content, for a list item's `children`, and for one
 * run of a `sequence`. `ctx` says where count findings land and what heading
 * they carry.
 */
export function checkParagraphsIn(
  content: ContentNode[],
  rule: ParagraphsRule | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const paragraphs = paragraphsOf(content);
  const findings = checkCount(
    paragraphs.length,
    rule,
    "paragraph",
    "paragraphs_count_error",
    ctx,
  );

  const pattern = rule.pattern;
  if (pattern) {
    const regex = compilePattern(pattern);
    paragraphs.forEach((paragraph, index) => {
      if (!regex.test(paragraph.text)) {
        findings.push({
          type: "paragraphs_pattern_error",
          heading: ctx.heading,
          message: `Paragraph ${index + 1} does not match /${pattern}/`,
          position: paragraph.position,
          severity: "error",
        });
      }
    });
  }

  return findings;
}
