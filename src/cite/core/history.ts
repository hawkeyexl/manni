/**
 * The claim end read against the page's own history. Proposal 0053 is the
 * record, and the source end's `historyOf` is the shape it follows.
 *
 * A claim that no longer holds says nothing on its own: the pin is a hash, and
 * 0044 chose never to copy the text. So the baseline is derived. It is the
 * newest commit whose page still held the pinned text, found by walking the
 * commits that touched the page, newest first. Nothing is stored, so a squash,
 * a rebase or an uncommitted page cannot make it wrong.
 *
 * With a baseline there are three strings, each normalized the same way.
 * `W0` is the text the pin covered then, `W1` the text the anchor covers now,
 * and `P0` the whole page body then. The claim is **reanchored** when `W0`
 * sits inside `W1` and `W1` sits inside `P0`: every word the pin covered is
 * still there, and every word the claim covers now was on the page already.
 * Anything else is **changed**, which is what the first condition catches for
 * an edit inside the claim and the second for a sentence added beside it.
 */
import type {
  ClaimEnd,
  GitClient,
  InlineStatement,
  PageCitation,
  PageCitations,
  PageLines,
} from "../types.js";
import { spellLines, toBodyLines } from "../../shared/pin.js";
import { claimEnd } from "./claims.js";
import { hashLines, splitLines } from "./hash.js";
import { readPage } from "./page.js";
import { parseLines } from "./range.js";
import { misplacedMarkerAt, movedUnit, unitText } from "./reanchor.js";
import { shortCommit } from "./spell.js";
import { ANY_FENCE, isMarkerLine } from "./statements.js";

/**
 * How many commits that touched the page one walk reads. A page with a long
 * history stops here, and the run says the history ended before the pin held.
 */
export const MAX_PAGE_COMMITS = 256;

/** A page's marker-only lines dropped: the lines whose words a claim is made of. */
export function stripMarkers(lines: readonly string[], format: string): string[] {
  return lines.filter((line) => !isMarkerLine(line, format));
}

/**
 * The words a span of lines holds: marker-only lines dropped, then every run
 * of whitespace collapsed to one space and both ends trimmed. Punctuation,
 * emphasis and inline markup are words here, as 0044 stress test 18 has it.
 */
export function claimWords(lines: readonly string[], format: string): string {
  return stripMarkers(lines, format).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * A text split into sentences, each with its whitespace collapsed and its
 * case dropped. What `update --accept` intersects, so a line that now holds
 * wholly other text is refused rather than blessed.
 */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim().toLowerCase())
    .filter((sentence) => sentence !== "");
}

/** Whether two texts share at least one sentence. */
export function sharesSentence(a: string, b: string): boolean {
  const left = new Set(sentencesOf(a));
  return sentencesOf(b).some((sentence) => left.has(sentence));
}

/** `true` when `inner`'s words sit inside `outer`'s, in order, at word boundaries. */
export function holdsWords(outer: string, inner: string): boolean {
  if (inner === "") return true;
  if (outer === inner) return true;
  if (outer.startsWith(`${inner} `)) return true;
  if (outer.endsWith(` ${inner}`)) return true;
  return outer.includes(` ${inner} `);
}

/**
 * Every run of whole body lines whose words hold `inner`, minimal under
 * containment. The page's words are laid out once with the line each
 * character came from, so a run is read off each occurrence rather than
 * searched for line by line.
 */
