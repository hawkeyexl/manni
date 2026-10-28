/**
 * The XHTML parse helper: detection by declaration or namespace, the Flare
 * namespace, and a parse5 tree that nests the way an XML parser reads the
 * file, with every location still indexing into the text passed in.
 */
import { describe, expect, it } from "vitest";
import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { isFlare, isXhtml, parseXhtml } from "../../src/shared/xhtml.js";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

const XHTML_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns:MadCap="http://www.madcapsoftware.com/Schemas/MadCap.xsd">';

/** Every element named `name` (lower-cased, as parse5 stores it), in document order. */
function all(node: Node, name: string, out: Element[] = []): Element[] {
  if ("tagName" in node && node.tagName === name) out.push(node);
  if ("childNodes" in node) for (const c of node.childNodes) all(c, name, out);
  return out;
}

function one(node: Node, name: string): Element {
  const found = all(node, name)[0];
  if (!found) throw new Error(`no <${name}>`);
  return found;
}

/** A compact shape of the tree: names, with text as quoted strings. */
function shape(node: Node): unknown {
  if (node.nodeName === "#text" && "value" in node) return JSON.stringify(node.value);
  if (!("childNodes" in node)) return node.nodeName;
  return { [node.nodeName]: node.childNodes.map(shape) };
}

/** Assert every node's `parentNode` matches the array that holds it. */
function parentsAgree(node: Node): void {
  if (!("childNodes" in node)) return;
  for (const c of node.childNodes) {
    expect(c.parentNode).toBe(node);
    parentsAgree(c);
  }
}

describe("isXhtml", () => {
  it("is true for an XML declaration, with or without a BOM", () => {
    expect(isXhtml('<?xml version="1.0"?><html><body/></html>')).toBe(true);
    expect(isXhtml('﻿<?xml version="1.0"?><html/>')).toBe(true);
    expect(isXhtml('﻿\n  <?xml version="1.0"?><html/>')).toBe(true);
  });

  it("is true when <html> declares a namespace", () => {
    expect(isXhtml('<html xmlns:MadCap="http://www.madcapsoftware.com/Schemas/MadCap.xsd"><body></body></html>')).toBe(true);
    expect(isXhtml('<!DOCTYPE html>\n<HTML lang="en" xmlns="http://www.w3.org/1999/xhtml">')).toBe(true);
  });

  it("is false for a plain HTML5 page", () => {
    expect(isXhtml('<!DOCTYPE html>\n<html lang="en"><head><title>T</title></head></html>')).toBe(false);
    expect(isXhtml('<html data-xmlns="x"><body></body></html>')).toBe(false);
  });
});

describe("isFlare", () => {
  it("matches the MadCap namespace in either casing", () => {
    expect(isFlare('<html xmlns:MadCap="http://www.madcapsoftware.com/Schemas/MadCap.xsd">')).toBe(true);
    expect(isFlare('<html xmlns:MadCap="http://www.madcapsoftware.com/schemas/MadCap.xsd">')).toBe(true);
  });

  it("is false for other XHTML", () => {
    expect(isFlare('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"></html>')).toBe(false);
  });
});

