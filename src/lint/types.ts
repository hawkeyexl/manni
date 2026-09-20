/**
 * The contract every other module is written against.
 *
 * Two shapes matter. `DocumentTree` is what a parser owes the rest of the tool:
 * a nested section tree with real source positions, in a vocabulary that has
 * nothing to do with Markdown. `Finding` is what the tool owes its caller.
 * Everything between the two - matching, rules, reporting - touches neither
 * mdast nor Asciidoctor nor parse5, which is what lets a new input format be
 * one file plus a line in the parser registry.
 */

import { ToolError } from "../shared/errors.js";
import type { Severity } from "../shared/severity.js";

/**
 * Operational/usage failure. Exits 2; never used for lint findings.
 *
 * Extends the umbrella's `ToolError`, which is what the shared bin runner
 * matches on; the subclass stays so this tool's tests and library callers can
 * match on it by name. Named for its domain, as `A11yError`, `CiteError` and
 * `KeyError` are.
 */
export class LintError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "LintError";
  }
}

/** A point in a source file. Line and column are 1-based, offset 0-based. */
export interface Point {
  line: number;
  column: number;
  offset: number;
}

/** A half-open source span, `start` inclusive and `end` exclusive. */
export interface Position {
  start: Point;
  end: Point;
}

/**
 * Content kinds a section can hold, named generically so a rule written once
 * works on every format. Each parser maps its own AST onto these: mdast
 * `paragraph`/`code`/`list`, Asciidoctor `paragraph`/`listing`/`ulist`|`olist`,
 * HTML `<p>`/`<pre>`/`<ul>` - all three onto `paragraph`/`codeBlock`/`list`.
 *
 * The vocabulary is wider than any one parser emits today. `table`,
 * `admonition`, `image`, `blockquote`, `definitionList`, and `element` are
 * declared here, and in each `DocumentParser.kinds`, only once a parser
 * actually produces them - see `src/lint/parsers/index.ts`.
 */
export type ContentKind =
  | "paragraph"
  | "codeBlock"
  | "list"
  | "listItem"
  | "table"
  | "tableRow"
  | "tableCell"
  | "admonition"
  | "image"
  | "blockquote"
  | "definitionList"
  | "definitionItem"
  | "element";

export interface ContentNodeBase {
  kind: ContentKind;
  position: Position;
  /** Plain-text rendering, used by pattern rules. */
  text: string;
}

export interface ParagraphNode extends ContentNodeBase {
  kind: "paragraph";
}

export interface CodeNode extends ContentNodeBase {
  kind: "codeBlock";
  /** Language, when the format carries one. */
  language?: string;
  /** The info-string tail after the language, when the format carries one. */
  fenceInfo?: string;
}

export interface ListItemNode {
  kind: "listItem";
  position: Position;
  text: string;
  /** Nested content, so item-level paragraph/code/list rules can run. */
  children: ContentNode[];
}

export interface ListNode extends ContentNodeBase {
  kind: "list";
  ordered: boolean;
  items: ListItemNode[];
}

export interface TableCellNode extends ContentNodeBase {
  kind: "tableCell";
  children: ContentNode[];
}

export interface TableRowNode extends ContentNodeBase {
  kind: "tableRow";
  header: boolean;
  children: TableCellNode[];
}

export interface TableNode extends ContentNodeBase {
  kind: "table";
  children: TableRowNode[];
}

/**
 * A callout, and the flavor the source gave it.
 *
 * `variant` is optional because not every format names one this vocabulary
 * has. reStructuredText has `hint`, `attention`, `error` and a generic
 * `admonition` directive, and a bare HTML `<aside>` says nothing at all. Those
 * produce an admonition with no variant rather than an invented equivalence:
 * mapping `hint` onto `tip` would make `variant: tip` pass on a page that
 * never said tip. A `variant:` rule reports such a node as a mismatch, and a
 * plain count rule still counts it.
 */
export interface AdmonitionNode extends ContentNodeBase {
  kind: "admonition";
  variant?: "note" | "tip" | "important" | "caution" | "warning" | "danger";
  children: ContentNode[];
}

export interface ImageNode extends ContentNodeBase {
  kind: "image";
  url: string;
  alt: string;
  title?: string;
}

export interface BlockquoteNode extends ContentNodeBase {
  kind: "blockquote";
  children: ContentNode[];
}

export interface DefinitionItemNode {
  kind: "definitionItem";
  position: Position;
  text: string;
  term: string;
  definition: ContentNode[];
}

export interface DefinitionListNode extends ContentNodeBase {
  kind: "definitionList";
  children: DefinitionItemNode[];
}

/**
 * A named wrapper - an MDX/JSX component today, and where HTML and DITA may
 * eventually anchor a custom element. Its children are its own content, never
 * the enclosing section's: a rule reading a section's `children` must not see
 * inside an `<Element>` it did not ask about.
 */
export interface ElementNode extends ContentNodeBase {
  kind: "element";
  name: string;
  attributes?: Record<string, string | true>;
  children: ContentNode[];
}