export function runsHolding(
  lines: readonly string[],
  format: string,
  bodyLine: number,
  inner: string,
): PageLines[] {
  if (inner === "") return [];
  let text = "";
  const at: number[] = [];
  for (let n = Math.max(bodyLine, 1); n <= lines.length; n++) {
    const line = lines[n - 1] ?? "";
    if (isMarkerLine(line, format)) continue;
    const words = line.replace(/\s+/g, " ").trim();
    if (words === "") continue;
    if (text !== "") {
      text += " ";
      at.push(n);
    }
    for (let i = 0; i < words.length; i++) at.push(n);
    text += words;
  }
  const out: PageLines[] = [];
  let from = 0;
  for (;;) {
    const found = text.indexOf(inner, from);
    if (found === -1) break;
    from = found + 1;
    const before = found === 0 ? " " : text[found - 1];
    const afterAt = found + inner.length;
    const after = afterAt === text.length ? " " : text[afterAt];
    if (before !== " " || after !== " ") continue;
    const start = at[found];
    const end = at[afterAt - 1];
    if (start === undefined || end === undefined) continue;
    if (!out.some((span) => span.start === start && span.end === end)) out.push({ start, end });
  }
  // A run that holds another is not minimal: the tighter one is the claim.
  return out.filter(
    (span) =>
      !out.some(
        (other) =>
          (other.start !== span.start || other.end !== span.end) &&
          other.start >= span.start &&
          other.end <= span.end,
      ),
  );
}

/** What the walk needs to read one entry's history. */
export interface ClaimHistoryInput {
  /** The page as it is now: its format, its body line, and the marker. */
  page: PageCitations;
  entry: PageCitation;
  /** The claim end `claimEnd` classified as `changed`. */
  claim: ClaimEnd;
  /** The page's path, as the client below resolves it. */
  path: string;
  git: GitClient;
  /** The manifest that owns the entry, at the path the config declares now. */
  manifest?: string;
  /** Commits to read. Defaults to `MAX_PAGE_COMMITS`. */
  cap?: number;
}

/**
 * What the page's history says about a claim that no longer holds.
 * `unavailable` is a walk that ran out of commits, so no verdict is safe.
 * `none` is a walk that reached the entry's birth, or a client with no
 * history to read.
 */
export type ClaimHistory =
  | { kind: "unavailable" }
  | { kind: "none" }
  | {
      kind: "baseline";
      /** The newest commit whose page held the pin, as the full hash. */
      commit: string;
      /** Subjects of the commits that touched the page after it, newest first. */
      commitsSince: string[];
      /** `W0`: the words the pin covered at the baseline. */
      words: string;
      /** `P0`: the words the whole page body held at the baseline. */
      pageWords: string;
      /** The pinned lines as they were, for the diff. */
      lines: string[];
      /** The file lines they sat at, for the diff's label. */
      at: string;
    };

/** Whether a line closes the window a marker's anchor may reach. */
function bounds(line: string | undefined): boolean {
  return line === undefined || line.trim() === "" || ANY_FENCE.test(line);
}

/** The plain pin over a span of lines, or undefined when the span is not there. */
function pinOf(lines: readonly string[], span: PageLines): string | undefined {
  if (span.start < 1 || span.end > lines.length || span.end < span.start) return undefined;
  return hashLines(lines.slice(span.start - 1, span.end).join("\n"));
}

/** Where the pin sat in one older page, or why the walk should stop. */
type FoundAt =
  | { kind: "found"; span: PageLines; lines: string[] }
  | { kind: "absent" }
  /** The marker that anchors the entry is not in that page, so nothing older can hold it. */
  | { kind: "no-marker" };

/** One older page, read as this page is read. */
interface ThenPage {
  page: PageCitations;
  lines: string[];
  /** The marker naming the entry, for a marker-anchored one. */
  marker?: InlineStatement;
}

/** An older page, with the marker that named the entry there. */
function readThen(input: ClaimHistoryInput, text: string): ThenPage | undefined {
  const then = readPage(input.page.file, text, { format: input.page.format });
  const lines = splitLines(then.content);
  if (input.entry.citation.claim?.lines !== undefined) return { page: then, lines };
  const id = input.entry.citation.id;
  if (id === undefined) return undefined;
  const marker = then.statements.find(
    (statement) => statement.payload.kind === "ref" && statement.payload.id === id,
  );
  // A marker absent at a commit is looked for no further back: the entry was
  // a claim-lines entry then, or it did not exist.
  if (marker === undefined) return undefined;
  return { page: then, lines, marker };
}

