/**
 * HTML's two term constructs, `<dl>` and `<dfn>`. Neither says it is a
 * glossary, so both are read only where the page's metadata declares
 * `type: term-set` (proposal 0052 § 3).
 *
 * parse5 is the parser meta's HTML extractor uses; its location info gives
 * each element's offsets and line directly.
 */
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Term, TermField, TermInput, TermReader, TermReadResult } from "../../types.js";
import { collapse, declares, nothing, recordOf, skipped, termOf, textOf } from "./normalize.js";

type Element = DefaultTreeAdapterMap["element"];
type ChildNode = DefaultTreeAdapterMap["childNode"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

interface ParsedHtml {
  root: DefaultTreeAdapterMap["document"];
  /** 1 when a leading BOM was stripped before parsing, so offsets map back onto `input.content`. */
  shift: number;
}

const cache = new WeakMap<TermInput, ParsedHtml>();

function parseHtml(input: TermInput): ParsedHtml {
  const cached = cache.get(input);
  if (cached !== undefined) return cached;
  // A BOM before `<html>` puts parse5 into a mode with no source locations for
  // the document's structure; meta's reader strips it for the same reason.
  const shift = input.content.charCodeAt(0) === 0xfeff ? 1 : 0;
  const parsed = { root: parse(input.content.slice(shift), { sourceCodeLocationInfo: true }), shift };
  cache.set(input, parsed);
  return parsed;
}

function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

function childElements(node: ParentNode): Element[] {
  return node.childNodes.filter(isElement);
}

function elementsNamed(node: ParentNode, name: string): Element[] {
  const out: Element[] = [];
  const walk = (parent: ParentNode): void => {
    for (const child of childElements(parent)) {
      if (child.tagName === name) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

function rawText(node: ParentNode): string {
  let text = "";
  for (const child of node.childNodes) {
    if (child.nodeName === "#text" && "value" in child) text += child.value;
    else if (isElement(child)) text += rawText(child);
  }
  return text;
}

function textOfNode(node: ParentNode): string {
  return collapse(rawText(node));
}

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function lineOf(el: Element): number {
  return el.sourceCodeLocation?.startLine ?? 1;
}

function spanOf(parsed: ParsedHtml, first: Element, last: Element): { start: number; end: number } | undefined {
  const start = first.sourceCodeLocation?.startOffset;
  const end = last.sourceCodeLocation?.endOffset;
  if (start === undefined || end === undefined) return undefined;
  return { start: start + parsed.shift, end: end + parsed.shift };
}

/** A `<dd>`'s definition: its paragraphs with a blank line between, or its text when it has none. */
function definitionOf(dd: Element): string {
  const paragraphs = childElements(dd).filter((child) => child.tagName === "p");
  if (paragraphs.length === 0) return textOfNode(dd);
  return paragraphs
    .map(textOfNode)
    .filter((text) => text !== "")
    .join("\n\n");
}

/** A `<dl>`'s `<dt>` and `<dd>` children, looking through the `<div>` wrappers HTML allows. */
function listItems(dl: Element): Element[] {
  return childElements(dl).flatMap((child) => (child.tagName === "div" ? childElements(child) : [child]));
}

const DL_LABEL = "dl";

function readDl(input: TermInput): TermReadResult {
  if (!declares(input, "term-set")) return nothing();
  const parsed = parseHtml(input);
  const result = nothing();

  for (const dl of elementsNamed(parsed.root, "dl")) {
    const items = listItems(dl).filter((item) => item.tagName === "dt" || item.tagName === "dd");
    let i = 0;
    while (i < items.length) {
      const dts: Element[] = [];
      const dds: Element[] = [];
      for (let item = items[i]; item?.tagName === "dt"; item = items[++i]) dts.push(item);
      for (let item = items[i]; item?.tagName === "dd"; item = items[++i]) dds.push(item);
      const first = dts[0] ?? dds[0];
      const last = dds[dds.length - 1] ?? dts[dts.length - 1];
      if (first === undefined || last === undefined) break;

      const named = dts.filter((dt) => textOfNode(dt) !== "");
      const [labelDt, ...altDts] = named;
      const [dd] = dds;
      const raw: Partial<Record<TermField, unknown>> = {
        label: labelDt === undefined ? undefined : textOfNode(labelDt),
        "alt-labels": altDts.map(textOfNode),
        definition: dd === undefined ? undefined : definitionOf(dd),
      };
      const lines: Partial<Record<TermField, number | undefined>> = {
        label: labelDt === undefined ? undefined : lineOf(labelDt),
        "alt-labels": altDts[0] === undefined ? undefined : lineOf(altDts[0]),
        definition: dd === undefined ? undefined : lineOf(dd),
      };
      const line = lineOf(first);
      const record = recordOf(raw);
      if (record === undefined) {
        result.notices.push(skipped(input, line, DL_LABEL));
        continue;
      }
      const span = spanOf(parsed, first, last);
      const constructId = dts.map((dt) => textOf(attr(dt, "id"))).find((id) => id !== undefined);
      result.terms.push(
        termOf(input, {
          record,
          constructId,
          construct: "html-dl",
          line,
          lines,
          ...(span === undefined ? {} : { span }),
        }),
      );
    }
  }
  return result;
}

const DFN_LABEL = "dfn";

/** Whether `el` sits in a `<dt>`, where the `<dl>` reader already reads its term. */
function insideDt(el: Element): boolean {
  let parent = el.parentNode;
  while (parent !== null && "tagName" in parent) {
    if (parent.tagName === "dt") return true;
    parent = parent.parentNode;
  }
  return false;
}

/**
 * The HTML spec's rule for the term a `<dfn>` defines: its `title`, else the
 * `title` of an `<abbr>` that is its only content, else its text. Where the
 * label came from an `<abbr>`, the abbreviation is an alt-label.
 */
function dfnFields(dfn: Element): { label?: string; alt?: string } {
  const title = textOf(attr(dfn, "title"));
  if (title !== undefined) return { label: title };
  const content = dfn.childNodes.filter((child) =>
    child.nodeName === "#text" && "value" in child ? child.value.trim() !== "" : isElement(child),
  );
  const [only] = content;
  if (content.length === 1 && only !== undefined && isElement(only) && only.tagName === "abbr") {
    const abbrTitle = textOf(attr(only, "title"));
    if (abbrTitle !== undefined) return { label: abbrTitle, alt: textOfNode(only) };
  }
  return { label: textOfNode(dfn) };
}

function readDfn(input: TermInput): TermReadResult {
  if (!declares(input, "term-set")) return nothing();
  const parsed = parseHtml(input);
  const result = nothing();
  for (const dfn of elementsNamed(parsed.root, "dfn")) {
    if (insideDt(dfn)) continue;
    const { label, alt } = dfnFields(dfn);
    const line = lineOf(dfn);
    const record = recordOf({ label, "alt-labels": alt });
    if (record === undefined) {
      result.notices.push(skipped(input, line, DFN_LABEL));
      continue;
    }
    const span = spanOf(parsed, dfn, dfn);
    const term: Term = termOf(input, {
      record,
      constructId: attr(dfn, "id"),
      construct: "html-dfn",
      line,
      lines: { label: line, "alt-labels": line },
      ...(span === undefined ? {} : { span }),
    });
    result.terms.push(term);
  }
  return result;
}

export const htmlDlReader: TermReader = {
  construct: "html-dl",
  label: DL_LABEL,
  formats: ["html"],
  read: readDl,
};

export const htmlDfnReader: TermReader = {
  construct: "html-dfn",
  label: DFN_LABEL,
  formats: ["html"],
  read: readDfn,
};
