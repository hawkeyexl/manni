/**
 * HTML parser: parse5's DOM -> generic blocks -> the shared `sectionize` fold.
 *
 * The job is the same one `mdast.ts` does for Markdown - flatten a format's own
 * tree into ordered `Fragment`s - and the same skipping discipline applies
 * where the content model has no kind at all. A `<div>` is not content and a
 * `<figure>` with no image inside it is dropped whole, because counting
 * either would make `paragraphs: {max: 3}` fail a page a reader would say
 * satisfies it. Proposal 0065 widened the model, so `blockquote`, `table`,
 * `figure`, and `dl` are no longer in that group: they map onto real nodes
 * now, alongside `admonition` from `<aside>`/`role="note"` and `image` from
 * `<img>`.
 *
 * `parse` rather than `parseFragment`. Real documentation HTML is a document:
 * `<!DOCTYPE html><html><head>…</head><body>…`, and an HTML page's metadata
 * lives in `<head>`, which `parseFragment` (which parses in a `<body>` context)
 * drops on the floor - `<head>` is an ignored start tag in the "in body"
 * insertion mode. `parse` also handles a bare fragment, because HTML5 tree
 * construction synthesizes the missing `<html>`/`<head>`/`<body>` around it; the
 * only cost is that those synthesized elements carry no `sourceCodeLocation`,
 * which `positionOf` already has to tolerate.
 *
 * parse5 never throws on malformed input - HTML5 defines recovery for every
 * error - so unlike the MDX path there is no parse-failure branch here. A
 * document with unclosed tags parses into whatever a browser would build from
 * it, and lints against that.
 */