/**
 * Whether the pin held on an older page, read by the classifier itself, and
 * over which lines.
 *
 * The classifier is what decides, rather than a bare search for the bytes,
 * because the baseline has to be the last moment the page *said* what the pin
 * recorded. A commit where the pinned sentence merely sits somewhere inside
 * the anchor is not that moment, and taking it as the baseline would let a
 * sentence added beside the claim pass condition 2 (0053 stress test 5).
 * `claimEnd` already knows today's anchor rule, the rule PR #43 replaced, and
 * 0054's joined unit, so all three read here.
 */
function anchorHeldAt(input: ClaimHistoryInput, then: ThenPage): FoundAt {
  const pin = input.entry.citation.claim?.integrity;
  if (pin === undefined) return { kind: "absent" };
  const was: PageCitation = {
    citation: input.entry.citation,
    origin: input.entry.origin,
    ...(then.marker === undefined ? {} : { marker: then.marker }),
  };
  const split =
    then.marker === undefined
      ? undefined
      : misplacedMarkerAt(then.page, then.lines, then.marker.line, was);
  const end = claimEnd(then.page, was, then.lines, split);
  if (end === null || (end.status !== "current" && end.status !== "moved")) {
    return { kind: "absent" };
  }
  // Which of the two specs held depends on the anchor and the status, so the
  // pin says: it is the one it matches.
  for (const spec of [end.fileLines, end.newFileLines]) {
    const span = spec === undefined ? undefined : parseLines(spec);
    if (span !== undefined && pinOf(then.lines, span) === pin) {
      return { kind: "found", span, lines: then.lines.slice(span.start - 1, span.end) };
    }
  }
  // 0054's case: the pin covered the paragraph a misplaced marker splits,
  // whose lines are not one span.
  if (split !== undefined) {
    const text = unitText(then.lines, split);
    if (hashLines(text.join("\n")) === pin) {
      return { kind: "found", span: movedUnit(split), lines: text };
    }
  }
  return { kind: "absent" };
}

/**
 * The bounded window search, for a marker-anchored pin minted under an anchor
 * rule the tool no longer models. The window runs from the marker to the next
 * blank line or fence, the add rule's own anchor window. A span starts on the
 * marker's line, or on any non-blank, non-marker line inside the window, and
 * ends at or before the window's last line. Only a walk that found no commit
 * where the anchor held asks this, so a wider span never outranks an anchor.
 */
function windowHeldAt(input: ClaimHistoryInput, then: ThenPage): FoundAt {
  const pin = input.entry.citation.claim?.integrity;
  const marker = then.marker;
  if (pin === undefined || marker === undefined) return { kind: "absent" };
  if (input.entry.citation.quote === true) return { kind: "absent" };
  const lines = then.lines;
  let stop = marker.line;
  for (let n = marker.line + 1; n <= lines.length; n++) {
    if (bounds(lines[n - 1])) break;
    stop = n;
  }
  const starts = [marker.line];
  for (let n = marker.line + 1; n <= stop; n++) {
    const line = lines[n - 1] ?? "";
    if (line.trim() === "" || isMarkerLine(line, then.page.format)) continue;
    starts.push(n);
  }
  for (const start of starts) {
    for (let end = start; end <= stop; end++) {
      if (pinOf(lines, { start, end }) === pin) {
        return { kind: "found", span: { start, end }, lines: lines.slice(start - 1, end) };
      }
    }
  }
  return { kind: "absent" };
}

/**
 * Whether the entry is still written down at a commit, which is how the walk
 * knows it has not passed the entry's birth.
 *
 * A manifest-owned entry is asked of the manifest at the path the current
 * config declares. Absent there means no baseline, which is a plainer verdict
 * rather than a wrong one, so the walk stops.
 *
 * A frontmatter entry is asked of the page. A page without the pin is *not*
 * a stop, because either side of a merge is a lineage the other's pins never
 * reached. It only records that the walk saw a page born without the entry.
 */
