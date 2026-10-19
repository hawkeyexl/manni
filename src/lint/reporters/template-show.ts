/**
 * `manni lint templates show`: what a template asks for, as a reader scans it
 * (`pretty`), as data (`json`), or as a page to start writing from
 * (`markdown`).
 *
 * The content lines use the nouns the count findings use, so "Contains at
 * least 1 table." here and "Expected at least 1 table" in a finding read as
 * the same rule.
 */
import { palette, type Colors } from "../../shared/color.js";
import { quoteList } from "../rules/index.js";
import {
  BLOCK_KINDS,
  occurrenceRange,
  type BlockKind,
  type BlockRule,
  type HeadingRule,
  type Occurrences,
  type Rule,
} from "../core/template.js";
import type { TemplateShow } from "../commands/templates.js";
import type { ReportOptions } from "./index.js";

/** `templates show -f`. */
export const SHOW_FORMATS = ["pretty", "json", "markdown"] as const;
export type ShowFormat = (typeof SHOW_FORMATS)[number];

export function isShowFormat(value: string): value is ShowFormat {
  return (SHOW_FORMATS as readonly string[]).includes(value);
}

/** How often a rule may occur, in words. */
export function occurrenceWords(rule: Occurrences): string {
  const { min, max } = occurrenceRange(rule);
  if (max === 0) return "forbidden";
  if (max === null) {
    if (min === 0) return "optional, repeats";
    if (min === 1) return "required, repeats";
    return `at least ${min}`;
  }
  if (min === 1 && max === 1) return "required";
  if (min === 0 && max === 1) return "optional";
  return `${min} to ${max}`;
}

function headingForm(heading: HeadingRule | undefined): string {
  if (heading === undefined) return "(any heading)";
  if (heading === false) return "(no heading)";
  if (typeof heading === "string") return heading;
  if (Array.isArray(heading)) return heading.join(" | ");
  return `/${heading.pattern}/`;
}

const NOUNS: Record<BlockKind, string> = {
  paragraphs: "paragraph",
  codeBlocks: "code block",
  lists: "list",
  tables: "table",
  admonitions: "admonition",
  images: "image",
  blockquotes: "blockquote",
  definitionLists: "definition list",
  elements: "element",
};

