/**
 * `lists:` - list counts, whether they are ordered, item counts, and what
 * each item holds.
 *
 * v1's `items` took its own flat `paragraphs`/`code_blocks`/`lists` keys. v2
 * replaces that split with the same `sequence` | `contains` every other
 * container uses (proposal 0061), so item-level rules recurse through the
 * same two functions as everything else instead of a third, list-shaped one.
 */

import type { ContentNode, Finding, ListNode, SectionNode } from "../types.js";
import {
  checkCount,
  listsOf,
  sectionContext,
  type ListsRule,
  type RuleContext,
} from "./index.js";
import { checkContainsIn } from "./contains.js";
import { checkSequenceIn } from "./sequence.js";

/** Checks the lists a section holds directly. */
export function checkLists(
  section: SectionNode,
  rule: ListsRule | undefined,
): Finding[] {
  return checkListsIn(section.children, rule, sectionContext(section));
}

/**
 * The reusable core: checks the lists in any ordered content list.
 *
 * `rule.items` recurses - a list item's children are a `ContentNode[]` like
 * any other, so item-level `sequence`/`contains` rules run through the same
 * functions, arbitrarily deep.
 */
export function checkListsIn(
  content: ContentNode[],
  rule: ListsRule | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const lists = listsOf(content);
  const findings = checkCount(lists.length, rule, "list", "lists_count_error", ctx);

  if (rule.ordered !== undefined) {
    findings.push(...checkOrdered(lists, rule.ordered, ctx));
  }

  const items = rule.items;
  if (!items) return findings;

  findings.push(...checkItemCounts(lists, items, ctx));

  if (!items.sequence && !items.contains) return findings;

  for (const list of lists) {
    for (const item of list.items) {
      const itemCtx: RuleContext = { heading: ctx.heading, position: item.position };
      if (items.sequence) {
        findings.push(...checkSequenceIn(item.children, items.sequence, itemCtx));
      } else if (items.contains) {
        findings.push(...checkContainsIn(item.children, items.contains, itemCtx));
      }
    }
  }

  return findings;
}

function checkOrdered(lists: ListNode[], ordered: boolean, ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const list of lists) {
    if (list.ordered !== ordered) {
      findings.push({
        type: "lists_ordered_error",
        heading: ctx.heading,
        message: ordered
          ? "Expected a numbered list, but found a bulleted list"
          : "Expected a bulleted list, but found a numbered list",
        position: list.position,
        severity: "error",
      });
    }
  }
  return findings;
}

/**
 * Item counts report once per bound, anchored at the first list that breaks
 * it. `min` defaults to 1 like every other count, which is a harmless no-op
 * here: a list always has at least one item structurally, so only an
 * explicit `min` above 1 (or a rule that also forbids via `max`) ever fires.
 */
function checkItemCounts(
  lists: ListNode[],
  items: { min?: number; max?: number },
  ctx: RuleContext,
): Finding[] {
  const findings: Finding[] = [];
  const min = items.min ?? (items.max === 0 ? 0 : 1);
  const max = items.max ?? null;

  if (max !== null) {
    const offender = lists.find((list) => list.items.length > max);
    if (offender) {
      findings.push({
        type: "lists_items_count_error",
        heading: ctx.heading,
        message: `Expected at most ${max} items in a list, but found ${offender.items.length}`,
        position: offender.position,
        severity: "error",
      });
    }
  }

  if (min > 0) {
    const offender = lists.find((list) => list.items.length < min);
    if (offender) {
      findings.push({
        type: "lists_items_count_error",
        heading: ctx.heading,
        message: `Expected at least ${min} items in a list, but found ${offender.items.length}`,
        position: offender.position,
        severity: "error",
      });
    }
  }

  return findings;
}
