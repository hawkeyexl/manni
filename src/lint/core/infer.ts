/**
 * Write a first template from a page that already has the shape its author
 * wants.
 *
 * The format is strict by default: every rule is one occurrence, and a section
 * no rule describes is a finding. A new author's first run against a
 * hand-written template is therefore a screen of unexpected sections, and this
 * is the escape. Proposal 0061's stress test 5 records it, and says the two
 * ship together.
 *
 * Two rules govern everything here.
 *
 * **The output must lint its input clean.** That is the whole contract, and it
 * is why each inference below is the weakest claim that still describes the
 * page. `contains:` lists only the kinds that are there, at `min: 1`, so a
 * section holding more of something still passes. A table's `columns:` is
 * claimed only where every table in that section agrees about them, and a code
 * block's `language:` only where every block in that section declares one -
 * both rules report per offending node, so a claim drawn from one node would
 * fail on its neighbour. A template that fails the page it was inferred from is
 * worse than no template: it hands a new author findings about the very
 * document they pointed at.
 *
 * **Nothing is optional and nothing repeats.** One page cannot show what
 * varies, so no `min: 0`, no `max`, no `repeat` and no `pattern` is invented.
 * Two sections with one heading are two rules. Loosening a heading into a list
 * or a pattern, marking a rule optional, and adding a trailing wildcard are the
 * author's edits, and the reference page says so.
 */
import { stringify as stringifyYaml } from "yaml";
import { LintError } from "../types.js";
import type {
  CodeNode,
  ContentKind,
  ContentNode,
  DocumentTree,
  Position,
  SectionNode,
  TableNode,
} from "../types.js";
import { BLOCK_KINDS, BLOCK_KIND_NODE } from "./template.js";
import type {
  BlockKind,
  BlockRule,
  HeadingRule,
  Rule,
  Template,
  TemplateFile,
} from "./template.js";

/** How an inferred template is written out. */
export const INFER_FORMATS = ["yaml", "json"] as const;
export type InferFormat = (typeof INFER_FORMATS)[number];

export function isInferFormat(value: string): value is InferFormat {
  return (INFER_FORMATS as readonly string[]).includes(value);
}

/**
 * Template names the schema's `templates` map accepts.
 *
 * Checked here rather than left to Ajv. `templates` is `additionalProperties:
 * false` beside a `patternProperties` key, so a name outside the pattern is
 * reported as an unexpected property - which names the offending key and says
 * nothing whatsoever about what is wrong with it.
 */
const TEMPLATE_NAME = /^[A-Za-z][A-Za-z0-9\-_]*$/;

/** The node each block-rule key counts, inverted: `codeBlock` -> `codeBlocks`. */
const KIND_KEY = new Map<ContentKind, BlockKind>(
  BLOCK_KINDS.map((key) => [BLOCK_KIND_NODE[key], key]),
);

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
 * Deliberately the same reading `validator.ts` applies, because the template
 * this produces is checked by that one. A page whose body is a single `# Title`
 * *is* that section; anything else - several top-level headings, or a body that
 * starts at `##` with no lead content - has no section standing for the page,
 * so one is synthesised with no heading of its own. The duplication is small
 * and the alternative is worse: an inference that read the page differently
 * from the checker would produce templates that fail their own source.
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
 * Content
 * -------------------------------------------------------------------------- */

/** The header row's cells, in order, or none where the table has no header. */
function headerCells(table: TableNode): string[] {
  const header = table.children.find((row) => row.header);
  return header ? header.children.map((cell) => cell.text) : [];
}

/**
 * `columns:` for a run of tables, where they all agree about it.
 *
 * `tables.columns` reports once per table whose header differs, so a claim
 * taken from the first of two unlike tables fails on the second - in the very
 * page it was drawn from. Where the tables disagree, or any of them has no
 * header row, the count alone is what the page can honestly be said to show.
 */
function columnsOf(tables: TableNode[]): { columns?: string[] } {
  const headers = tables.map(headerCells);
  const [first] = headers;
  if (first === undefined || first.length === 0) return {};
  const same = (cells: string[]): boolean =>
    cells.length === first.length && cells.every((c, i) => c === first[i]);
  return headers.every(same) ? { columns: [...first] } : {};
}

/**
 * `language:` for a run of code blocks, where every one of them declares one.
 *
 * `codeBlocks.language` holds every block in the run to the accepted set, so a
 * section mixing a tagged fence with a bare one can claim nothing: the bare one
 * would fail. Where the tags differ the list form says what the page shows,
 * which is what "one of these" is for.
 */
