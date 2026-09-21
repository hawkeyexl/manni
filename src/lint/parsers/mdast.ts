/**
 * mdast -> generic fragments. Shared by the Markdown and MDX parsers, which
 * differ only in which unified processor produced the tree.
 *
 * The mapping is onto the family content model (proposal 0060), never onto a
 * nearest neighbour: a blockquote is a `blockquote` and a table is a `table`,
 * because counting either as a paragraph would make `paragraphs: {max: 3}`
 * fail documents a reader would say satisfy it. A node type the model has no
 * kind for is still skipped with its subtree rather than approximated.
 *
 * MDX-only node types (`mdxJsxFlowElement`, and the expressions and comments
 * this file deliberately drops) appear only in trees the MDX processor
 * produced. The plain Markdown processor has no `remark-mdx`, so its trees
 * cannot carry them and `markdownParser` neither emits `element` nor declares
 * it. That is why one mapping serves both formats without a mode flag.
 */
import { toString as mdastToString } from "mdast-util-to-string";
import type { Position } from "../types.js";
import type {
  AdmonitionNode,
  ContentNode,
  ElementNode,
  ImageNode,
  ListItemNode,
  TableCellNode,
  TableRowNode,
} from "../types.js";
import type { Fragment } from "./sectionize.js";

/** An MDX JSX attribute, as `mdast-util-mdx-jsx` shapes it. */
interface MdAttribute {
  type: string;
  name?: string | null;
  /** A string for `a="b"`, null for a bare `a`, an expression node for `a={b}`. */
  value?: string | { type?: string; value?: string } | null;
}

/** Minimal structural view of an mdast node; avoids depending on @types/mdast shapes. */
interface MdNode {
  type: string;
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  children?: MdNode[];
  depth?: number;
  lang?: string | null;
  ordered?: boolean | null;
  value?: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
  /** MDX JSX only; null on a fragment (`<>`). */
  name?: string | null;
  attributes?: MdAttribute[];
}

const ZERO: Position = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

/**
 * unist positions carry `offset` as optional. It is always present on a tree
 * remark parsed from a string, but the type does not say so, and a missing
 * offset would otherwise become `NaN` in a reporter.
 */
export function positionOf(node: MdNode): Position {
  const p = node.position;
  if (!p) return { start: { ...ZERO.start }, end: { ...ZERO.end } };
  return {
    start: { line: p.start.line, column: p.start.column, offset: p.start.offset ?? 0 },
    end: { line: p.end.line, column: p.end.column, offset: p.end.offset ?? 0 },
  };
}

function isContentNode(node: ContentNode | null): node is ContentNode {
  return node !== null;
}

function childContent(node: MdNode): ContentNode[] {
  return (node.children ?? []).map(toContentNode).filter(isContentNode);
}

/**
 * `AdmonitionNode.variant` is optional, for the formats that name a flavor
 * this vocabulary does not carry. A GitHub alert always names one of five, so
 * every admonition this file produces has one, and saying so here is what
 * keeps a missing lookup from being mistaken for a format that named nothing.
 */
type AlertVariant = NonNullable<AdmonitionNode["variant"]>;

/**
 * The five alert types GitHub defines. `danger` is in the model's `variant`
 * set but is not one of them, so `> [!DANGER]` renders as an ordinary
 * blockquote and is read as one here: a word outside the source's own set is
 * not an equivalence to invent.
 */
const ALERT_VARIANTS = new Map<string, AlertVariant>([
  ["note", "note"],
  ["tip", "tip"],
  ["important", "important"],
  ["warning", "warning"],
  ["caution", "caution"],
]);

/** The marker line, which must be the whole first line of the first paragraph. */
const ALERT_MARKER = /^\[!([A-Za-z]+)\][^\S\n]*$/;

/**
 * The same marker where it sits at the head of a flattened string, with the
 * newline that followed it. `mdast-util-to-string` concatenates block children
 * without a separator, so the marker's paragraph may run straight into the
 * next one and there is no newline to consume.
 */
const ALERT_PREFIX = /^\[!\w+\][^\S\n]*\n?/;

/**
 * A GitHub alert, which is a blockquote whose first paragraph opens with a
 * marker line. It is a check on that paragraph's text rather than a plugin,
 * because the marker is ordinary text to every Markdown parser.
 */
function alertVariant(node: MdNode): AlertVariant | null {
  const first = node.children?.[0];
  if (!first || first.type !== "paragraph") return null;
  const text = mdastToString(first);
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const match = ALERT_MARKER.exec(firstLine);
  const word = match?.[1];
  // Case-insensitively, as GitHub matches it.
  return word ? (ALERT_VARIANTS.get(word.toLowerCase()) ?? null) : null;
}

function toAdmonition(node: MdNode, variant: AlertVariant): AdmonitionNode {
  const children = childContent(node);
  const first = children[0];
  // The marker is markup, not content, so it is stripped from the admonition's
  // own text and from the paragraph that carried it. A paragraph left holding
  // nothing but the marker is dropped rather than kept as an empty one.
  if (first && first.kind === "paragraph") {
    const stripped = first.text.replace(ALERT_PREFIX, "");
    if (stripped.length === 0) children.shift();
    else children[0] = { ...first, text: stripped };
  }
  return {
    kind: "admonition",
    position: positionOf(node),
    text: mdastToString(node).replace(ALERT_PREFIX, ""),
    variant,
    children,
  };
}

/**
 * The image a paragraph holds, when that is all it holds. An image inside
 * richer prose is part of what the paragraph says: promoting it would take the
 * sentence around it out of the paragraph count.
 */
