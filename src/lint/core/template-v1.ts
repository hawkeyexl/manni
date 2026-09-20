/**
 * The v1 template shapes, kept alive for exactly one reason.
 *
 * `core/template.ts` now holds the v2 format: a rule list, keyed by `id`, with
 * `min`/`max` counts and plural block-rule keys. The matcher (`core/match.ts`)
 * and the content rules (`rules/**`) are rewritten against it in a later piece
 * of work. Until then they still speak the v1 map-of-sections shape, and this
 * file is where that shape lives so `core/template.ts` can be purely v2.
 *
 * Nothing new should import this. It is deleted with the matcher rewrite.
 */
import { compilePattern } from "../rules/index.js";
import type {
  CodeBlocksRule,
  HeadingRule,
  ListsRule,
  ParagraphsRule,
  SequenceRule,
} from "../rules/index.js";

export interface TemplateSection {
  description?: string;
  heading?: HeadingRule;
  /** Default true. */
  required?: boolean;
  paragraphs?: ParagraphsRule;
  code_blocks?: CodeBlocksRule;
  lists?: ListsRule;
  sequence?: SequenceRule;
  /** Whether this rule may claim more than one section. Default false. */
  repeat?: boolean;
  /** Allow document sections this template does not describe. Default false. */
  additionalSections?: boolean;
  /** Subsection rules, in document order. */
  sections?: Record<string, TemplateSection>;
}

/** A v1 template: the map-of-sections shape the matcher still reads. */
export interface V1Template {
  types?: string[];
  extends?: string;
  additionalSections?: boolean;
  sections?: Record<string, TemplateSection>;
}

/** A rule is required unless it says otherwise. */
export function isRequired(rule: TemplateSection): boolean {
  return rule.required !== false;
}

/**
 * A rule is a "slot" when it constrains no heading text. A slot matches any
 * heading, and claims exactly one section unless it sets `repeat`.
 */
export function isSlot(rule: TemplateSection): boolean {
  return !rule.heading?.const && !rule.heading?.pattern;
}

/** Whether a section's heading satisfies a rule's heading constraint. */
export function headingMatches(title: string, rule: TemplateSection): boolean {
  if (isSlot(rule)) return true;
  if (rule.heading?.const !== undefined) return title === rule.heading.const;
  if (rule.heading?.pattern !== undefined) {
    return compilePattern(rule.heading.pattern).test(title);
  }
  return true;
}
