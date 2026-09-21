/**
 * `codeBlocks:` - code block counts, the language(s) every block must
 * declare, and a `fenceInfo` filter over the info-string tail.
 *
 * `language` reports per offending block (every code block must declare one
 * of the accepted languages), the same way v1 reported nothing about
 * language at all - this is new in v2. `fenceInfo` has no message form of its
 * own in proposal 0054's table, so it narrows which blocks count toward
 * `min`/`max` instead, the way `elements.tag` does.
 */

import type { CodeNode, ContentNode, Finding, SectionNode } from "../types.js";
import {
  checkCount,
  codeBlocksOf,
  compilePattern,
  sectionContext,
  type CodeBlocksRule,
  type RuleContext,
} from "./index.js";

/** Checks the code blocks a section holds directly. */
export function checkCodeBlocks(
  section: SectionNode,
  rule: CodeBlocksRule | undefined,
): Finding[] {
  return checkCodeBlocksIn(section.children, rule, sectionContext(section));
}

/**
 * The reusable core: checks the code blocks in any ordered content list -
 * a section's content, a list item's `children`, or one run of a `sequence`.
 */
export function checkCodeBlocksIn(
  content: ContentNode[],
  rule: CodeBlocksRule | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const codeBlocks = codeBlocksOf(content);
  const counted = rule.fenceInfo
    ? codeBlocks.filter((block) => matchesFenceInfo(block, rule.fenceInfo as string))
    : codeBlocks;

  const findings = checkCount(
    counted.length,
    rule,
    "code block",
    "code_blocks_count_error",
    ctx,
  );

  if (rule.language) {
    findings.push(...checkLanguages(codeBlocks, rule.language, ctx));
  }

  return findings;
}

function matchesFenceInfo(block: CodeNode, pattern: string): boolean {
  return compilePattern(pattern).test(block.fenceInfo ?? "");
}

/** Every code block in the run must declare one of the accepted languages. */
function checkLanguages(
  codeBlocks: CodeNode[],
  language: string | string[],
  ctx: RuleContext,
): Finding[] {
  const languages = Array.isArray(language) ? language : [language];
  const only = languages[0];
  if (languages.length === 0 || only === undefined) return [];

  const label =
    languages.length === 1
      ? `"${only}"`
      : `one of ${languages.map((lang) => `"${lang}"`).join(", ")}`;

  const findings: Finding[] = [];
  codeBlocks.forEach((block, index) => {
    if (block.language !== undefined && languages.includes(block.language)) return;

    const found = block.language ? `but found "${block.language}"` : "but found no language";
    findings.push({
      type: "code_blocks_language_error",
      heading: ctx.heading,
      message: `Expected code block ${index + 1} to declare ${label}, ${found}`,
      position: block.position,
      severity: "error",
    });
  });

  return findings;
}
