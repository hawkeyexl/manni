/**
 * The join behind `manni site annotate` (proposal 0095): one built page, its
 * chunk rows, and what each pin and statement is joined to.
 *
 * Lines first: a block stamped by `@hawkeyexl/manni/site/rehype` whose lines
 * overlap the claim. Then text: the claim's rendered text in exactly one run
 * of adjacent blocks. A tie is never broken. Statements join by lines alone.
 *
 * The page is never re-serialized. Each change is an edit at a source offset
 * parse5 reports, so every byte annotate does not touch stays as the
 * framework wrote it.
 */
import { resolve } from "node:path";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { toString as mdastToString } from "mdast-util-to-string";
import { unified } from "unified";
import type { ChunkRow, PassageStatement, PinItem, ProvenanceRecord } from "../../graph/runtime/chunks.js";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

export const STAMP = "data-manni-src";
export const ISLAND_ID = "manni-provenance";

/** The elements the text step compares; a table row is one, not its cells. */
const TEXT_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "blockquote", "tr", "dt", "dd", "figcaption"]);
const NO_TEXT = new Set(["script", "style", "template", "head"]);
/** Shorter than this, a block inside a longer claim is too common to count. */
const MIN_PART = 12;

export interface PageJoinInput {
  html: string;
  /** The page source, absolute: stamps naming it join. */
  file: string;
  /** The directory stamps resolve from: where the framework built. */
  stampBase: string;
  /** The file line of body line 1. */
  bodyLine: number;
  /** The rendered, normalized text of body lines `start`-`end`. */
  claimText: (start: number, end: number) => string;
  /** The page's chunk rows. */
  rows: readonly ChunkRow[];
  /** The docs commit, or `null` outside git. */
  commit: string | null;
}

export type UnplacedReason = "repeated-text" | "no-block";

export interface PageJoin {
  html: string;
  pins: { total: number; placed: number };
  statements: { total: number; placed: number };
  unplaced: { kind: "pin" | "statement"; ids: string[]; reason: UnplacedReason }[];
  /** Blocks whose state is `drifted`, and the error pins on them. */
  drifted: { blocks: number; ids: string[] };
  /** Blocks and headings that carry a statement's verification. */
  verified: number;
}

interface Stamp {
  file: string;
  start: number;
  end: number;
}

/** What a placed element gains, in the order its attributes are written. */
interface Marks {
  node?: string;
  pins: string[];
  drifted: boolean;
  verified?: string;
  verifiedBy?: string;
  statement?: PassageStatement["status"];
  appliesTo?: string;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

// ---- reading the page -----------------------------------------------------------

function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function attr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

function textOf(node: Node): string {
  if (node.nodeName === "#text") return "value" in node ? node.value : "";
  if (isElement(node) && NO_TEXT.has(node.tagName)) return "";
  return children(node).map(textOf).join("");
}

function parseStamp(value: string, base: string): Stamp | undefined {
  const m = /^(.*):(\d+)-(\d+)$/.exec(value);
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return undefined;
  return { file: resolve(base, m[1]), start: Number(m[2]), end: Number(m[3]) };
}

/** Every element in document order, with its parent. */
function walk(root: Node): { all: Element[]; parent: Map<Element, Element> } {
  const all: Element[] = [];
  const parent = new Map<Element, Element>();
  const visit = (node: Node, up: Element | undefined): void => {
    let next = up;
    if (isElement(node)) {
      all.push(node);
      if (up !== undefined) parent.set(node, up);
      next = node;
    }
    if (isElement(node) && node.tagName === "template") return;
    for (const c of children(node)) visit(c, next);
  };
  visit(root, undefined);
  return { all, parent };
}

/**
 * Text compared without whitespace, and with the typography a renderer adds
 * (smart quotes, dashes, an ellipsis) undone on both sides.
 */
export function comparable(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, "---")
    .replace(/–/g, "--")
    .replace(/…/g, "...")
    .replace(/\s+/g, "");
}

const processor = unified().use(remarkParse).use(remarkGfm);
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Markdown lines as the reader sees them: rendered to text, with no HTML or
 * JSX. A table row alone is no table to a parser, so its pipes go first.
 */