function soleImage(node: MdNode): MdNode | null {
  const meaningful = (node.children ?? []).filter(
    (child) => !(child.type === "text" && (child.value ?? "").trim().length === 0),
  );
  const only = meaningful.length === 1 ? meaningful[0] : undefined;
  return only && only.type === "image" ? only : null;
}

function toImage(node: MdNode): ImageNode {
  const alt = node.alt ?? "";
  return {
    kind: "image",
    position: positionOf(node),
    text: alt,
    url: node.url ?? "",
    alt,
    ...(node.title ? { title: node.title } : {}),
  };
}

/**
 * An MDX element's attributes, by their literal values: the string for
 * `a="b"`, `true` for a bare `a`, and the braced source for `a={b}`, so a rule
 * can say "its value is an expression" rather than silently not matching a
 * value it cannot know. A spread (`{...rest}`) names no attribute and is
 * dropped, having no key to record it under.
 */
function attributesOf(node: MdNode): Record<string, string | true> | undefined {
  const attributes: Record<string, string | true> = {};
  let any = false;
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== "mdxJsxAttribute") continue;
    const name = attribute.name;
    if (typeof name !== "string" || name.length === 0) continue;
    const value = attribute.value;
    if (value === null || value === undefined) attributes[name] = true;
    else if (typeof value === "string") attributes[name] = value;
    else attributes[name] = `{${value.value ?? ""}}`;
    any = true;
  }
  return any ? attributes : undefined;
}

function toElement(node: MdNode): ElementNode {
  const attributes = attributesOf(node);
  return {
    kind: "element",
    position: positionOf(node),
    text: mdastToString(node),
    // A fragment (`<>`) has no tag to name.
    name: node.name ?? "",
    ...(attributes ? { attributes } : {}),
    // The element's own children, never the enclosing section's: a section
    // holding one `<Steps>` holds one block, not the four paragraphs inside
    // it (proposal 0060, stress test 4). A heading inside one is dropped with
    // everything else the model has no kind for, which stress test 5 records.
    children: childContent(node),
  };
}

function toTableRow(row: MdNode, header: boolean): TableRowNode {
  return {
    kind: "tableRow",
    position: positionOf(row),
    text: mdastToString(row),
    header,
    children: (row.children ?? [])
      .filter((cell) => cell.type === "tableCell")
      .map(
        (cell): TableCellNode => ({
          kind: "tableCell",
          position: positionOf(cell),
          text: mdastToString(cell),
          // A GFM cell holds inline content only, so this is empty today. It
          // is mapped rather than assumed empty because the model's cell is
          // the one reStructuredText and DITA fill with blocks.
          children: childContent(cell),
        }),
      ),
  };
}

function toContentNode(node: MdNode): ContentNode | null {
  switch (node.type) {
    case "paragraph": {
      const image = soleImage(node);
      if (image) return toImage(image);
      return {
        kind: "paragraph",
        position: positionOf(node),
        text: mdastToString(node),
      };
    }
    case "code":
      return {
        kind: "codeBlock",
        position: positionOf(node),
        text: node.value ?? "",
        ...(node.lang ? { language: node.lang } : {}),
      };
    case "list":
      return {
        kind: "list",
        position: positionOf(node),
        text: mdastToString(node),
        ordered: Boolean(node.ordered),
        items: (node.children ?? [])
          .filter((child) => child.type === "listItem")
          .map(
            (item): ListItemNode => ({
              kind: "listItem",
              position: positionOf(item),
              text: mdastToString(item),
              children: childContent(item),
            }),
          ),
      };
    case "table":
      return {
        kind: "table",
        position: positionOf(node),
        text: mdastToString(node),
        // GFM guarantees the first row is the header, which is the one format
        // of six where reading it positionally is safe. Everywhere else the
        // format carries a real `thead` and this flag comes from it.
        children: (node.children ?? [])
          .filter((row) => row.type === "tableRow")
          .map((row, index) => toTableRow(row, index === 0)),
      };
    case "blockquote": {
      const variant = alertVariant(node);
      if (variant) return toAdmonition(node, variant);
      return {
        kind: "blockquote",
        position: positionOf(node),
        text: mdastToString(node),
        children: childContent(node),
      };
    }
    case "mdxJsxFlowElement":
      return toElement(node);
    default:
      return null;
  }
}

/**
 * The `{#anchor}` suffix Hugo and Docusaurus write on a heading. It names the
 * rendered id, and a reader never sees it, so a template matches the heading
 * without it.
 */
const HEADING_ANCHOR = /\s*\{#[^}\s]*\}\s*$/;

function headingTitle(node: MdNode): string {
  return mdastToString(node).replace(HEADING_ANCHOR, "").trim();
}

/** Flatten an mdast root's direct children into ordered fragments. */
export function toFragments(root: MdNode): Fragment[] {
  const fragments: Fragment[] = [];
  for (const node of root.children ?? []) {
    // Frontmatter is metadata, not body content; the caller reads it separately.
    if (node.type === "yaml" || node.type === "toml") continue;

    if (node.type === "heading") {
      fragments.push({
        type: "heading",
        level: node.depth ?? 1,
        title: headingTitle(node),
        position: positionOf(node),
      });
      continue;
    }

    const content = toContentNode(node);
    if (content) fragments.push({ type: "content", node: content });
  }
  return fragments;
}

/** End of the document, for closing the final sections. */
export function documentEnd(root: MdNode): Position["end"] {
  return positionOf(root).end;
}
