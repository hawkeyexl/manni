/**
 * Content rules: the checks that run against a single section's own content.
 *
 * A rule is a pure, synchronous function of one `SectionNode` (or one ordered
 * `ContentNode[]` slice of it) and its slice of a template, returning
 * `Finding[]`. Rules never touch a parser AST and never await anything.
 *
 * The content model is format-neutral and flat: a section carries one ordered
 * `children: ContentNode[]`, and the per-kind "buckets" every rule needs are
 * queries over it (`paragraphsOf`, `codeBlocksOf`, ...) rather than separately
 * maintained arrays. The same queries work unchanged on a list item's
 * `children` or an element's own `children`, which is why `lists.items` and
 * `elements` can recurse.
 *
 * This module is deliberately independent of `../core/template.ts`. That file
 * is the DSL the v2 loader and schema agree on; this one is the DSL the rules
 * are written against. Where the two diverge - see `CodeBlocksRule.language`
 * and `ElementsRule.tag` below, which this chunk's task widened to `string |
 * string[]` while `core/template.ts` still types them as a bare `string` -
 * the validator chunk that wires the two together needs to reconcile it. That
 * mirrors the v1 shape of this file, whose own rule interfaces mirrored
 * `template-v1.ts` rather than importing it.
 */

import { LintError } from "../types.js";
import type {
  AdmonitionNode,
  BlockquoteNode,
  CodeNode,
  ContentNode,
  DefinitionListNode,
  ElementNode,
  Finding,
  ImageNode,
  ListNode,
  ParagraphNode,
  Position,
  SectionNode,
  TableNode,
} from "../types.js";

/* -------------------------------------------------------------------------- *
 * Template rule shapes
 *
 * These mirror the v2 template DSL's block-rule vocabulary (proposal 0065 /
 * 0061): a block rule is keyed by a plural content kind and carries `min`
 * (default 1), `max` (absent unbounded, `0` forbids), plus per-kind keys.
 * -------------------------------------------------------------------------- */

/** Shared by every counted rule: how many of the thing there must be. */
export interface Occurrences {
  /** Fewest occurrences. Absent means one - see `checkCount` for the one
   * exception, where an explicit `max: 0` with no `min` defaults `min` to 0
   * too, so "forbid this kind" is satisfiable by finding none of it. */
  min?: number;
  /** Most occurrences. Absent is unbounded; `0` forbids. */
  max?: number;
}

/**
 * What a rule's `heading` may say.
 *
 * `undefined` (the key absent) matches any heading or none. A string is exact
 * text, a list is one-of, `{ pattern }` is an unanchored regular expression,
 * and `false` means the section has no heading of its own.
 */
export type HeadingRule = string | string[] | { pattern: string } | false;

/** Attributes a node must carry. `true` requires presence; `false` requires absence. */
export type AttributesRule = Record<string, string | boolean>;

/** `paragraphs:` - how many paragraphs, and what they must look like. */
export interface ParagraphsRule extends Occurrences {
  /** Unanchored regular expression every paragraph in the run must match. */
  pattern?: string;
}

/** `codeBlocks:` - how many code blocks, and how they are tagged. */
export interface CodeBlocksRule extends Occurrences {
  /** Language(s) every code block must declare one of. */
  language?: string | string[];
  /** Info-string tail after the language; narrows which blocks count. */
  fenceInfo?: string;
}

/** `lists.items:` - how many items per list, and what each item holds. */
export interface ListItemsRule extends Occurrences {
  sequence?: BlockRule[];
  contains?: BlockRule;
}

/** `lists:` - how many lists, whether they are ordered, and item rules. */
export interface ListsRule extends Occurrences {
  ordered?: boolean;
  items?: ListItemsRule;
}

/** `tables:` - how many tables, and the header cells in order. */
export interface TablesRule extends Occurrences {
  columns?: string[];
}

/** `admonitions:` - how many, and of which variant. */
export interface AdmonitionsRule extends Occurrences {
  variant?: "note" | "tip" | "important" | "caution" | "warning" | "danger";
}

/** `images:` - how many, and what they point at. */
export interface ImagesRule extends Occurrences {
  /** Narrows which images count: only images at this url are counted. */
  url?: string;
  /** Narrows which images count: only images with this alt text are counted. */
  alt?: string;
  /**
   * Narrows which images count. `ImageNode` carries no `attributes` of its
   * own (the node model gave that field to `element` only), so any non-empty
   * requirement here matches no image - see `images.ts`.
   */
  attributes?: AttributesRule;
}

