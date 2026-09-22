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
 *
 * Proposal 0055 widens that in two directions, both gated on the original
 * text. A pin that holds nowhere in its own file is looked for in every file
 * that changed in committed history since its commit, so a rename is `moved`
 * with a new path rather than `missing`. And a `changed` end is bracketed by
 * its old first and last line, so the finding names the span they cover now
 * and `update --accept` re-mints there rather than over a stale range. The
 * 64 MiB budget is one counter per citation, spent in ladder order by every
 * search that settles it.
 */
import type {
  GitClient,
  PageCitation,
  PageLines,
  SourceEnd,
  SourceIndex,
  SourceRange,
} from "../types.js";
import {
  MAX_RANGE_LINES,
  MOVE_BUDGET_BYTES,
  findWindows,
  type FindWindowsOptions,
  type SearchBudget,
} from "../../shared/pin.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { formatSrc, lineSpec, sourceRange, spellSource } from "./range.js";
import { encryptSourcePath, readSource, readTracked, resolveSourcePath } from "./sources.js";

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
  counter?: SearchBudget,
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

  // Not at the recorded lines. An entry can carry a `commit` older than its
  // `lines`: one pinned by hand, or one an `update` before this rule
  // re-anchored without advancing the commit. So the lines the pin was minted
  // from may sit elsewhere in the file as it was then. Only a pin found
  // nowhere there never held. A whole-file pin has nowhere else to be.
  if (range.start === undefined) return { kind: "never-true" };
  const length = (range.end ?? range.start) - range.start + 1;
  const search: FindWindowsOptions = { around: range.start };
  if (budget !== undefined) search.budget = budget;
  if (counter !== undefined) search.counter = counter;
  const found = findWindows(then, length, pin, key, search);
  const [first] = found.starts;
  if (first !== undefined) {
    return { kind: "original", lines: then.slice(first - 1, first - 1 + length) };
  }
  return found.truncated ? { kind: "unknown" } : { kind: "never-true" };
}

/** One window that hashes to the pin, at the file it was found in. */
export interface CrossFileHit {
  path: string;
  /** 1-based start line in that file. */
  start: number;
}

/**
 * Every file a commit touched that holds the pinned lines. The candidate list
 * is `git diff --name-only <commit> HEAD`, so it is committed changes only;
 * the entry's own file is dropped because the in-file search covered it, and a
 * path the tracked-file index does not hold is dropped exactly as a cited path
 * would be. The bytes come from the working tree, as every other source read
 * does. Each candidate costs its own bytes against the citation's counter, and
 * the `original` lines take `findWindows` down its filtered path, which hashes
 * only a start line whose text already matches.
 */
export async function followAcross(
  ask: {
    git: GitClient;
    root: string;
    index: SourceIndex;
    commit: string;
    /** The entry's own path, already searched. */
    own: string;
    pin: string;
    key: string | undefined;
    /** The pinned lines as they were at the commit: the window's length and its filter. */
    original: readonly string[];
  },
  counter: SearchBudget,
): Promise<{ hits: CrossFileHit[]; truncated: boolean }> {
  const hits: CrossFileHit[] = [];
  const length = ask.original.length;
  if (length < 1 || ask.git.changedSince === undefined) return { hits, truncated: false };
  // Git prints the diff sorted by path, so a search that stops early stops at
  // the same place twice.
  const candidates = (await ask.git.changedSince(ask.commit)).filter(
    (path) => path !== ask.own && ask.index.has(path),
  );
  for (const path of candidates) {
    const text = await readTracked(ask.root, path);
    // A deletion the diff named, a permission error, or a file that went away
    // between the diff and the read: skipped, never an operational error.
    if (text === undefined) continue;
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > counter.left) return { hits, truncated: true };
    counter.left -= bytes;
    const found = findWindows(splitLines(text), length, ask.pin, ask.key, {
      original: ask.original,
    });
    for (const start of found.starts) hits.push({ path, start });
  }
  return { hits, truncated: false };
}

/**
 * The span the pinned range's old first and last line cover in the file as it
 * stands: each must sit exactly once, the last at or after the first, and the
 * span no wider than `MAX_RANGE_LINES`, so an accepted span is never a range
 * the schema refuses. Undefined when any of those fails, which leaves the
 * finding exactly what it is without this search.
 */
