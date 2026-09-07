/**
 * Source-side classification of one citation.
 *
 * current: the range hashes to the pin. moved / moved-ambiguous: a window of
 * the same length hashes equal elsewhere (once / more than once); whole-file
 * citations never move. changed: none equal; with a commit and history,
 * the diff and commit subjects are attached (pretty-only). never-true: the
 * range at the commit does not hash to the pin, or the path is absent there.
 * missing: the source cannot be read.
 *
 * Move search: with the original text (git could show the commit), candidate
 * offsets are where the first line matches, compared lexically, hashed only on
 * a full match. Without it, a ±2000-line window around the original position
 * first, then the rest of the file under a 64 MiB hashing budget; past the
 * budget the result is `changed` with `truncatedSearch`.
 */
import type { CitationResult, GitClient, PageCitation, SourceIndex } from "../types.js";
import { notImplemented } from "./not-implemented.js";

export const MOVE_WINDOW_LINES = 2000;
export const MOVE_BUDGET_BYTES = 64 * 1024 * 1024;
export const MAX_RANGE_LINES = 5000;

export interface ClassifyOptions {
  root: string;
  index: SourceIndex;
  git: GitClient;
  /** Default true; false skips never-true, history and subjects. */
  useGit?: boolean;
  salt: string;
  /** Page-level `citation-commit`, the default for entries without `commit`. */
  pageCommit?: string;
}

export function classifyCitation(
  entry: PageCitation,
  opts: ClassifyOptions,
): Promise<CitationResult> {
  return notImplemented("classifyCitation", entry, opts);
}

/**
 * Pure move search over normalized lines: the 1-based start lines where a
 * window of `length` lines hashes to `pin`. `original` (the lines at the
 * commit, when known) enables the first-line filter.
 */
export function findWindows(
  lines: readonly string[],
  length: number,
  pin: string,
  salt: string,
  opts?: { around?: number; original?: readonly string[] },
): { starts: number[]; truncated: boolean } {
  return notImplemented("findWindows", lines, length, pin, salt, opts);
}