export type ContentNode =
  | ParagraphNode
  | CodeNode
  | ListNode
  | TableNode
  | AdmonitionNode
  | ImageNode
  | BlockquoteNode
  | DefinitionListNode
  | ElementNode;

/**
 * One section of a document, demarcated by a heading.
 *
 * `slug`/`title`/`level`/`order`/`parentSlug` intentionally match manni kg's
 * `Section` (dockg/src/types.ts), so its graph can be built from this tree.
 *
 * `children` is in document order and is the single source of truth: the
 * paragraph/codeBlock/list counts every rule needs are queries over it, not
 * separately maintained arrays.
 */
export interface SectionNode {
  /** Slug of the heading, disambiguated across the document (`install-1`). */
  slug: string;
  /** Heading text, with inline markup flattened. */
  title: string;
  /** Heading level, 1-6. 0 for the implicit lead section before any heading. */
  level: number;
  /** 1-based position among siblings under the same parent. */
  order: number;
  /** Slug of the enclosing section, or null at the top level. */
  parentSlug: string | null;
  /** Span of the title itself. Null for the implicit lead section. */
  titlePosition: Position | null;
  /** Span of the whole section: its heading through the last node before the next sibling heading. */
  position: Position;
  /** Direct content, in document order, excluding anything owned by a subsection. */
  children: ContentNode[];
  /** Nested sections, in document order. */
  sections: SectionNode[];
}

/** What a parser returns for one file. */
export interface DocumentTree {
  /** Name of the parser that produced this (`markdown`, `asciidoc`, ...). */
  format: string;
  /** Path the content came from, for error messages. */
  filePath: string;
  /** Raw frontmatter/metadata values, or null when the file carries none. */
  frontmatter: Record<string, unknown> | null;
  /** Span of the frontmatter block, for anchoring findings about it. */
  frontmatterPosition: Position | null;
  /** Top-level sections, in document order. */
  sections: SectionNode[];
}

/**
 * A parser for one input format.
 *
 * Shaped after docmeta's `MetadataExtractor` so the two registries read the
 * same way. A format is registered only when its parser reads it, so every
 * registered format is one the tool reads, and an extension no parser claims is
 * skipped by name rather than parsed as Markdown.
 */
export interface DocumentParser {
  /** Stable name, also used as `DocumentTree.format`. */
  name: string;
  /** Human-readable label for `manni lint tools`. */
  label: string;
  /**
   * The content kinds this parser actually emits today. A capability
   * declaration, not the full `ContentKind` vocabulary: a kind absent here is
   * one no rule will ever see from this parser's trees, whatever the format
   * could in principle represent.
   */
  kinds: ContentKind[];
  /** Lowercase file extensions this parser handles, incl. dot (e.g. ".md"). */
  extensions: string[];
  /**
   * Extensions safe to collect from a directory walk. Defaults to
   * `extensions`.
   *
   * The two differ when an extension is a generic container rather than a
   * documentation format. `.xml` is the case: this parser can read a DocBook
   * or DITA document named explicitly, but a docs tree also contains
   * `pom.xml`, `sitemap.xml`, and `.csproj`, and sweeping those in turns a
   * clean run into a failure about files the user never asked to lint.
   */
  walkExtensions?: string[];
  /** Parse raw file content into the generic tree. */
  parse(content: string, filePath: string): DocumentTree;
}

/**
 * How much a finding weighs, on the one scale every manni tool speaks
 * (`src/shared/severity.ts`): `notice | warning | error`.
 *
 * Every structural finding is an `error`: a template either describes a
 * document or it does not. The scale is the family's and not this tool's
 * private pair, because a flag or config key two domains both have carries the
 * same name *and* the same values. Re-exported so `lint.Severity` names the
 * same type a caller already has.
 */
export type { Severity };

/**
 * One structural violation.
 *
 * The field set is pinned by manni docevals' tool adapter, which reads
 * `{ type, heading, message, position }` off the JSON reporter. Additions are
 * safe; renames are not.
 */
export interface Finding {
  /** Machine-readable rule id, e.g. `missing_section`. */
  type: string;
  /** Heading of the section the finding is anchored to, if any. */
  heading: string | null;
  message: string;
  position: Position;
  severity: Severity;
}

/**
 * Why a file was not linted.
 *
 * `unreadable` is the one that is not about the document: the file was found,
 * claimed by a parser, and then could not be opened - a denied permission, a
 * symlink loop, a page a doc build moved between the walk and the read. It is a
 * skip rather than a finding because nothing was checked, and calling it a
 * finding would report the docs as wrong when the filesystem was.
 */
export type SkipReason = "no-template" | "unsupported-format" | "unreadable";

/** Result of linting one file. */
export interface FileResult {
  file: string;
  /** True when the file was linted and produced no findings. */
  success: boolean;
  findings: Finding[];
  /** Template id/ref applied, or null when skipped. */
  template: string | null;
  /** Set when the file was skipped rather than linted. */
  skipped?: SkipReason;
}