export function spanOf(
  lines: readonly string[],
  original: readonly string[],
): PageLines | undefined {
  const first = original[0];
  const last = original[original.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const at = onlyLine(lines, first);
  if (at === undefined) return undefined;
  // A one-line pin's first and last line are the same line, so one occurrence
  // serves both ends and the span is that line.
  const to = original.length === 1 ? at : onlyLine(lines, last);
  if (to === undefined || to < at || to - at + 1 > MAX_RANGE_LINES) return undefined;
  return { start: at, end: to };
}

/** The 1-based line holding exactly this text, or undefined for none or several. */
function onlyLine(lines: readonly string[], text: string): number | undefined {
  let at: number | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== text) continue;
    if (at !== undefined) return undefined;
    at = i + 1;
  }
  return at;
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

  // A source whose path will not resolve at all names no file to search from,
  // so its verdict is settled here as it always was.
  const resolved = resolveSourcePath(range, opts.key);
  if ("reason" in resolved) {
    result.missingReason = resolved.reason;
    return result;
  }
  const path = resolved.path;

  // Only an encrypted source carries a keyed pin, and reading one needed the key.
  const key = range.encrypted ? opts.key : undefined;
  const pin = citation.source.integrity;

  // The path may be gone, which is a verdict that now waits: `git show` reads
  // the file at the recorded commit rather than from disk, so a rename is
  // still answerable.
  const source = await readSource(opts.root, opts.index, range, opts.key);
  const lines = source.kind === "ok" ? splitLines(source.text) : undefined;
  if (source.kind === "missing") result.missingReason = source.reason;
  else result.resolvedPath = source.resolvedPath;

  if (lines !== undefined) {
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
  }

  // One counter for this citation, spent in ladder order by every search below.
  const counter: SearchBudget = { left: opts.budget ?? MOVE_BUDGET_BYTES };

  let history: History = { kind: "none" };
  if (commit !== undefined && (await opts.git.available())) {
    history = await historyOf(opts.git, commit, path, range, pin, key, opts.budget, counter);
  }
  const original = history.kind === "original" ? history.lines : undefined;

  /** The new source as the entry spells sources: a ciphertext stays one. */
  const spellAt = (at: string, start?: number, end?: number): string => {
    const written = range.encrypted && opts.key !== undefined ? encryptSourcePath(at, opts.key) : at;
    return formatSrc({ path: written, encrypted: range.encrypted, ...(start === undefined ? {} : { start, end }) });
  };

  // A whole-file pin has nowhere to move to inside its file.
  if (lines !== undefined && range.start !== undefined) {
    const start = range.start;
    const end = range.end ?? start;
    const search: FindWindowsOptions = { around: start, counter };
    if (original !== undefined) search.original = original;
    const found = findWindows(lines, end - start + 1, pin, key, search);
    if (found.truncated) result.truncatedSearch = true;
    // The file is the entry's own, so it is spelled as the entry spelled it.
    const spell = (at: number): string =>
      formatSrc({ ...range, start: at, end: at + (end - start) });
    const [only] = found.starts;
    if (found.starts.length === 1 && only !== undefined) {
      result.status = "moved";
      result.newSrc = spell(only);
      result.newLines = String(lineSpec({ start: only, end: only + (end - start) }));
      if (range.encrypted) result.resolvedNewPath = path;
      return result;
    }
    if (found.starts.length > 1) {
      result.status = "moved-ambiguous";
      result.candidates = found.starts.map(spell);
      return result;
    }
  }

  // The pin holds nowhere in its own file. Every file the commit touched is
  // asked the same question, and a hit is a move whatever else is true of the
  // old range.
  if (commit !== undefined && original !== undefined) {
    const across = await followAcross(
      { git: opts.git, root: opts.root, index: opts.index, commit, own: path, pin, key, original },
      counter,
    );
    if (across.truncated) {
      result.truncatedSearch = true;
      result.truncatedAcross = true;
    }
    const width = range.start === undefined ? undefined : original.length - 1;
    const spell = (hit: CrossFileHit): string =>
      width === undefined ? spellAt(hit.path) : spellAt(hit.path, hit.start, hit.start + width);
    // This is the one place a source whose path would not read settles as
    // something other than `missing`. A reason was recorded because the old
    // path was gone; the verdict is no longer `missing`, so it does not
    // travel with it.
    if (across.hits.length > 0) delete result.missingReason;
    const [only] = across.hits;
    if (across.hits.length === 1 && only !== undefined) {
      result.status = "moved";
      result.newSrc = spell(only);
      if (width !== undefined) {
        result.newLines = String(lineSpec({ start: only.start, end: only.start + width }));
      }
      if (range.encrypted) result.resolvedNewPath = only.path;
      return result;
    }
    if (across.hits.length > 1) {
      result.status = "moved-ambiguous";
      result.candidates = across.hits.map(spell);
      return result;
    }
  }

  // The path is gone and the pin is nowhere a commit touched.
  if (lines === undefined) return result;

  if (history.kind === "never-true") {
    result.status = "never-true";
    return result;
  }
  result.status = "changed";
  if (history.kind === "unavailable") result.historyAvailable = false;
  if (history.kind === "unknown") result.truncatedSearch = true;
  if (original !== undefined && commit !== undefined) {
    result.historyAvailable = true;
    result.commitsSince = await opts.git.subjectsSince(commit, path);
    result.diff = await opts.git.diffSince(commit, path);
    // Where the old first and last line sit now. The content between them did
    // change, so the status stands; what the span buys is a diff and an
    // `--accept` over the lines the sentence rests on.
    //
    // A whole-file pin is left out for the reason it never moves inside its
    // own file: it has no range, so it has nothing to grow. Its `original` is
    // the whole file as it was, whose first and last line usually do still sit
    // once each, so without this guard it would gain a `source.lines` it never
    // had and `--accept` would quietly narrow the citation to a range.
    const span = range.start === undefined ? undefined : spanOf(lines, original);
    if (span !== undefined) result.newLines = String(lineSpec(span));
  }
  return result;
}
