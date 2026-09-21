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
 * Two things beyond that wiring live here, and both are about the document as a
 * whole rather than about any one section.
 *
 * **A template is a rule, and its subject is the page.** Its `heading`
 * constrains the page's own title, its `sequence`/`contains` describe what sits
 * before the first heading, and its `sections` describe what follows. See
 * `pageSection` for which section that makes the subject.
 *
 * **A rule the format cannot answer is said out loud.** A parser declares the
 * content kinds it emits (proposal 0053), and a rule about a kind absent from
 * that list is dropped and reported as a `warning` rather than silently passing
 * - or, worse, failing a document for holding none of something its format
 * cannot express.
 */
import type {
  ContentKind,
  DocumentTree,
  Finding,
  Position,
  SectionNode,
} from "../types.js";
import {
  checkContains,
  checkContainsIn,
  checkHeading,
  checkSequence,
  checkSequenceIn,
  type RuleContext,
} from "../rules/index.js";
import { parserByName } from "../parsers/index.js";
import { matchSections, type MatchOptions } from "./match.js";
import { BLOCK_KINDS, BLOCK_KIND_NODE } from "./template.js";
import type {
  BlockKind,
  BlockRule,
  ElementsRule,
  ListItemsRule,
  ListsRule,
  Rule,
  TablesRule,
  Template,
} from "./template.js";

/** What a caller can tell the validator beyond the tree and the template. */
export interface ValidateOptions {
  /** Template file the rules came from. Names the state-cap failure. */
  source?: string;
  /** Template within that file. Named in messages about the template. */
  template?: string;
  /**
   * Content kinds the parser that produced this tree emits. Defaults to what
   * the registry declares for `tree.format`, which is what the CLI wants; a
   * caller holding a tree from somewhere else passes its own.
   */
  kinds?: ContentKind[];
}

/* -------------------------------------------------------------------------- *
 * The page as the template's subject
 * -------------------------------------------------------------------------- */

/** A zero-width span at the top of a file, for a document with no sections. */
function origin(): Position {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  };
}

/** First section's start through the last one's end. */
function span(sections: SectionNode[]): Position {
  const first = sections[0];
  const last = sections[sections.length - 1];
  if (!first || !last) return origin();
  return { start: { ...first.position.start }, end: { ...last.position.end } };
}

/**
 * The section the template describes: the page itself.
 *
 * A page whose body is one `# Title` with everything nested under it *is* that
 * section, and a page whose content starts before any heading is the implicit
 * lead section `sectionize` opens for it - which has no heading of its own, so
 * `heading: false` matches it and `heading: "Overview"` does not.
 *
 * Anything else - several top-level headings, or a body that starts at `##`,
 * which is what a page whose title lives in frontmatter looks like - has no one
 * section standing for the page, so one is synthesised. It has no heading and
 * no content of its own: content before the first heading always opens a lead
 * section, so a document that reaches this branch has none.
 */
function pageSection(tree: DocumentTree): SectionNode {
  const [only] = tree.sections;
  if (tree.sections.length === 1 && only && only.level <= 1) return only;
  return {
    slug: "",
    title: "",
    level: 0,
    order: 0,
    parentSlug: null,
    titlePosition: null,
    position: span(tree.sections),
    children: [],
    sections: tree.sections,
  };
}

/* -------------------------------------------------------------------------- *
 * Rules the format cannot answer
 * -------------------------------------------------------------------------- */

/** One rule that will not run here, and what the parser does not report. */
interface UncheckedRule {
  /** The template key, as the author wrote it. */
  rule: string;
  /** What is missing, in words: `tables`, `table columns`, `list items`. */
  noun: string;
}

/** What each block-rule key asks about, as a message says it. */
const BLOCK_NOUNS: Record<BlockKind, string> = {
  paragraphs: "paragraphs",
  codeBlocks: "code blocks",
  lists: "lists",
  tables: "tables",
  admonitions: "admonitions",
  images: "images",
  blockquotes: "blockquotes",
  definitionLists: "definition lists",
  elements: "elements",
};

/**
 * A template with the rules this format cannot answer removed, and the list of
 * what was removed.
 *
 * Removing them is the point, not a side effect. A `tables: { min: 1 }` left
 * standing against a parser that never emits a table counts zero tables and
 * fails the page, which is a verdict on the format rather than on the document
 * - and it would contradict, in the same report, the warning saying the rule
 * was not checked.
 */
class Pruner {
  private readonly emitted: Set<ContentKind>;
  /** Keyed by message, so one rule asked twice is reported once. */
  private readonly missing = new Map<string, UncheckedRule>();

  constructor(kinds: ContentKind[]) {
    this.emitted = new Set(kinds);
  }

  get gaps(): UncheckedRule[] {
    return [...this.missing.values()];
  }

