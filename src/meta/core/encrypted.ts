/**
 * `x-manni-encrypt` (proposal 0045): what meta does with a property whose
 * schema says the page must hold its value encrypted.
 *
 * The keyword itself is registered on every Ajv meta builds (validator.ts),
 * where it records the instance pointers it is evaluated at. Ajv's own
 * resolution is the walker, so a mark counts wherever the validator evaluates
 * it: through `$ref`, `allOf` and a referenced built-in, and inside `anyOf`,
 * `oneOf` and `if`/`then` branches Ajv actually takes. This module is what
 * happens next, and is the same for every command:
 *
 * - a marked value the page holds in plain text is a finding
 *   (`encrypted:plain`), unless an external-metadata manifest supplied it;
 * - an encrypted one that decrypts under the key is validated as its
 *   plaintext, on a copy, and no finding may print that plaintext;
 * - one that does not decrypt is a finding (`encrypted:unreadable`);
 * - with no key, findings at or under it are dropped and counted, and the run
 *   says so once.
 *
 * The plaintext never leaves this module except as the copy validation reads
 * and the value a writer is about to encrypt.
 */
import type { DerivedField } from "./derive/types.js";
import type { ConfigFile } from "../../shared/config-file.js";
import { decryptValue, isEncryptedValue } from "../../shared/encryption.js";
import {
  ENCRYPTION_KEY_ENV,
  resolveEncryptionKey,
} from "../../shared/encryption-key.js";
import { escapePointerSegment } from "../extractors/pointer.js";
import { DocmetaError, type FieldError } from "../types.js";
import type { SourceLocation } from "./external-metadata.js";

/** The schema keyword. `true` marks a property; `false` or absent does not. */
export const ENCRYPT_KEYWORD = "x-manni-encrypt";

/**
 * The `schema` of a finding for a plain value in a marked property. Shaped
 * like `external:owned` so `classifyRef` passes it through as a built-in id,
 * and so its rule id is `encrypted:plain/encrypted`.
 */
export const ENCRYPTED_PLAIN_SCHEMA = "encrypted:plain";

/** The `schema` of a finding for a value that does not decrypt. */
export const ENCRYPTED_UNREADABLE_SCHEMA = "encrypted:unreadable";

/** The `keyword` both findings carry: no Ajv keyword produced them. */
export const ENCRYPTED_KEYWORD = "encrypted";

/** What every report prints in place of a value it must not show. */
export const ENCRYPTED_PLACEHOLDER = "(encrypted)";

/** The encryption context of a metadata value. */
export const META_CONTEXT = "meta";

/**
 * The refusals encryption adds to a run: a key that will not resolve, a join
 * that cannot be matched, a write with no key. A class of its own so a command
 * that files a document's own errors per file (`fill`) can tell these apart:
 * they are about the run, and exit 2.
 */
export class EncryptionRefusal extends DocmetaError {}

export const plainMessage = (pointer: string): string =>
  `${pointer} holds a plain value; its schema marks it ${ENCRYPT_KEYWORD}.`;

export const unreadableMessage = (pointer: string): string =>
  `${pointer} does not decrypt under the current key: encrypted under another key, or edited by hand.`;

/** The one run-level warning for values a run could not verify. */
export function unverifiedWarning(count: number): string {
  const what =
    count === 1
      ? "1 encrypted value was not verified"
      : `${count} encrypted values were not verified`;
  return `${what}: no encryption key is available. Set ${ENCRYPTION_KEY_ENV}, or run \`manni key set\`.`;
}

/** The key a run reads with, or `undefined`; resolved on first use. */
export type KeyGetter = () => string | undefined;

/**
 * The run's key, resolved once and only when something needs it: a malformed
 * `MANNI_ENCRYPTION_KEY` is refused by the first run that meets a ciphertext,
 * not by every run in a repository that encrypts nothing.
 */
export function lazyKey(
  file: ConfigFile | undefined,
  env: NodeJS.ProcessEnv | undefined,
): KeyGetter {
  let resolved: { key: string | undefined } | undefined;
  return () => {
    resolved ??= {
      key: resolveEncryptionKey({
        ...(env === undefined ? {} : { env }),
        file: file ?? null,
        toError: (m) => new EncryptionRefusal(m),
      }).key,
    };
    return resolved.key;
  };
}

// ---------------------------------------------------------------------------
// Pointers
// ---------------------------------------------------------------------------

/** The `/key` pointer of a top-level key. */
export function pointerOf(key: string): string {
  return `/${escapePointerSegment(key)}`;
}

