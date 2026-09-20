/**
 * The template DSL, as TypeScript. `schemas/lint/template.json` is the
 * authority that user input is validated against; this is the shape the rest of
 * the code reads once that validation has passed.
 *
 * Two things are worth knowing before reading it.
 *
 * A template *is* a rule. It describes the page, so it takes every rule key,
 * plus `title`, `types` and `extends`. It may not take `min` or `max`, because
 * a page is one page, and the loader refuses those two by hand.
 *
 * A rule's children are a **list**, not a map. The v1 format keyed section
 * rules by name and let YAML key order carry the grammar, which made the order
 * invisible to the schema and unspeakable in `extends`. A rule names itself
 * with `id` instead, and that is what `extends` targets.
 *
 * The block-rule keys are plural where the node model is singular. That is
 * deliberate: the node model names one node (`codeBlock`), while a template key
 * carries a count (`codeBlocks: { min: 1 }`).
 */
import { compilePattern } from "../rules/index.js";

/** Shared by every counted rule: how many of the thing there must be. */
export interface Occurrences {
  /** Fewest occurrences. Absent means one. */
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

/** Attributes a node must carry. `true` requires the attribute's presence. */
export type AttributesRule = Record<string, string | boolean>;

/** `paragraphs:` - how many paragraphs, and what each must look like. */
export interface ParagraphsRule extends Occurrences {
  /** Unanchored regular expression every paragraph in the run must match. */
  pattern?: string;
}

/** `codeBlocks:` - how many code blocks, and how they are tagged. */
export interface CodeBlocksRule extends Occurrences {
  language?: string;
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
  url?: string;
  alt?: string;
  attributes?: AttributesRule;
}

/** `elements:` - how many named wrappers, and what they hold. */
export interface ElementsRule extends Occurrences {
  tag?: string;
  attributes?: AttributesRule;
  sequence?: BlockRule[];
  contains?: BlockRule;
}

/**
 * What a section holds, keyed by content kind.
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

/** One rule: a section of the page, or a repeated run of sections. */
export interface Rule extends Occurrences {
  /** Handle, unique among siblings. `extends` targets it. */
  id?: string;
  /** Prose description of what the rule is for. Never checked. */
  description?: string;
  heading?: HeadingRule;
  /** Rules matched in order as one unit, repeated by this rule's `min`/`max`. */
  repeat?: Rule[];
  /** What the section holds, in order. Not combinable with `contains`. */
  sequence?: BlockRule[];
  /** What the section holds, in any order. Not combinable with `sequence`. */
  contains?: BlockRule;
  /** Rules for the subsections, in document order. */
  sections?: Rule[];
}

/** One doctype template: the rule that describes a whole page. */
export interface Template extends Rule {
  /** Human-readable name, shown by `manni lint templates`. */
  title?: string;
  /** Doctypes this template serves, matched against a page's `type`. */
  types?: string[];
  /** Built-in id, path, or URL to inherit from. */
  extends?: string;
}

/** A template file: named templates plus reusable `$ref` targets. */
export interface TemplateFile {
  /** Published schema URL, for editors. Ignored by the linter. */
  $schema?: string;
  templates?: Record<string, Template>;
  components?: Record<string, unknown>;
  info?: Record<string, unknown>;
}

/**
 * A rule is a wildcard when it says nothing about its heading.
 *
 * It then matches any heading, and matches a section with none. `heading:
 * false` is not a wildcard: it states that the section has no heading of its
 * own, which is as specific as naming one.
 */
export function isWildcard(rule: Rule): boolean {
  return rule.heading === undefined;
}

/**
 * How many sections a rule claims: `min` defaulting to one, and `max` as
 * written, with `null` for unbounded.
 *
 * The defaults live here rather than in the schema. A default written into the
 * data by Ajv is indistinguishable from a value the author typed, so it wins
 * the `extends` merge against the parent's real value.
 */
export function occurrenceRange(rule: Occurrences): {
  min: number;
  max: number | null;
} {
  return { min: rule.min ?? 1, max: rule.max ?? null };
}

/** Whether a section's title satisfies a rule's `heading`. */
export function headingMatches(
  heading: HeadingRule | undefined,
  title: string | null,
): boolean {
  if (heading === undefined) return true;
  if (heading === false) return title === null;
  if (title === null) return false;
  if (typeof heading === "string") return title === heading;
  if (Array.isArray(heading)) return heading.includes(title);
  return compilePattern(heading.pattern).test(title);
}