export function renderedText(lines: readonly string[]): string {
  const source = lines
    .filter((l) => !(TABLE_DELIMITER.test(l) && l.includes("-") && l.includes("|")))
    .map((l) => (TABLE_ROW.test(l) ? l.replace(/\|/g, " ") : l))
    .join("\n");
  return comparable(mdastToString(processor.parse(source), { includeHtml: false }));
}

// ---- the records ------------------------------------------------------------------

function range(spec: string): { start: number; end: number } | undefined {
  const m = /^(\d+)(?:-(\d+))?$/.exec(spec.trim());
  if (m?.[1] === undefined) return undefined;
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  return end < start ? undefined : { start, end };
}

interface Row {
  id: string;
  start: number;
  end: number;
  section: boolean;
  metadata: Record<string, unknown>;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "string" ? [value] : [];

function tools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const tool = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)["tool"] : undefined;
    if (typeof tool === "string" && !out.includes(tool)) out.push(tool);
  }
  return out;
}

/** The records of one page, in `lines` order: the outer passage first. */
export function pageRecords(rows: readonly ChunkRow[]): ProvenanceRecord[] {
  return [...rows]
    .map((r) => ({ r, span: range(r.lines) ?? { start: 0, end: 0 } }))
    .sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0))
    .map((x) => x.r.provenance);
}

