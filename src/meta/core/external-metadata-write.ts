/**
 * The manifest splice writer: rewrite one owned value for one document entry
 * of an external-metadata manifest (proposal 0037), and change no other byte.
 *
 * `manni cite` keeps a page's `citations` in a manifest and is the first
 * writer of one. `meta fill` and `meta query` stay read-only on manifests and
 * never call this. It is text in, text out: the caller reads and writes the
 * file.
 *
 * The design is the one `frontmatter-write.ts` uses for TOML. The document is
 * parsed once for its node ranges, and exactly one range of the original text
 * is replaced. So everything outside that range survives by construction
 * rather than by careful re-emission: comments, key order, quoting, blank
 * lines, and the line endings. Three edits are possible:
 *
 *  - **Replace.** The key is present in the entry. Its value's text is
 *    replaced by the new value as block YAML at the key's indentation.
 *    Comments inside the old value go with it, since they described it. A
 *    comment on the key's own line stays.
 *  - **Insert.** The entry is present and the key is not. The key is added
 *    after the entry's last line, at the indentation of its other keys.
 *  - **Append.** The entry is absent. It is added after the last entry, keyed
 *    by path, or by the join value when the manifest joins on a field (0039),
 *    and spaced from the one before it the way the others are.
 *
 * Every result is read back before it is returned, and the entry's key must
 * deep-equal the value while every other value is unchanged. A serializer
 * bug, or a value YAML cannot hold, is then a refusal rather than a damaged
 * manifest.
 */
import { posix } from "node:path";
import {
  LineCounter,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type Document,
  type Pair,
  type YAMLMap,
} from "yaml";
import { DocmetaError } from "../types.js";
import { deepEqual } from "../extractors/patch-util.js";
import { FILE_SCHEMA_KEY } from "./resolve-schema.js";
import { PATH_JOIN } from "./external-metadata.js";

export interface SpliceManifestOptions {
  /**
   * The document entry: its path relative to the config's directory, or its
   * value of the join field when `join` names one. A path entry matches
   * however the manifest spells it (`./docs/a.md` is `docs/a.md`); a join
   * value matches exactly.
   */
  entry: string;
  /** The owned key to write. */
  key: string;
  /** The value to write. Mappings and lists are written in block style. */
  value: unknown;
  /** `path` (the default) or the frontmatter field the manifest joins on. */
  join?: string;
  /** The manifest as the run reports it, for error messages. */
  file?: string;
}

export interface SplicedManifest {
  /** The whole manifest, with the one value rewritten. */
  text: string;
  /** 1-based line where the written value now starts. */
  line: number;
}

/** How the manifest lays itself out, so a new value matches its neighbours. */
interface Style {
  /** Spaces per nesting level. */
  step: number;
  /** Whether a list under a key is indented past it (`key:\n  - a`). */
  indentSeq: boolean;
  eol: string;
}

/** One replacement of the original text. */
interface Edit {
  start: number;
  end: number;
  insert: string;
}

type Range = [number, number, number];

/**
 * Rewrite `options.key` of `options.entry` in the manifest `text` to
 * `options.value`, and return the new text and the line the value starts on.
 *
 * Throws `DocmetaError`, and never returns a partial result, when:
 *  - the text is not valid YAML, or its top level is not a mapping;
 *  - the entry is named twice, or is not a mapping;
 *  - the key is set twice in the entry, or is `$schema`;
 *  - the value is `undefined`;
 *  - the key or entry is absent and would go into a flow mapping that has
 *    members (`{ jira: A }`), which this writer does not add to;
 *  - the key is written as an explicit `? key`;
 *  - the result does not read back as written.
 */
