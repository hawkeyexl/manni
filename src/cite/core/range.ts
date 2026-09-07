/**
 * `src` grammar: `path`, `path:L`, `path:L1-L2`, or `~<16 hex>` with the same
 * line forms. The regex is the schema's `srcRef` pattern, spelled once here and
 * once in `schema/citations.json`; `test/cite/range.test.ts` pins the two equal.
 */
import { CiteError } from "../errors.js";
import type { SourceRange } from "../types.js";

/** The schema's `$defs.srcRef.pattern`, as a RegExp. */
export const SRC_PATTERN =
  /^(?:~[0-9a-f]{16}|(?!~)(?:(?!\.\.?(?:\/|:|$))[^/\\:\r\n\t]+)(?:\/(?:(?!\.\.?(?:\/|:|$))[^/\\:\r\n\t]+))*)(?::[1-9][0-9]*(?:-[1-9][0-9]*)?)?$/;

const TOKEN_PATTERN = /^~[0-9a-f]{16}$/;

/**
 * Parse a `src`. Throws `CiteError` on bad grammar or an end line before the
 * start. A one-line `path:L` comes back with `end` equal to `start`, as the
 * ladder's parser spells it, so a range's width is always `end - start + 1`.
 */
export function parseSrc(src: string): SourceRange {
  if (!SRC_PATTERN.test(src)) {
    throw new CiteError(
      `Invalid src "${src}": expected path, path:L, path:L1-L2, or ~<16 hex> with the same line forms; ` +
        "the path is repo-root-relative, posix, and free of . and .. segments.",
    );
  }
  // The grammar keeps `:` out of every path segment, so the first one starts
  // the line suffix.
  const colon = src.indexOf(":");
  const path = colon === -1 ? src : src.slice(0, colon);
  const range: SourceRange = { path, obfuscated: TOKEN_PATTERN.test(path) };
  if (colon === -1) return range;
  const [startText, endText] = src.slice(colon + 1).split("-");
  const start = Number(startText);
  const end = endText === undefined ? start : Number(endText);
  if (end < start) {
    throw new CiteError(`Invalid range "${src}": end line ${end} is before start line ${start}.`);
  }
  range.start = start;
  range.end = end;
  return range;
}

/** The canonical spelling: `path:L` for one line, `path:L1-L2` otherwise. */
export function formatSrc(range: SourceRange): string {
  const { path, start, end } = range;
  if (start === undefined) return path;
  if (end === undefined || end === start) return `${path}:${start}`;
  return `${path}:${start}-${end}`;
}

/** `true` for a `~<16 hex>` token. */
export function isObfuscatedToken(path: string): boolean {
  return TOKEN_PATTERN.test(path);
}
