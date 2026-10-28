/**
 * Where an HTML or XML page's metadata ends (proposal 0125, decision 21).
 *
 * `manni docevals` grades the source from here to the end of the file as the
 * page's body. Slicing the file rather than rebuilding text keeps a grader's
 * line numbers the file's own. The fenced formats answer `undefined`: their
 * body is what follows the front matter block, which the caller cuts by the
 * fence rules it already has.
 */
import { extname } from "node:path";
import { defaultTreeAdapter, parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { isXhtml, parseXhtml } from "../../shared/xhtml.js";
import { liftRoot } from "./dita.js";
import { extractorForExtension } from "./index.js";
import { closeTagStart, lineStarts, offsetAt, startTagEnd } from "./xml-locate.js";
import { readXml } from "./xml-read.js";

/**
 * The offset in `content` where an HTML or XML page's body starts, or
 * `undefined` for a format whose metadata is a fenced block. Throws where the
 * XML extractor throws, on a document that is not well-formed.
 */
export function bodyOffset(content: string, filePath: string): number | undefined {
  // Both readers strip a leading BOM, so their offsets are into the rest.
  const bom = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  const text = content.slice(bom);
  switch (extractorForExtension(extname(filePath))?.name) {
    case "html":
      return bom + htmlBodyOffset(text);
    case "xml":
      return bom + xmlBodyOffset(content, filePath);
    default:
      return undefined;
  }
}

/** The end of `</head>`, else the start of `<body>`, else 0. */
function htmlBodyOffset(text: string): number {
  const doc = isXhtml(text) ? parseXhtml(text) : parse(text, { sourceCodeLocationInfo: true });
  const html = doc.childNodes.find(
    (n): n is DefaultTreeAdapterTypes.Element =>
      defaultTreeAdapter.isElementNode(n) && n.tagName === "html",
  );
  const child = (name: string): DefaultTreeAdapterTypes.Element | undefined =>
    html?.childNodes.find(
      (n): n is DefaultTreeAdapterTypes.Element =>
        defaultTreeAdapter.isElementNode(n) && n.tagName === name,
    );
  // An implied element has no location, so a page that never wrote one falls through.
  return (
    child("head")?.sourceCodeLocation?.endTag?.endOffset ??
    child("body")?.sourceCodeLocation?.startTag?.startOffset ??
    0
  );
}

/**
 * The end of a DITA topic's `</prolog>` or a map's `</topicmeta>`, where the
 * document has one, else the end of the root start tag. Offsets are into the
 * BOM-stripped text `readXml` parsed.
 */
function xmlBodyOffset(content: string, filePath: string): number {
  const { root, body, dita } = readXml(content, filePath);
  if (root === undefined) return 0;
  const lift = dita === undefined ? undefined : liftRoot(root, dita);
  const el = lift ?? root;
  const open = startTagEnd(body, offsetAt(lineStarts(body), el.lineNumber ?? 1, el.columnNumber ?? 1));
  if (open === undefined) return 0;
  if (lift === undefined || open.selfClosing) return open.end;
  const close = closeTagStart(body, open.end, lift.nodeName);
  const end = close === undefined ? -1 : body.indexOf(">", close);
  return end === -1 ? open.end : end + 1;
}
