/**
 * The manifest splice writer: rewrite one owned value for one document entry
 * of an external-metadata manifest (proposal 0037), and change no other byte.
 *
 * `manni cite` keeps a page's `citations` in a manifest and is the first
 * writer of one. Since proposal 0047, `meta query` routes a write to an
 * owned key here too, and `renameManifestEntry` follows a `_path` move. It is text in, text out: the caller reads and writes the
 * file.
 *
 * The design is the one `frontmatter-write.ts` uses for TOML. The document is
 * parsed once for its node ranges, and exactly one range of the original text
 * is replaced. So everything outside that range survives by construction
 * rather than by careful re-emission: comments, key order, quoting, blank
 * lines, and the line endings. The primitives live in `yaml-splice.ts`,
 * which the frontmatter writer shares. Three edits are possible:
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
  isScalar,
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
import {
  blockLines,
  colOf,
  colonEnd,
  contentEnd,
  detectEol,
  detectStyle,
  emptySource,
  insertKey,
  keyLines,
  keyString,
  lineEnd,
  rangeOf,
  replaceBlockValue,
  replaceFlowValue,
  type Edit,
  type Style,
} from "./yaml-splice.js";

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

/**
 * The value one document entry holds for one owned key, as the manifest text
 * stands. `undefined` when the entry or the key is absent, and for text that
 * is not a manifest at all.
 *
 * A writer that re-reads its target before replacing it needs this: it tells
 * the writer whether the entry it is about to rewrite is the one it read, or
 * one another process has changed since. Every refusal a malformed manifest
 * deserves is the splice's to raise, so this answers `undefined` rather than
 * throwing, and two `undefined`s compare equal.
 */
export function readManifestValue(
  text: string,
  options: { entry: string; key: string; join?: string },
): unknown {
  const join = options.join ?? PATH_JOIN;
  const doc = parseDocument(text, { uniqueKeys: false });
  if (doc.errors.length > 0) return undefined;
  const root = doc.contents;
  if (!isMap(root)) return undefined;
  const same =
    join === PATH_JOIN
      ? (a: string, b: string) => posix.normalize(a) === posix.normalize(b)
      : (a: string, b: string) => a === b;
  const pair = root.items.find((p) => same(keyString(p.key), options.entry));
  const held = pair?.value;
  if (!isMap(held)) return undefined;
  const kv = held.items.find((p) => keyString(p.key) === options.key);
  const node = kv?.value;
  return isNode(node) ? (node.toJSON() as unknown) : undefined;
}

/**
 * Remove `options.key` from `options.entry` in the manifest `text`, and change
 * no other byte. An entry left with no keys goes too, since the loader refuses
 * an entry that is not a mapping, along with the blank line that spaced it.
 * A manifest, entry or key that is absent is left as it was.
 *
 * Throws `DocmetaError` where `spliceManifestValue` would: invalid YAML, a top
 * level or entry that is not a mapping, an entry named twice, a key set twice.
 * It also refuses a key in a flow mapping with other members, and a result
 * that does not read back with only that key gone.
 */
export function removeManifestKey(
  text: string,
  options: Omit<SpliceManifestOptions, "value">,
): { text: string } {
  const { entry, key, file } = options;
  const join = options.join ?? PATH_JOIN;
  const at = (line?: number): string => {
    const name = file === undefined ? "Manifest" : `Manifest ${file}`;
    if (line === undefined) return name;
    return file === undefined ? `${name} line ${String(line)}` : `${name}:${String(line)}`;
  };

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
  const root = doc.contents;
  if (root === null || (isScalar(root) && root.value === null)) return { text };
  if (!isMap(root)) {
    throw new DocmetaError(
      `${at()}: the manifest must be a mapping from document ${join === PATH_JOIN ? "path" : `"${join}"`} to owned keys.`,
    );
  }
  const same =
    join === PATH_JOIN
      ? (a: string, b: string) => posix.normalize(a) === posix.normalize(b)
      : (a: string, b: string) => a === b;
  const matches = root.items.filter((p) => same(keyString(p.key), entry));
  const [first, second] = matches;
  if (first && second) {
    throw new DocmetaError(
      `${at(keyLine(second.key))}: "${keyString(second.key)}" is named twice (first at line ${String(keyLine(first.key) ?? "?")}). Merge the two entries into one.`,
    );
  }
  if (first === undefined) return { text };
  const spelled = keyString(first.key);
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
  if (hit === undefined) return { text };

  const whole = v.items.length === 1;
  if (!whole && v.flow === true) {
    throw new DocmetaError(
      `${where}: "${spelled}" is a flow mapping ({ … }), which this writer does not remove keys from. Rewrite the entry in block style.`,
    );
  }
  // The lines to cut: from the start of the key's line (the entry's, when
  // the entry goes) through the line break after the value's last line.
  const from = rangeOf(whole ? first.key : hit.key);
  const to = whole ? contentEnd(text, v) : (contentEnd(text, hit.value) ?? contentEnd(text, hit.key));
  if (!from || to === undefined) {
    throw new DocmetaError(
      `${where}: "${spelled}" writes a key in a form this writer does not edit. Write it as "${key}: …".`,
    );
  }
  let { start, end } = keyLines(text, from[0], to, eol);
  if (whole) {
    // The blank line that spaced the entry from the one before goes with it;
    // for a first entry, the one after it does.
    if (text.slice(start - 2 * eol.length, start) === eol + eol) start -= eol.length;
    else if (start === 0 && text.startsWith(eol, end)) end += eol.length;
  }
  const out = text.slice(0, start) + text.slice(end);

  const after = parseDocument(out, { uniqueKeys: false });
  const fail = (why: string) =>
    new DocmetaError(
      `${at()}: removing "${key}" for "${entry}" did not read back as removed, so nothing was written. ${why}`,
    );
  if (after.errors[0]) throw fail(`The result is not valid YAML: ${after.errors[0].message}`);
  const was: unknown = doc.toJS({ maxAliasCount: 100 });
  const wasRoot = isRecord(was) ? was : {};
  const wasEntry = wasRoot[spelled];
  const rest = Object.fromEntries(
    Object.entries(isRecord(wasEntry) ? wasEntry : {}).filter(([k]) => k !== key),
  );
  const kept = Object.entries(wasRoot).filter(([k]) => k !== spelled);
  if (Object.keys(rest).length > 0) kept.push([spelled, rest]);
  const now: unknown = after.toJS({ maxAliasCount: 100 });
  const expected = kept.length === 0 ? null : Object.fromEntries(kept);
  if (!deepEqual(now ?? null, expected)) throw fail("Another value in the manifest would have changed.");
  return { text: out };
}

