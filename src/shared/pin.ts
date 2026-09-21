/**
 * The pin engine: refer to content by its lines and a hash of them, and find
 * those lines again when they move. cite pins a citation's two ends with it,
 * and meta pins the fields a document derives; neither owns it.
 *
 * The hashing rule, stated once (proposal 0044 § The vocabulary):
 * UTF-8; strip one leading BOM; CRLF → LF; split on LF; drop the empty element
 * a trailing LF leaves; take lines L1..L2 inclusive (1-based); join with LF; no
 * trailing LF; trailing whitespace kept. Plain: `sha256-` and sha256(text).
 * Keyed (an encrypted value): `hmac-sha256-` and the family's keyed pin,
 * HMAC-SHA256 under a key derived from the encryption key (proposal 0045).
 */
// Straight to the module rather than meta's barrel: shared code sits under
// every tool, and `integrity.ts` depends on nothing but node:crypto.
import { integrityOf } from "../meta/core/integrity.js";
import { KEYED_PIN_PREFIX, keyedPin } from "./encryption.js";
import { ToolError } from "./errors.js";
import { STDIN_LINES_MARKER } from "./run.js";

/**
 * A line range that runs past the end of the text, or ends before it starts.
 * Each tool rethrows it as its own error where its callers match on that.
 */
export class LineRangeError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "LineRangeError";
  }
}

/** Lines as an entry writes them: an integer for one line, `"L1-L2"` for several. */
export type LineSpec = number | string;

/** Page lines as an editor numbers them, 1-based and inclusive. */
export interface PageLines {
  start: number;
  end: number;
}

/** A 1-based inclusive range, either end optional: no `start` is the whole text, no `end` one line. */
export interface LineRange {
  start?: number;
  end?: number;
}

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
 * The lines of a range joined by LF. Throws `LineRangeError` when the range
 * runs past the end of the text (`<label> has N lines; line M is out of range.`).
 */
export function sliceLines(lines: readonly string[], range?: LineRange, label?: string): string {
  const start = range?.start;
  if (start === undefined) return lines.join("\n");
  const end = range?.end ?? start;
  if (end < start) {
    // Both bounds can be in range, so without this a reversed range sliced
    // nothing and hashed as the pin of an empty span.
    throw new LineRangeError(`${label ?? "the source"} range ${String(start)}-${String(end)} ends before it starts.`);
  }
  if (start > lines.length || end > lines.length) {
    const first = start > lines.length ? start : end;
    throw new LineRangeError(`${label ?? "the source"} has ${lines.length} lines; line ${first} is out of range.`);
  }
  return lines.slice(start - 1, end).join("\n");
}

/** The pin of a range of `text`: plain, or the keyed pin under `key` when one is given. */
export function hashRange(text: string, range?: LineRange, key?: string): string {
  return hashLines(sliceLines(splitLines(text), range), key);
}

/**
 * The pin of already-joined lines: `sha256-<hex>`, or with `key` the
 * `hmac-sha256-<hex>` keyed pin an encrypted value carries. A plain pin
 * passes `undefined`.
 */
export function hashLines(joined: string, key?: string): string {
  return key === undefined ? integrityOf(Buffer.from(joined, "utf8")) : keyedPin(joined, key);
}

/** Whether a pin is keyed (`hmac-sha256-`), the form an encrypted value carries. */
export function isKeyedPin(pin: string): boolean {
  return pin.startsWith(KEYED_PIN_PREFIX);
}

/** The plain pin of a range of lines; undefined when the range falls outside them or ends before it starts. */
export function pinOfLines(lines: readonly string[], range: PageLines): string | undefined {
  if (range.start < 1 || range.end > lines.length || range.end < range.start) return undefined;
  return hashLines(lines.slice(range.start - 1, range.end).join("\n"));
}

/** Half-width of the band around the original position the blind move search tries first. */
export const MOVE_WINDOW_LINES = 2000;
/** Default hashing budget for the blind move search, in bytes. */
export const MOVE_BUDGET_BYTES = 64 * 1024 * 1024;
/** The widest range an entry may name, at either end: a wider one is refused. */
export const MAX_RANGE_LINES = 5000;

/**
 * Bytes left to spend on settling one pin. Every search that classifies the
 * same end shares one of these, so the cap is the cost of settling that pin
 * rather than the cost of each search in turn (proposal 0055 § the budget).
 */
export interface SearchBudget {
  left: number;
}

