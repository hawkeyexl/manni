/**
 * The hashing rule, stated once (proposal 0035 § The vocabulary):
 * UTF-8; strip one leading BOM; CRLF → LF; split on LF; drop the empty element
 * a trailing LF leaves; take lines L1..L2 inclusive (1-based); join with LF; no
 * trailing LF; trailing whitespace kept. Plain: sha256(text). Keyed (obfuscated
 * `src`): sha256(salt + "\n" + text). Spelled `sha256-<64 hex>`.
 */
import { integrityOf } from "../../meta/index.js";
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

/**
 * `sha256-<hex>` of the cited lines; keyed when `salt` is a string. The empty
 * string is still a key, so a plain pin passes `undefined`, never `""`.
 */
export function hashRange(
  text: string,
  range?: { start?: number; end?: number },
  salt?: string,
): string {
  return hashLines(sliceLines(splitLines(text), range), salt);
}

/** `sha256-<hex>` of already-joined lines; keyed when `salt` is a string. */
export function hashLines(joined: string, salt?: string): string {
  const keyed = salt === undefined ? joined : `${salt}\n${joined}`;
  return integrityOf(Buffer.from(keyed, "utf8"));
}
