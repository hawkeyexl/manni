/**
 * Source-side classification of one citation.
 *
 * current: the range hashes to the pin. moved / moved-ambiguous: a window of
 * the same length hashes equal elsewhere (once / more than once); whole-file
 * citations never move. changed: none equal; with a commit and history,
 * the diff and commit subjects are attached (pretty-only). never-true: no
 * window of the range's length anywhere in the file at the commit hashes to
 * the pin, or the path is absent there. The recorded lines are tried first;
 * the rest of the file is searched because `update` rewrites `src` for a move
 * without touching `commit`, so the lines a pin was minted from may sit
 * elsewhere in the file as it was then. A window that matches there is the
 * original for the move search below. missing: the source cannot be read.
 *
 * Move search: with the original text (git could show the commit), candidate
 * offsets are where the first line matches, compared lexically, hashed only on
 * a full match. Without it, a ±2000-line window around the original position
 * first, then the rest of the file under a 64 MiB hashing budget; past the
 * budget the result is `changed` with `truncatedSearch`.
 *
 * Order, as the ladder has it: the move search runs whenever the pin does not
 * hold, and history decides only what a non-match is called. So a pin that
 * never held at its commit but whose bytes sit elsewhere in the file is
 * `moved`, not `never-true`; the search sees the file as it is.
 */
import type { CitationResult, GitClient, PageCitation, SourceIndex, SourceRange } from "../types.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { formatSrc, parseSrc } from "./range.js";
import { readSource } from "./sources.js";

export const MOVE_WINDOW_LINES = 2000;
export const MOVE_BUDGET_BYTES = 64 * 1024 * 1024;
export const MAX_RANGE_LINES = 5000;

export interface ClassifyOptions {
  root: string;
  index: SourceIndex;
  git: GitClient;
  /** Default true; false skips never-true, history and subjects. */
  useGit?: boolean;
  /** The encryption key: decrypts an encrypted source and keys its pin. */
  key?: string;
  /** Page-level `citation-commit`, the default for entries without `commit`. */
  pageCommit?: string;
  /** Hashing budget for the blind move search, in bytes. Default `MOVE_BUDGET_BYTES`. */
  budget?: number;
}

export interface FindWindowsOptions {
  /** The 1-based start line the range was pinned at: the blind search begins around it. */
  around?: number;
  /** The cited lines at the commit, when git could show them: enables the first-line filter. */
  original?: readonly string[];
  /** Hashing budget for the blind search, in bytes. Default `MOVE_BUDGET_BYTES`. */
  budget?: number;
}

/**
 * Pure move search over normalized lines: the 1-based start lines where a
 * window of `length` lines hashes to `pin`. `original` (the cited lines at the
 * commit, when known) enables the first-line filter. `key` keys the hash for
 * an encrypted source's pin and is `undefined` for a plain one.
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
  const budget = opts?.budget ?? MOVE_BUDGET_BYTES;
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
    if (spent + bytes > budget) return { starts, truncated: true };
    spent += bytes;
    if (hashLines(text, key) === pin) starts.push(start);
  }
  return { starts, truncated: false };
}

/**
 * What git could say about the pin at the recorded commit. `unknown` is a
 * file at the commit too large to search under the budget with the pin found
 * nowhere in the part that was: neither true nor never true. `original`
 * carries the cited lines as they were then, which `reencryptCitations` re-keys
 * from when the pin no longer holds today.
 */
export type History =
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "never-true" }
  | { kind: "unknown" }
  | { kind: "original"; lines: string[] };

export async function historyOf(
  git: GitClient,
  commit: string,
  path: string,
  range: SourceRange,
  pin: string,
  key: string | undefined,
  budget: number | undefined,
): Promise<History> {
  const shown = await git.showFile(commit, path);
  if ("missing" in shown) {
    return shown.missing === "commit" ? { kind: "unavailable" } : { kind: "never-true" };
  }
  const then = splitLines(shown.text);
  let joined: string | undefined;
  try {
    joined = sliceLines(then, range);
  } catch {
    // The range ran past the end of the file as it was at the commit.
    joined = undefined;
  }
  if (joined !== undefined && hashLines(joined, key) === pin) {
    return { kind: "original", lines: joined.split("\n") };
  }

  // Not at the recorded lines. `update` rewrites `src` for a move and keeps
  // `commit`, so the lines the pin was minted from may sit elsewhere in the
  // file as it was then. Only a pin found nowhere there never held. A
  // whole-file pin has nowhere else to be.
  if (range.start === undefined) return { kind: "never-true" };
  const length = (range.end ?? range.start) - range.start + 1;
  const search: FindWindowsOptions = { around: range.start };
  if (budget !== undefined) search.budget = budget;
  const found = findWindows(then, length, pin, key, search);
  const [first] = found.starts;
  if (first !== undefined) {
    return { kind: "original", lines: then.slice(first - 1, first - 1 + length) };
  }
  return found.truncated ? { kind: "unknown" } : { kind: "never-true" };
}

export async function classifyCitation(
  entry: PageCitation,
  opts: ClassifyOptions,
): Promise<CitationResult> {
  const { citation, origin } = entry;
  const range = parseSrc(citation.src);
  const commit = citation.commit ?? opts.pageCommit;
  const result: CitationResult = { citation, origin, status: "missing" };
  if (commit !== undefined) result.commit = commit;

  const source = await readSource(opts.root, opts.index, range, opts.key);
  if (source.kind === "missing") {
    result.missingReason = source.reason;
    return result;
  }
  result.resolvedPath = source.resolvedPath;

  // Only an encrypted source carries a keyed pin, and reading one needed the key.
  const key = range.encrypted ? opts.key : undefined;
  const pin = citation.integrity;
  const lines = splitLines(source.text);

  let here: string | undefined;
  try {
    here = hashLines(sliceLines(lines, range), key);
  } catch {
    // The range runs past the end of the file: nothing to compare, so it is
    // `changed`, and the search below has no window of that length to find.
    here = undefined;
  }
  if (here === pin) {
    result.status = "current";
    return result;
  }

  let history: History = { kind: "none" };
  if (opts.useGit !== false && commit !== undefined && (await opts.git.available())) {
    history = await historyOf(opts.git, commit, source.resolvedPath, range, pin, key, opts.budget);
  }

  // A whole-file pin has nowhere to move to.
  if (range.start !== undefined) {
    const start = range.start;
    const end = range.end ?? start;
    const search: FindWindowsOptions = { around: start };
    if (history.kind === "original") search.original = history.lines;
    if (opts.budget !== undefined) search.budget = opts.budget;
    const found = findWindows(lines, end - start + 1, pin, key, search);
    if (found.truncated) result.truncatedSearch = true;
    const spell = (at: number): string =>
      formatSrc({ ...range, start: at, end: at + (end - start) });
    const [only] = found.starts;
    if (found.starts.length === 1 && only !== undefined) {
      result.status = "moved";
      result.newSrc = spell(only);
      return result;
    }
    if (found.starts.length > 1) {
      result.status = "moved-ambiguous";
      result.candidates = found.starts.map(spell);
      return result;
    }
  }

  if (history.kind === "never-true") {
    result.status = "never-true";
    return result;
  }
  result.status = "changed";
  if (history.kind === "unavailable") result.historyAvailable = false;
  if (history.kind === "unknown") result.truncatedSearch = true;
  if (history.kind === "original" && commit !== undefined) {
    result.historyAvailable = true;
    result.commitsSince = await opts.git.subjectsSince(commit, source.resolvedPath);
    result.diff = await opts.git.diffSince(commit, source.resolvedPath);
  }
  return result;
}
