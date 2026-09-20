/**
 * `heading:` - the section's title against a string, a one-of list, a
 * `{ pattern }`, or `false` for "no heading of its own".
 *
 * One finding type, `heading_error`, covers all four forms; the message
 * names which form failed. v1 split this into `heading_const_error` and
 * `heading_pattern_error`, each of which could fire independently for the
 * same section. v2's `heading:` is one value, so it fires at most once.
 */

import type { Finding, SectionNode } from "../types.js";
import { compilePattern, type HeadingRule } from "./index.js";

/**
 * A section's own title, in the vocabulary `heading:` speaks: `null` when the
 * section has no heading of its own (the implicit lead section), the title
 * text otherwise.
 *
 * `SectionNode.title` is `""` rather than `null` for that section - `null` is
 * reserved for "no heading" so `headingMatches`-style checks elsewhere don't
 * have to special-case the empty string. This bridges the two.
 */
function ownTitle(section: SectionNode): string | null {
  return section.titlePosition === null ? null : section.title;
}

/** Checks a section's title against the template's `heading:` rule. */
export function checkHeading(
  section: SectionNode,
  rule: HeadingRule | undefined,
): Finding[] {
  if (rule === undefined) return [];

  // The heading itself is the offending node when it has a span of its own;
  // the implicit lead section has none, so fall back to the section.
  const position = section.titlePosition ?? section.position;
  const title = ownTitle(section);
  const found = title === null ? "no heading" : `"${title}"`;

  const fail = (message: string): Finding[] => [
    {
      type: "heading_error",
      // `|| null`, as `sectionContext` and `match.ts`'s `anchor` both do. A
      // headless section's title is `""`, and the JSON reporter's `heading` is
      // a wire key `manni docevals` parses rather than validates, so two
      // spellings of "no heading" would reach it as two different facts.
      heading: section.title || null,
      message,
      position,
      severity: "error",
    },
  ];

  if (rule === false) {
    return title === null ? [] : fail(`Expected no heading of its own, but found ${found}`);
  }

  if (typeof rule === "string") {
    return title === rule ? [] : fail(`Expected title "${rule}", but found ${found}`);
  }

  if (Array.isArray(rule)) {
    if (title !== null && rule.includes(title)) return [];
    return fail(`Expected one of ${rule.map((option) => `"${option}"`).join(", ")}, but found ${found}`);
  }

  // { pattern }
  if (title !== null && compilePattern(rule.pattern).test(title)) return [];
  return fail(`Expected title matching /${rule.pattern}/, but found ${found}`);
}
