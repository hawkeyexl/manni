/**
 * Source and line grammar.
 *
 * An entry's `source.file` is a path or an encrypted source (`~` and at least
 * 82 base64url characters, proposal 0045), and its `lines` an integer or
 * `"L1-L2"`. `FILE_PATTERN` is the schema's `$defs.fileRef.pattern`, spelled
 * once here and once in `schema/citations.json`; `test/cite/range.test.ts`
 * pins the two equal.
 *
 * The command line spells a source as one string, `path`, `path:L` or
 * `path:L1-L2` (`SRC_PATTERN`), and reports spell it that way too.
 */
import { isEncryptedValue } from "../../shared/encryption.js";
import { CiteError } from "../errors.js";
import type { CitationSource, LineSpec, PageLines, SourceRange } from "../types.js";

/** The schema's `$defs.fileRef.pattern`, as a RegExp. */
export const FILE_PATTERN =
  /^(?:~[A-Za-z0-9_-]{82,}|(?!~)(?:(?!\.\.?(?:\/|$))[^/\\:\r\n\t]+)(?:\/(?:(?!\.\.?(?:\/|$))[^/\\:\r\n\t]+))*)$/;

/** A source on the command line: a `file`, then an optional `:L` or `:L1-L2`. */
export const SRC_PATTERN =
  /^(?:~[A-Za-z0-9_-]{82,}|(?!~)(?:(?!\.\.?(?:\/|:|$))[^/\\:\r\n\t]+)(?:\/(?:(?!\.\.?(?:\/|:|$))[^/\\:\r\n\t]+))*)(?::[1-9][0-9]*(?:-[1-9][0-9]*)?)?$/;

/**
 * `"L1-L2"`, the only string form an entry may write, and `"L"`, which no
 * entry writes but every report spells (`spellLines`), so a spelling reads
 * back as the lines it names.
 */
const RANGE_SPEC = /^([1-9][0-9]*)(?:-([1-9][0-9]*))?$/;

/**
 * Parse a command-line source. Throws `CiteError` on bad grammar or an end
 * line before the start. A one-line `path:L` comes back with `end` equal to
 * `start`, so a range's width is always `end - start + 1`.
 */
export function parseSrc(src: string): SourceRange {
  if (!SRC_PATTERN.test(src)) {
    throw new CiteError(
      `Invalid src "${src}": expected path, path:L, path:L1-L2, or an encrypted source (~ and at least 82 base64url characters) with the same line forms; ` +
        "the path is repo-root-relative, posix, and free of . and .. segments.",
    );
  }
  // The grammar keeps `:` out of every path segment and out of the base64url
  // alphabet, so the first one starts the line suffix.
  const colon = src.indexOf(":");
  const path = colon === -1 ? src : src.slice(0, colon);
  const range: SourceRange = { path, encrypted: isEncryptedValue(path) };
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

/**
 * The lines an entry's `lines` names. Undefined for a value that is neither
 * a positive integer nor `"L1-L2"` with `L1 <= L2`: the schema refuses the
 * first, and `readPage` reports the second.
 */
export function parseLines(spec: LineSpec): PageLines | undefined {
  if (typeof spec === "number") {
    return Number.isInteger(spec) && spec >= 1 ? { start: spec, end: spec } : undefined;
  }
  const m = RANGE_SPEC.exec(spec);
  const startText = m?.[1];
  if (startText === undefined) return undefined;
  const start = Number(startText);
  const endText = m?.[2];
  const end = endText === undefined ? start : Number(endText);
  return end < start ? undefined : { start, end };
}

/** Lines as an entry writes them: the integer for one line, `"L1-L2"` otherwise. */
export function lineSpec(lines: PageLines): LineSpec {
  return lines.start === lines.end ? lines.start : `${String(lines.start)}-${String(lines.end)}`;
}

/** Lines as a report spells them: `"9"` or `"9-12"`. */
export function spellLines(lines: PageLines): string {
  return String(lineSpec(lines));
}

/** An entry's source as a range. Its lines must already be valid (see `parseLines`). */
export function sourceRange(source: CitationSource): SourceRange {
  const range: SourceRange = { path: source.file, encrypted: isEncryptedValue(source.file) };
  if (source.lines === undefined) return range;
  const lines = parseLines(source.lines);
  if (lines !== undefined) {
    range.start = lines.start;
    range.end = lines.end;
  }
  return range;
}

/** An entry's source spelled as one string, `path:L1-L2`, the way the command line takes it. */
export function spellSource(source: CitationSource): string {
  return formatSrc(sourceRange(source));
}

/** A range's lines as an entry writes them; undefined for a whole file. */
export function rangeLines(range: SourceRange): LineSpec | undefined {
  if (range.start === undefined) return undefined;
  return lineSpec({ start: range.start, end: range.end ?? range.start });
}