/**
 * Rename the document entry `options.entry` to `options.to` in the manifest
 * `text`, and change no other byte: only the entry's key is replaced, so its
 * values, comments and position stay. `meta query` uses it when a `_path`
 * move renames a document a path-joined manifest names (proposal 0047). A
 * manifest or entry that is absent is left as it was.
 *
 * Throws `DocmetaError` where `spliceManifestValue` would (invalid YAML, a top
 * level that is not a mapping, an entry named twice), when `to` already has
 * an entry, for a key written as an explicit `? key`, and for a result that
 * does not read back with only the entry's name changed.
 */
export function renameManifestEntry(
  text: string,
  options: { entry: string; to: string; join?: string; file?: string },
): { text: string } {
  const { entry, to, file } = options;
  const join = options.join ?? PATH_JOIN;
  const at = (line?: number): string => {
    const name = file === undefined ? "Manifest" : `Manifest ${file}`;
    if (line === undefined) return name;
    return file === undefined ? `${name} line ${String(line)}` : `${name}:${String(line)}`;
  };
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
  const root = doc.contents;
  if (root === null || (isScalar(root) && root.value === null)) return { text };
  if (!isMap(root)) {
    throw new DocmetaError(
      `${at()}: the manifest must be a mapping from document ${join === PATH_JOIN ? "path" : `"${join}"`} to owned keys.`,
    );
  }
  const same =
    join === PATH_JOIN
      ? (a: string, b: string) => posix.normalize(a) === posix.normalize(b)
      : (a: string, b: string) => a === b;
  const [first, second] = root.items.filter((p) => same(keyString(p.key), entry));
  if (first && second) {
    throw new DocmetaError(
      `${at(keyLine(second.key))}: "${keyString(second.key)}" is named twice (first at line ${String(keyLine(first.key) ?? "?")}). Merge the two entries into one.`,
    );
  }
  if (first === undefined) return { text };
  const taken = root.items.find((p) => same(keyString(p.key), to));
  if (taken !== undefined) {
    throw new DocmetaError(
      `${at(keyLine(taken.key))}: "${keyString(taken.key)}" already has an entry, so "${keyString(first.key)}" cannot be renamed to it. Merge the two entries into one.`,
    );
  }
  const spelled = keyString(first.key);
  const r = rangeOf(first.key);
  const end = contentEnd(text, first.key);
  if (!r || end === undefined || colonEnd(text, first) === undefined) {
    throw new DocmetaError(
      `${at(keyLine(first.key))}: "${spelled}" is written in a form this writer does not edit. Write it as "${spelled}: …".`,
    );
  }
  const quoted = isScalar(first.key) && (first.key.type === "QUOTE_DOUBLE" || first.key.type === "QUOTE_SINGLE");
  const plain = stringify(to, { lineWidth: 0 }).replace(/\n$/, "");
  const insert = quoted || plain.includes("\n") ? JSON.stringify(to) : plain;
  const out = text.slice(0, r[0]) + insert + text.slice(end);

  const after = parseDocument(out, { uniqueKeys: false });
  const fail = (why: string) =>
    new DocmetaError(
      `${at()}: renaming "${spelled}" to "${to}" did not read back as renamed, so nothing was written. ${why}`,
    );
  if (after.errors[0]) throw fail(`The result is not valid YAML: ${after.errors[0].message}`);
  const was: unknown = doc.toJS({ maxAliasCount: 100 });
  const wasRoot = isRecord(was) ? was : {};
  const expected = Object.fromEntries(
    Object.entries(wasRoot).map(([k, v]) => [k === spelled ? to : k, v]),
  );
  const now: unknown = after.toJS({ maxAliasCount: 100 });
  if (!deepEqual(now, expected)) throw fail("Another value in the manifest would have changed.");
  return { text: out };
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

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
