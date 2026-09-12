/**
 * The hashing rule, stated once (proposal 0044 § The vocabulary):
 * UTF-8; strip one leading BOM; CRLF → LF; split on LF; drop the empty element
 * a trailing LF leaves; take lines L1..L2 inclusive (1-based); join with LF; no
 * trailing LF; trailing whitespace kept. Plain: `sha256-` and sha256(text).
 * Keyed (an encrypted `source.file`): `hmac-sha256-` and the family's keyed
 * pin, HMAC-SHA256 under a key derived from the encryption key (proposal
 * 0045). A claim is always pinned plain: the page is public.
 */
import { integrityOf } from "../../meta/index.js";
import { KEYED_PIN_PREFIX, keyedPin } from "../../shared/encryption.js";
import { CiteError } from "../errors.js";

/** BOM stripped, CRLF folded to LF. */
export function normalizeText(text: string): string {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body.replace(/\r\n/g, "\n");
}

/** The normalized lines, without the empty element a trailing LF leaves. */
export function splitLines(text: string): string[] {
  const parts = normalizeText(text).split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * The cited lines joined by LF. Throws `CiteError` when the range runs past
 * the end of the text (`<path> has N lines; line M is out of range`).
 */
export function sliceLines(
  lines: readonly string[],
  range?: { start?: number; end?: number },
  label?: string,
): string {
  const start = range?.start;
  if (start === undefined) return lines.join("\n");
  const end = range?.end ?? start;
  if (start > lines.length || end > lines.length) {
    const first = start > lines.length ? start : end;
    throw new CiteError(`${label ?? "the source"} has ${lines.length} lines; line ${first} is out of range.`);
  }
  return lines.slice(start - 1, end).join("\n");
}

/** The pin of the cited lines: plain, or the keyed pin under `key` when one is given. */
export function hashRange(
  text: string,
  range?: { start?: number; end?: number },
  key?: string,
): string {
  return hashLines(sliceLines(splitLines(text), range), key);
}

/**
 * The pin of already-joined lines: `sha256-<hex>`, or with `key` the
 * `hmac-sha256-<hex>` keyed pin an encrypted source carries. A plain pin
 * passes `undefined`.
 */
export function hashLines(joined: string, key?: string): string {
  return key === undefined ? integrityOf(Buffer.from(joined, "utf8")) : keyedPin(joined, key);
}

/** Whether a pin is keyed (`hmac-sha256-`), the form an encrypted source carries. */
export function isKeyedPin(pin: string): boolean {
  return pin.startsWith(KEYED_PIN_PREFIX);
}
