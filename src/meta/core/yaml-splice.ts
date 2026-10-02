/**
 * Formatting-preserving edits to YAML text. Each edit replaces one range of
 * the original text and leaves every other byte as it was: comments, key
 * order, quoting, blank lines and line endings.
 *
 * The text is parsed once for its node ranges, and an edit is computed from
 * those ranges. Two writers use these primitives. The manifest writer
 * (`external-metadata-write.ts`) edits one entry of a manifest, and the
 * frontmatter writer (`frontmatter-write.ts`) edits a page's root mapping.
 */
import {
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  stringify,
  type Pair,
  type YAMLMap,
} from "yaml";

/** How a document lays itself out, so a new value matches its neighbours. */
export interface Style {
  /** Spaces per nesting level. */
  step: number;
  /** Whether a list under a key is indented past it (`key:\n  - a`). */
  indentSeq: boolean;
  eol: string;
}

/** One replacement of the original text. */
export interface Edit {
  start: number;
  end: number;
  insert: string;
}

type Range = [number, number, number];

/** A key the mapping does not have, after the mapping's last line. */
export function insertKey(
  text: string,
  entryMap: YAMLMap,
  key: string,
  value: unknown,
  style: Style,
): Edit | undefined {
  const firstKey = rangeOf(entryMap.items[0]?.key);
  const end = contentEnd(text, entryMap);
  if (!firstKey || end === undefined) return undefined;
  const pos = lineEnd(text, end);
  return {
    start: pos,
    end: pos,
    insert: style.eol + blockLines({ [key]: value }, colOf(text, firstKey[0]), style),
  };
}

/**
 * A present key in a block mapping: everything from its `:` to the end of its
 * value is the new value. A comment on the key's own line is kept, and the
 * value then starts on the next line.
 */
export function replaceBlockValue(
  text: string,
  pair: Pair,
  value: unknown,
  style: Style,
): Edit | undefined {
  const colon = colonEnd(text, pair);
  const keyRange = rangeOf(pair.key);
  if (colon === undefined || !keyRange) return undefined;
  const keyCol = colOf(text, keyRange[0]);
  let start = colon;
  let ownLine = false;
  let i = colon;
  while (text.charAt(i) === " " || text.charAt(i) === "\t") i++;
  if (text.charAt(i) === "#") {
    start = lineEnd(text, i);
    ownLine = true;
  }
  const old = pair.value;
  const oldEnd =
    isScalar(old) && old.value === null && emptySource(text, old)
      ? start
      : (contentEnd(text, old) ?? start);
  const end = Math.max(start, oldEnd);
  let insert = afterColon(value, keyCol, style);
  if (ownLine && !insert.startsWith(style.eol)) {
    insert = style.eol + " ".repeat(keyCol + style.step) + insert.trimStart();
  }
  return { start, end, insert };
}

/**
 * A present key whose value is written in flow style: the value, and only the
 * value, in flow style. `padded` chooses `[ a ]` or `[a]`; left out, the
 * `yaml` package's default applies.
 */
export function replaceFlowValue(
  text: string,
  pair: Pair,
  value: unknown,
  padded?: boolean,
): Edit | undefined {
  const r = rangeOf(pair.value);
  if (!r || emptySource(text, pair.value)) return undefined;
  const end = contentEnd(text, pair.value) ?? r[1];
  return { start: r[0], end, insert: flowText(value, padded) };
}

/**
 * The lines to cut to remove a key: from the start of the line `from` is on
 * through the line break after the line `to` is on. On the last line, with no
 * break after it, the break before it goes instead.
 */
export function keyLines(
  text: string,
  from: number,
  to: number,
  eol: string,
): { start: number; end: number } {
  let start = text.lastIndexOf("\n", from - 1) + 1;
  let end = lineEnd(text, to);
  if (text.startsWith(eol, end)) end += eol.length;
  else if (start >= eol.length) start -= eol.length;
  return { start, end };
}

/** A present key in a block mapping, removed with its value's lines. */
export function removeKey(text: string, pair: Pair, eol: string): Edit | undefined {
  const from = rangeOf(pair.key);
  const to = contentEnd(text, pair.value) ?? contentEnd(text, pair.key);
  if (!from || to === undefined) return undefined;
  const { start, end } = keyLines(text, from[0], to, eol);
  return { start, end, insert: "" };
}

// ---------------------------------------------------------------------------
// Serialization. `stringify` lays the value out; the splice only indents it.
// `lineWidth: 0` disables folding, so a long value stays on its line.
// ---------------------------------------------------------------------------

/** `{ key: value }` as block lines at column `col`, joined with the document's line ending. */
export function blockLines(pair: Record<string, unknown>, col: number, style: Style): string {
  const s = stringify(pair, { lineWidth: 0, indent: style.step, indentSeq: style.indentSeq });
  return indentLines(s.replace(/\n$/, "").split("\n"), col, 0).join(style.eol);
}

/**
 * The text that follows `key:` for `value`, for a key at column `col`: ` x`
 * for a scalar or an empty collection, or a line break and the block for a
 * mapping or a list with members.
 */
