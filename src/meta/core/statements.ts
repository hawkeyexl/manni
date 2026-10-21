/**
 * Inline `meta` statements (proposal 0099): small JSON objects of block-level
 * fields written in a page's own comment syntax, each pinned to the block it
 * describes.
 *
 * The text forms are found by the scanner cite shares
 * (`src/shared/statements.ts`), and in Markdown, MDX, HTML, AsciiDoc and
 * reStructuredText a statement anchors what a cite marker would
 * (`anchoredLines`). In XML and DITA it anchors an element instead: the
 * element it is the first child of, else the next element after it, start tag
 * to end tag. DITA's `<data name="manni-meta" value='…'/>` carrier is read
 * here, from the same element scan.
 *
 * A statement on a heading describes the section (decision 2b) and pins the
 * heading line only. Statements are never front matter: they are read beside
 * it, and nothing here merges them into a page's metadata.
 *
 * Nothing here reads git. A pin is a content hash of the anchored lines.
 */
import * as Ajv2020Ns from "ajv/dist/2020.js";
import type { DefinedError, ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import GithubSlugger from "github-slugger";
import graphSchema from "../schemas/graph/1.0.0.json" with { type: "json" };
import type { Guidance } from "../../shared/guidance.js";
import { hashLines, normalizeText, spellLines, splitLines, type PageLines } from "../../shared/pin.js";
import type { Severity } from "../../shared/severity.js";
import {
  anchoredLines,
  isMarkerLine,
  lineAt,
  markerRunAt,
  parseMetaStatements,
  PIN_TOKEN,
  splitUnit,
  type MetaStatementToken,
} from "../../shared/statements.js";
import { locateFrontmatter } from "../extractors/frontmatter.js";
import { startTagEnd } from "../extractors/xml-locate.js";
import type { FieldError } from "../types.js";
import { guidanceFor } from "./guidance.js";
import { messageFor, type Validator } from "./validator.js";

/** The schema label every statement rule carries, so its rule id is `manni:meta/<rule>`. */
export const STATEMENT_SCHEMA = "manni:meta";

/** The page that says how statements work, which every rule's guidance links. */
const GUIDE = "https://hawkeyexl.github.io/manni/meta/set-up/inline-statements/";

/** Each rule's severity and what it asks for. */
export const STATEMENT_RULES = {
  "statement-invalid": { severity: "error", description: "A statement's payload is one JSON object." },
  "statement-unknown-field": {
    severity: "error",
    description: "A statement sets only fields that the page's schemas define.",
  },
  "statement-external-field": {
    severity: "error",
    description: "A field marked x-manni-location: external lives in the manifest, not in the page.",
  },
  "statement-orphan": {
    severity: "error",
    description: "A statement describes the paragraph, block or element that follows it.",
  },
  "statement-misplaced": {
    severity: "warning",
    description: "A statement sits above the first line of the paragraph it describes.",
  },
  "statement-changed": { severity: "warning", description: "The pinned block no longer matches." },
  "statement-unpinned": {
    severity: "notice",
    description: "A statement without a pin cannot tell when its block changes.",
  },
  "statement-line-form-paren": {
    severity: "error",
    description: "A line comment form ends at the first ), so its payload cannot hold one.",
  },
  "statement-graph-not-section": {
    severity: "error",
    description: "Only a statement on a heading types a section with graph.",
  },
  "statement-conflicts-sections": {
    severity: "error",
    description: "A section's field is set in one place: its heading statement or graph.sections.",
  },
  "statement-xml-comment-dashes": {
    severity: "error",
    description: "XML forbids -- inside a comment.",
  },
} as const satisfies Record<string, { severity: Severity; description: string }>;

export type StatementRule = keyof typeof STATEMENT_RULES;

/** A statement as `meta get` reports it, and as `graph build` reads it. */
export interface PageStatement {
  /** File line of the statement. */
  line: number;
  /** The anchored lines the pin covers: the block, or for a section its heading. Absent on an orphan. */
  anchor?: PageLines;
  /** `section` for a statement on a heading, which describes the whole section. */
  scope: "block" | "section";
  /** Slug of the section the statement is in, or describes. `""` before the first heading. */
  section: string;
  /** The heading's text, on a section statement. */
  heading?: string;
  /** The pin token, when the statement carries one. */
  pin?: string;
  status: "current" | "changed" | "unpinned";
  /** The payload, when it is one JSON object. */
  data?: Record<string, unknown>;
  /** The statement as written, for a writer. */
  token: MetaStatementToken;
}

/** What `readStatements` finds on a page: its statements, and what is wrong with their shape. */
export interface StatementRead {
  statements: PageStatement[];
  findings: FieldError[];
}

/** `"53-54"`, or `null` on an orphan. */
function anchorText(s: Pick<PageStatement, "anchor">): string | null {
  return s.anchor === undefined ? null : spellLines(s.anchor);
}

/** One statement finding, with its rule's severity and guidance. */
export function statementFinding(
  rule: StatementRule,
  message: string,
  s: Pick<PageStatement, "line" | "anchor">,
  instancePath = "",
): FieldError {
  const { severity, description } = STATEMENT_RULES[rule];
  const guidance: Guidance = { id: STATEMENT_SCHEMA, rule, description, guide: GUIDE };
  return {
    schema: STATEMENT_SCHEMA,
    keyword: rule,
    instancePath,
    message,
    line: s.line,
    severity,
    guidance,
    statement: { line: s.line, anchor: anchorText(s) },
  };
}

/**
 * The pin of a block's lines, by the citations hashing rule: joined with LF,
 * one BOM stripped, CRLF folded to LF, no trailing LF, as `sha256-<hex>`. A
 * writer in Node computes the same pin with it.
 */
export function pinOf(lines: readonly string[]): string {
  return hashLines(normalizeText(lines.join("\n")));
}

/** Formats whose metadata is a leading fenced block, so the body starts after it. */
const ELEMENT_BACKED = new Set(["html", "xml"]);

/** The file offset and line the body starts at. */
function bodyStart(content: string, format: string): { offset: number; line: number } {
  const offset = ELEMENT_BACKED.has(format) ? 0 : (locateFrontmatter(content)?.closeEnd ?? 0);
  return { offset, line: lineAt(content, offset) };
}

/** A heading the page holds, with the slug its section is named by. */
interface Heading {
  line: number;
  title: string;
  slug: string;
}

const ATX = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ASCIIDOC_HEADING = /^(={1,6})[ \t]+(.*\S)[ \t]*$/;
const RST_ADORNMENT = /^([-=~^"'*+#_:<>`.])\1{2,}[ \t]*$/;

/** A heading's text with inline markup flattened, close to what a renderer shows. */
function plainTitle(raw: string): string {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

/**
 * The heading on `line` of a line-rule format, or undefined. An rst title is
 * the text line an adornment underlines, or the line between an overline and
 * its underline.
 */
function headingAt(lines: readonly string[], line: number, format: string): { line: number; title: string } | undefined {
  const text = lines[line - 1] ?? "";
  switch (format) {
    case "markdown":
    case "mdx": {
      const m = ATX.exec(text);
      return m?.[2] === undefined ? undefined : { line, title: plainTitle(m[2]) };
    }
    case "asciidoc": {
      const m = ASCIIDOC_HEADING.exec(text);
      return m?.[2] === undefined ? undefined : { line, title: plainTitle(m[2]) };
    }
    case "rst": {
      if (RST_ADORNMENT.test(text)) {
        const next = lines[line] ?? "";
        const under = lines[line + 1] ?? "";
        return next.trim() !== "" && RST_ADORNMENT.test(under)
          ? { line: line + 1, title: plainTitle(next) }
          : undefined;
      }
      const under = lines[line] ?? "";
      return text.trim() !== "" && RST_ADORNMENT.test(under) ? { line, title: plainTitle(text) } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Every heading of a line-rule page outside code, in order, each with its
 * slug. ponytail: slugs come from the heading's text with link and code
 * markup stripped, which matches the graph's section slugs for every heading
 * this repo writes. A heading holding other inline markup may slug apart.
 */
function lineHeadings(lines: readonly string[], format: string, bodyLine: number, code: (line: number) => boolean): Heading[] {
  const slugger = new GithubSlugger();
  const out: Heading[] = [];
  for (let n = bodyLine; n <= lines.length; n++) {
    if (code(n)) continue;
    const h = headingAt(lines, n, format);
    // An rst overline finds its title one line down; skip that title's own turn.
    if (h === undefined || out.some((o) => o.line === h.line)) continue;
    out.push({ ...h, slug: slugger.slug(h.title) });
  }
  return out;
}

/** The slug of the last heading at or above `line`, or `""`. */
function sectionAt(headings: readonly Heading[], line: number): string {
  let slug = "";
  for (const h of headings) {
    if (h.line > line) break;
    slug = h.slug;
  }
  return slug;
}

/** Lines of the page that sit in a fenced block, for skipping headings in code. */
function fencedLines(lines: readonly string[], format: string): Set<number> {
  const out = new Set<number>();
  const fence = format === "asciidoc" ? /^(-{4,})/ : format === "markdown" || format === "mdx" ? /^[ \t]*(`{3,}|~{3,})/ : undefined;
  if (fence === undefined) return out;
  let open: string | undefined;
  lines.forEach((text, i) => {
    const marker = fence.exec(text)?.[1];
    if (open === undefined) {
      if (marker !== undefined) {
        open = marker;
        out.add(i + 1);
      }
      return;
    }
    out.add(i + 1);
    if (text.trim().startsWith(open)) open = undefined;
  });
  return out;
}

/** The pin status of a statement whose anchored text is `text`. */
function statusOf(pin: string | undefined, text: readonly string[] | undefined): PageStatement["status"] {
  if (pin === undefined) return "unpinned";
  return text !== undefined && pinOf(text) === pin ? "current" : "changed";
}

/**
 * The anchored lines' text. A statement inside the lines it anchors, as an
 * element's first child is and as one sharing its line with the text is, is
 * cut out of its line first, so writing its own pin cannot change the text
 * the pin covers.
 */
function anchoredText(
  content: string,
  lines: readonly string[],
  anchor: PageLines,
  token: MetaStatementToken,
): string[] {
  const out = lines.slice(anchor.start - 1, anchor.end);
  const at = token.line - anchor.start;
  const own = out[at];
  if (own !== undefined) {
    const lineStart = content.lastIndexOf("\n", token.start - 1) + 1;
    out[at] = own.slice(0, token.start - lineStart) + own.slice(token.end - lineStart);
  }
  return out;
}

/** The payload as one JSON object, or why it is not one. */
function parsePayload(payload: string): { data: Record<string, unknown> } | { reason: string } {
  if (payload === "") return { reason: "it is empty" };
  if (/[\r\n]/.test(payload)) return { reason: "a statement is one line" };
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (err) {
    return { reason: (err instanceof Error ? err.message : String(err)).replace(/\.$/, "") };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { reason: `it is ${Array.isArray(value) ? "an array" : value === null ? "null" : `a ${typeof value}`}` };
  }
  return { data: value as Record<string, unknown> };
}

/** The structural findings every format shares: the form, the payload, the pin. */
function shapeFindings(s: PageStatement, payloadReason: string | undefined, xml: boolean): FieldError[] {
  const at = `the meta statement at line ${String(s.line)}`;
  const out: FieldError[] = [];
  const problem = s.token.formProblem;
  if (problem === "line-form-paren") {
    out.push(
      statementFinding(
        "statement-line-form-paren",
        `${at} uses a line comment form, and its payload contains ")"; use <!-- --> or {/* */}.`,
        s,
      ),
    );
  } else if (problem === "xml-comment-dashes") {
    out.push(
      statementFinding(
        "statement-xml-comment-dashes",
        `${at} is an XML comment, and its payload contains "--", which XML forbids in a comment; use <?manni meta …?>.`,
        s,
      ),
    );
  } else if (payloadReason !== undefined) {
    out.push(statementFinding("statement-invalid", `${at} is not one JSON object: ${payloadReason}.`, s));
  }
  if (s.anchor === undefined) {
    out.push(
      statementFinding(
        "statement-orphan",
        xml
          ? `${at} anchors nothing: no element follows it, and it is not an element's first child.`
          : `${at} anchors nothing: no paragraph or block follows it.`,
        s,
      ),
    );
    return out;
  }
  if (s.status === "unpinned") {
    out.push(statementFinding("statement-unpinned", `${at} has no pin; run manni meta derive to pin it to the block below.`, s));
  } else if (s.status === "changed") {
    const holds = s.data !== undefined && Object.hasOwn(s.data, "last-verified") ? ", so its last-verified may no longer hold" : "";
    out.push(
      statementFinding(
        "statement-changed",
        `the block under the meta statement at line ${String(s.line)} changed since it was pinned${holds}. Run its checks again, or remove the pin and run manni meta derive.`,
        s,
      ),
    );
  }
  return out;
}

/**
 * The statements of a page in a line-rule format: Markdown, MDX, HTML,
 * AsciiDoc and reStructuredText.
 */
function readLineRule(content: string, format: string): StatementRead {
  const from = bodyStart(content, format);
  const lines = splitLines(content);
  const fenced = fencedLines(lines, format);
  const headings = lineHeadings(lines, format, from.line, (n) => fenced.has(n));
  const statements: PageStatement[] = [];
  const findings: FieldError[] = [];
  for (const token of parseMetaStatements(content.slice(from.offset), format, from)) {
    const unit = anchoredLines(content, token.end, format);
    const heading = unit !== undefined && unit.start === unit.end ? headingAt(lines, unit.start, format) : undefined;
    const anchor = heading !== undefined ? { start: heading.line, end: heading.line } : unit;
    const parsed = parsePayload(token.payload);
    const s: PageStatement = {
      line: token.line,
      scope: heading !== undefined ? "section" : "block",
      section: sectionAt(headings, anchor?.start ?? token.line),
      status: statusOf(token.pin, anchor === undefined ? undefined : anchoredText(content, lines, anchor, token)),
      token,
    };
    if (anchor !== undefined) s.anchor = anchor;
    if (heading !== undefined) s.heading = heading.title;
    if (token.pin !== undefined) s.pin = token.pin;
    if ("data" in parsed) s.data = parsed.data;
    statements.push(s);
    findings.push(...shapeFindings(s, "reason" in parsed ? parsed.reason : undefined, false));
    // A statement line between two lines of one paragraph splits it, as a
    // misplaced cite marker does.
    if (isMarkerLine(lines[token.line - 1] ?? "", format)) {
      const run = markerRunAt(lines, token.line, format, from.line);
      if (splitUnit(lines, run, format, from.line) !== undefined) {
        findings.push(
          statementFinding(
            "statement-misplaced",
            `the meta statement at line ${String(token.line)} sits inside a paragraph; move it above the paragraph's first line.`,
            s,
          ),
        );
      }
    }
  }
  return { statements, findings };
}

// ---------------------------------------------------------------------------
// XML and DITA: element anchoring (decision 2a)
// ---------------------------------------------------------------------------

/** A node of the light element scan: an element, or anything else between tags. */
interface XmlNode {
  kind: "element" | "other" | "text";
  name: string;
  start: number;
  /** Offset just past the node: past the end tag for an element. */
  end: number;
  children: XmlNode[];
  parent?: XmlNode;
  /** Whitespace-only text. */
  blank?: boolean;
  statement?: MetaStatementToken;
}

const DATA_NAME = /\bname\s*=\s*(["'])manni-meta\1/;
const DATA_VALUE = /\bvalue\s*=\s*(["'])/;

/** The five predefined entities and character references, decoded. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|quot|apos|lt|gt|amp);/g, (_m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
    return { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" }[e] ?? "";
  });
}

/** The `<data name="manni-meta" value='…'/>` statement a start tag holds, or undefined. */
function dataStatement(content: string, start: number, tagEnd: number): MetaStatementToken | undefined {
  const tag = content.slice(start, tagEnd);
  if (!DATA_NAME.test(tag)) return undefined;
  const value = DATA_VALUE.exec(tag);
  if (value?.[1] === undefined) return undefined;
  const open = start + value.index + value[0].length;
  const close = content.indexOf(value[1], open);
  if (close === -1) return undefined;
  const raw = content.slice(open, close);
  const lead = /^\s*/.exec(raw)?.[0] ?? "";
  const rest = decodeEntities(raw.slice(lead.length));
  const word = /^\S+/.exec(rest)?.[0] ?? "";
  const pinned = PIN_TOKEN.test(word);
  const token: MetaStatementToken = {
    line: lineAt(content, start),
    start,
    end: tagEnd,
    form: "data",
    pinAt: open + lead.length,
    payload: (pinned ? rest.slice(word.length) : rest).trim(),
  };
  if (pinned) token.pin = word;
  return token;
}

/**
 * A light scan of an XML document into elements with start and end offsets.
 * xmldom reports where a node starts and never where it ends, and refuses a
 * comment holding `--` outright, so the statement reader keeps its own walk.
 * A start tag's end comes from `startTagEnd`, which skips a `>` inside a
 * quoted attribute value.
 */
function scanXml(content: string, texts: readonly MetaStatementToken[]): XmlNode {
  const root: XmlNode = { kind: "element", name: "#document", start: 0, end: content.length, children: [] };
  const byStart = new Map(texts.map((t) => [t.start, t]));
  let current = root;
  let i = 0;
  const push = (node: XmlNode): void => {
    node.parent = current;
    current.children.push(node);
  };
  const skipTo = (needle: string, from: number): number => {
    const at = content.indexOf(needle, from);
    return at === -1 ? content.length : at + needle.length;
  };
  while (i < content.length) {
    const lt = content.indexOf("<", i);
    if (lt === -1 || lt > i) {
      const end = lt === -1 ? content.length : lt;
      const text = content.slice(i, end);
      push({ kind: "text", name: "#text", start: i, end, children: [], blank: text.trim() === "" });
      i = end;
      continue;
    }
    let end: number;
    if (content.startsWith("<!--", i)) {
      end = skipTo("-->", i + 4);
    } else if (content.startsWith("<![CDATA[", i)) {
      end = skipTo("]]>", i + 9);
      push({ kind: "text", name: "#cdata", start: i, end, children: [] });
      i = end;
      continue;
    } else if (content.startsWith("<?", i)) {
      end = skipTo("?>", i + 2);
    } else if (content.startsWith("<!", i)) {
      // A doctype, with an internal subset in brackets when it has one.
      const bracket = content.indexOf("[", i);
      const gt = content.indexOf(">", i);
      end = bracket !== -1 && gt !== -1 && bracket < gt ? skipTo(">", skipTo("]", bracket)) : skipTo(">", i);
    } else if (content.startsWith("</", i)) {
      end = skipTo(">", i);
      current.end = end;
      current = current.parent ?? root;
      i = end;
      continue;
    } else {
      const tag = startTagEnd(content, i);
      const name = /^<([^\s/>]+)/.exec(content.slice(i, i + 256))?.[1];
      if (tag === undefined || name === undefined) {
        i += 1;
        continue;
      }
      const node: XmlNode = { kind: "element", name, start: i, end: tag.end, children: [] };
      const data = name === "data" ? dataStatement(content, i, tag.end) : undefined;
      if (data !== undefined) node.statement = data;
      push(node);
      if (!tag.selfClosing) {
        node.end = content.length;
        current = node;
      }
      i = tag.end;
      continue;
    }
    const node: XmlNode = { kind: "other", name: "#other", start: i, end, children: [] };
    const statement = byStart.get(i);
    if (statement !== undefined) node.statement = statement;
    push(node);
    i = end;
  }
  return root;
}

/** A node a statement's placement looks past: blank text, a comment, a processing instruction, another statement. */
function ignorable(node: XmlNode): boolean {
  return node.kind === "other" || node.blank === true || node.statement !== undefined;
}

/** The `<title>` child of an element, which makes it a section in the graph. */
function titleOf(node: XmlNode): XmlNode | undefined {
  return node.children.find((c) => c.kind === "element" && c.name === "title");
}

function linesOf(content: string, node: XmlNode): PageLines {
  return { start: lineAt(content, node.start), end: lineAt(content, Math.max(node.start, node.end - 1)) };
}

/** An element's text, tags dropped. */
function textOf(content: string, node: XmlNode): string {
  const start = startTagEnd(content, node.start)?.end ?? node.start;
  const close = content.lastIndexOf("</", node.end);
  return decodeEntities(content.slice(start, close > start ? close : node.end).replace(/<[^>]*>/g, "")).trim();
}

function* walk(node: XmlNode): Generator<XmlNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/** The statements of an XML or DITA page, anchored to elements. */
function readXml(content: string): StatementRead {
  const tree = scanXml(content, parseMetaStatements(content, "xml"));
  const lines = splitLines(content);
  // Titles in document order, slugged once, so two equal titles stay apart.
  const slugger = new GithubSlugger();
  const slugs = new Map<XmlNode, string>();
  for (const node of walk(tree)) {
    if (node.kind === "element" && node.name === "title") slugs.set(node, slugger.slug(textOf(content, node)));
  }
  /** The section slug an element sits in: its nearest titled ancestor's. */
  const sectionOf = (node: XmlNode | undefined): string => {
    for (let at = node; at !== undefined; at = at.parent) {
      const title = titleOf(at);
      if (title !== undefined) return slugs.get(title) ?? "";
    }
    return "";
  };
  const statements: PageStatement[] = [];
  const findings: FieldError[] = [];
  for (const node of walk(tree)) {
    const token = node.statement;
    if (token === undefined) continue;
    const parent = node.parent ?? tree;
    const siblings = parent.children;
    const index = siblings.indexOf(node);
    const firstChild = parent !== tree && siblings.slice(0, index).every(ignorable);
    const next = siblings.slice(index + 1).find((c) => c.kind === "element" && c.statement === undefined);
    let anchor: PageLines | undefined;
    let scope: PageStatement["scope"] = "block";
    let section = "";
    let heading: string | undefined;
    // First child of a titled element, or just before a title: the section.
    const owner = firstChild ? parent : next?.name === "title" ? parent : undefined;
    const title = owner === undefined || owner === tree ? undefined : titleOf(owner);
    if (owner !== undefined && title !== undefined) {
      scope = "section";
      anchor = linesOf(content, title);
      section = slugs.get(title) ?? "";
      heading = textOf(content, title);
    } else if (firstChild) {
      anchor = linesOf(content, parent);
      section = sectionOf(parent.parent);
    } else if (next !== undefined) {
      anchor = linesOf(content, next);
      section = sectionOf(parent);
    } else {
      section = sectionOf(parent);
    }
    const parsed = parsePayload(token.payload);
    const s: PageStatement = {
      line: token.line,
      scope,
      section,
      status: statusOf(token.pin, anchor === undefined ? undefined : anchoredText(content, lines, anchor, token)),
      token,
    };
    if (anchor !== undefined) s.anchor = anchor;
    if (heading !== undefined) s.heading = heading;
    if (token.pin !== undefined) s.pin = token.pin;
    if ("data" in parsed) s.data = parsed.data;
    statements.push(s);
    findings.push(...shapeFindings(s, "reason" in parsed ? parsed.reason : undefined, true));
  }
  return { statements, findings };
}

/**
 * Every `meta` statement on a page, anchored and pin-checked, with the
 * findings about their shape. `format` is the extractor's name. Schema
 * findings need the page's schema set, so `statementFieldFindings` adds them.
 */
export function readStatements(content: string, format: string): StatementRead {
  return format === "xml" ? readXml(content) : readLineRule(content, format);
}

/**
 * The page with a pin written into every unpinned statement that anchors
 * something, and how many it wrote. A changed pin is never rewritten: removing
 * it and running `derive` is how a person accepts an edit.
 */
export function pinStatements(content: string, format: string): { content: string; pinned: number } {
  const lines = splitLines(content);
  const edits = readStatements(content, format)
    .statements.filter((s) => s.pin === undefined && s.anchor !== undefined)
    .map((s) => ({ at: s.token.pinAt, text: `${pinOf(anchoredText(content, lines, s.anchor as PageLines, s.token))} ` }))
    .sort((a, b) => b.at - a.at);
  let out = content;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at);
  return { content: out, pinned: edits.length };
}

// ---------------------------------------------------------------------------
// Fields, against the page's own schemas (decision 6)
// ---------------------------------------------------------------------------

type AjvCtor = typeof import("ajv/dist/2020.js").default;
const Ajv2020 = Ajv2020Ns.default as unknown as AjvCtor;
const GRAPH_REF = graphSchema.$id;
let sectionValidator: ValidateFunction | undefined;

/** The validator for `$defs/sectionMetadata`, the shape `graph.sections.<slug>` takes. */
function sectionMetadata(): ValidateFunction {
  if (sectionValidator !== undefined) return sectionValidator;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(graphSchema);
  sectionValidator = ajv.compile({ $ref: `${GRAPH_REF}#/$defs/sectionMetadata` });
  return sectionValidator;
}

/** The fields a section statement shares with `graph.sections.<slug>`, outside `graph`. */
const SECTION_FIELDS = new Set(Object.keys(graphSchema.$defs.sectionMetadata.properties));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One Ajv error against `graph`, as a statement finding at the statement's line. */
function graphError(s: PageStatement, e: ErrorObject): FieldError {
  const instancePath = `/graph${e.instancePath}`;
  return {
    schema: "manni:graph:1.0.0",
    keyword: e.keyword,
    instancePath,
    message: messageFor(e as DefinedError, e.message ?? "is invalid"),
    line: s.line,
    guidance: guidanceFor(sectionMetadataRoot, "manni:graph:1.0.0", { ...e, instancePath: e.instancePath }),
    statement: { line: s.line, anchor: anchorText(s) },
  };
}

/** `sectionMetadata` as a root, so guidance walks it as `graph.sections.<slug>` would. */
const sectionMetadataRoot = { ...graphSchema.$defs.sectionMetadata, $defs: graphSchema.$defs };

/**
 * The findings about what each statement sets, judged by the page's resolved
 * schema set one field at a time: a key no schema defines, a key its schema
 * keeps in the manifest, and a value its own definition refuses. A page's
 * `required` never applies, since a statement describes part of a page.
 *
 * `graph` is a section's typing, so it is read only on a heading statement,
 * against `$defs/sectionMetadata`, and a field set both there and in the
 * page's `graph.sections.<slug>` is a conflict.
 */
export async function statementFieldFindings(
  statements: readonly PageStatement[],
  ctx: {
    validator: Validator;
    schemas: string[];
    /** The page's own metadata, for `graph.sections`. */
    page: Record<string, unknown>;
    lineFor: (pointer: string) => number | undefined;
  },
): Promise<FieldError[]> {
  const withData = statements.filter((s) => s.data !== undefined);
  if (withData.length === 0) return [];
  const claimed = await ctx.validator.claimedProperties(ctx.schemas);
  const graph = isRecord(ctx.page["graph"]) ? ctx.page["graph"] : {};
  const sections = isRecord(graph["sections"]) ? graph["sections"] : {};
  const out: FieldError[] = [];
  for (const s of withData) {
    const data = s.data ?? {};
    const at = `the meta statement at line ${String(s.line)}`;
    const checked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!claimed.has(key)) {
        out.push(
          statementFinding("statement-unknown-field", `${at} sets "${key}", which none of this page's schemas define.`, s, `/${key}`),
        );
      } else if (key === "graph" && s.scope !== "section") {
        out.push(
          statementFinding(
            "statement-graph-not-section",
            `${at} sets "graph", which only a statement on a heading may set; move it above the section's heading.`,
            s,
            "/graph",
          ),
        );
      } else if (key === "graph") {
        const validate = sectionMetadata();
        if (!validate(value)) for (const e of validate.errors ?? []) out.push(graphError(s, e));
      } else {
        checked[key] = value;
      }
    }
    const preferences = await ctx.validator.locationPreferences(checked, ctx.schemas);
    const external = new Set(
      [...preferences].filter(([key, pref]) => pref.location === "external" && Object.hasOwn(checked, key)).map(([key]) => key),
    );
    for (const key of external) {
      out.push(
        statementFinding(
          "statement-external-field",
          `${at} sets "${key}", which lives in the manifest (x-manni-location: external); set it there.`,
          s,
          `/${key}`,
        ),
      );
    }
    const kept = Object.fromEntries(Object.entries(checked).filter(([key]) => !external.has(key)));
    if (Object.keys(kept).length > 0) {
      const errors = await ctx.validator.validate(kept, ctx.schemas, () => s.line);
      // A root finding is about the page as a whole (`required`, a closed
      // root), which a statement is not.
      for (const e of errors) {
        if (e.instancePath === "") continue;
        out.push({ ...e, line: s.line, statement: { line: s.line, anchor: anchorText(s) } });
      }
    }
    if (s.scope === "section") out.push(...conflicts(s, data, sections, ctx.lineFor));
  }
  return out;
}

/** A section field the heading statement and `graph.sections.<slug>` both set. */
function conflicts(
  s: PageStatement,
  data: Record<string, unknown>,
  sections: Record<string, unknown>,
  lineFor: (pointer: string) => number | undefined,
): FieldError[] {
  const entry = sections[s.section];
  if (!isRecord(entry)) return [];
  const inline = isRecord(data["graph"]) ? data["graph"] : {};
  const both = [
    ...Object.keys(inline).filter((k) => Object.hasOwn(entry, k)).map((k) => `graph.${k}`),
    ...Object.keys(data).filter((k) => SECTION_FIELDS.has(k) && k !== "graph" && Object.hasOwn(entry, k)),
  ];
  const where = lineFor(`/graph/sections/${s.section}`);
  const line = s.anchor?.start ?? s.line;
  return both.map((field) =>
    statementFinding(
      "statement-conflicts-sections",
      `the statement on heading "${s.heading ?? s.section}" (line ${String(line)}) and graph.sections.${s.section}${
        where === undefined ? "" : ` (line ${String(where)})`
      } both set ${field}; keep one.`,
      s,
      `/${field.replace(".", "/")}`,
    ),
  );
}

/** A statement as `meta get -f json` prints it. */
export interface StatementView {
  /** File line of the statement. */
  line: number;
  /** The lines its pin covers, `"53-54"`, or `null` when it anchors nothing. */
  anchor: string | null;
  scope: "block" | "section";
  /** Slug of its section, `""` before the first heading. */
  section: string;
  pin?: string;
  status: "current" | "changed" | "unpinned";
  /** Its fields, or `null` when the payload is not one JSON object. */
  data: Record<string, unknown> | null;
}

export function statementView(s: PageStatement): StatementView {
  return {
    line: s.line,
    anchor: anchorText(s),
    scope: s.scope,
    section: s.section,
    ...(s.pin !== undefined ? { pin: s.pin } : {}),
    status: s.status,
    data: s.data ?? null,
  };
}
