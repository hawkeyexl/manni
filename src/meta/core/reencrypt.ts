/**
 * Re-encrypt a page's metadata under a new key: meta's half of `manni key
 * rotate` (proposal 0045).
 *
 * Values are found by their ciphertext, not through schema marks. Every
 * string at any depth of the metadata that has the ciphertext shape is a
 * candidate, and the authentication tag decides whether it is ours: no schema
 * is resolved, so a mark from a `-s` schema or an unreachable remote cannot
 * hide a value from rotation. `citations` is left alone; cite owns it, and
 * re-encrypts its own sources with their pins.
 *
 * Pure: no IO. The caller reads the page and writes `content` back.
 */
import { extname } from "node:path";
import { decryptValue, encryptValue, isEncryptedValue } from "../../shared/encryption.js";
import { escapePointerSegment } from "../extractors/pointer.js";
import { extractorByName, extractorForExtension, supportedExtensions } from "../extractors/index.js";
import { DocmetaError, type MetadataExtractor, type MetadataPatch } from "../types.js";
import { META_CONTEXT, withValueAt } from "./encrypted.js";

/** One value re-encrypted: where, and the ciphertext before and after. */
export interface ReencryptedValue {
  pointer: string;
  from: string;
  to: string;
}

export interface ReencryptMetadataResult {
  /** The page with every rewritten value; the input itself when nothing was. */
  content: string;
  rewritten: ReencryptedValue[];
  /** Values that could not be re-encrypted, and why. */
  skipped: { pointer: string; message: string }[];
}

/** The subtree cite owns. */
const CITATIONS_KEY = "citations";

const NOT_OURS = "does not decrypt under the current key";
const READ_ONLY = "this format cannot be written";

/**
 * Re-encrypt every encrypted value in one page's metadata from `fromKey` to
 * `toKey`.
 *
 * - A value that decrypts under `fromKey` is rewritten under `toKey`.
 * - One that already decrypts under `toKey` is done: an interrupted rotation
 *   can be run again. It is neither rewritten nor skipped.
 * - One that decrypts under neither is skipped.
 *
 * The format is `page.format` (an extractor name) when given, else the
 * file's extension. A nested value rewrites its top-level key; everything
 * else in the page is kept. A format that cannot be written lists every value
 * it would have rewritten as skipped, and returns the content unchanged.
 */
export function reencryptMetadata(
  page: { file: string; content: string; format?: string },
  opts: { fromKey: string; toKey: string },
): ReencryptMetadataResult {
  const extractor =
    page.format !== undefined
      ? extractorByName(page.format)
      : extractorForExtension(extname(page.file));
  if (!extractor) {
    throw new DocmetaError(
      page.format !== undefined
        ? `Unknown format "${page.format}" for "${page.file}".`
        : `Unsupported file type "${extname(page.file)}" for "${page.file}". Supported: ${supportedExtensions().join(", ")}.`,
    );
  }
  return reencryptWith(extractor, page, opts);
}

interface Found {
  pointer: string;
  top: string;
  token: string;
}

/** Every ciphertext in `data`, in document order, outside `citations`. */
function tokensIn(data: Record<string, unknown>): Found[] {
  const found: Found[] = [];
  const walk = (node: unknown, pointer: string, top: string): void => {
    if (isEncryptedValue(node)) {
      found.push({ pointer, top, token: node });
      return;
    }
    if (Array.isArray(node)) {
      (node as unknown[]).forEach((item, i) => {
        walk(item, `${pointer}/${String(i)}`, top);
      });
      return;
    }
    if (typeof node === "object" && node !== null && !(node instanceof Date)) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, `${pointer}/${escapePointerSegment(k)}`, top);
      }
    }
  };
  for (const [key, value] of Object.entries(data)) {
    if (key === CITATIONS_KEY) continue;
    walk(value, `/${escapePointerSegment(key)}`, key);
  }
  return found;
}

/** `reencryptMetadata` with the extractor chosen. Exported for tests. */
export function reencryptWith(
  extractor: MetadataExtractor,
  page: { file: string; content: string },
  opts: { fromKey: string; toKey: string },
): ReencryptMetadataResult {
  const read = (content: string): Record<string, unknown> => {
    try {
      return extractor.extract(content, page.file).data;
    } catch (err) {
      if (err instanceof DocmetaError) throw err;
      throw new DocmetaError(`${page.file}: ${(err as Error).message}`);
    }
  };
  const data = read(page.content);
  const rewritten: ReencryptedValue[] = [];
  const skipped: { pointer: string; message: string }[] = [];
  const apply = extractor.apply;
  for (const { pointer, token } of tokensIn(data)) {
    const opened = decryptValue(token, opts.fromKey, META_CONTEXT);
    if (opened.ok) {
      if (apply === undefined) {
        skipped.push({ pointer, message: READ_ONLY });
        continue;
      }
      rewritten.push({
        pointer,
        from: token,
        to: encryptValue(opened.value, opts.toKey, META_CONTEXT),
      });
      continue;
    }
    if (decryptValue(token, opts.toKey, META_CONTEXT).ok) continue;
    skipped.push({ pointer, message: NOT_OURS });
  }
  if (rewritten.length === 0 || apply === undefined) {
    return { content: page.content, rewritten: [], skipped };
  }

  // One patch entry per top-level key: the whole value, with its tokens
  // replaced, because a writer sets top-level keys and nothing deeper.
  let next: Record<string, unknown> = data;
  for (const r of rewritten) next = withValueAt(next, r.pointer, r.to);
  const patch: MetadataPatch = {};
  const tops = new Set(
    tokensIn(data)
      .filter((f) => rewritten.some((r) => r.pointer === f.pointer))
      .map((f) => f.top),
  );
  for (const top of tops) patch[top] = next[top];
  const content = apply(page.content, patch, { filePath: page.file });

  // A writer that cannot keep a value is worse than a refused rotation: the
  // old ciphertext would be gone and the new one nowhere.
  const reread = tokensIn(read(content));
  for (const r of rewritten) {
    if (!reread.some((f) => f.pointer === r.pointer && f.token === r.to)) {
      throw new DocmetaError(
        `${page.file}: the ${extractor.name} writer did not keep ${r.pointer}; nothing was re-encrypted.`,
      );
    }
  }
  return { content, rewritten, skipped };
}