  private emits(kind: ContentKind): boolean {
    return this.emitted.has(kind);
  }

  private drop(rule: string, noun: string): void {
    this.missing.set(`${rule}: ${noun}`, { rule, noun });
  }

  /** A table rule without its `columns`, when the parser reports no cells. */
  private tables(rule: TablesRule): TablesRule {
    if (rule.columns === undefined || this.emits("tableCell")) return rule;
    this.drop("columns", "table columns");
    const { columns: _columns, ...kept } = rule;
    return kept;
  }

  /**
   * A list rule with its `items` pruned.
   *
   * `items` has no capability of its own to check. A parser that reports a
   * list reports its items, since `ListNode.items` is not optional, and
   * `listItem` is not one of the `BLOCK_KINDS` a block rule can target. So
   * the `lists` gap covers the whole rule, and only what the items *hold* can
   * go unchecked.
   *
   * `listItem` is a `ContentKind` and parsers do declare it. That is a fact
   * about the node model rather than about this pruner: a template names
   * `lists`, and reaches an item only through `items`, so there is no rule
   * whose capability would be `listItem` on its own.
   */
  private lists(rule: ListsRule): ListsRule {
    const items = rule.items;
    if (items === undefined) return rule;
    const pruned = this.listItems(items);
    return pruned === items ? rule : { ...rule, items: pruned };
  }

  private listItems(rule: ListItemsRule): ListItemsRule {
    return this.holder(rule);
  }

  private elements(rule: ElementsRule): ElementsRule {
    return this.holder(rule);
  }

  /** The `sequence`/`contains` pair every content holder carries. */
  private holder<T extends { sequence?: BlockRule[]; contains?: BlockRule }>(
    rule: T,
  ): T {
    const kept = { ...rule };
    let changed = false;

    if (rule.sequence) {
      const sequence = this.sequence(rule.sequence);
      if (sequence === undefined) {
        delete kept.sequence;
        changed = true;
      } else if (sequence !== rule.sequence) {
        kept.sequence = sequence;
        changed = true;
      }
    }

    if (rule.contains) {
      const contains = this.block(rule.contains);
      if (contains === undefined) {
        delete kept.contains;
        changed = true;
      } else if (contains !== rule.contains) {
        kept.contains = contains;
        changed = true;
      }
    }

    return changed ? kept : rule;
  }

  /**
   * One `sequence`, with the runs this format cannot see taken out.
   *
   * Taking the entry out rather than leaving it empty is what keeps the rest of
   * the sequence meaningful: a run of a kind the parser never emits can never
   * appear among the actual runs, so an entry left standing would report an
   * order error on every file of that format. `undefined` means the key goes.
   */
  private sequence(entries: BlockRule[]): BlockRule[] | undefined {
    const kept: BlockRule[] = [];
    let changed = false;
    for (const entry of entries) {
      const pruned = this.block(entry);
      if (pruned === undefined) {
        changed = true;
        continue;
      }
      if (pruned !== entry) changed = true;
      kept.push(pruned);
    }
    if (!changed) return entries;
    return kept.length > 0 ? kept : undefined;
  }

  /** One block rule, or `undefined` when nothing in it can be checked. */
  private block(block: BlockRule): BlockRule | undefined {
    const kept: BlockRule = { ...block };
    let changed = false;

    for (const key of BLOCK_KINDS) {
      if (kept[key] === undefined) continue;
      if (this.emits(BLOCK_KIND_NODE[key])) continue;
      this.drop(key, BLOCK_NOUNS[key]);
      // Cleared rather than deleted. A computed `delete` is banned here, and
      // nothing that reads a block rule asks whether the key is present - every
      // one of them tests the value against `undefined`.
      Object.assign(kept, { [key]: undefined });
      changed = true;
    }

    const tables = kept.tables;
    if (tables) {
      const pruned = this.tables(tables);
      if (pruned !== tables) {
        kept.tables = pruned;
        changed = true;
      }
    }

    const lists = kept.lists;
    if (lists) {
      const pruned = this.lists(lists);
      if (pruned !== lists) {
        kept.lists = pruned;
        changed = true;
      }
    }

    const elements = kept.elements;
    if (elements) {
      const pruned = this.elements(elements);
      if (pruned !== elements) {
        kept.elements = pruned;
        changed = true;
      }
    }

    if (!changed) return block;
    return BLOCK_KINDS.some((key) => kept[key] !== undefined) ? kept : undefined;
  }

  private rules(rules: Rule[]): Rule[] {
    const kept: Rule[] = [];
    let changed = false;
    for (const rule of rules) {
      const pruned = this.rule(rule);
      if (pruned !== rule) changed = true;
      kept.push(pruned);
    }
    return changed ? kept : rules;
  }