describe("parseXhtml", () => {
  it("keeps an inline self-closed element empty", () => {
    const text = `${XHTML_HEAD}<body><p>Version <MadCap:variable name="General.V" /> needs Node.</p><p>Next</p></body></html>`;
    const doc = parseXhtml(text);
    const variable = one(doc, "madcap:variable");
    expect(variable.childNodes).toEqual([]);
    const [first, second] = all(doc, "p");
    expect(shape(first as Node)).toEqual({ p: ['"Version "', { "madcap:variable": [] }, '" needs Node."'] });
    expect(second?.parentNode).toBe(first?.parentNode);
    expect(shape(second as Node)).toEqual({ p: ['"Next"'] });
    parentsAgree(doc);
  });

  it("ends a self-closed element where its start tag ends, with no endTag", () => {
    const text = `${XHTML_HEAD}<body><p>A <MadCap:variable name="x" /> b</p></body></html>`;
    const loc = one(parseXhtml(text), "madcap:variable").sourceCodeLocation;
    if (!loc?.startTag) throw new Error("no location");
    expect(loc.endTag).toBeUndefined();
    expect(loc.endOffset).toBe(loc.startTag.endOffset);
    expect(loc.endLine).toBe(loc.startTag.endLine);
    expect(loc.endCol).toBe(loc.startTag.endCol);
    expect(text.slice(loc.startOffset, loc.endOffset)).toBe('<MadCap:variable name="x" />');
  });

  it("leaves a top-level snippetBlock's followers as body children", () => {
    const text = `${XHTML_HEAD}<body><MadCap:snippetBlock src="a.flsnp" /><h2>Steps</h2><p>x</p></body></html>`;
    const doc = parseXhtml(text);
    expect(shape(one(doc, "body"))).toEqual({
      body: [{ "madcap:snippetblock": [] }, { h2: ['"Steps"'] }, { p: ['"x"'] }],
    });
    parentsAgree(doc);
  });

  it("unnests two self-closed siblings in a row", () => {
    const text = `${XHTML_HEAD}<body><p>a <MadCap:variable name="x" /><MadCap:variable name="y" /> b</p><p>c</p></body></html>`;
    const doc = parseXhtml(text);
    expect(shape(one(doc, "body"))).toEqual({
      body: [
        { p: ['"a "', { "madcap:variable": [] }, { "madcap:variable": [] }, '" b"'] },
        { p: ['"c"'] },
      ],
    });
    parentsAgree(doc);
  });

  it("closes a self-closed <title /> and maps locations back to the text", () => {
    const text = `${XHTML_HEAD}<head><title /><meta name="a" content="b" /></head><body><h1>T</h1></body></html>`;
    const doc = parseXhtml(text);
    const head = one(doc, "head");
    const meta = one(doc, "meta");
    const h1 = one(doc, "h1");
    expect(meta.parentNode).toBe(head);
    expect(h1.parentNode).toBe(one(doc, "body"));

    const title = one(doc, "title");
    expect(title.childNodes).toEqual([]);
    const tloc = title.sourceCodeLocation;
    expect(tloc?.endTag).toBeUndefined();
    expect(tloc && text.slice(tloc.startOffset, tloc.endOffset)).toBe("<title />");

    const mloc = meta.sourceCodeLocation;
    const hloc = h1.sourceCodeLocation;
    if (!mloc || !hloc) throw new Error("no location");
    expect(text.slice(mloc.startOffset, mloc.endOffset)).toBe('<meta name="a" content="b" />');
    expect(text.slice(hloc.startOffset, hloc.endOffset)).toBe("<h1>T</h1>");
    const attr = mloc.attrs?.["content"];
    expect(attr && text.slice(attr.startOffset, attr.endOffset)).toBe('content="b"');

    // Line 2, after the rewrite on the same line: col is 1 + offset into line 2.
    const line2 = text.indexOf("\n") + 1;
    expect(mloc.startLine).toBe(2);
    expect(mloc.startCol).toBe(mloc.startOffset - line2 + 1);
    expect(hloc.startCol).toBe(hloc.startOffset - line2 + 1);
    expect(hloc.endCol).toBe(hloc.endOffset - line2 + 1);
    expect(attr?.startCol).toBe((attr?.startOffset ?? 0) - line2 + 1);
    parentsAgree(doc);
  });

  it("closes a self-closed <script /> in head", () => {
    const text = `${XHTML_HEAD}\n<head><script src="x.js" /><link rel="stylesheet" href="a.css" />\n</head>\n<body><h1>T</h1></body></html>`;
    const doc = parseXhtml(text);
    const script = one(doc, "script");
    const link = one(doc, "link");
    const h1 = one(doc, "h1");
    expect(script.childNodes).toEqual([]);
    expect(link.parentNode).toBe(one(doc, "head"));
    expect(h1.parentNode).toBe(one(doc, "body"));
    const sloc = script.sourceCodeLocation;
    const lloc = link.sourceCodeLocation;
    const hloc = h1.sourceCodeLocation;
    if (!sloc || !lloc || !hloc) throw new Error("no location");
    expect(text.slice(sloc.startOffset, sloc.endOffset)).toBe('<script src="x.js" />');
    expect(text.slice(lloc.startOffset, lloc.endOffset)).toBe('<link rel="stylesheet" href="a.css" />');
    expect(text.slice(hloc.startOffset, hloc.endOffset)).toBe("<h1>T</h1>");
    const lineStart = text.lastIndexOf("\n", lloc.startOffset) + 1;
    expect(lloc.startCol).toBe(lloc.startOffset - lineStart + 1);
    expect(hloc.startLine).toBe(5);
    expect(hloc.startCol).toBe(7);
  });

  it("does not rewrite a self-closed tag inside a comment", () => {
    const text = `${XHTML_HEAD}<head><!-- <title /> --></head><body></body></html>`;
    const doc = parseXhtml(text);
    const head = one(doc, "head");
    const comment = head.childNodes[0];
    expect(comment && "data" in comment ? comment.data : undefined).toBe(" <title /> ");
  });

  it("works with a leading BOM and leaves offsets on the text passed in", () => {
    const text = `﻿${XHTML_HEAD}<body><p>a <MadCap:variable name="x" /> b</p></body></html>`;
    const doc = parseXhtml(text);
    const loc = one(doc, "madcap:variable").sourceCodeLocation;
    expect(loc && text.slice(loc.startOffset, loc.endOffset)).toBe('<MadCap:variable name="x" />');
    expect(shape(one(doc, "p"))).toEqual({ p: ['"a "', { "madcap:variable": [] }, '" b"'] });
  });

  it("returns the same tree as parse for a page with no self-closed tags", () => {
    const text = '<!DOCTYPE html>\n<html lang="en"><head><title>T</title></head><body><p>a <b>b</b></p><img src="x.png"></body></html>';
    const opts = { sourceCodeLocationInfo: true };
    const strip = (n: Node): unknown => JSON.parse(JSON.stringify(n, (k, v: unknown) => (k === "parentNode" ? undefined : v)));
    expect(strip(parseXhtml(text))).toEqual(strip(parse(text, opts)));
  });

  it("leaves foreign content alone", () => {
    const text = `${XHTML_HEAD}<body><svg><circle r="1" /><title /></svg><p>x</p></body></html>`;
    const doc = parseXhtml(text);
    expect(shape(one(doc, "body"))).toEqual({ body: [{ svg: [{ circle: [] }, { title: [] }] }, { p: ['"x"'] }] });
  });
});