async function stillWritten(
  input: ClaimHistoryInput,
  commit: string,
  pageText: string,
): Promise<{ stop: boolean; born: boolean }> {
  const pin = input.entry.citation.claim?.integrity;
  if (pin === undefined) return { stop: true, born: true };
  const manifest = input.manifest;
  if (manifest !== undefined) {
    const shown = await input.git.showFile(commit, manifest);
    const held = "text" in shown && shown.text.includes(pin);
    return { stop: !held, born: !held };
  }
  const held = pageText.includes(pin);
  return { stop: false, born: !held };
}

/**
 * The newest commit whose page held the pin, and what it held. Walks the
 * commits that touched the page, newest first, stopping at the entry's birth
 * and at the cap.
 */
export async function claimHistory(input: ClaimHistoryInput): Promise<ClaimHistory> {
  const { git, path } = input;
  if (git.pageCommits === undefined) return { kind: "none" };
  if (!(await git.available())) return { kind: "none" };
  const cap = input.cap ?? MAX_PAGE_COMMITS;
  const history = await git.pageCommits(path, cap);
  const { commits } = history;
  if (commits.length === 0) return { kind: "none" };

  const format = input.page.format;
  const baselineAt = (index: number, then: ThenPage, found: FoundAt): ClaimHistory => {
    if (found.kind !== "found") return { kind: "none" };
    const commit = commits[index];
    if (commit === undefined) return { kind: "none" };
    return {
      kind: "baseline",
      commit: commit.sha,
      commitsSince: commits.slice(0, index).map((c) => c.subject),
      words: claimWords(found.lines, format),
      pageWords: claimWords(then.lines.slice(then.page.bodyLine - 1), format),
      lines: found.lines,
      at: spellLines(found.span),
    };
  };

  /** The pages the walk read, so the fallback search does not re-read them. */
  const examined: ThenPage[] = [];
  let ended: "birth" | "unavailable" | "cap" = "cap";
  /** Whether any commit the walk read was older than the entry. */
  let born = false;
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    if (commit === undefined) continue;
    const shown = await git.showFile(commit.sha, path);
    if (!("text" in shown)) {
      // A commit git cannot show is a shallow boundary; a path absent there
      // is the page's own birth.
      ended = shown.missing === "commit" ? "unavailable" : "birth";
      break;
    }
    const then = readThen(input, shown.text);
    if (then === undefined) {
      ended = "birth";
      break;
    }
    examined.push(then);
    const found = anchorHeldAt(input, then);
    if (found.kind === "found") return baselineAt(i, then, found);
    const written = await stillWritten(input, commit.sha, shown.text);
    if (written.born) born = true;
    if (written.stop) {
      ended = "birth";
      break;
    }
  }

  // No commit held the pin at its anchor. A pin minted under an anchor rule
  // the tool no longer models still deserves a baseline, so the bounded
  // window search reads the same pages once.
  for (const [i, then] of examined.entries()) {
    const found = windowHeldAt(input, then);
    if (found.kind === "found") return baselineAt(i, then, found);
  }

  // Only a walk that reached the entry's birth can say the pin never held; a
  // cut-short one says the history is not all there. A walk that read a page
  // the entry was not on yet has reached that birth, wherever in the list it
  // sat, which is what `born` records.
  if (ended === "birth" || born) return { kind: "none" };
  if (ended === "unavailable") return { kind: "unavailable" };
  return history.truncated || history.shallow ? { kind: "unavailable" } : { kind: "none" };
}