export interface FindWindowsOptions {
  /** The 1-based start line the range was pinned at: the blind search begins around it. */
  around?: number;
  /** The pinned lines as they were, when known: enables the first-line filter. */
  original?: readonly string[];
  /** Hashing budget for the blind search, in bytes. Default `MOVE_BUDGET_BYTES`. */
  budget?: number;
  /** A budget shared with the other searches settling this pin. Wins over `budget`. */
  counter?: SearchBudget;
}

/**
 * Pure move search over normalized lines: the 1-based start lines where a
 * window of `length` lines hashes to `pin`. `original` (the pinned lines as
 * they were, when known) enables the first-line filter. `key` keys the hash
 * for a keyed pin and is `undefined` for a plain one.
 */
export function findWindows(
  lines: readonly string[],
  length: number,
  pin: string,
  key: string | undefined,
  opts?: FindWindowsOptions,
): { starts: number[]; truncated: boolean } {
  const starts: number[] = [];
  const lastStart = lines.length - length + 1;
  if (length < 1 || lastStart < 1) return { starts, truncated: false };

  const joined = (start: number): string => lines.slice(start - 1, start - 1 + length).join("\n");

  const original = opts?.original;
  if (original !== undefined) {
    const first = original[0];
    for (let start = 1; start <= lastStart; start++) {
      if (lines[start - 1] !== first) continue;
      let same = true;
      for (let i = 1; i < length; i++) {
        if (lines[start - 1 + i] !== original[i]) {
          same = false;
          break;
        }
      }
      if (same && hashLines(joined(start), key) === pin) starts.push(start);
    }
    return { starts, truncated: false };
  }

  // Blind: the band around the original position first, then the rest, so the
  // common small shift is found before the budget is anywhere near spent.
  const counter = opts?.counter;
  const budget = counter?.left ?? opts?.budget ?? MOVE_BUDGET_BYTES;
  const around = opts?.around ?? 1;
  const bandStart = Math.max(1, around - MOVE_WINDOW_LINES);
  const bandEnd = Math.min(lastStart, around + MOVE_WINDOW_LINES);
  const order: number[] = [];
  for (let start = bandStart; start <= bandEnd; start++) order.push(start);
  for (let start = 1; start < bandStart; start++) order.push(start);
  for (let start = bandEnd + 1; start <= lastStart; start++) order.push(start);

  let spent = 0;
  for (const start of order) {
    const text = joined(start);
    const bytes = Buffer.byteLength(text, "utf8");
    if (spent + bytes > budget) {
      if (counter !== undefined) counter.left = budget - spent;
      return { starts, truncated: true };
    }
    spent += bytes;
    if (hashLines(text, key) === pin) starts.push(start);
  }
  if (counter !== undefined) counter.left = budget - spent;
  return { starts, truncated: false };
}

/**
 * `"L1-L2"`, the only string form an entry may write, and `"L"`, which no
 * entry writes but every report spells (`spellLines`), so a spelling reads
 * back as the lines it names.
 */
const RANGE_SPEC = /^([1-9][0-9]*)(?:-([1-9][0-9]*))?$/;

/**
 * The lines a `LineSpec` names. Undefined for a value that is neither a
 * positive integer nor `"L1-L2"` with `L1 <= L2`.
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

/** Body lines as file lines: body line 1 is the file line `bodyLine`, the first after the frontmatter. */
export function toFileLines(lines: PageLines, bodyLine: number): PageLines {
  return { start: bodyLine + lines.start - 1, end: bodyLine + lines.end - 1 };
}

/** File lines as body lines. */
export function toBodyLines(lines: PageLines, bodyLine: number): PageLines {
  return { start: lines.start - bodyLine + 1, end: lines.end - bodyLine + 1 };
}

/**
 * Split `docs/limits.md:9` or `docs/limits.md:14-18` into the page and its
 * lines. Only a trailing `:L` or `:L1-L2` is read as lines, so a path that
 * carries a colon keeps it, and `-:9` still reads the page from stdin. Throws
 * `LineRangeError` for an end line before the start.
 */
export function splitPageArgument(arg: string): { page: string; lines?: PageLines } {
  // `-:9` reaches commander as an operand only after the bin rewrites its
  // leading `-` to the marker (`run.ts`); both spellings name stdin, `-`, and
  // the same lines.
  const text = arg.startsWith(STDIN_LINES_MARKER) ? `-${arg.slice(STDIN_LINES_MARKER.length)}` : arg;
  const m = /:([1-9][0-9]*)(?:-([1-9][0-9]*))?$/.exec(text);
  const head = m === null ? text : text.slice(0, m.index);
  if (m === null || head === "") return { page: arg };
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  if (end < start) {
    throw new LineRangeError(`Invalid range "${arg}": end line ${end} is before start line ${start}.`);
  }
  return { page: head, lines: { start, end } };
}