export function spliceManifestValue(
  text: string,
  options: SpliceManifestOptions,
): SplicedManifest {
  const { entry, key, value, file } = options;
  const join = options.join ?? PATH_JOIN;
  const at = (line?: number): string => {
    const name = file === undefined ? "Manifest" : `Manifest ${file}`;
    if (line === undefined) return name;
    return file === undefined ? `${name} line ${String(line)}` : `${name}:${String(line)}`;
  };

  if (key === FILE_SCHEMA_KEY) {
    throw new DocmetaError(
      `${at()}: refusing to write "${FILE_SCHEMA_KEY}" for "${entry}"; a manifest never chooses the schema a document is judged by. Use "overrides" in the config.`,
    );
  }
  if (value === undefined) {
    throw new DocmetaError(`${at()}: refusing to write "${key}" for "${entry}" with no value.`);
  }

  const eol = detectEol(text);
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  const problem = doc.errors[0];
  if (problem) {
    throw new DocmetaError(`${at()} is not valid YAML: ${problem.message}`);
  }
  const keyLine = (node: unknown): number | undefined => {
    const r = rangeOf(node);
    return r ? lc.linePos(r[0]).line : undefined;
  };
  const same =
    join === PATH_JOIN
      ? (a: string, b: string) => posix.normalize(a) === posix.normalize(b)
      : (a: string, b: string) => a === b;

  const root = doc.contents;
  let spelled = entry;
  let edit: Edit;
  if (root === null || (isScalar(root) && root.value === null && emptySource(text, root))) {
    edit = startManifest(text, entry, key, value, eol);
  } else if (!isMap(root)) {
    throw new DocmetaError(
      `${at()}: the manifest must be a mapping from document ${join === PATH_JOIN ? "path" : `"${join}"`} to owned keys.`,
    );
  } else {
    const style = detectStyle(text, root, eol);
    const matches = root.items.filter((p) => same(keyString(p.key), entry));
    const [first, second] = matches;
    if (first && second) {
      throw new DocmetaError(
        `${at(keyLine(second.key))}: "${keyString(second.key)}" is named twice (first at line ${String(keyLine(first.key) ?? "?")}). Merge the two entries into one.`,
      );
    }
    if (first === undefined) {
      if (root.flow === true && root.items.length > 0) {
        throw new DocmetaError(
          `${at()}: the manifest is a flow mapping ({ … }), which this writer does not add entries to. Rewrite it in block style.`,
        );
      }
      edit = appendEntry(text, root, entry, key, value, style);
    } else {
      spelled = keyString(first.key);
      const where = at(keyLine(first.key));
      const v = first.value;
      if (!isMap(v)) {
        throw new DocmetaError(`${where}: "${spelled}" must be a mapping of owned keys to values.`);
      }
      const hits = v.items.filter((kv) => keyString(kv.key) === key);
      const [hit, again] = hits;
      if (hit && again) {
        throw new DocmetaError(
          `${at(keyLine(again.key))}: "${spelled}" sets "${key}" twice (first at line ${String(keyLine(hit.key) ?? "?")}). Remove one.`,
        );
      }
      const flowRefusal = () =>
        new DocmetaError(
          `${where}: "${spelled}" is a flow mapping ({ … }), which this writer does not add keys to. Rewrite the entry in block style.`,
        );
      const formRefusal = () =>
        new DocmetaError(
          `${where}: "${spelled}" writes a key in a form this writer does not edit. Write it as "${key}: …".`,
        );
      // Each of these answers `undefined` for a shape it will not edit: a
      // flow mapping with members, or a key written as an explicit `? key`.
      let made: Edit | undefined;
      if (v.flow === true) {
        if (hit) made = replaceFlowValue(text, hit, value);
        else if (v.items.length === 0) made = fillEmptyEntry(text, first, key, value, style);
        else throw flowRefusal();
        if (!made) throw hit ? flowRefusal() : formRefusal();
      } else {
        made = hit
          ? replaceBlockValue(text, hit, value, style)
          : insertKey(text, v, key, value, style);
        if (!made) throw formRefusal();
      }
      edit = made;
    }
  }

  const out = text.slice(0, edit.start) + edit.insert + text.slice(edit.end);
  const line = readBack(doc, out, spelled, key, value, (why) =>
    new DocmetaError(
      `${at()}: writing "${key}" for "${entry}" did not read back as written, so nothing was written. ${why}`,
    ),
  );
  return { text: out, line };
}