/** `elements:` - how many named wrappers, and what they hold. */
export interface ElementsRule extends Occurrences {
  /** Narrows which elements count, and names the noun in count messages. */
  tag?: string | string[];
  attributes?: AttributesRule;
  sequence?: BlockRule[];
  contains?: BlockRule;
}

/**
 * What a section (or an element's or list item's own content) holds, keyed by
 * content kind.
 *
 * One of these is a whole `contains:`. As an entry of `sequence:` exactly one
 * key is set, and it names the kind expected at that position.
 */
export interface BlockRule {
  paragraphs?: ParagraphsRule;
  codeBlocks?: CodeBlocksRule;
  lists?: ListsRule;
  tables?: TablesRule;
  admonitions?: AdmonitionsRule;
  images?: ImagesRule;
  blockquotes?: Occurrences;
  definitionLists?: Occurrences;
  elements?: ElementsRule;
}

/** `sequence:` - the ordered runs of content a section must contain. */
export type SequenceRule = BlockRule[];

/** One block-rule key: a content kind, spelled plural. */
export type BlockKind = keyof BlockRule;

/** Every block-rule key, in the order the schema declares them. */
export const BLOCK_KINDS: readonly BlockKind[] = [
  "paragraphs",
  "codeBlocks",
  "lists",
  "tables",
  "admonitions",
  "images",
  "blockquotes",
  "definitionLists",
  "elements",
];

/* -------------------------------------------------------------------------- *
 * Finding anchoring
 * -------------------------------------------------------------------------- */

/**
 * Where findings land when a rule runs over content that is not a whole
 * section - a list item's `children`, an element's `children`, or one run
 * inside a `sequence`.
 */
export interface RuleContext {
  /** Stamped onto every finding as `Finding.heading`. */
  heading: string | null;
  /** Used when the offending thing is a count rather than a single node. */
  position: Position;
}

/**
 * The context for rules run against a section's own content.
 *
 * The heading is normalised to `null` when there is none, as `match.ts` and
 * `validator.ts` both do. A headless section carries `title: ""`, and the JSON
 * reporter's `heading` is a wire key `manni docevals` parses rather than
 * validates, so `""` and `null` would reach it as two spellings of one fact.
 */
export function sectionContext(section: SectionNode): RuleContext {
  return { heading: section.title || null, position: section.position };
}

/* -------------------------------------------------------------------------- *
 * Content queries
 *
 * The single place the flat content array is bucketed by kind. Rules call
 * these; they never filter inline.
 * -------------------------------------------------------------------------- */

export function paragraphsOf(content: ContentNode[]): ParagraphNode[] {
  return content.filter((node): node is ParagraphNode => node.kind === "paragraph");
}

export function codeBlocksOf(content: ContentNode[]): CodeNode[] {
  return content.filter((node): node is CodeNode => node.kind === "codeBlock");
}

export function listsOf(content: ContentNode[]): ListNode[] {
  return content.filter((node): node is ListNode => node.kind === "list");
}

export function tablesOf(content: ContentNode[]): TableNode[] {
  return content.filter((node): node is TableNode => node.kind === "table");
}

export function admonitionsOf(content: ContentNode[]): AdmonitionNode[] {
  return content.filter((node): node is AdmonitionNode => node.kind === "admonition");
}

export function imagesOf(content: ContentNode[]): ImageNode[] {
  return content.filter((node): node is ImageNode => node.kind === "image");
}

export function blockquotesOf(content: ContentNode[]): BlockquoteNode[] {
  return content.filter((node): node is BlockquoteNode => node.kind === "blockquote");
}

export function definitionListsOf(content: ContentNode[]): DefinitionListNode[] {
  return content.filter((node): node is DefinitionListNode => node.kind === "definitionList");
}

export function elementsOf(content: ContentNode[]): ElementNode[] {
  return content.filter((node): node is ElementNode => node.kind === "element");
}

/* -------------------------------------------------------------------------- *
 * Shared message helpers
 * -------------------------------------------------------------------------- */

/** `"paragraph"`/1 -> `"paragraph"`; `"paragraph"`/2 -> `"paragraphs"`. */
function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

/** `["Field", "Type"]` -> `"Field", "Type"`. */
export function quoteList(items: string[]): string {
  return items.map((item) => `"${item}"`).join(", ");
}