import { defaultTreeAdapter, parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { extractFrontmatter, extractorForExtension } from "../../meta/index.js";
import type {
  AdmonitionNode,
  BlockquoteNode,
  CodeNode,
  ContentNode,
  DefinitionItemNode,
  DefinitionListNode,
  DocumentParser,
  DocumentTree,
  ImageNode,
  ListItemNode,
  Position,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "../types.js";
import type { Fragment } from "./sectionize.js";
import { sectionize } from "./sectionize.js";
import { fencedPosition, withMetadataTitle } from "./metadata.js";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/**
 * What a walk does when it meets an element.
 *
 *  - `heading`/`content`: the element *is* a block. It is emitted and never
 *    descended into, because its whole subtree has already been folded into the
 *    emitted node's text (or, for a container kind, its own `children`).
 *    Descending would emit the same prose twice.
 *  - `container`: the element is not content but its children may be. Descend
 *    without emitting. This is the case that matters: real HTML wraps
 *    everything in `<html><body><main><article><div>`, and a heading inside a
 *    `<div>` is still a heading.
 *  - `opaque`: neither content nor a container. Skip the subtree entirely.
 *
 * `container` is the default, so an unknown element - a web component, a
 * `<my-callout>` - still yields the headings and paragraphs inside it. `opaque`
 * is a short, explicit list, and every entry earns its place the same way: it
 * is metadata/machinery rather than prose, so the generic content model has no
 * kind for it at all.
 */
type Role = "heading" | "content" | "container" | "opaque";

const HEADING_LEVELS = new Map<string, number>([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
  ["h5", 5],
  ["h6", 6],
]);

/**
 * Elements that are a block on their own: emitted as one content node, never
 * descended into. `table`, `blockquote`, `dl`, `img` and `figure` used to sit
 * in `OPAQUE_TAGS` and be dropped whole; proposal 0065 gave each a node shape,
 * so they move here instead. `aside` joins them because it is one of the two
 * HTML sources of `admonition` - the other, `role="note"`, is not a tag and is
 * checked separately in `roleOf`.
 */
const CONTENT_TAGS = new Set(["p", "pre", "ul", "ol", "table", "blockquote", "dl", "img", "figure", "aside"]);

const OPAQUE_TAGS = new Set([
  // Metadata and machinery, not prose.
  "head",
  "script",
  "style",
  "template",
  "noscript",
  "svg",
  "math",
]);

/** Elements whose text is not document text, for the flattening helpers. */
const NON_TEXT_TAGS = new Set(["script", "style", "template"]);

const ADMONITION_VARIANTS = new Set([
  "note",
  "tip",
  "important",
  "caution",
  "warning",
  "danger",
]);

const ZERO: Position = {
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 },
};

function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

/** An element's attribute value, or `undefined` when it does not carry one. */
function attrOf(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/**
 * `admonition`'s two HTML sources: the `<aside>` tag, and `role="note"` on any
 * element. Neither one is enough on its own - `aside` is a tag and `role` is
 * an attribute any element can carry - so this is checked ahead of the
 * tag-keyed `CONTENT_TAGS`/`OPAQUE_TAGS` lookup rather than folded into it.
 */
function isAdmonitionSource(el: Element, tag: string): boolean {
  return tag === "aside" || attrOf(el, "role") === "note";
}

function roleOf(el: Element, tag: string): Role {
  if (HEADING_LEVELS.has(tag)) return "heading";
  if (isAdmonitionSource(el, tag)) return "content";
  if (CONTENT_TAGS.has(tag)) return "content";
  if (OPAQUE_TAGS.has(tag)) return "opaque";
  return "container";
}

/**
 * parse5's `sourceCodeLocation` maps onto `Position` one field at a time: its
 * lines and columns are 1-based, its offsets 0-based, and its `end*` is one
 * past the last character - the same half-open span `Position` documents. A
 * `<p>foo</p>` starting at column 1 reports `endCol` 12 for an 11-character
 * element, and `endOffset - startOffset` is its length.
 *
 * A node can carry no location at all: parse5 synthesizes `<html>`, `<head>`,
 * and `<body>` around a fragment, and those have none. Nothing synthesized is
 * ever emitted as a block, but the fallback keeps a missing location from
 * becoming `NaN` in a reporter.
 */
interface Located {
  sourceCodeLocation?: {
    startLine: number;
    startCol: number;
    startOffset: number;
    endLine: number;
    endCol: number;
    endOffset: number;
  } | null;
}

function positionOf(node: Located): Position {
  const loc = node.sourceCodeLocation;
  if (!loc) return { start: { ...ZERO.start }, end: { ...ZERO.end } };
  return {
    start: { line: loc.startLine, column: loc.startCol, offset: loc.startOffset },
    end: { line: loc.endLine, column: loc.endCol, offset: loc.endOffset },
  };
}

/** Concatenated text of a subtree, markup and all, verbatim. */
function rawText(node: Node): string {
  if (defaultTreeAdapter.isTextNode(node)) return node.value;
  if (!defaultTreeAdapter.isElementNode(node)) return "";
  if (NON_TEXT_TAGS.has(tagOf(node))) return "";
  let out = "";
  for (const child of node.childNodes) out += rawText(child);
  return out;
}

/**
 * Text as a browser renders it: nested `<code>`, `<em>`, and `<a>` contribute
 * their text, and HTML's insignificant whitespace collapses, so a heading
 * written across three indented lines still equals `"Overview"` - which is what
 * a template's `heading: {const: Overview}` compares against.
 *
 * This is the HTML side of the bug the Markdown parser had before the rewrite,
 * where a title was built from `children.map(c => c.value)` and every inline
 * element vanished.
 */
function flatText(node: Node): string {
  return rawText(node).replace(/\s+/g, " ").trim();
}

/** `language-x` from a `class`, per the HTML5 convention for code blocks. */
function langOf(el: Element): string | undefined {
  const className = attrOf(el, "class");
  if (!className) return undefined;
  for (const token of className.split(/\s+/)) {
    if (token.startsWith("language-") && token.length > "language-".length) {
      return token.slice("language-".length);
    }
  }
  return undefined;
}

/** `variant`, from `role="note"` or a class naming one of the six - never invented. */
function variantOf(el: Element): AdmonitionNode["variant"] | undefined {
  const className = attrOf(el, "class");
  if (className) {
    for (const token of className.split(/\s+/)) {
      if (ADMONITION_VARIANTS.has(token)) return token as AdmonitionNode["variant"];
    }
  }
  if (attrOf(el, "role") === "note") return "note";
  return undefined;
}

function firstElementChild(el: Element, tag: string): Element | undefined {
  for (const child of el.childNodes) {
    if (defaultTreeAdapter.isElementNode(child) && tagOf(child) === tag) return child;
  }
  return undefined;
}

/** An element's direct element children, text and comment nodes excluded. */
function elementChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (const child of el.childNodes) {
    if (defaultTreeAdapter.isElementNode(child)) out.push(child);
  }
  return out;
}

/** The first `<img>` anywhere under `el`, depth-first - for a `<figure>`. */
function findImage(el: Element): Element | undefined {
  for (const child of el.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    if (tagOf(child) === "img") return child;
    const nested = findImage(child);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * `<pre>` (usually `<pre><code>`) as a code node.
 *
 * Whitespace is significant here, so this is the one place `rawText` is used
 * unnormalized. Two trims are deliberate: a newline directly after `<code>` is
 * an artifact of writing the block over several lines (the HTML parser already
 * drops one directly after `<pre>`, but not one after a nested `<code>`), and
 * dropping trailing whitespace matches mdast's `code.value`, which carries no
 * closing newline.
 */
function codeNode(pre: Element): CodeNode {
  const inner = firstElementChild(pre, "code");
  const lang = langOf(pre) ?? (inner ? langOf(inner) : undefined);
  const text = rawText(pre).replace(/^\r?\n/, "").replace(/\s+$/, "");
  return {
    kind: "codeBlock",
    position: positionOf(pre),
    text,
    ...(lang ? { language: lang } : {}),
  };
}

/**
 * `<img>` as an image node. A bare `<img>` carries no caption of its own; a
 * `<figure>` wrapping one supplies both the position (the whole figure, since
 * that construct - image and caption together - is what the one node stands
 * for) and, when present, its `<figcaption>` as `text`.
 */
function imageNode(img: Element, position: Position, caption: string | null): ImageNode {
  const title = attrOf(img, "title");
  return {
    kind: "image",
    position,
    text: caption ?? "",
    url: attrOf(img, "src") ?? "",
    alt: attrOf(img, "alt") ?? "",
    ...(title ? { title } : {}),
  };
}

/**
 * `<figure>` as a single image node. A figure with no `<img>` anywhere inside
 * it maps to nothing - the same as before 0065, when the whole subtree was
 * opaque - because the content model has no other kind to give it.
 */
function figureNode(figure: Element): ImageNode | null {
  const img = findImage(figure);
  if (!img) return null;
  const caption = firstElementChild(figure, "figcaption");
  return imageNode(img, positionOf(figure), caption ? flatText(caption) : null);
}

/** `<blockquote>` as a blockquote node, its own content mapped recursively. */
function blockquoteNode(el: Element): BlockquoteNode {
  return {
    kind: "blockquote",
    position: positionOf(el),
    text: flatText(el),
    children: childContent(el),
  };
}

/**
 * `<aside>` or `role="note"` as an admonition node. HTML names no admonition
 * type natively, so `variantOf` only ever returns one of the six when the
 * source itself said which - see its own comment. A bare `<aside>` that names
 * neither carries no `variant` at all, per `AdmonitionNode.variant`'s own
 * comment in `src/lint/types.ts`: defaulting it to `note` would make
 * `variant: note` pass on a page that never said note.
 */
function admonitionNode(el: Element): AdmonitionNode {
  const variant = variantOf(el);
  return {
    kind: "admonition",
    position: positionOf(el),
    text: flatText(el),
    ...(variant ? { variant } : {}),
    children: childContent(el),
  };
}

/** One `<td>`/`<th>` as a table cell, its own content mapped recursively. */
function cellNode(cell: Element): TableCellNode {
  return {
    kind: "tableCell",
    position: positionOf(cell),
    text: flatText(cell),
    children: childContent(cell),
  };
}

/**
 * Which grouping a row was found in. `none` is a bare `<tr>` under the table.
 *
 * A footer has to be told apart from a body, rather than both being "not the
 * head". `<tfoot><tr><th>Total</th></tr></tfoot>` is an ordinary way to label
 * a totals row, and the every-cell-is-a-`<th>` rule below would otherwise read
 * it as a header.
 */
type RowGroup = "head" | "body" | "foot" | "none";

/** One `<tr>`. `header` is set from `<thead>` membership, or - failing that - from every cell being a `<th>`. Never inferred from position, and never in a footer. */
function rowNode(tr: Element, group: RowGroup): TableRowNode {
  const cells: TableCellNode[] = [];
  let allHeaderCells = true;
  for (const child of elementChildren(tr)) {
    const tag = tagOf(child);
    if (tag !== "td" && tag !== "th") continue;
    if (tag !== "th") allHeaderCells = false;
    cells.push(cellNode(child));
  }
  return {
    kind: "tableRow",
    position: positionOf(tr),
    text: flatText(tr),
    header:
      group === "head" || (group !== "foot" && cells.length > 0 && allHeaderCells),
    children: cells,
  };
}

/** Rows from `<thead>`/`<tbody>`/`<tfoot>` or bare `<tr>` children, in document order. */
function collectRows(parent: Element, out: TableRowNode[], group: RowGroup): void {
  for (const child of elementChildren(parent)) {
    const tag = tagOf(child);
    if (tag === "thead") {
      collectRows(child, out, "head");
    } else if (tag === "tbody") {
      collectRows(child, out, "body");
    } else if (tag === "tfoot") {
      collectRows(child, out, "foot");
    } else if (tag === "tr") {
      out.push(rowNode(child, group));
    }
    // `<caption>`/`<colgroup>` carry no rows and are not content of their own.
  }
}

/** `<table>` as a table node. */
function tableNode(table: Element): TableNode {
  const rows: TableRowNode[] = [];
  collectRows(table, rows, "none");
  return {
    kind: "table",
    position: positionOf(table),
    text: flatText(table),
    children: rows,
  };
}

/**
 * `<dl>` as a definition list. Each `<dt>` pairs with the `<dd>` elements that
 * immediately follow it - up to the next `<dt>` or the end of the list - and
 * the `<dt>`'s own text becomes the item's `term`. An item's position spans
 * from its `<dt>` through its last `<dd>`, or the `<dt>` alone when it has
 * none.
 */
function definitionListNode(dl: Element): DefinitionListNode {
  const children = elementChildren(dl);
  const items: DefinitionItemNode[] = [];

  for (let i = 0; i < children.length; i++) {
    const dt = children[i];
    if (!dt || tagOf(dt) !== "dt") continue;

    const dds: Element[] = [];
    let j = i + 1;
    while (j < children.length) {
      const next = children[j];
      if (!next || tagOf(next) !== "dd") break;
      dds.push(next);
      j++;
    }

    const term = flatText(dt);
    const definition = dds.flatMap((dd) => childContent(dd));
    const lastDd = dds.at(-1);
    const end = lastDd ? positionOf(lastDd).end : positionOf(dt).end;
    const text = [term, ...dds.map((dd) => flatText(dd))].filter((t) => t.length > 0).join(" ");

    items.push({
      kind: "definitionItem",
      position: { start: positionOf(dt).start, end },
      text,
      term,
      definition,
    });
  }

  return {
    kind: "definitionList",
    position: positionOf(dl),
    text: flatText(dl),
    children: items,
  };
}

/**
 * `<li>` children of a list, with their own content mapped recursively.
 */
function listItems(list: Element): ListItemNode[] {
  const items: ListItemNode[] = [];
  for (const child of list.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    if (tagOf(child) !== "li") continue;
    items.push({
      kind: "listItem",
      position: positionOf(child),
      text: flatText(child),
      children: childContent(child),
    });
  }
  return items;
}

/**
 * One container element's content, with its own loose prose kept as a
 * paragraph. Shared by every construct that holds generic content recursively
 * - `<li>`, `<blockquote>`, `<aside>`/`role="note"`, `<td>`/`<th>`, `<dd>` -
 * so the same reconciliation applies everywhere rather than once per kind.
 *
 * An item's text is rarely wrapped in a block element, but mdast puts a list
 * item's principal text in a `paragraph` child regardless, and
 * `lists: {items: {paragraphs: {min: 1}}}` has to count the same thing in
 * every format. So the loose text is gathered into one, in the position it
 * occupies among the container's blocks.
 *
 * Gathering it rather than checking whether the container has any children is
 * what makes the two cases agree. `<li>text</li>` and `<li><p>text</p></li>`
 * were already reconciled; `<li>Parent<ul>…</ul></li>` was not, because the
 * nested list is a child, so the item looked accounted for and `Parent` became
 * a paragraph nothing counted - while its Markdown, AsciiDoc, and reST twins
 * all counted one.
 *
 * A container element that yields no blocks of its own is inline in practice -
 * `<strong>`, `<a>`, `<code>` - so its text joins the prose around it instead
 * of being dropped, which is again what mdast does with the same markup.
 */
function childContent(parent: Element): ContentNode[] {
  const out: ContentNode[] = [];
  let text = "";
  let span: Position | null = null;

  const extend = (node: Located): void => {
    const at = positionOf(node);
    span = span === null ? at : { start: span.start, end: at.end };
  };

  const flush = (): void => {
    const value = text.trim();
    const at = span;
    text = "";
    span = null;
    if (value.length === 0) return;
    out.push({ kind: "paragraph", position: at ?? positionOf(parent), text: value });
  };

  for (const child of parent.childNodes) {
    if (defaultTreeAdapter.isTextNode(child)) {
      text += child.value;
      if (child.value.trim().length > 0) extend(child);
      continue;
    }
    if (!defaultTreeAdapter.isElementNode(child)) continue;

    const tag = tagOf(child);
    const role = roleOf(child, tag);
    if (role === "heading" || role === "opaque") continue;

    if (role === "content") {
      flush();
      const node = toContentNode(child, tag);
      if (node) out.push(node);
      continue;
    }

    const nested = contentIn(child);
    if (nested.length > 0) {
      flush();
      out.push(...nested);
      continue;
    }

    const inline = flatText(child);
    text += inline;
    if (inline.trim().length > 0) extend(child);
  }

  flush();
  return out;
}

function toContentNode(el: Element, tag: string): ContentNode | null {
  if (isAdmonitionSource(el, tag)) return admonitionNode(el);
  switch (tag) {
    case "p":
      return { kind: "paragraph", position: positionOf(el), text: flatText(el) };
    case "pre":
      return codeNode(el);
    case "ul":
    case "ol":
      return {
        kind: "list",
        position: positionOf(el),
        text: flatText(el),
        ordered: tag === "ol",
        items: listItems(el),
      };
    case "table":
      return tableNode(el);
    case "blockquote":
      return blockquoteNode(el);
    case "dl":
      return definitionListNode(el);
    case "img":
      return imageNode(el, positionOf(el), null);
    case "figure":
      return figureNode(el);
    default:
      return null;
  }
}

/**
 * Content nodes inside a container that is not itself a block - a wrapper
 * within one, reached from `childContent`. Same descend/skip rule as the
 * document walk, minus headings: a heading inside a list item does not open a
 * section, and mdast drops it the same way.
 */
function contentIn(parent: ParentNode): ContentNode[] {
  const out: ContentNode[] = [];
  for (const child of parent.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    const tag = tagOf(child);
    const role = roleOf(child, tag);
    if (role === "heading" || role === "opaque") continue;
    if (role === "content") {
      const node = toContentNode(child, tag);
      if (node) out.push(node);
      continue;
    }
    out.push(...contentIn(child));
  }
  return out;
}

/**
 * Walk the document into ordered blocks.
 *
 * Structure comes from heading *levels* only. Explicit `<section>` nesting is
 * deliberately ignored, and `<section>` is just another container:
 *
 *  - `sectionize` already derives nesting from heading level for every format.
 *    Honoring `<section>` would mean a second nesting mechanism living in this
 *    file, plus a rule for reconciling the two whenever a page's element
 *    nesting and its heading levels disagree - which they routinely do, because
 *    `<section>` is optional and is as often a layout wrapper
 *    (`<section class="hero">`) as a semantic one.
 *  - The cross-format promise is that one template produces the same findings
 *    on a page and its Markdown, AsciiDoc, or reST twin. Those formats have
 *    nothing but heading level, so deriving HTML's structure from anything else
 *    would let identical headings nest differently per format.
 *  - Where `<section>` nesting agrees with the headings - which is the whole
 *    point of writing it - honoring it changes nothing. It could only ever
 *    matter when it disagrees, and there the headings are what the reader sees.
 */
function walk(parent: ParentNode, out: Fragment[]): void {
  for (const child of parent.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    const tag = tagOf(child);
    const role = roleOf(child, tag);

    if (role === "heading") {
      out.push({
        type: "heading",
        level: HEADING_LEVELS.get(tag) ?? 1,
        title: flatText(child),
        position: positionOf(child),
      });
      continue;
    }

    if (role === "content") {
      const node = toContentNode(child, tag);
      if (node) out.push({ type: "content", node });
      continue;
    }

    if (role === "opaque") continue;

    walk(child, out);
  }
}

/** End of the document, for closing the final sections. */
function documentEnd(content: string): Position["end"] {
  const lines = content.split("\n");
  const last = lines[lines.length - 1] ?? "";
  return { line: lines.length, column: last.length + 1, offset: content.length };
}

/**
 * An HTML page's metadata, from both places it can be.
 *
 * `extractFrontmatter(content, "html")` - the call the Markdown parser makes -
 * turns out to read *only* a fenced `---`/`+++`/`;;;` block; the `format`
 * argument is a label on the result, not a dispatch key. On an ordinary HTML
 * page it returns `{present: false, data: {}}`, which would leave
 * `type: how-to` in a `<meta>` tag invisible and every `.html` file unrouted.
 *
 * The `<meta>` reading lives in docmeta's *extractor* registry instead, reached
 * by extension. So both are asked, and the results merged. That keeps docmeta
 * the single source of truth for metadata - including its `<title>` lift and
 * its YAML-scalar coercion of attribute values, so `content="[a, b]"` is a list
 * here exactly as it would be in frontmatter - rather than growing a second
 * `<meta>` convention in this repository.
 *
 * A fenced block wins on a key collision: it is authored at the top of the
 * source file, and it is what every sibling format reads. The two coexist
 * rarely enough that the tie-break is a formality.
 *
 * The cost is that docmeta parses the document a second time. Re-reading
 * `<meta>` off the tree already in hand would avoid it and duplicate the
 * convention; the ADR's "docmeta is the single source of truth for frontmatter"
 * is worth one extra parse of a file we are already reading from disk.
 */
function metadataOf(
  content: string,
  filePath: string,
  doc: DefaultTreeAdapterTypes.Document,
): { frontmatter: Record<string, unknown> | null; position: Position | null } {
  const fenced = extractFrontmatter(content, "html");
  const extractor = extractorForExtension(".html");
  const headMeta = extractor
    ? extractor.extract(content, filePath)
    : { present: false, data: {} as Record<string, unknown> };

  if (!fenced.present && !headMeta.present) return { frontmatter: null, position: null };

  const frontmatter = { ...headMeta.data, ...fenced.data };

  // Anchor on whichever block the values actually came from. `<head>` is an
  // HTML document's frontmatter: it is where `<title>` and every `<meta>` sit,
  // and a finding about the page's metadata belongs there.
  if (fenced.present) return { frontmatter, position: fencedPosition(content) };

  // A `<head>` parse5 synthesized carries no source location. That happens
  // whenever anything precedes `<html>` - a BOM is the common case - and it
  // used to yield a null position, which silently switched off the synthetic
  // frontmatter title: `withMetadataTitle` bails when the position is null, so
  // the document lost its top-level section and every doctype template
  // misaligned against it. The metadata is real either way, so fall back to the
  // top of the file rather than disowning it.
  const head = findHead(doc);
  return {
    frontmatter,
    position: head?.sourceCodeLocation ? positionOf(head) : origin(),
  };
}

/** Zero-width span at the top of the file, for metadata with no located block. */
function origin(): Position {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  };
}

/** The document's `<head>`, when the source actually wrote one. */
function findHead(doc: DefaultTreeAdapterTypes.Document): Element | undefined {
  for (const child of doc.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    if (tagOf(child) === "html") return firstElementChild(child, "head");
  }
  return undefined;
}

function parseHtml(content: string, filePath: string): DocumentTree {
  const doc = parse(content, { sourceCodeLocationInfo: true });
  const fragments: Fragment[] = [];
  walk(doc, fragments);

  const { frontmatter, position } = metadataOf(content, filePath, doc);

  return {
    format: "html",
    filePath,
    frontmatter,
    frontmatterPosition: position,
    sections: sectionize(
      withMetadataTitle(fragments, frontmatter, position),
      documentEnd(content),
    ),
  };
}

export const htmlParser: DocumentParser = {
  name: "html",
  label: "HTML",
  kinds: [
    "paragraph",
    "codeBlock",
    "list",
    "listItem",
    "table",
    "tableRow",
    "tableCell",
    "admonition",
    "image",
    "blockquote",
    "definitionList",
    "definitionItem",
  ],
  extensions: [".html", ".htm"],
  parse: parseHtml,
};