export function afterColon(value: unknown, col: number, style: Style): string {
  const s = stringify({ k: value }, { lineWidth: 0, indent: style.step, indentSeq: style.indentSeq });
  const lines = s.replace(/\n$/, "").slice("k:".length).split("\n");
  return indentLines(lines, col, 1).join(style.eol);
}

/** Every non-empty line from index `from` on, shifted right by `col` spaces. */
export function indentLines(lines: string[], col: number, from: number): string[] {
  const pad = " ".repeat(col);
  return lines.map((l, i) => (i < from || l === "" ? l : pad + l));
}

/** `value` on one line, in flow style: JSON when YAML's flow form would wrap. */
export function flowText(value: unknown, padded?: boolean): string {
  const s = stringify(value, {
    lineWidth: 0,
    collectionStyle: "flow",
    ...(padded === undefined ? {} : { flowCollectionPadding: padded }),
  }).replace(/\n$/, "");
  return s.includes("\n") ? JSON.stringify(value) : s;
}

// ---------------------------------------------------------------------------
// Positions.
// ---------------------------------------------------------------------------

/** The text's line ending, from its first line break; LF when it has none. */
export function detectEol(text: string): string {
  const i = text.indexOf("\n");
  return i > 0 && text.charAt(i - 1) === "\r" ? "\r\n" : "\n";
}

/** The indentation step and list style the document already uses. */
export function detectStyle(text: string, root: YAMLMap, eol: string): Style {
  let step = 2;
  for (const pair of root.items) {
    const v = pair.value;
    const entryKey = rangeOf(pair.key);
    const ownedKey = isMap(v) && v.flow !== true ? rangeOf(v.items[0]?.key) : undefined;
    if (entryKey && ownedKey) {
      const d = colOf(text, ownedKey[0]) - colOf(text, entryKey[0]);
      if (d > 0) {
        step = d;
        break;
      }
    }
  }
  return { step, indentSeq: seqIndented(text, root) ?? true, eol };
}

/** Whether the first block list under a key is indented past it; undefined when there is none. */
function seqIndented(text: string, node: unknown): boolean | undefined {
  if (isMap(node)) {
    for (const pair of node.items) {
      const v = pair.value;
      if (isSeq(v) && v.flow !== true && v.items.length > 0) {
        const k = rangeOf(pair.key);
        const s = rangeOf(v);
        if (k && s) return colOf(text, s[0]) > colOf(text, k[0]);
      }
      const inner = seqIndented(text, v);
      if (inner !== undefined) return inner;
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      const inner = seqIndented(text, item);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

/**
 * Where a node's own text ends: the last character of its last scalar or
 * flow collection. A block collection's range runs on through the line break
 * and any comments after its last item, which belong to what follows.
 */
export function contentEnd(text: string, node: unknown): number | undefined {
  if (isMap(node) && node.flow !== true) {
    const last = node.items.at(-1);
    if (last) return contentEnd(text, last.value) ?? contentEnd(text, last.key);
  } else if (isSeq(node) && node.flow !== true) {
    const last: unknown = node.items.at(-1);
    if (last !== undefined) {
      return isPair(last)
        ? (contentEnd(text, last.value) ?? contentEnd(text, last.key))
        : contentEnd(text, last);
    }
  }
  const r = rangeOf(node);
  if (!r) return undefined;
  let end = r[1];
  while (end > r[0] && /\s/.test(text.charAt(end - 1))) end--;
  return end;
}

/** Just past the `:` that follows a pair's key; undefined for an explicit `? key`. */
export function colonEnd(text: string, pair: Pair): number | undefined {
  const r = rangeOf(pair.key);
  if (!r) return undefined;
  let i = r[1];
  while (text.charAt(i) === " " || text.charAt(i) === "\t") i++;
  return text.charAt(i) === ":" ? i + 1 : undefined;
}

/** The offset of the line break ending the line `i` is on, or the end of the text. */
export function lineEnd(text: string, i: number): number {
  const j = text.indexOf("\n", i);
  if (j < 0) return text.length;
  return j > 0 && text.charAt(j - 1) === "\r" ? j - 1 : j;
}

/** 0-based column of `offset`, not counting a byte-order mark. */
export function colOf(text: string, offset: number): number {
  if (offset === 0) return 0;
  let start = text.lastIndexOf("\n", offset - 1) + 1;
  if (start === 0 && text.startsWith("﻿")) start = 1;
  return offset - start;
}

export function rangeOf(node: unknown): Range | undefined {
  return isNode(node) ? (node.range ?? undefined) : undefined;
}

/** A node with no text of its own: `key:` with nothing after it. */
export function emptySource(text: string, node: unknown): boolean {
  const r = rangeOf(node);
  return !r || text.slice(r[0], r[1]).trim() === "";
}

/** A mapping key as the loader compares it. */
export function keyString(key: unknown): string {
  return isScalar(key) ? String(key.value) : String(key);
}
