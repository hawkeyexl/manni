/**
 * XHTML through parse5: detection, and a tree that nests the way an XML
 * parser reads the file (proposal 0125, decisions 1 and 2).
 *
 * Every HTML reader in the family walks parse5's tree. HTML5 parsing ignores
 * the slash in a self-closed non-void element, so on an XHTML page
 * `<MadCap:variable name="x" />` swallows the rest of its paragraph, and a
 * self-closed `<title />` or `<script />` swallows the rest of the file as
 * text. `parseXhtml` undoes both, and leaves every source location indexing
 * into the text it was given, so a splice offset read from it still holds.
 */
import { defaultTreeAdapter, html, parse } from "parse5";
import type { DefaultTreeAdapterTypes, Token } from "parse5";

type Document = DefaultTreeAdapterTypes.Document;
type Node = DefaultTreeAdapterTypes.Node;
type Location = Token.Location;

/** The XML declaration, after any byte-order mark and whitespace. */
const XML_DECL = /^﻿?\s*<\?xml[\s?]/;

/** An `<html` start tag carrying `xmlns=` or `xmlns:prefix=`. */
const HTML_XMLNS = /<html(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*?\sxmlns(?::[\w.-]+)?\s*=/i;

const FLARE_NS = /http:\/\/www\.madcapsoftware\.com\/schemas\/madcap\.xsd/i;

/**
 * Raw-text and RCDATA elements: parse5 reads everything after their start
 * tag as text until a matching end tag, so a self-closed one swallows the
 * rest of the file. A comment or CDATA section is matched first so a tag
 * inside one is skipped, not rewritten.
 */
const SELF_CLOSED_RAW =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(title|textarea|script|style|xmp|iframe|noembed|noframes|noscript)(?=[\s/])(?:"[^"]*"|'[^']*'|[^'">])*?\/>/gi;

/** True when the page opens with an XML declaration or its `<html>` declares a namespace. */
export function isXhtml(text: string): boolean {
  return XML_DECL.test(text) || HTML_XMLNS.test(text);
}

/** True when the page declares the MadCap Flare namespace, in either casing Flare writes. */
export function isFlare(text: string): boolean {
  return FLARE_NS.test(text);
}

/** Text spliced into the parsed copy: where it starts there, and how long it is. */
interface Insertion {
  at: number;
  len: number;
  /** The first newline at or after `at`, in the parsed copy: the end of the insertion's line. */
  lineEnd: number;
}

/**
 * Parse `text` with parse5, with source locations, nesting as XML would:
 * a self-closed element holds nothing, and what parse5 put inside it follows
 * it in its parent. A self-closed element has no `endTag`, and its end
 * location equals its start tag's. Foreign content (SVG, MathML) is left as
 * parse5 reads it, since parse5 already honours the slash there.
 */
export function parseXhtml(text: string): Document {
  // Closing a raw-text element with a spliced end tag, `<title />` read as
  // `<title /></title>`, is a pure insertion: the slash stays, parse5
  // ignores it, and the start tag keeps its original span.
  const insertions: Insertion[] = [];
  let added = 0;
  const parsed = text.replace(SELF_CLOSED_RAW, (match: string, name: string | undefined, offset: number) => {
    if (name === undefined) return match;
    const end = `</${name}>`;
    insertions.push({ at: offset + match.length + added, len: end.length, lineEnd: -1 });
    added += end.length;
    return match + end;
  });
  for (const ins of insertions) {
    const nl = parsed.slice(ins.at).search(/[\r\n]/);
    ins.lineEnd = nl === -1 ? parsed.length : ins.at + nl;
  }

  const doc = parse(parsed, { sourceCodeLocationInfo: true });
  if (insertions.length > 0) unshift(doc, insertions);
  hoist(doc, text);
  return doc;
}

/** Map every location in the tree from the parsed copy back to the original text. */
function unshift(node: Node, insertions: Insertion[]): void {
  // Every node's location widens to the element's: its extra fields are optional.
  const loc: Token.ElementLocation | null | undefined =
    "sourceCodeLocation" in node ? node.sourceCodeLocation : undefined;
  if (loc) {
    // An end tag starting in spliced text is the synthetic one: drop it so
    // the element reads as self-closed.
    const endTag = loc.endTag;
    if (endTag && insertions.some((i) => i.at === endTag.startOffset)) delete loc.endTag;
    const all: Location[] = [loc];
    if (loc.startTag) all.push(loc.startTag);
    if (loc.endTag) all.push(loc.endTag);
    if (loc.attrs) all.push(...Object.values(loc.attrs));
    for (const l of all) {
      const [startOffset, startShift] = back(l.startOffset, insertions);
      const [endOffset, endShift] = back(l.endOffset, insertions);
      l.startOffset = startOffset;
      l.startCol -= startShift;
      l.endOffset = endOffset;
      l.endCol -= endShift;
    }
  }
  if ("childNodes" in node) for (const c of node.childNodes) unshift(c, insertions);
  if ("content" in node) unshift(node.content, insertions);
}

/**
 * An offset in the parsed copy, as an offset in the original text, and how
 * far its column moves. Inserted text holds no newline, so only insertions
 * on the offset's own line move its column. An offset inside inserted text
 * maps to where the insertion sits, the end of the self-closed tag.
 */
function back(offset: number, insertions: Insertion[]): [number, number] {
  let shift = 0;
  let colShift = 0;
  for (const ins of insertions) {
    if (ins.at >= offset) break;
    const moved = Math.min(ins.len, offset - ins.at);
    shift += moved;
    if (offset <= ins.lineEnd) colShift += moved;
  }
  return [offset - shift, colShift];
}

/**
 * Move the children of each self-closed HTML element out, in order, to just
 * after it. Post-order, so a self-closed element swallowed by another is
 * emptied first and then moves out with what follows it.
 */
function hoist(node: Node, text: string): void {
  if (!("childNodes" in node)) return;
  for (const c of [...node.childNodes]) hoist(c, text);
  if ("content" in node) hoist(node.content, text);
  if (!defaultTreeAdapter.isElementNode(node) || node.namespaceURI !== html.NS.HTML) return;
  const loc = node.sourceCodeLocation;
  if (!loc?.startTag || loc.endTag) return;
  if (!text.slice(loc.startTag.startOffset, loc.startTag.endOffset).endsWith("/>")) return;
  loc.endLine = loc.startTag.endLine;
  loc.endCol = loc.startTag.endCol;
  loc.endOffset = loc.startTag.endOffset;
  const parent = node.parentNode;
  if (!parent || node.childNodes.length === 0) return;
  const next = parent.childNodes[parent.childNodes.indexOf(node) + 1];
  for (const child of [...node.childNodes]) {
    defaultTreeAdapter.detachNode(child);
    if (next) defaultTreeAdapter.insertBefore(parent, child, next);
    else defaultTreeAdapter.appendChild(parent, child);
  }
}
