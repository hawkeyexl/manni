/**
 * The XML parse the DITA and DocBook readers share: one parse per input,
 * element lookup by local name, and an element's span in the file's content.
 *
 * meta's XML read model sits behind the sibling-tool wall, so the few pieces
 * needed here are restated rather than imported. The parser is the same one
 * (`@xmldom/xmldom`), with the same tolerance for DTD-declared entities, so a
 * file meta extracted is a file this parses.
 */
import { DOMParser, type Element } from "@xmldom/xmldom";
import type { TermInput } from "../../types.js";
import { collapse } from "./normalize.js";

export type XmlElement = Element;

export interface ParsedXml {
  root: XmlElement;
  /** The content parsed: `input.content` minus a leading BOM. */
  body: string;
  /** How far `body` is shifted from `input.content`: 1 when a BOM was stripped. */
  shift: number;
  /** Offsets at which each 1-based line of `body` begins, counted as xmldom counts them. */
  starts: number[];
}

const cache = new WeakMap<TermInput, ParsedXml | null>();

/** The six break forms xmldom folds to LF before counting lines. */
const LINE_BREAK = /\r\n|\r|\n|\u0085|\u2028|\u2029/g;

function lineStarts(source: string): number[] {
  const starts = [0];
  for (const match of source.matchAll(LINE_BREAK)) starts.push(match.index + match[0].length);
  return starts;
}

/**
 * The input's XML, or `null` for a file that does not parse or has no root.
 * The loader has already extracted the file with meta's XML extractor, which
 * refuses a malformed one, so `null` here means "not a document this reader
 * can hold entries in", never a quiet skip of a broken file.
 */
export function parseXml(input: TermInput): ParsedXml | null {
  const cached = cache.get(input);
  if (cached !== undefined) return cached;
  const shift = input.content.charCodeAt(0) === 0xfeff ? 1 : 0;
  const body = input.content.slice(shift);
  const errors: string[] = [];
  let parsed: ParsedXml | null = null;
  try {
    const doc = new DOMParser({
      onError: (level, message) => {
        if (level !== "error" && level !== "fatalError") return;
        if (/entity not found/i.test(message)) return;
        errors.push(message);
      },
    }).parseFromString(body, "text/xml");
    const root = doc.documentElement;
    if (errors.length === 0 && root !== null) parsed = { root, body, shift, starts: lineStarts(body) };
  } catch {
    parsed = null;
  }
  cache.set(input, parsed);
  return parsed;
}

/** An element's local name, lowercased: DocBook 5 is namespaced, DocBook 4 and DITA are not. */
export function nameOf(el: XmlElement): string {
  return (el.localName ?? el.nodeName).toLowerCase();
}

/** The element children of `el`, optionally only those named `name` (lowercase). */
export function childrenOf(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children.item(i);
    if (child !== null && (name === undefined || nameOf(child) === name)) out.push(child);
  }
  return out;
}

/** Every descendant of `el` named `name` (lowercase), in document order. */
export function descendantsOf(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (parent: XmlElement): void => {
    for (const child of childrenOf(parent)) {
      if (nameOf(child) === name) out.push(child);
      walk(child);
    }
  };
  walk(el);
  return out;
}

/** An element's text, whitespace collapsed. */
export function textOfElement(el: XmlElement): string {
  return collapse(el.textContent ?? "");
}

/** The 1-based line an element starts on. */
export function lineOfElement(el: XmlElement): number {
  return el.lineNumber ?? 1;
}

/**
 * The offset just past the end of the markup construct starting at `from`
 * (a comment, CDATA section, processing instruction or declaration), or
 * `undefined` when `from` starts none of them.
 */
function skipOpaque(body: string, from: number): number | undefined {
  const opaque: [string, string][] = [
    ["<!--", "-->"],
    ["<![CDATA[", "]]>"],
    ["<?", "?>"],
    ["<!", ">"],
  ];
  for (const [open, close] of opaque) {
    if (body.startsWith(open, from)) {
      const end = body.indexOf(close, from + open.length);
      return end === -1 ? body.length : end + close.length;
    }
  }
  return undefined;
}

/** The offset past a tag's closing `>`, honouring quoted attribute values, and whether it self-closed. */
function tagEnd(body: string, from: number): { end: number; selfClosing: boolean } | undefined {
  let quote: string | undefined;
  for (let i = from + 1; i < body.length; i++) {
    const ch = body[i];
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return { end: i + 1, selfClosing: body[i - 1] === "/" };
    }
  }
  return undefined;
}

function namedAt(body: string, at: number, name: string): boolean {
  if (!body.startsWith(name, at)) return false;
  const after = body[at + name.length];
  return after === undefined || /[\s/>]/.test(after);
}

/**
 * An element's `[start, end)` offsets in `input.content`. xmldom reports only
 * where an element starts, so the end is found by scanning forward for the
 * close tag that balances it, skipping comments, CDATA and processing
 * instructions.
 */
export function spanOfElement(xml: ParsedXml, el: XmlElement): { start: number; end: number } | undefined {
  const lineStart = xml.starts[(el.lineNumber ?? 1) - 1];
  if (lineStart === undefined) return undefined;
  const start = lineStart + (el.columnNumber ?? 1) - 1;
  const { body } = xml;
  if (body[start] !== "<") return undefined;
  const name = el.nodeName;
  const open = tagEnd(body, start);
  if (open === undefined) return undefined;
  if (open.selfClosing) return { start: start + xml.shift, end: open.end + xml.shift };

  let depth = 1;
  let i = open.end;
  while (i < body.length) {
    const lt = body.indexOf("<", i);
    if (lt === -1) return undefined;
    const skipTo = skipOpaque(body, lt);
    if (skipTo !== undefined) {
      i = skipTo;
      continue;
    }
    const tag = tagEnd(body, lt);
    if (tag === undefined) return undefined;
    if (body[lt + 1] === "/" && namedAt(body, lt + 2, name)) {
      depth -= 1;
      if (depth === 0) return { start: start + xml.shift, end: tag.end + xml.shift };
    } else if (namedAt(body, lt + 1, name) && !tag.selfClosing) {
      depth += 1;
    }
    i = tag.end;
  }
  return undefined;
}