/** Each pin on the page once, in the page's order: the whole-page passage holds every one. */
function pinsOf(rows: readonly ChunkRow[]): PinItem[] {
  const seen = new Set<string>();
  const out: PinItem[] = [];
  for (const record of pageRecords(rows)) {
    for (const item of record.pins.items) {
      const key = JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function statementsOf(rows: readonly ChunkRow[]): PassageStatement[] {
  const seen = new Set<string>();
  const out: PassageStatement[] = [];
  for (const record of pageRecords(rows)) {
    for (const s of record.statements) {
      const key = JSON.stringify(s);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out.sort((a, b) => (range(a.lines)?.start ?? 0) - (range(b.lines)?.start ?? 0));
}

// ---- the join ---------------------------------------------------------------------

export function joinPage(input: PageJoinInput): PageJoin {
  const { html } = input;
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const { all, parent } = walk(doc);

  const stamps = new Map<Element, Stamp>();
  for (const el of all) {
    const value = attr(el, STAMP);
    const stamp = value === undefined ? undefined : parseStamp(value, input.stampBase);
    if (stamp !== undefined && stamp.file === input.file) stamps.set(el, stamp);
  }

  const main = all.find((e) => e.tagName === "main");
  const body = all.find((e) => e.tagName === "body");
  const scope = main ?? body;
  const inScope = (el: Element): boolean => {
    for (let at: Element | undefined = el; at !== undefined; at = parent.get(at)) if (at === scope) return true;
    return scope === undefined;
  };
  const textual = all.filter((e) => TEXT_BLOCKS.has(e.tagName) && inScope(e));
  const nested = new Set<Element>();
  for (const el of textual) for (let up = parent.get(el); up !== undefined; up = parent.get(up)) nested.add(up);
  const blocks = textual.filter((e) => !nested.has(e)).map((el) => ({ el, text: comparable(textOf(el)) }));

  /** The innermost stamped elements whose lines overlap `start`-`end` (file lines). */
  const byLines = (start: number, end: number): Element[] => {
    const hit = [...stamps].filter(([, s]) => s.start <= end && s.end >= start).map(([el]) => el);
    const outer = new Set<Element>();
    for (const el of hit) for (let up = parent.get(el); up !== undefined; up = parent.get(up)) outer.add(up);
    return hit.filter((el) => !outer.has(el));
  };

  /** The single run of blocks holding `text`, or why there is none. */
  const byText = (text: string): Element[] | UnplacedReason => {
    if (text === "") return "no-block";
    const holding = blocks.filter((b) => b.text.includes(text));
    if (holding.length === 1) return holding.map((b) => b.el);
    if (holding.length > 1) return "repeated-text";
    const runs: Element[][] = [];
    let run: Element[] = [];
    for (const b of blocks) {
      if (b.text.length >= MIN_PART && text.includes(b.text)) run.push(b.el);
      else if (run.length > 0) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length > 0) runs.push(run);
    if (runs.length === 1) return runs[0] ?? "no-block";
    return runs.length === 0 ? "no-block" : "repeated-text";
  };

  const rows: Row[] = input.rows.flatMap((r) => {
    const span = range(r.lines);
    return span === undefined ? [] : [{ id: r.id, ...span, section: r.id.includes("#"), metadata: r.metadata }];
  });
  const docId = rows.find((r) => !r.section)?.id ?? input.rows[0]?.id.split("#")[0] ?? "";
  const toFile = (line: number): number => line + input.bodyLine - 1;
  /** The innermost passage holding body line `line`. */
  const nodeAt = (line: number): string => {
    const holding = rows.filter((r) => r.start <= line && r.end >= line);
    holding.sort((a, b) => b.start - a.start || a.end - b.end);
    return holding[0]?.id ?? docId;
  };

  const marks = new Map<Element, Marks>();
  const marksOf = (el: Element): Marks => {
    let m = marks.get(el);
    if (m === undefined) {
      m = { pins: [], drifted: false };
      marks.set(el, m);
    }
    return m;
  };

  const result: PageJoin = {
    html,
    pins: { total: 0, placed: 0 },
    statements: { total: 0, placed: 0 },
    unplaced: [],
    drifted: { blocks: 0, ids: [] },
    verified: 0,
  };
  const unplaced = (kind: "pin" | "statement", reason: UnplacedReason, id: string): void => {
    const entry = result.unplaced.find((u) => u.kind === kind && u.reason === reason);
    if (entry === undefined) result.unplaced.push({ kind, ids: [id], reason });
    else entry.ids.push(id);
  };

  // Pins.
  const errorIds = new Map<Element, string[]>();
  for (const [i, pin] of pinsOf(input.rows).entries()) {
    result.pins.total += 1;
    const claim = range(pin.claim);
    const id = pin.id ?? `#${String(i + 1)}`;
    if (claim === undefined) {
      unplaced("pin", "no-block", id);
      continue;
    }
    let placed = byLines(toFile(claim.start), toFile(claim.end));
    if (placed.length === 0) {
      const found = byText(input.claimText(claim.start, claim.end));
      if (typeof found === "string") {
        unplaced("pin", found, id);
        continue;
      }
      placed = found;
    }
    result.pins.placed += 1;
    const error = pin.findings.some((f) => f.severity === "error");
    for (const el of placed) {
      const m = marksOf(el);
      m.node ??= nodeAt(claim.start);
      if (!m.pins.includes(id)) m.pins.push(id);
      if (error) {
        m.drifted = true;
        const ids = errorIds.get(el) ?? [];
        ids.push(id);
        errorIds.set(el, ids);
      }
    }
  }

  // Statements: a heading's describes its section, any other is a graph:Block.
  const blocksIn = new Map<string, number>();
  for (const statement of statementsOf(input.rows)) {
    result.statements.total += 1;
    const span = range(statement.lines);
    const heading = span && rows.find((r) => r.section && r.start >= span.start && r.start <= span.end);
    let node: string;
    if (heading) node = heading.id;
    else {
      const owner = rows
        .filter((r) => r.section && span !== undefined && r.start <= span.start)
        .sort((a, b) => b.start - a.start)[0];
      const key = owner?.id ?? `${docId}#`;
      const n = (blocksIn.get(key) ?? 0) + 1;
      blocksIn.set(key, n);
      node = `${key}.${String(n)}`;
    }
    const placed = span === undefined ? [] : byLines(toFile(span.start), toFile(span.end));
    if (placed.length === 0) {
      unplaced("statement", "no-block", statement.lines);
      continue;
    }
    result.statements.placed += 1;
    const lastVerified = statement.data["last-verified"];
    const by = tools(statement.data["verified-by"]);
    const appliesTo = heading ? strings(heading.metadata["applies-to"]) : [];
    for (const el of placed) {
      const m = marksOf(el);
      m.node = node;
      if (typeof lastVerified === "string") m.verified = lastVerified;
      if (by.length > 0) m.verifiedBy = by.join(" ");
      m.statement = statement.status;
      if (appliesTo.length > 0) m.appliesTo = appliesTo.join(" ");
    }
  }

  const edits: Edit[] = [];
  // Every manni attribute the page carries goes, stamps and an earlier run's marks alike.
  for (const el of all) {
    const at = el.sourceCodeLocation?.attrs;
    if (at === undefined) continue;
    for (const a of el.attrs) {
      const loc = at[a.name];
      if (!a.name.startsWith("data-manni-") || loc === undefined) continue;
      let start = loc.startOffset;
      while (start > 0 && /\s/.test(html[start - 1] ?? "")) start -= 1;
      edits.push({ start, end: loc.endOffset, text: "" });
    }
    if (el.tagName === "script" && attr(el, "id") === ISLAND_ID) {
      const loc = el.sourceCodeLocation;
      if (loc?.startTag !== undefined && loc.endTag !== undefined) {
        const end = html[loc.endTag.endOffset] === "\n" ? loc.endTag.endOffset + 1 : loc.endTag.endOffset;
        edits.push({ start: loc.startTag.startOffset, end, text: "" });
      }
    }
  }

  for (const [el, m] of marks) {
    const pairs: [string, string | undefined][] = [
      ["node", m.node],
      ["pins", m.pins.length > 0 ? m.pins.join(" ") : undefined],
      ["state", m.pins.length > 0 ? (m.drifted ? "drifted" : "current") : undefined],
      ["verified", m.verified],
      ["verified-by", m.verifiedBy],
      ["statement", m.statement],
      ["applies-to", m.appliesTo],
    ];
    insertAttrs(el, pairs, html, edits);
    if (m.drifted) {
      result.drifted.blocks += 1;
      for (const id of errorIds.get(el) ?? []) if (!result.drifted.ids.includes(id)) result.drifted.ids.push(id);
    }
    if (m.statement !== undefined && (m.verified !== undefined || m.verifiedBy !== undefined)) result.verified += 1;
  }

  const records = pageRecords(input.rows);
  const first = records[0];
  const page = scope ?? body;
  if (page !== undefined) {
    insertAttrs(
      page,
      [
        ["commit", input.commit ?? undefined],
        ["last-verified", first?.dates.lastVerified ?? undefined],
      ],
      html,
      edits,
    );
  }

  const island = {
    page: first?.page ?? "",
    commit: input.commit,
    worktree: first?.worktree ?? null,
    dates: first?.dates ?? null,
    records,
  };
  const json = JSON.stringify(island).replace(/</g, "\\u003c");
  const closeBody = body?.sourceCodeLocation?.endTag?.startOffset;
  const at = closeBody ?? html.length;
  edits.push({ start: at, end: at, text: `<script type="application/json" id="${ISLAND_ID}">${json}</script>\n` });

  result.html = applyEdits(html, edits);
  return result;
}

const escapeAttr = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function insertAttrs(el: Element, pairs: [string, string | undefined][], html: string, edits: Edit[]): void {
  const tag = el.sourceCodeLocation?.startTag;
  if (tag === undefined) return;
  const text = pairs
    .filter((p): p is [string, string] => p[1] !== undefined)
    .map(([name, value]) => ` data-manni-${name}="${escapeAttr(value)}"`)
    .join("");
  if (text === "") return;
  const at = html[tag.endOffset - 2] === "/" ? tag.endOffset - 2 : tag.endOffset - 1;
  edits.push({ start: at, end: at, text });
}

function applyEdits(html: string, edits: Edit[]): string {
  // From the end, so each edit's offsets still hold when it is applied.
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = html;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Remove every stamp from a page no record names, so none reaches the deployed site. */
export function stripStamps(html: string): string {
  if (!html.includes(STAMP)) return html;
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const edits: Edit[] = [];
  for (const el of walk(doc).all) {
    const loc = el.sourceCodeLocation?.attrs?.[STAMP];
    if (loc === undefined) continue;
    let start = loc.startOffset;
    while (start > 0 && /\s/.test(html[start - 1] ?? "")) start -= 1;
    edits.push({ start, end: loc.endOffset, text: "" });
  }
  return applyEdits(html, edits);
}

/** The source files a page's stamps name, as written. */
export function stampedFiles(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/data-manni-src="([^"]*):\d+-\d+"/g)) if (m[1] !== undefined) out.add(m[1]);
  return out;
}
