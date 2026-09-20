/**
 * `admonitions:` - admonition counts and the variant every admonition must
 * carry.
 *
 * `variant` is diagnostic, not a count filter, for the same reason
 * `tables.columns` is: every admonition counts toward `min`/`max` regardless,
 * and a mismatch is reported once per offending admonition.
 */

import type { AdmonitionNode, ContentNode, Finding, SectionNode } from "../types.js";
import {
  admonitionsOf,
  checkCount,
  sectionContext,
  type AdmonitionsRule,
  type RuleContext,
} from "./index.js";

/** Checks the admonitions a section holds directly. */
export function checkAdmonitions(
  section: SectionNode,
  rule: AdmonitionsRule | undefined,
): Finding[] {
  return checkAdmonitionsIn(section.children, rule, sectionContext(section));
}

/** The reusable core: checks the admonitions in any ordered content list. */
export function checkAdmonitionsIn(
  content: ContentNode[],
  rule: AdmonitionsRule | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const admonitions = admonitionsOf(content);
  const findings = checkCount(
    admonitions.length,
    rule,
    "admonition",
    "admonitions_count_error",
    ctx,
  );

  if (rule.variant) {
    findings.push(...checkVariant(admonitions, rule.variant, ctx));
  }

  return findings;
}

function checkVariant(
  admonitions: AdmonitionNode[],
  variant: NonNullable<AdmonitionsRule["variant"]>,
  ctx: RuleContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const admonition of admonitions) {
    if (admonition.variant !== variant) {
      findings.push({
        type: "admonitions_variant_error",
        heading: ctx.heading,
        message: `Expected a ${variant} admonition, but found a ${admonition.variant}`,
        position: admonition.position,
        severity: "error",
      });
    }
  }
  return findings;
}