/** An empty manifest (no text, only comments, or a bare `---`): the first entry. */
function startManifest(text: string, entry: string, key: string, value: unknown, eol: string): Edit {
  const style: Style = { step: 2, indentSeq: true, eol };
  const block = blockLines({ [entry]: { [key]: value } }, 0, style);
  let insert: string;
  if (text === "" || text.endsWith("\n")) insert = block + eol;
  else insert = eol + block;
  return { start: text.length, end: text.length, insert };
}

/** A new entry after the last one, or in place of an empty `{}` manifest. */
function appendEntry(
  text: string,
  root: YAMLMap,
  entry: string,
  key: string,
  value: unknown,
  style: Style,
): Edit {
  const body = { [entry]: { [key]: value } };
  if (root.flow === true) {
    // `{}` and nothing else: the refusal for a flow mapping with members ran first.
    const r = rangeOf(root);
    const start = r ? r[0] : text.length;
    const end = contentEnd(text, root) ?? start;
    return { start, end, insert: blockLines(body, colOf(text, start), style) };
  }
  const firstKey = rangeOf(root.items[0]?.key);
  const col = firstKey ? colOf(text, firstKey[0]) : 0;
  const pos = lineEnd(text, contentEnd(text, root) ?? text.length);
  const last = root.items.at(-1);
  const spaced =
    root.items.length > 1 && isNode(last?.key) && last.key.spaceBefore === true;
  return {
    start: pos,
    end: pos,
    insert: style.eol + (spaced ? style.eol : "") + blockLines(body, col, style),
  };
}