  rule<T extends Rule>(rule: T): T {
    const kept = this.holder(rule);
    let changed = kept !== rule;
    const out = changed ? kept : { ...rule };

    if (rule.repeat) {
      const repeat = this.rules(rule.repeat);
      if (repeat !== rule.repeat) {
        out.repeat = repeat;
        changed = true;
      }
    }

    if (rule.sections) {
      const sections = this.rules(rule.sections);
      if (sections !== rule.sections) {
        out.sections = sections;
        changed = true;
      }
    }

    return changed ? out : rule;
  }
}

/** A pruned template and what pruning it took out. */
interface Pruned {
  template: Template;
  gaps: UncheckedRule[];
}

/**
 * Pruned templates, keyed by the template and the format's kinds.
 *
 * The identity matters as much as the saving. `match.ts` caches one compiled
 * automaton per rule *array*, so a fresh copy of `sections` per file would
 * recompile the template for every page of a docset. A template that needs no
 * pruning is therefore returned as-is, and one that does is pruned once per
 * format.
 */
const pruneCache = new WeakMap<Template, Map<string, Pruned>>();

function prune(template: Template, kinds: ContentKind[]): Pruned {
  const key = [...kinds].sort().join(",");
  let byKinds = pruneCache.get(template);
  if (!byKinds) {
    byKinds = new Map<string, Pruned>();
    pruneCache.set(template, byKinds);
  }
  const hit = byKinds.get(key);
  if (hit) return hit;

  const pruner = new Pruner(kinds);
  const pruned: Pruned = { template: pruner.rule(template), gaps: pruner.gaps };
  byKinds.set(key, pruned);
  return pruned;
}

/** The warning one unchecked rule gets, anchored at the top of the file. */
function uncheckedFinding(
  format: string,
  name: string,
  gap: UncheckedRule,
): Finding {
  return {
    type: "unsupported_content_kind",
    heading: null,
    message:
      `The ${format} parser does not report ${gap.noun}, so the ` +
      `"${gap.rule}" rule in template "${name}" is not checked for this file.`,
    position: origin(),
    // A warning, because nothing about the document is wrong: the rule asks
    // about something this format cannot express. It never changes the exit
    // code - `runLint` counts a file as failed only on an error-severity
    // finding - so a docset of mixed formats stays green while still saying
    // which rules went unchecked, and where.
    severity: "warning",
  };
}

/* -------------------------------------------------------------------------- *
 * The walk
 * -------------------------------------------------------------------------- */

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
  options: MatchOptions = {},
): Finding[] {
  const { matches, findings } = matchSections(sections, rules, options);
  const all = [...findings];

  for (const match of matches) {
    all.push(...checkSection(match.section, match.rule));
    all.push(
      ...validateSections(match.section.sections, match.rule.sections, {
        ...options,
        parent: match.section,
      }),
    );
  }

  return all;
}

/** Findings for one document against one template, in document order. */
export function validateDocument(
  tree: DocumentTree,
  template: Template,
  options: ValidateOptions = {},
): Finding[] {
  // An unrecognised format falls back to *no* kinds rather than to no pruning.
  // Every tree the CLI builds carries a registered parser's own name, so this
  // is only reachable through the exported API, with a tree somebody else
  // parsed. Such a format has promised nothing, so no content rule can be said
  // to have run against it, and the alternative is the one 0053 rules out:
  // applying every rule to a format that may answer none of them, which makes
  // a green run mean two different things.
  const kinds = options.kinds ?? parserByName(tree.format)?.kinds ?? [];
  const pruned = prune(template, kinds);
  const rules = pruned.template;
  // The template's own name, for the messages that have to say which template
  // asked. The caller knows it; `title` is the next best thing a file carries.
  const name = options.template ?? template.title ?? "unnamed";

  const findings: Finding[] = pruned.gaps.map((gap) =>
    uncheckedFinding(tree.format, name, gap),
  );

  // The page is the template's subject. Its content is checked through the
  // `*In` rules rather than the section-shaped ones so that a finding about a
  // page with no heading of its own carries no heading either, instead of the
  // empty string a headless section's title is.
  const page = pageSection(tree);
  const ctx: RuleContext = {
    heading: page.title || null,
    position: page.position,
  };
  findings.push(...checkHeading(page, rules.heading));
  findings.push(...checkSequenceIn(page.children, rules.sequence, ctx));
  findings.push(...checkContainsIn(page.children, rules.contains, ctx));
  findings.push(
    ...validateSections(page.sections, rules.sections, {
      parent: page,
      source: options.source,
      template: options.template,
    }),
  );

  // Rules fire in rule order, which is not necessarily document order once a
  // template mixes optional sections and subsections. Readers scan a report top
  // to bottom against the file, so sort by where the finding actually is.
  return findings.sort(
    (a, b) => a.position.start.offset - b.position.start.offset,
  );
}