/** The noun one kind's rule counts, narrowed the way its count finding is. */
function noun(kind: BlockKind, block: BlockRule): string {
  if (kind === "lists" && block.lists?.ordered !== undefined) {
    return block.lists.ordered ? "numbered list" : "bulleted list";
  }
  if (kind === "admonitions" && block.admonitions?.variant !== undefined) {
    return `${block.admonitions.variant} admonition`;
  }
  const tag = block.elements?.tag;
  if (kind === "elements" && tag !== undefined) {
    const tags = Array.isArray(tag) ? tag : [tag];
    return `${tags.map((t) => `"${t}"`).join(" or ")} element`;
  }
  return NOUNS[kind];
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

/** `at least 1 table`, `at most 3 lists`, `no images`. */
function counted(range: Occurrences, word: string): string {
  const { min, max } = occurrenceRange(range);
  if (max === 0) return `no ${plural(word, 0)}`;
  if (max === null) {
    return min === 0 ? `any number of ${plural(word, 0)}` : `at least ${min} ${plural(word, min)}`;
  }
  if (min === 0) return `at most ${max} ${plural(word, max)}`;
  if (min === max) return `exactly ${min} ${plural(word, min)}`;
  return `${min} to ${max} ${plural(word, max)}`;
}

/** What else a kind's rule asks of each thing it counts. */
function qualifiers(block: BlockRule): string {
  const parts: string[] = [];
  if (block.paragraphs?.pattern !== undefined) {
    parts.push(`each matching /${block.paragraphs.pattern}/`);
  }
  const language = block.codeBlocks?.language;
  if (language !== undefined) {
    parts.push(`in ${(Array.isArray(language) ? language : [language]).join(" or ")}`);
  }
  if (block.codeBlocks?.fenceInfo !== undefined) {
    parts.push(`with fence info "${block.codeBlocks.fenceInfo}"`);
  }
  if (block.lists?.items !== undefined) {
    parts.push(`each with ${counted(block.lists.items, "item")}`);
  }
  if (block.tables?.columns !== undefined) {
    parts.push(`with columns ${quoteList(block.tables.columns)}`);
  }
  return parts.map((p) => `, ${p}`).join("");
}

/** The content minimums a rule sets, one line per kind, then its order. */
function contentLines(rule: Rule): string[] {
  const lines: string[] = [];
  const contains = rule.contains;
  if (contains !== undefined) {
    for (const kind of BLOCK_KINDS) {
      const range = contains[kind];
      if (range === undefined) continue;
      lines.push(
        `Contains ${counted(range, noun(kind, contains))}${qualifiers({ [kind]: range })}.`,
      );
    }
  }
  if (rule.sequence !== undefined) {
    const kinds = rule.sequence.flatMap((entry) => {
      const kind = BLOCK_KINDS.find((k) => entry[k] !== undefined);
      return kind === undefined ? [] : [noun(kind, entry)];
    });
    lines.push(`In order: ${kinds.join(", ")}.`);
  }
  return lines;
}

function detailLines(rule: Rule): string[] {
  return [...contentLines(rule), ...(rule.description === undefined ? [] : [rule.description])];
}

/* -------------------------------------------------------------------------- *
 * pretty
 * -------------------------------------------------------------------------- */

function prettyRule(c: Colors, rule: Rule, level: number, indent: number, out: string[]): void {
  const pad = " ".repeat(indent);
  const hashes = "#".repeat(level);
  const occurs = c.dim(occurrenceWords(rule));
  if (rule.repeat !== undefined) {
    const group = rule.id === undefined ? "(group)" : `(group ${rule.id})`;
    out.push(`${pad}${hashes} ${group}  ${occurs}`);
  } else {
    const id = rule.id === undefined ? "" : `${c.cyan(rule.id)} · `;
    out.push(`${pad}${hashes} ${headingForm(rule.heading)}  ${id}${occurs}`);
  }
  for (const line of detailLines(rule)) out.push(`${pad}   ${line}`);
  for (const member of rule.repeat ?? []) prettyRule(c, member, level, indent + 2, out);
  for (const section of rule.sections ?? []) {
    prettyRule(c, section, level + 1, indent + 2, out);
  }
}

function renderPrettyShow(show: TemplateShow, c: Colors): string {
  const title = show.title ? `  ${c.dim("—")}  ${show.title}` : "";
  const lines = [`${c.bold(show.id)}${title}`];
  if (show.types !== undefined && show.types.length > 0) {
    lines.push(`  types: ${show.types.join(", ")}`);
  }
  if (show.description !== undefined) lines.push(`  ${show.description}`);
  for (const line of contentLines(show)) lines.push(`  ${line}`);
  if (show.guide !== undefined) lines.push(`  Guide: ${show.guide}`);
  const sections = show.sections ?? [];
  if (sections.length > 0) lines.push("");
  for (const section of sections) prettyRule(c, section, 2, 2, lines);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- *
 * markdown
 * -------------------------------------------------------------------------- */

/** The rules a skeleton writes: no catch-all at the end, nothing forbidden. */
function skeletonRules(rules: Rule[] | undefined): Rule[] {
  const kept = (rules ?? []).filter((rule) => occurrenceRange(rule).max !== 0);
  const last = kept[kept.length - 1];
  if (
    last !== undefined &&
    last.id === undefined &&
    last.heading === undefined &&
    last.repeat === undefined
  ) {
    kept.pop();
  }
  return kept;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** One HTML comment. `--` may not appear inside one, so dashes are spaced. */
function comment(parts: string[]): string {
  return `<!-- ${parts.join(" ").replace(/-(?=-)/g, "- ")} -->`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The heading a skeleton writes: the exact text, or the first of a list. */
function headingText(heading: HeadingRule | undefined): string | undefined {
  if (typeof heading === "string") return heading;
  return Array.isArray(heading) ? heading[0] : undefined;
}

function markdownRule(rule: Rule, level: number, out: string[]): void {
  if (rule.repeat !== undefined) {
    for (const member of skeletonRules(rule.repeat)) markdownRule(member, level, out);
  } else {
    if (rule.heading !== false) {
      const text = headingText(rule.heading) ?? `{${rule.id ?? "section"}}`;
      out.push(`${"#".repeat(level)} ${text}`, "");
    }
    out.push(
      comment([sentence(capitalise(occurrenceWords(rule))), ...detailLines(rule).map(sentence)]),
      "",
    );
  }
  for (const section of skeletonRules(rule.sections)) markdownRule(section, level + 1, out);
}

function renderMarkdownShow(show: TemplateShow): string {
  const lines: string[] = [];
  const type = show.types?.[0];
  if (type !== undefined) lines.push("---", `type: ${type}`, "---", "");
  lines.push(`# ${headingText(show.heading) ?? "{Title}"}`, "");
  const parts = [
    sentence(show.id),
    ...contentLines(show),
    ...(show.description === undefined ? [] : [sentence(show.description)]),
    ...(show.guide === undefined ? [] : [`Guide: ${show.guide}`]),
  ];
  lines.push(comment(parts), "");
  for (const section of skeletonRules(show.sections)) markdownRule(section, 2, lines);
  return lines.join("\n").trimEnd();
}

/** Render one shown template. */
export function renderTemplateShow(
  show: TemplateShow,
  format: ShowFormat,
  opts: ReportOptions = {},
): string {
  if (format === "json") return JSON.stringify(show, null, 2);
  if (format === "markdown") return renderMarkdownShow(show);
  return renderPrettyShow(show, palette(opts.color ?? false));
}
