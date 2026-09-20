/**
 * Run a template over a parsed document.
 *
 * Matching and checking are deliberately separate: `match.ts` decides which
 * section each rule is talking about, and this module asks the content rules
 * about the pairs it produced. The old code fused the two - it inferred which
 * section a rule meant by running the rules and seeing whether they passed -
 * which made "does this section match?" and "is this section valid?" the same
 * question, so a section could never be both matched and wrong.
 *
 * Everything here is synchronous. It was async only to await a language model,
 * which this tool no longer has.
 *
 * This is the v2 wiring at its thinnest: match, check the heading and the
 * section's own content, recurse. The chunk that owns this file reconciles the
 * two block-rule vocabularies (`core/template.ts` and `rules/index.ts` still
 * disagree about `codeBlocks.language` and `elements.tag`) and decides what a
 * template's own `contains`/`sequence` mean for the page as a whole.
 */
import type { DocumentTree, Finding, SectionNode } from "../types.js";
import { checkContains, checkHeading, checkSequence } from "../rules/index.js";
import { matchSections } from "./match.js";
import type { Rule, Template } from "./template.js";

/** Content and heading rules for one matched pair, without recursion. */
function checkSection(section: SectionNode, rule: Rule): Finding[] {
  return [
    ...checkHeading(section, rule.heading),
    ...checkSequence(section, rule.sequence),
    ...checkContains(section, rule.contains),
  ];
}

/** Match one level of sections, check each pair, then recurse. */
export function validateSections(
  sections: SectionNode[],
  rules: Rule[] | undefined,
  options: { parent?: SectionNode | null } = {},
): Finding[] {
  const { matches, findings } = matchSections(sections, rules, options);
  const all = [...findings];

  for (const match of matches) {
    all.push(...checkSection(match.section, match.rule));
    all.push(
      ...validateSections(match.section.sections, match.rule.sections, {
        parent: match.section,
      }),
    );
  }

  return all;
}

/** Findings for one document against one template, in document order. */
export function validateDocument(tree: DocumentTree, template: Template): Finding[] {
  const findings = validateSections(tree.sections, template.sections, {
    parent: null,
  });

  // Rules fire in rule order, which is not necessarily document order once a
  // template mixes optional sections and subsections. Readers scan a report top
  // to bottom against the file, so sort by where the finding actually is.
  return findings.sort(
    (a, b) => a.position.start.offset - b.position.start.offset,
  );
}