/** A key the entry does not have, after the entry's last line. */
function insertKey(
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

/** `docs/a.md: {}`: the empty flow mapping becomes a block one holding the key. */
function fillEmptyEntry(
  text: string,
  entryPair: Pair,
  key: string,
  value: unknown,
  style: Style,
): Edit | undefined {
  const start = colonEnd(text, entryPair);
  const keyRange = rangeOf(entryPair.key);
  const end = contentEnd(text, entryPair.value);
  if (start === undefined || !keyRange || end === undefined) return undefined;
  const col = colOf(text, keyRange[0]) + style.step;
  return { start, end, insert: style.eol + blockLines({ [key]: value }, col, style) };
}

/**
 * A present key in a block mapping: everything from its `:` to the end of its
 * value is the new value. A comment on the key's own line is kept, and the
 * value then starts on the next line.
 */
function replaceBlockValue(text: string, pair: Pair, value: unknown, style: Style): Edit | undefined {
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

/** A present key in a flow mapping: the value, and only the value, in flow style. */
function replaceFlowValue(text: string, pair: Pair, value: unknown): Edit | undefined {
  const r = rangeOf(pair.value);
  if (!r || emptySource(text, pair.value)) return undefined;
  const end = contentEnd(text, pair.value) ?? r[1];
  return { start: r[0], end, insert: flowText(value) };
}

/**
 * Re-parse `out` and check it says what was asked: the entry's key deep-equals
 * `value`, and every other value is what it was. Returns the value's line.
 */
function readBack(
  before: Document,
  out: string,
  spelled: string,
  key: string,
  value: unknown,
  fail: (why: string) => DocmetaError,
): number {
  const lc = new LineCounter();
  const after = parseDocument(out, { lineCounter: lc, uniqueKeys: false });
  const problem = after.errors[0];
  if (problem) throw fail(`The result is not valid YAML: ${problem.message}`);

  const was: unknown = before.toJS({ maxAliasCount: 100 });
  const now: unknown = after.toJS({ maxAliasCount: 100 });
  const wasRoot = isRecord(was) ? was : {};
  const wasEntry = wasRoot[spelled];
  const expected = {
    ...wasRoot,
    [spelled]: { ...(isRecord(wasEntry) ? wasEntry : {}), [key]: value },
  };
  const nowEntry = isRecord(now) ? now[spelled] : undefined;
  if (!isRecord(nowEntry) || !deepEqual(nowEntry[key], value)) {
    throw fail(
      "The value reads back differently. A Date, an undefined member, or another value YAML cannot hold does not survive the trip.",
    );
  }
  if (!deepEqual(now, expected)) {
    throw fail("Another value in the manifest would have changed.");
  }

  const root = after.contents;
  const pair = isMap(root) ? root.items.find((p) => keyString(p.key) === spelled) : undefined;
  const entryMap = pair?.value;
  const kv = isMap(entryMap) ? entryMap.items.find((p) => keyString(p.key) === key) : undefined;
  const r = rangeOf(kv?.value) ?? rangeOf(kv?.key);
  if (!r) throw fail("The written value could not be found again.");
  return lc.linePos(r[0]).line;
}

// ---------------------------------------------------------------------------
// Serialization. `stringify` lays the value out; the splice only indents it.
// `lineWidth: 0` disables folding, so a long value stays on its line.
// ---------------------------------------------------------------------------

/** `{ key: value }` as block lines at column `col`, joined with the manifest's line ending. */
function blockLines(pair: Record<string, unknown>, col: number, style: Style): string {
  const s = stringify(pair, { lineWidth: 0, indent: style.step, indentSeq: style.indentSeq });
  return indentLines(s.replace(/\n$/, "").split("\n"), col, 0).join(style.eol);
}

/**
 * The text that follows `key:` for `value`, for a key at column `col`: ` x`
 * for a scalar or an empty collection, or a line break and the block for a
 * mapping or a list with members.
 */
function afterColon(value: unknown, col: number, style: Style): string {
  const s = stringify({ k: value }, { lineWidth: 0, indent: style.step, indentSeq: style.indentSeq });
  const lines = s.replace(/\n$/, "").slice("k:".length).split("\n");
  return indentLines(lines, col, 1).join(style.eol);
}

/** Every non-empty line from index `from` on, shifted right by `col` spaces. */
function indentLines(lines: string[], col: number, from: number): string[] {
  const pad = " ".repeat(col);
  return lines.map((l, i) => (i < from || l === "" ? l : pad + l));
}

/** `value` on one line, in flow style: JSON when YAML's flow form would wrap. */
function flowText(value: unknown): string {
  const s = stringify(value, { lineWidth: 0, collectionStyle: "flow" }).replace(/\n$/, "");
  return s.includes("\n") ? JSON.stringify(value) : s;
}

// ---------------------------------------------------------------------------
// Positions.
// ---------------------------------------------------------------------------

/** The manifest's line ending, from its first line break; LF when it has none. */
function detectEol(text: string): string {
  const i = text.indexOf("\n");
  return i > 0 && text.charAt(i - 1) === "\r" ? "\r\n" : "\n";
}

/** The indentation step and list style the manifest already uses. */
function detectStyle(text: string, root: YAMLMap, eol: string): Style {
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
function contentEnd(text: string, node: unknown): number | undefined {
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
function colonEnd(text: string, pair: Pair): number | undefined {
  const r = rangeOf(pair.key);
  if (!r) return undefined;
  let i = r[1];
  while (text.charAt(i) === " " || text.charAt(i) === "\t") i++;
  return text.charAt(i) === ":" ? i + 1 : undefined;
}

/** The offset of the line break ending the line `i` is on, or the end of the text. */
function lineEnd(text: string, i: number): number {
  const j = text.indexOf("\n", i);
  if (j < 0) return text.length;
  return j > 0 && text.charAt(j - 1) === "\r" ? j - 1 : j;
}

/** 0-based column of `offset`, not counting a byte-order mark. */
function colOf(text: string, offset: number): number {
  if (offset === 0) return 0;
  let start = text.lastIndexOf("\n", offset - 1) + 1;
  if (start === 0 && text.startsWith("﻿")) start = 1;
  return offset - start;
}

function rangeOf(node: unknown): Range | undefined {
  return isNode(node) ? (node.range ?? undefined) : undefined;
}

/** A node with no text of its own: `key:` with nothing after it. */
function emptySource(text: string, node: unknown): boolean {
  const r = rangeOf(node);
  return !r || text.slice(r[0], r[1]).trim() === "";
}

/** A mapping key as the loader compares it. */
function keyString(key: unknown): string {
  return isScalar(key) ? String(key.value) : String(key);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