function segments(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** The top-level key a one-segment pointer names; `undefined` otherwise. */
export function topLevelKeyOf(pointer: string): string | undefined {
  const parts = segments(pointer);
  return parts.length === 1 ? parts[0] : undefined;
}

/** Whether `pointer` is `ancestor` or somewhere beneath it. */
export function isAtOrUnder(pointer: string, ancestor: string): boolean {
  return (
    pointer === ancestor || ancestor === "" || pointer.startsWith(`${ancestor}/`)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at `pointer`, or `undefined` when there is none. */
export function valueAt(data: unknown, pointer: string): unknown {
  let node: unknown = data;
  for (const seg of segments(pointer)) {
    if (Array.isArray(node)) {
      const items: unknown[] = node;
      node = /^\d+$/.test(seg) ? items[Number(seg)] : undefined;
    } else if (isRecord(node)) {
      node = Object.hasOwn(node, seg) ? node[seg] : undefined;
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * `root` with the value at `pointer` replaced, copying only the containers on
 * the way down: the page's own object is never mutated. A pointer that does
 * not resolve leaves `root` as it was.
 */
export function withValueAt<T>(root: T, pointer: string, value: unknown): T {
  const parts = segments(pointer);
  const set = (node: unknown, i: number): unknown => {
    const seg = parts[i];
    if (seg === undefined) return value;
    if (Array.isArray(node)) {
      const items: unknown[] = [...(node as unknown[])];
      if (!/^\d+$/.test(seg) || Number(seg) >= items.length) return node;
      items[Number(seg)] = set(items[Number(seg)], i + 1);
      return items;
    }
    if (isRecord(node) && Object.hasOwn(node, seg)) {
      return { ...node, [seg]: set(node[seg], i + 1) };
    }
    return node;
  };
  return set(root, 0) as T;
}

// ---------------------------------------------------------------------------
// The view a run validates
// ---------------------------------------------------------------------------

/** What a document's marks came to, for one schema set. */
export interface EncryptionView {
  /** The document's data with every readable encrypted value decrypted. A copy. */
  data: Record<string, unknown>;
  /** Every marked pointer that holds a value, shallowest first. */
  marked: string[];
  /** Marked pointers holding a plain value the page itself wrote. */
  plain: string[];
  /** Marked pointers whose ciphertext decrypted under the key. */
  decrypted: string[];
  /** Marked pointers whose ciphertext does not decrypt under the key. */
  unreadable: string[];
  /** Marked pointers holding a ciphertext, with no key to read it. */
  unverified: string[];
}

/** What the view needs from a validator: its marks, per data and schema set. */
export interface MarkSource {
  markedPointers(
    data: Record<string, unknown>,
    refs: string[],
  ): Promise<ReadonlySet<string>>;
}

/**
 * Settling a view can uncover marks: a decrypted value may take an `if`
 * branch the ciphertext did not. Each round decrypts what the last one
 * found, and a real schema settles in two; the bound is a guard, not a limit
 * anyone meets.
 */
const MAX_ROUNDS = 8;

/**
 * Collect a document's marks and decrypt what it can. `locate` answers for a
 * value an external-metadata manifest supplied, which is private by
 * construction and never flagged.
 */
export async function encryptionView(opts: {
  data: Record<string, unknown>;
  refs: string[];
  validator: MarkSource;
  key: KeyGetter;
  locate?: (pointer: string) => SourceLocation | undefined;
}): Promise<EncryptionView> {
  const { data, refs, validator, key, locate } = opts;
  const view: EncryptionView = {
    data,
    marked: [],
    plain: [],
    decrypted: [],
    unreadable: [],
    unverified: [],
  };
  const seen = new Set<string>();
  const sealed: string[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const marks = await validator.markedPointers(view.data, refs);
    const fresh = [...marks]
      .filter((p) => !seen.has(p))
      .sort((a, b) => segments(a).length - segments(b).length);
    if (fresh.length === 0) break;
    for (const pointer of fresh) {
      seen.add(pointer);
      // Inside a ciphertext: the whole value is one token, so a mark on a
      // part of it is covered by the one on the whole.
      if (sealed.some((s) => isAtOrUnder(pointer, s))) continue;
      const value = valueAt(data, pointer);
      if (value === undefined) continue;
      view.marked.push(pointer);
      if (locate?.(pointer) !== undefined) continue;
      if (!isEncryptedValue(value)) {
        view.plain.push(pointer);
        continue;
      }
      sealed.push(pointer);
      const k = key();
      if (k === undefined) {
        view.unverified.push(pointer);
        continue;
      }
      const opened = decryptValue(value, k, META_CONTEXT);
      if (!opened.ok) {
        view.unreadable.push(pointer);
        continue;
      }
      view.decrypted.push(pointer);
      view.data = withValueAt(view.data, pointer, opened.value);
    }
  }
  return view;
}

/**
 * Keywords whose Ajv message or `params` name a part of the value itself — a
 * property name of an object — rather than something the schema says.
 */
const VALUE_NAMING = new Map<string, string>([
  ["additionalProperties", "must NOT have additional properties"],
  ["unevaluatedProperties", "must NOT have unevaluated properties"],
  ["propertyNames", "property name must be valid"],
]);

interface Positions {
  lineFor(this: void, pointer: string): number | undefined;
  colFor?(this: void, pointer: string): number | undefined;
}

function at(pointer: string, pos: Positions): { line?: number; col?: number } {
  const line = pos.lineFor(pointer);
  const col = pos.colFor?.(pointer);
  return { ...(line != null ? { line } : {}), ...(col != null ? { col } : {}) };
}

/**
 * Validation findings as a report may show them. Dropped at or under a value
 * that could not be read; at or under a decrypted value, moved to its pointer
 * and stripped of anything naming the plaintext, so neither the message, the
 * subject, nor the path of a nested key says more than the page did.
 */
export function settleFindings(
  errors: readonly FieldError[],
  view: EncryptionView,
  pos: Positions,
): FieldError[] {
  const hidden = [...view.unreadable, ...view.unverified];
  const out: FieldError[] = [];
  for (const e of errors) {
    if (hidden.some((p) => isAtOrUnder(e.instancePath, p))) continue;
    const inside = view.decrypted.find((p) => isAtOrUnder(e.instancePath, p));
    const generic = VALUE_NAMING.get(e.keyword);
    if (inside === undefined || (e.instancePath === inside && generic === undefined)) {
      out.push(e);
      continue;
    }
    const { subject, line: _line, col: _col, ...rest } = e;
    void _line;
    void _col;
    out.push({
      ...rest,
      instancePath: inside,
      message: generic ?? e.message,
      ...(generic === undefined && subject !== undefined ? { subject } : {}),
      ...at(inside, pos),
    });
  }
  return out;
}

/** The findings encryption itself raises for a view, in pointer order. */
export function encryptionFindings(view: EncryptionView, pos: Positions): FieldError[] {
  return [
    ...view.plain.map((p) => ({ p, schema: ENCRYPTED_PLAIN_SCHEMA, message: plainMessage(p) })),
    ...view.unreadable.map((p) => ({
      p,
      schema: ENCRYPTED_UNREADABLE_SCHEMA,
      message: unreadableMessage(p),
    })),
  ].map(({ p, schema, message }) => ({
    schema,
    keyword: ENCRYPTED_KEYWORD,
    instancePath: p,
    message,
    ...at(p, pos),
  }));
}

/**
 * A copy of `data` fit to leave the machine: every marked pointer, and any
 * ciphertext anywhere, reads `(encrypted)`. What `fill` sends a model (0017's
 * egress rule): neither the plaintext nor the ciphertext of a marked field.
 */
export function redactForModel(
  data: Record<string, unknown>,
  marked: Iterable<string>,
): Record<string, unknown> {
  let out = data;
  for (const pointer of marked) {
    if (valueAt(out, pointer) !== undefined) {
      out = withValueAt(out, pointer, ENCRYPTED_PLACEHOLDER);
    }
  }
  const scrub = (node: unknown): unknown => {
    if (isEncryptedValue(node)) return ENCRYPTED_PLACEHOLDER;
    if (Array.isArray(node)) return (node as unknown[]).map(scrub);
    if (isRecord(node)) {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, scrub(v)]));
    }
    return node;
  };
  return scrub(out) as Record<string, unknown>;
}

/**
 * A compared managed field as a report may show it when its schema marks it
 * `x-manni-encrypt` (proposals 0040 and 0045): both values as `(encrypted)`,
 * the status and the evidence as they were. `derive` and the derived
 * comparison in `validate` both report through it.
 */
export function redactedDerived(f: DerivedField): DerivedField {
  return {
    ...f,
    ...(f.asserted !== undefined ? { asserted: ENCRYPTED_PLACEHOLDER } : {}),
    ...(f.derived !== null ? { derived: ENCRYPTED_PLACEHOLDER } : {}),
  };
}
