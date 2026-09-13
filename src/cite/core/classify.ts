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
import type { GitClient, PageCitation, SourceEnd, SourceIndex, SourceRange } from "../types.js";
import { findWindows, type FindWindowsOptions } from "../../shared/pin.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { formatSrc, lineSpec, sourceRange, spellSource } from "./range.js";
import { readSource } from "./sources.js";

// The move search is the shared pin engine's; this path keeps cite's imports working.
export { MAX_RANGE_LINES, MOVE_BUDGET_BYTES, MOVE_WINDOW_LINES, findWindows } from "../../shared/pin.js";
export type { FindWindowsOptions } from "../../shared/pin.js";

export interface ClassifyOptions {
  root: string;
  index: SourceIndex;
  /** History is read through it when it reports git available, and never otherwise. */
  git: GitClient;
  /** The encryption key: decrypts an encrypted source and keys its pin. */
  key?: string;
  /** Hashing budget for the blind move search, in bytes. Default `MOVE_BUDGET_BYTES`. */
  budget?: number;
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
): Promise<SourceEnd> {
  const { citation } = entry;
  const range = sourceRange(citation.source);
  const commit = citation.source["commit-sha"];
  const result: SourceEnd = { src: spellSource(citation.source), status: "missing" };
  if (commit !== undefined) result.commitSha = commit;

  const source = await readSource(opts.root, opts.index, range, opts.key);
  if (source.kind === "missing") {
    result.missingReason = source.reason;
    return result;
  }
  result.resolvedPath = source.resolvedPath;

  // Only an encrypted source carries a keyed pin, and reading one needed the key.
  const key = range.encrypted ? opts.key : undefined;
  const pin = citation.source.integrity;
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
  if (commit !== undefined && (await opts.git.available())) {
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
      result.newLines = String(lineSpec({ start: only, end: only + (end - start) }));
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