function languageOf(blocks: CodeNode[]): { language?: string | string[] } {
  const declared: string[] = [];
  for (const block of blocks) {
    if (block.language === undefined || block.language.length === 0) return {};
    declared.push(block.language);
  }
  const distinct = [...new Set(declared)];
  const [only] = distinct;
  if (only === undefined) return {};
  return { language: distinct.length === 1 ? only : distinct };
}

/**
 * What a section holds, as a `contains:` rule, or nothing where it holds none
 * of the kinds a template can count.
 *
 * `contains` rather than `sequence`: the page shows one order, and asserting it
 * would make moving a paragraph below a list a finding. Order is a claim its
 * author makes deliberately.
 */
function inferContains(children: ContentNode[]): BlockRule | undefined {
  const byKey = new Map<BlockKind, ContentNode[]>();
  for (const node of children) {
    const key = KIND_KEY.get(node.kind);
    if (key === undefined) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(node);
    else byKey.set(key, [node]);
  }

  const rule: BlockRule = {};
  let any = false;
  // In `BLOCK_KINDS` order, not the order the page happens to put them in, so
  // two pages holding the same kinds produce byte-identical rules.
  for (const key of BLOCK_KINDS) {
    const nodes = byKey.get(key);
    if (nodes === undefined) continue;
    any = true;
    if (key === "tables") {
      rule.tables = { min: 1, ...columnsOf(nodes as TableNode[]) };
    } else if (key === "codeBlocks") {
      rule.codeBlocks = { min: 1, ...languageOf(nodes as CodeNode[]) };
    } else {
      // A computed key, as `validator.ts` does it: every other block rule is a
      // bare count, and nine near-identical branches would say less.
      Object.assign(rule, { [key]: { min: 1 } });
    }
  }
  return any ? rule : undefined;
}

/* -------------------------------------------------------------------------- *
 * Rules
 * -------------------------------------------------------------------------- */

/**
 * A section's heading, as a rule about it.
 *
 * Exact text, because that is what the page shows; a one-of list or a pattern
 * is a generalisation only its author can make. `false` for a section with no
 * heading of its own - the implicit lead section, and the synthesised page -
 * because that is as specific a claim as naming one.
 *
 * An empty title is the one case with no spelling: the schema's `heading`
 * requires a non-empty string, and `false` would be a lie about a section that
 * does have a heading. The key is omitted, which matches any heading.
 */
function inferHeading(section: SectionNode): HeadingRule | undefined {
  if (section.titlePosition === null) return false;
  return section.title.length > 0 ? section.title : undefined;
}

/** One section, and every section under it. */
function inferRule(section: SectionNode): Rule {
  const rule: Rule = {};
  const heading = inferHeading(section);
  if (heading !== undefined) rule.heading = heading;
  const contains = inferContains(section.children);
  if (contains) rule.contains = contains;
  // Omitted, never `[]`. An absent `sections:` says nothing about the
  // subsections; an empty list says none are permitted.
  if (section.sections.length > 0) {
    rule.sections = section.sections.map(inferRule);
  }
  return rule;
}

/** The template one page describes: the page rule, with its sections under it. */
export function inferTemplate(tree: DocumentTree): Template {
  return inferRule(pageSection(tree));
}

/* -------------------------------------------------------------------------- *
 * The file
 * -------------------------------------------------------------------------- */

/** Refuse a name the `templates` map cannot hold, in words that name the rule. */
export function assertTemplateName(name: string): string {
  if (TEMPLATE_NAME.test(name)) return name;
  throw new LintError(
    `"${name}" is not a usable template name. A name starts with a letter and ` +
      `holds only letters, digits, "-" and "_". Pass --name <name>.`,
  );
}

/** A one-template file, ready to serialize. */
export function inferTemplateFile(
  tree: DocumentTree,
  name: string,
): TemplateFile {
  return { templates: { [assertTemplateName(name)]: inferTemplate(tree) } };
}

/**
 * Serialize a template file.
 *
 * `lineWidth: 0` turns off YAML's folding. A folded heading still parses back
 * to the same string, but a template is read and edited by hand, and a heading
 * broken across two lines is the one thing in this output a reader would
 * mistrust.
 */
export function renderTemplateFile(
  file: TemplateFile,
  format: InferFormat,
): string {
  const text =
    format === "json"
      ? JSON.stringify(file, null, 2)
      : stringifyYaml(file, { lineWidth: 0 });
  return text.endsWith("\n") ? text : `${text}\n`;
}