/** A unified diff of the claim's lines, from the baseline to now, with file-line labels. */
export function claimDiff(input: {
  file: string;
  commit: string;
  was: { at: string; lines: readonly string[] };
  now: { at: string; lines: readonly string[] };
}): string {
  const a = input.was.lines;
  const b = input.now.lines;
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const out = [
    `--- ${input.file}@${shortCommit(input.commit)}:${input.was.at}`,
    `+++ ${input.file}:${input.now.at}`,
  ];
  for (const line of a.slice(0, head)) out.push(` ${line}`);
  for (const line of a.slice(head, a.length - tail)) out.push(`-${line}`);
  for (const line of b.slice(head, b.length - tail)) out.push(`+${line}`);
  for (const line of a.slice(a.length - tail)) out.push(` ${line}`);
  return out.join("\n");
}

/** What `refineClaim` needs beyond the history it was given. */
export interface RefineClaimInput extends Omit<ClaimHistoryInput, "git" | "cap"> {
  /** The page now, under the hashing rule. */
  lines: readonly string[];
  history: ClaimHistory;
}

/**
 * The claim end the words test leaves: `reanchored` where only the layout
 * moved, `moved-ambiguous` where the claim's words now sit in several runs,
 * and `changed` with its baseline otherwise.
 */
export function refineClaim(input: RefineClaimInput): ClaimEnd {
  const { claim, history, entry, page, lines } = input;
  if (history.kind === "unavailable") return { ...claim, historyAvailable: false };
  if (history.kind === "none") return claim;
  const format = page.format;
  const base: ClaimEnd = {
    ...claim,
    commitSha: history.commit,
    historyAvailable: true,
    commitsSince: history.commitsSince,
    baselineText: history.lines,
  };
  // The diff is attached whenever there is a baseline, as the source end's
  // is. `pretty` prints it under `--show-diff`, and no other reporter reads it.
  const withDiff = (end: ClaimEnd, now: { at: string; lines: readonly string[] }): ClaimEnd => {
    const diff = claimDiff({
      file: page.file,
      commit: history.commit,
      was: { at: history.at, lines: history.lines },
      now,
    });
    return { ...end, diff };
  };

  // A quote pins source code inside a fence, where collapsing whitespace
  // would hide a real change. So its words test is equality on the lines the
  // hashing rule reads, with only marker lines dropped.
  if (entry.citation.quote === true) {
    const now = claim.text ?? [];
    const same =
      stripMarkers(now, format).join("\n") === stripMarkers(history.lines, format).join("\n");
    const at = claim.fileLines ?? history.at;
    return withDiff(same ? { ...base, status: "reanchored" } : base, { at, lines: now });
  }

  // A marker travels with its text, so the span it anchors now is the claim.
  if (entry.citation.claim?.lines === undefined) {
    const now = claim.text ?? [];
    const w1 = claimWords(now, format);
    const at = claim.fileLines ?? history.at;
    const held = holdsWords(w1, history.words) && holdsWords(history.pageWords, w1);
    return withDiff(held ? { ...base, status: "reanchored" } : base, { at, lines: now });
  }

  const runs = runsHolding(lines, format, page.bodyLine, history.words);
  const [only] = runs;
  if (runs.length > 1) {
    return {
      ...claim,
      status: "moved-ambiguous",
      candidates: runs.map((span) => spellLines(toBodyLines(span, page.bodyLine))),
      candidateFileLines: runs.map(spellLines),
    };
  }
  if (only === undefined) {
    return withDiff(base, { at: claim.fileLines ?? history.at, lines: claim.text ?? [] });
  }
  const now = lines.slice(only.start - 1, only.end);
  const w1 = claimWords(now, format);
  if (!holdsWords(history.pageWords, w1)) {
    return withDiff(base, { at: claim.fileLines ?? history.at, lines: claim.text ?? [] });
  }
  return withDiff(
    {
      ...base,
      status: "reanchored",
      newLines: spellLines(toBodyLines(only, page.bodyLine)),
      newFileLines: spellLines(only),
    },
    { at: spellLines(only), lines: now },
  );
}
