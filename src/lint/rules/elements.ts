/**
 * `elements:` - named-wrapper counts, filtered and labeled by `tag`, the
 * literal `attributes` a matched element must carry, and what it holds via
 * `sequence` | `contains` recursing into the element's own `children` -
 * never the enclosing section's, per proposal 0065 stress test 4.
 *
 * `tag` narrows the counted set the way `codeBlocks.fenceInfo` and
 * `images.url`/`alt` do, and also names the noun in count messages: `elements:
 * { tag: "Steps", min: 1 }` reports `Expected at least 1 "Steps" element, but
 * found 0`, not the generic `"element"`. `attributes` is diagnostic instead,
 * checked per matched element and reported once per offending attribute.
 */

import type { ContentNode, ElementNode, Finding, SectionNode } from "../types.js";
import {
  checkCount,
  elementsOf,
  sectionContext,
  type AttributesRule,
  type ElementsRule,
  type RuleContext,
} from "./index.js";
import { checkContainsIn } from "./contains.js";
import { checkSequenceIn } from "./sequence.js";

/** Checks the elements a section holds directly. */
export function checkElements(
  section: SectionNode,
  rule: ElementsRule | undefined,
): Finding[] {
  return checkElementsIn(section.children, rule, sectionContext(section));
}

/** The reusable core: checks the elements in any ordered content list. */
export function checkElementsIn(
  content: ContentNode[],
  rule: ElementsRule | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const tags = rule.tag === undefined ? undefined : Array.isArray(rule.tag) ? rule.tag : [rule.tag];
  const matching = tags ? elementsOf(content).filter((element) => tags.includes(element.name)) : elementsOf(content);

  // "or", not a comma list: the count applies to one combined label, so
  // `"Note", "Tip" element` reads as two nouns with a singular verb where
  // `"Note" or "Tip" element` reads as the one thing being counted.
  const noun = tags
    ? `${tags.map((tag) => `"${tag}"`).join(" or ")} element`
    : "element";
  const findings = checkCount(matching.length, rule, noun, "elements_count_error", ctx);

  if (rule.attributes) {
    for (const element of matching) {
      findings.push(...checkAttributes(element, rule.attributes, ctx));
    }
  }

  // Both, unconditionally, as `validator.ts` runs them against a section. Each
  // no-ops on an absent rule, and the schema refuses a rule that writes both
  // (`oneOfSequenceOrContains`), so only one can ever fire. Writing it as a
  // choice made this file's behaviour depend on a constraint declared in
  // another, which reads like a silent drop whether or not it is one.
  if (rule.sequence || rule.contains) {
    for (const element of matching) {
      const elementCtx: RuleContext = { heading: ctx.heading, position: element.position };
      findings.push(...checkSequenceIn(element.children, rule.sequence, elementCtx));
      findings.push(...checkContainsIn(element.children, rule.contains, elementCtx));
    }
  }

  return findings;
}

/**
 * `true` requires presence (any value); `false` requires absence; a string
 * is the required literal value. An element's own `attributes` map values a
 * dynamic (JSX-expression) attribute as `true` too, since its literal value
 * cannot be known statically - `checkOne` tells that apart from "absent" by
 * checking membership before comparing values.
 */
function checkAttributes(
  element: ElementNode,
  rule: AttributesRule,
  ctx: RuleContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const [key, expected] of Object.entries(rule)) {
    const finding = checkOne(element, key, expected, ctx);
    if (finding) findings.push(finding);
  }
  return findings;
}

function checkOne(
  element: ElementNode,
  key: string,
  expected: string | boolean,
  ctx: RuleContext,
): Finding | null {
  const attributes = element.attributes ?? {};
  const present = key in attributes;
  const actual = attributes[key];

  const fail = (want: string, detail: string): Finding => ({
    type: "elements_attribute_error",
    heading: ctx.heading,
    message: `Expected the "${element.name}" element ${want}, but ${detail}`,
    position: element.position,
    severity: "error",
  });

  if (expected === false) {
    if (!present) return null;
    const found = actual === true ? `an expression` : `${key}="${String(actual)}"`;
    return fail(`not to carry ${key}`, `found ${found}`);
  }

  if (!present) return fail(attributeWant(key, expected), `it carries no ${key}`);
  if (expected === true) return null;
  if (actual === true) return fail(attributeWant(key, expected), `its ${key} is an expression`);
  if (actual !== expected) return fail(attributeWant(key, expected), `found ${key}="${String(actual)}"`);
  return null;
}

function attributeWant(key: string, expected: string | true): string {
  return expected === true ? `to carry ${key}` : `to carry ${key}="${expected}"`;
}