/**
 * The count half of every block rule: `min` (default 1) and `max` (default
 * unbounded), against one already-computed count.
 *
 * One default is not the naive `rule.min ?? 1`. The schema documents `max: 0`
 * as how a template forbids a kind outright, and that has to be satisfiable
 * by a section that truly has none of it. A blanket "min defaults to 1" would
 * make `{ max: 0 }` alone unsatisfiable - it would demand at least one and
 * permit at most zero. So `min` defaults to 0 exactly when `max` is written
 * as `0` and `min` itself is not, and to 1 otherwise. `min: 0` and `max: 0`
 * are each still tested explicitly; this is what makes both mean something
 * at once.
 */
export function checkCount(
  count: number,
  rule: Occurrences,
  noun: string,
  type: string,
  ctx: RuleContext,
): Finding[] {
  const findings: Finding[] = [];
  const min = rule.min ?? (rule.max === 0 ? 0 : 1);
  const max = rule.max ?? null;

  if (count < min) {
    findings.push({
      type,
      heading: ctx.heading,
      message: `Expected at least ${min} ${plural(noun, min)}, but found ${count}`,
      position: ctx.position,
      severity: "error",
    });
  }

  if (max !== null && count > max) {
    findings.push({
      type,
      heading: ctx.heading,
      message: `Expected at most ${max} ${plural(noun, max)}, but found ${count}`,
      position: ctx.position,
      severity: "error",
    });
  }

  return findings;
}

/* -------------------------------------------------------------------------- *
 * The rules
 * -------------------------------------------------------------------------- */

export { checkHeading } from "./heading.js";
export { checkParagraphs, checkParagraphsIn } from "./paragraphs.js";
export { checkCodeBlocks, checkCodeBlocksIn } from "./code-blocks.js";
export { checkLists, checkListsIn } from "./lists.js";
export { checkTables, checkTablesIn } from "./tables.js";
export { checkAdmonitions, checkAdmonitionsIn } from "./admonitions.js";
export { checkImages, checkImagesIn } from "./images.js";
export { checkBlockquotes, checkBlockquotesIn } from "./blockquotes.js";
export { checkDefinitionLists, checkDefinitionListsIn } from "./definition-lists.js";
export { checkElements, checkElementsIn } from "./elements.js";
export { checkContains, checkContainsIn } from "./contains.js";
export { checkSequence, checkSequenceIn, groupRuns } from "./sequence.js";
export type { ContentRun } from "./sequence.js";

/**
 * Compile an author-supplied pattern, or say which one is broken.
 *
 * A pattern comes from a template, so a bad one is a broken template rather
 * than a lint finding - and the raw `SyntaxError` names the regex but not the
 * template, the section, or the file. Every caller must route the result
 * through the same containment a template load failure gets, or one bad
 * pattern takes the whole run down with it.
 *
 * ## A pattern that compiles can still hang
 *
 * This checks syntax, and syntax is all it checks. `(a+)+b$` is a valid regex
 * that backtracks catastrophically against a heading it cannot match, and
 * `loadTemplateFile` will fetch a template over HTTP, so an untrusted template
 * can supply one.
 *
 * Capping the input length is not the answer, however cheap it looks. The
 * blow-up is exponential in the length of the input, so a cap generous enough
 * for a real heading is already far past the point of hanging: `(a+)+b$` needs
 * on the order of 2^n steps, and n of 64 is out of reach. Any cap that
 * actually bounded the work would reject headings people legitimately write.
 *
 * The boundary that does hold is the one proposal 0015 drew for schemas: a
 * template from a URL is a trust decision made when the URL is configured, not
 * something this function can take back. Validating patterns for backtracking
 * safety at load time is the fix if that decision is ever delegated, and it is
 * a dependency and a proposal rather than a line here.
 */
const compiled = new Map<string, RegExp>();

export function compilePattern(pattern: string): RegExp {
  // Memoized because heading matching is quadratic by nature: the matcher asks
  // every rule about every section, so a template with ten pattern rules against
  // a twenty-section page compiled the same ten regexes two hundred times.
  //
  // Safe to share one instance: these are built with no flags, and `lastIndex`
  // is only carried between calls by `g` and `y`. Adding either to this
  // construction would make the cached regex stateful across sections.
  const hit = compiled.get(pattern);
  if (hit) return hit;
  try {
    const regex = new RegExp(pattern);
    compiled.set(pattern, regex);
    return regex;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new LintError(`Invalid pattern "${pattern}": ${reason}`);
  }
}

/** Drop the compiled-pattern memo. See `clearCaches` in the package root. */
export function clearPatternCache(): void {
  compiled.clear();
}
