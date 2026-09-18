/**
 * `manni cite update`: repair what moved; with `--accept`, re-pin what changed.
 *
 * A moved end gets its `lines` spliced where it stands, so comments and
 * quoting are untouched: `claim.lines` for a claim found verbatim elsewhere on
 * the page, `source.lines` for a source found elsewhere in its file. A marker
 * never moves, because it travels with its own text.
 *
 * `--accept` re-pins a changed end. A claim is re-pinned over the paragraph,
 * fenced block or table rows now at its first line, and the report prints that
 * text, so the log shows exactly what was accepted. A paragraph grows with the
 * sentence it gained; a table keeps the number of rows the claim was minted
 * over, because a row is a statement of its own. A claim it cannot re-pin is
 * skipped with the reason named, and a sentence that was reworded *and* moved
 * is an `add` again. A source is re-minted at HEAD, with a new `commit-sha`
 * where the entry records one.
 *
 * Every finding the run did not resolve is reported as skipped, and an
 * error-severity one is work left undone: exit 1, as `fill` has it. Writes by
 * default (0025).
 */
import { resolve } from "node:path";
import { writeFileAtomic } from "../../meta/index.js";
import { STDIN_LABEL } from "../../meta/internal.js";
import { checkCitations } from "../core/check-page.js";
import {
  noUnitAt,
  normalizeWhitespace,
  pinOfLines,
  toBodyLines,
  toFileLines,
  unitAt,
  type ClaimUnit,
  type NoUnit,
} from "../core/claims.js";
import { GIT_UNAVAILABLE_COMMIT } from "../core/git.js";
import { splitLines } from "../core/hash.js";
import { claimWords, sharesSentence } from "../core/history.js";
import { mintCitation } from "../core/mint.js";
import { ManifestSet } from "../core/manifest.js";
import { readPage } from "../core/page.js";
import { lineSpec, parseLines, spellLines, tooWide } from "../core/range.js";
import {
  applyMarkerMoves,
  misplacedMarkers,
  type MisplacedMarker,
} from "../core/reanchor.js";
import { resolveSeverity } from "../core/severity.js";
import { listOf, spellAt } from "../core/spell.js";
import { anchoredLines, markerIndent, offsetOfLine } from "../core/statements.js";
import { spliceEntryField, unifiedDiff } from "../core/write.js";
import { CiteError } from "../errors.js";
import type {
  Citation,
  CitationResult,
  CiteRule,
  ClaimEnd,
  LineSpec,
  ManifestChange,
  PageCitation,
  PageCitationReport,
  PageCitations,
  PageLines,
  UpdateOptions,
  UpdatePage,
  UpdateRewrite,
  UpdateRun,
} from "../types.js";
import {
  assertNoOrphanJoins,
  assertNoOrphans,
  joinHits,
  prepareRun,
  readTarget,
  sayNotices,
} from "./check.js";

type Plan =
  | { kind: "claim-moved"; result: CitationResult; lines: LineSpec; from: string; to: string }
  | { kind: "source-moved"; result: CitationResult; lines: LineSpec; to: string }
  | {
      kind: "claim-accepted";
      result: CitationResult;
      unit: ClaimUnit;
      pin: string;
      lines?: LineSpec;
      /**
       * The line held wholly other text and `--only` named the entry, so the
       * accept stands. The report says so rather than reading as an edit.
       */
      replaced?: true;
      /** The marker's line on the page this run leaves, where one anchors. */
      markerLine?: number;
    }
  | { kind: "source-accepted"; result: CitationResult; minted: Citation }
  | { kind: "marker-moved"; result: CitationResult; from: number; to: number }
  | {
      kind: "claim-reanchored";
      result: CitationResult;
      pin: string;
      /** The span that held, in file lines, and the span now pinned. */
      held: string;
      now: string;
    }
  | {
      kind: "claim-shifted";
      result: CitationResult;
      lines: LineSpec;
      from: string;
      to: string;
    }
  /**
   * The words the pin covered are unchanged and only the layout moved
   * (proposal 0053). A plain `update` re-pins it, and rewrites its `lines:`
   * when the entry has them.
   */
  | {
      kind: "claim-words-held";
      result: CitationResult;
      pin: string;
      /** The file line of the claim's first body line, after any marker move. */
      at: number;
      /** The stored span and the span now pinned, in file lines. */
      fromLines: string;
      toLines: string;
      commitSha?: string;
      lines?: LineSpec;
    }
  /**
   * A changed claim `--accept` refused to re-pin: the line now holds text
   * sharing no sentence with the claim at its baseline. Nothing is written.
   */
  | {
      kind: "claim-replaced";
      result: CitationResult;
      at: number;
      commitSha: string;
      /** The pin that stands, and the one that was not written. */
      pin: string;
      would: string;
    };

/**
 * Why one repair was declined, and the rule whose finding says so. One entry
 * can carry findings about both ends, so the reason names which it is about.
 */
interface Declined {
  rule: string;
  why: string;
}

/**
 * Why `--accept` re-pinned nothing at the claim's line, said plainly. Each
 * reason is a different problem: a blank line lost the sentence, a fenced line
 * moved it into code, a line that starts no paragraph is a heading underline
 * or an unclosed fence, a line outside the body is a range the page no longer
 * reaches, and a short table lost rows the claim was minted over.
 */
function sayNoUnit(reason: NoUnit): string {
  switch (reason) {
    case "outside":
      return "the line is outside the page body";
    case "blank":
      return "the line is blank";
    case "fenced":
      return "the line sits inside a fenced block";
    case "not-a-paragraph":
      return "the line does not start a paragraph";
    case "table-short":
      return "the table no longer holds every row the claim covers";
  }
}

/** The rule a plan settles, so its finding is not also reported as skipped. */
function settles(plan: Plan): string {
  switch (plan.kind) {
    case "claim-moved":
      return "claim-moved";
    case "source-moved":
      return "source-moved";
    case "claim-accepted":
      return "claim-changed";
    case "source-accepted":
      return plan.result.source.status === "never-true" ? "source-never-true" : "source-changed";
    case "marker-moved":
      return "marker-misplaced";
    case "claim-reanchored":
      return "claim-moved";
    case "claim-words-held":
      return "claim-reanchored";
    // A refused claim leaves nothing written, but its finding is the row the
    // refusal prints, so it is not also reported as skipped.
    case "claim-replaced":
      return "claim-changed";
    // A shifted entry was `current`, so it had no finding to settle.
    case "claim-shifted":
      return "";
  }
}

function apply(content: string, format: string, plan: Plan): string {
  const index = plan.result.origin.index;
  switch (plan.kind) {
    case "claim-moved":
    case "claim-shifted":
      return spliceEntryField(content, format, index, ["claim", "lines"], plan.lines);
    case "claim-reanchored":
      return spliceEntryField(content, format, index, ["claim", "integrity"], plan.pin);
    case "claim-words-held": {
      let out = spliceEntryField(content, format, index, ["claim", "integrity"], plan.pin);
      if (plan.lines !== undefined) {
        out = spliceEntryField(out, format, index, ["claim", "lines"], plan.lines);
      }
      return out;
    }
    // Nothing is written for a refused claim; the report is the whole of it.
    case "claim-replaced":
    // The move is a page rewrite, applied to the whole page before any splice.
    case "marker-moved":
      return content;
    case "source-moved":
      return spliceEntryField(content, format, index, ["source", "lines"], plan.lines);
    case "claim-accepted": {
      let out = spliceEntryField(content, format, index, ["claim", "integrity"], plan.pin);
      if (plan.lines !== undefined) {
        out = spliceEntryField(out, format, index, ["claim", "lines"], plan.lines);
      }
      return out;
    }
    case "source-accepted": {
      let out = spliceEntryField(
        content,
        format,
        index,
        ["source", "integrity"],
        plan.minted.source.integrity,
      );
      const commit = plan.minted.source["commit-sha"];
      // An entry with no `commit-sha:` line of its own keeps none: the splice
      // replaces a scalar, it does not add a key.
      if (commit !== undefined) {
        out = spliceEntryField(out, format, index, ["source", "commit-sha"], commit);
      }
      return out;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The same repair, against an entry that lives in a manifest. The page's
 * whole `citations` value is written back at the end of the run, so a repair
 * here is an edit to the parsed entry rather than a splice of one scalar.
 * An entry the writer cannot reach — a list item that is not a mapping —
 * leaves its finding reported.
 */
function applyToEntry(entry: unknown, plan: Plan): boolean {
  if (!isRecord(entry)) return false;
  const end = (name: "claim" | "source"): Record<string, unknown> | undefined =>
    isRecord(entry[name]) ? entry[name] : undefined;
  switch (plan.kind) {
    case "claim-moved":
    case "claim-shifted": {
      const claim = end("claim");
      if (claim === undefined) return false;
      claim.lines = plan.lines;
      return true;
    }
    case "claim-reanchored": {
      const claim = end("claim");
      if (claim === undefined) return false;
      claim.integrity = plan.pin;
      return true;
    }
    case "claim-words-held": {
      const claim = end("claim");
      if (claim === undefined) return false;
      claim.integrity = plan.pin;
      if (plan.lines !== undefined) claim.lines = plan.lines;
      return true;
    }
    // Nothing is written for a refused claim.
    case "claim-replaced":
    // The page holds the marker, so the manifest has nothing to change.
    case "marker-moved":
      return true;
    case "source-moved": {
      const source = end("source");
      if (source === undefined) return false;
      source.lines = plan.lines;
      return true;
    }
    case "claim-accepted": {
      const claim = end("claim");
      if (claim === undefined) return false;
      claim.integrity = plan.pin;
      if (plan.lines !== undefined) claim.lines = plan.lines;
      return true;
    }
    case "source-accepted": {
      const source = end("source");
      if (source === undefined) return false;
      source.integrity = plan.minted.source.integrity;
      const commit = plan.minted.source["commit-sha"];
      // As on a page: a re-mint records a commit only where the entry
      // already recorded one, so this never adds the key.
      if (commit !== undefined) source["commit-sha"] = commit;
      return true;
    }
  }
}

function rewriteOf(plan: Plan): UpdateRewrite {
  const { citation, origin, source } = plan.result;
  const base: Pick<UpdateRewrite, "id" | "index" | "line"> = { index: origin.index };
  if (citation.id !== undefined) base.id = citation.id;
  if (origin.line !== undefined) base.line = origin.line;

  switch (plan.kind) {
    case "claim-moved":
      return {
        ...base,
        end: "claim",
        reason: "moved",
        status: "moved",
        from: plan.from,
        to: plan.to,
        fromLines: plan.from,
        toLines: plan.to,
      };
    case "marker-moved": {
      const from = String(plan.from);
      const to = String(plan.to);
      return {
        ...base,
        end: "marker",
        reason: "re-anchored",
        status: "misplaced",
        from,
        to,
        fromLines: from,
        toLines: to,
      };
    }
    case "claim-reanchored": {
      const was = citation.claim?.integrity ?? "";
      return {
        ...base,
        end: "claim",
        reason: "re-anchored",
        status: "moved",
        from: was,
        to: plan.pin,
        fromPin: was,
        toPin: plan.pin,
        lines: plan.held,
        newLines: plan.now,
      };
    }
    case "claim-words-held": {
      const was = citation.claim?.integrity ?? "";
      const out: UpdateRewrite = {
        ...base,
        end: "claim",
        reason: "re-anchored",
        status: "reanchored",
        from: was,
        to: plan.pin,
        fromPin: was,
        toPin: plan.pin,
        fromLines: plan.fromLines,
        toLines: plan.toLines,
        at: plan.at,
      };
      if (plan.commitSha !== undefined) out.commitSha = plan.commitSha;
      return out;
    }
    case "claim-replaced":
      return {
        ...base,
        end: "claim",
        reason: "replaced",
        status: "changed",
        from: plan.pin,
        to: plan.would,
        fromPin: plan.pin,
        toPin: plan.would,
        at: plan.at,
        commitSha: plan.commitSha,
      };
    case "claim-shifted":
      return {
        ...base,
        end: "claim",
        reason: "shifted",
        status: "current",
        from: plan.from,
        to: plan.to,
        fromLines: plan.from,
        toLines: plan.to,
      };
    case "source-moved":
      return {
        ...base,
        end: "source",
        reason: "moved",
        status: "moved",
        from: source.src,
        to: plan.to,
      };
    case "claim-accepted": {
      const was = citation.claim?.integrity ?? "";
      const out: UpdateRewrite = {
        ...base,
        end: "claim",
        reason: "accepted",
        // A bypassed guard reads `replaced`, so the log shows that the line
        // held other text and a named accept took it anyway.
        status: plan.replaced === true ? "replaced" : "changed",
        from: was,
        to: plan.pin,
        fromPin: was,
        toPin: plan.pin,
        at: plan.unit.lines.start,
        text: quoted(plan.unit.text),
      };
      // A re-pin over a unit wider than the stored lines names both spans.
      const stored = plan.result.claim?.fileLines;
      const now = spellLines(plan.unit.lines);
      if (stored !== undefined && stored !== now) {
        out.fromLines = stored;
        out.toLines = now;
      }
      // Where the report says the claim is: its marker, when one anchors it.
      // A marker this run moved reads at the line it now sits on, so the row
      // and the move above it name one line rather than two.
      const markerLine =
        plan.markerLine ?? (plan.result.anchor === "marker" ? plan.result.markerLine : undefined);
      if (markerLine !== undefined) out.markerLine = markerLine;
      return out;
    }
    case "source-accepted": {
      const out: UpdateRewrite = {
        ...base,
        end: "source",
        reason: "accepted",
        status: source.status === "never-true" ? "never-true" : "changed",
        from: citation.source.integrity,
        to: plan.minted.source.integrity,
        fromPin: citation.source.integrity,
        toPin: plan.minted.source.integrity,
        src: source.src,
      };
      const commit = plan.minted.source["commit-sha"];
      if (commit !== undefined) out.commitSha = commit;
      return out;
    }
  }
}

/**
 * The baseline, when a re-pin over `text` would bless a line that now holds
 * wholly other text: a neighbouring table row after a shift, or a block
 * inserted under a marker. `undefined` lets the accept stand, which is also
 * what happens with no baseline to read the claim against.
 *
 * The test is sentence intersection. A claim whose paragraph was edited still
 * shares a sentence with what it said at the baseline; one whose line was
 * replaced shares none.
 *
 * The guard only asks about an entry the run did not name. Naming an id with
 * `--only` is the human judgement the guard exists to demand, so a reviewer
 * who has read the claim and its source re-pins a reworded sentence without a
 * remove and an add. What the guard is for is a blanket `--accept` quietly
 * re-pinning a hundred claims, one of which now holds a neighbouring table
 * row. A bypass is reported rather than hidden.
 */
function replacementAt(
  claim: ClaimEnd,
  text: readonly string[],
  format: string,
): string | undefined {
  const was = claim.baselineText;
  const commit = claim.commitSha;
  if (was === undefined || commit === undefined) return undefined;
  if (sharesSentence(claimWords(was, format), claimWords(text, format))) return undefined;
  return commit;
}

/** How many characters of re-pinned text the report quotes before it elides. */
const QUOTE_CAP = 200;

/**
 * The text a re-pin quotes: whitespace collapsed, and capped, because the
 * unit may be a whole paragraph and the report is one line per rewrite.
 */
function quoted(text: readonly string[]): string {
  const all = normalizeWhitespace(text.join("\n"));
  return all.length <= QUOTE_CAP ? all : `${all.slice(0, QUOTE_CAP)}…`;
}

/** `<id>: <text>`, or the text alone for an entry with no id. */
function named(id: string | undefined, text: string): string {
  return id === undefined ? text : `${id}: ${text}`;
}

/** One misplaced marker `update` left where it is, and the rule its line reads at. */
interface MarkerStay {
  line: number;
  rule: CiteRule;
  message: string;
}

/** What `update` will do to a page's misplaced markers. */
interface MarkerDecisions {
  moves: { result: CitationResult; entry: PageCitation; misplaced: MisplacedMarker }[];
  stays: MarkerStay[];
}

/**
 * A claim-lines entry the move would change: one whose range holds the
 * marker's line, or starts above the unit and reaches the place the marker
 * goes. Moving the marker would rewrite that entry's pinned text.
 */
function crossing(
  page: PageCitations,
  misplaced: MisplacedMarker,
): string | undefined {
  for (const other of page.citations) {
    const spec = other.citation.claim?.lines;
    const recorded = spec === undefined ? undefined : parseLines(spec);
    if (recorded === undefined) continue;
    const file = toFileLines(recorded, page.bodyLine);
    const holdsMarker = file.start <= misplaced.line && misplaced.line <= file.end;
    const holdsPlace = file.start < misplaced.place && misplaced.place <= file.end;
    if (!holdsMarker && !holdsPlace) continue;
    return other.citation.id === undefined
      ? `the claim at ${spellAt(file)}`
      : `the claim of ${other.citation.id} (${spellAt(file)})`;
  }
  return undefined;
}

/**
 * Which of a page's misplaced markers move, and why each of the rest stays.
 * Every decision is taken against the page as it was read, before any write.
 */
function decideMarkers(input: {
  page: PageCitations;
  report: PageCitationReport;
  lines: readonly string[];
  accept: boolean;
  only?: Set<string>;
}): MarkerDecisions {
  const { page, report, lines, accept, only } = input;
  const out: MarkerDecisions = { moves: [], stays: [] };
  for (const misplaced of misplacedMarkers(page, lines)) {
    const entry = misplaced.entry;
    const line = misplaced.line;
    const stay = (rule: CiteRule, message: string): void => {
      out.stays.push({ line, rule, message });
    };
    // An orphan, repeated or invalid marker names no entry that can be
    // checked, and `--only` selects entries, so it selects their markers.
    if (entry === undefined) {
      if (only !== undefined) continue;
      const own = report.findings.find(
        (finding) => finding.line === line && finding.rule.startsWith("marker-") && finding.rule !== "marker-misplaced",
      );
      stay(
        own?.rule ?? "marker-orphan",
        `the marker at line ${String(line)} stays, because it names no entry update can check.`,
      );
      continue;
    }
    const id = entry.citation.id;
    if (only !== undefined && (id === undefined || !only.has(id))) continue;
    const result = report.citations.find((r) => r.origin.index === entry.origin.index);
    if (result === undefined) continue;
    // Claim lines and a marker both: neither anchor can be trusted.
    if (entry.citation.claim?.lines !== undefined) {
      stay(
        "anchor-invalid",
        named(id, `the marker at line ${String(line)} stays, because the entry also has claim lines. Keep one.`),
      );
      continue;
    }
    const across = crossing(page, misplaced);
    if (across !== undefined) {
      stay(
        "marker-misplaced",
        named(id, `the marker at line ${String(line)} stays, because moving it would change ${across}.`),
      );
      continue;
    }
    if (result.claim !== null && result.claim.status === "changed" && !accept) {
      stay(
        "marker-misplaced",
        named(
          id,
          `the marker at line ${String(line)} stays, because its claim changed since it was pinned. update --accept moves it and re-pins.`,
        ),
      );
      continue;
    }
    out.moves.push({ result, entry, misplaced });
  }
  return out;
}

/**
 * The lines the span an entry's marker anchors covers on the page as it now
 * stands, and the pin over them.
 */
function anchoredNow(
  content: string,
  format: string,
  lines: readonly string[],
  markerLine: number,
  quote: boolean,
): { span: PageLines; pin: string } | undefined {
  const at = offsetOfLine(content, markerLine) + (lines[markerLine - 1]?.length ?? 0);
  const span = anchoredLines(content, at, format, quote);
  if (span === undefined) return undefined;
  const pin = pinOfLines(lines, span);
  return pin === undefined ? undefined : { span, pin };
}

/** The errno a failed write carries, when it carries one. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code: unknown = error.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * A run writes a page and the manifest that keys it, and a marker move needs
 * both to land. So every file this run wrote, page and manifest alike, keeps
 * its original text until the run is done, and a failed write puts them back.
 * A manifest left pinned to text its page no longer holds would read as drift
 * that never happened.
 */
class WrittenFiles {
  private readonly before = new Map<string, string>();
  private readonly labels = new Map<string, string>();

  /** Remember what `path` held before this run wrote it. */
  record(path: string, label: string, content: string): void {
    if (!this.before.has(path)) {
      this.before.set(path, content);
      this.labels.set(path, label);
    }
  }

  /**
   * Put every file back, and say what happened: `<file> could not be written
   * (<code>). <pages> was restored.`
   */
  async restore(file: string, error: unknown): Promise<CiteError> {
    const restored: string[] = [];
    const failed: string[] = [];
    for (const [path, content] of this.before) {
      const label = this.labels.get(path) ?? path;
      try {
        await writeFileAtomic(path, content);
        restored.push(label);
      } catch {
        failed.push(label);
      }
    }
    const code = codeOf(error);
    const why = code === undefined ? "" : ` (${code})`;
    const parts = [`${file} could not be written${why}.`];
    if (restored.length > 0) {
      parts.push(`${listOf(restored)} ${restored.length === 1 ? "was" : "were"} restored.`);
    }
    if (failed.length > 0) {
      parts.push(
        `${listOf(failed)} could not be restored, and ${failed.length === 1 ? "holds" : "hold"} an intermediate state.`,
      );
    }
    return new CiteError(parts.join(" "));
  }
}

/**
 * Citations counted as a summary counts them: an entry whose marker moved and
 * whose claim was re-pinned is one citation, not two.
 */
function citationsIn(rows: readonly UpdateRewrite[]): number {
  const withMarker = new Set(rows.filter((row) => row.end === "marker").map((row) => row.index));
  return withMarker.size + rows.filter((row) => !withMarker.has(row.index)).length;
}

export async function runUpdate(opts: UpdateOptions): Promise<UpdateRun> {
  const prepared = await prepareRun(opts, "updated", "update", { require: true });
  const { run, files, usingStdin, forced, pageOptions, git } = prepared;
  assertNoOrphans(prepared);
  const hits = joinHits();
  // Each manifest is read once and written once, however many of its pages
  // the run repairs.
  const manifests = new ManifestSet();
  // What every file this run wrote held before, so a failed write is undone.
  const writes = new WrittenFiles();
  const only = opts.only !== undefined && opts.only.length > 0 ? new Set(opts.only) : undefined;
  const accept = opts.accept === true;

  /** What this citation needs, in the order the repairs are worth trying. */
  const plansFor = async (
    result: CitationResult,
    entry: PageCitation | undefined,
    page: PageCitations,
    lines: readonly string[],
    lineNow: (line: number) => number,
    declined: Map<number, Declined>,
  ): Promise<Plan[]> => {
    const out: Plan[] = [];
    const claim = result.claim;
    // A marker-anchored claim has no `lines:` to splice; its repair is a
    // re-pin over the span the marker anchors, planned by the caller.
    if (
      result.anchor !== "marker" &&
      claim !== null &&
      claim.status === "moved" &&
      claim.newLines !== undefined
    ) {
      const at = parseLines(claim.newLines);
      // A marker that moved shifted the page under the window the search
      // found, so the lines it reported are read through the move.
      const shifted =
        at === undefined
          ? undefined
          : (() => {
              const file = toFileLines(at, page.bodyLine);
              const to = { start: lineNow(file.start), end: lineNow(file.end) };
              return to.end - to.start === file.end - file.start
                ? toBodyLines(to, page.bodyLine)
                : undefined;
            })();
      if (at !== undefined && shifted !== undefined) {
        out.push({
          kind: "claim-moved",
          result,
          lines: lineSpec(shifted),
          from: claim.fileLines ?? "",
          to: spellLines(toFileLines(shifted, page.bodyLine)),
        });
      }
    }
    // The words the pin covered are unchanged, and the run they sit in moved.
    // A plain `update` re-pins it and rewrites the entry's lines (0053).
    if (
      result.anchor !== "marker" &&
      claim !== null &&
      claim.status === "reanchored" &&
      claim.newLines !== undefined
    ) {
      const at = parseLines(claim.newLines);
      const file = at === undefined ? undefined : toFileLines(at, page.bodyLine);
      const pin = file === undefined ? undefined : pinOfLines(lines, file);
      const to =
        file === undefined ? undefined : { start: lineNow(file.start), end: lineNow(file.end) };
      if (
        file !== undefined &&
        to !== undefined &&
        pin !== undefined &&
        to.end - to.start === file.end - file.start
      ) {
        const plan: Plan = {
          kind: "claim-words-held",
          result,
          pin,
          at: to.start,
          fromLines: claim.fileLines ?? "",
          toLines: spellLines(to),
          lines: lineSpec(toBodyLines(to, page.bodyLine)),
        };
        if (claim.commitSha !== undefined) plan.commitSha = claim.commitSha;
        out.push(plan);
      }
    }
    if (result.source.status === "moved" && result.source.newLines !== undefined) {
      const at = parseLines(result.source.newLines);
      if (at !== undefined && result.source.newSrc !== undefined) {
        out.push({ kind: "source-moved", result, lines: lineSpec(at), to: result.source.newSrc });
      }
    }
    if (!accept) return out;

    // A marker-anchored claim is re-pinned against the page the move left,
    // so the caller plans that one.
    if (claim !== null && claim.status === "changed" && entry !== undefined && result.anchor !== "marker") {
      // The paragraph, block or row now at the claim's first line. Anything
      // else is left for a fresh `cite add`, and says why.
      // The span the claim holds now, and the line it starts on. A table keeps
      // the span: the author chose how many rows the claim covers, and
      // `--accept` re-mints, never redesigns.
      //
      // Both are set for every claim that reaches here. `claimEnd` fills
      // `fileLines` only on the `claim.lines` branch, and the marker branch is
      // already excluded above, so the `undefined` arms below are the types
      // being honest rather than a case a run can land in.
      const held = claim.fileLines === undefined ? undefined : parseLines(claim.fileLines);
      const at = held?.start;
      const unit: ClaimUnit | undefined =
        at === undefined ? undefined : unitAt(page, at, lines, held);
      const wantsBlock = entry.citation.quote === true;
      const pin = unit === undefined ? undefined : pinOfLines(lines, unit.lines);
      // A unit past the range limit would pin more than a citation may hold.
      const wide = unit === undefined ? undefined : tooWide(unit.lines);
      if (unit !== undefined && wide !== undefined) {
        declined.set(result.origin.index, {
          rule: "claim-changed",
          why: `Not re-pinned: the ${unit.kind} ${wide}.`,
        });
      } else if (unit === undefined) {
        const why = at === undefined ? undefined : noUnitAt(page, at, lines, held);
        if (why !== undefined) {
          declined.set(result.origin.index, {
            rule: "claim-changed",
            why: `Not re-pinned: ${sayNoUnit(why)}.`,
          });
        }
      } else if (pin !== undefined && (!wantsBlock || unit.kind === "block")) {
        const replaced = replacementAt(claim, unit.text, page.format);
        // `plansFor` runs only for a selected entry, so a run with `only` set
        // has named this one. `selected` says which repairs run; the bypass
        // says which entries `--accept` may re-pin, and both hold here.
        if (replaced !== undefined && only === undefined) {
          out.push({
            kind: "claim-replaced",
            result,
            at: unit.lines.start,
            commitSha: replaced,
            pin: entry.citation.claim?.integrity ?? "",
            would: pin,
          });
        } else {
          const plan: Plan = { kind: "claim-accepted", result, unit, pin };
          if (replaced !== undefined) plan.replaced = true;
          // A paragraph that grew or shrank moves the claim's last line too.
          if (entry.citation.claim?.lines !== undefined) {
            const body = toBodyLines(unit.lines, page.bodyLine);
            const recorded = parseLines(entry.citation.claim.lines);
            if (
              recorded === undefined ||
              recorded.start !== body.start ||
              recorded.end !== body.end
            ) {
              plan.lines = lineSpec(body);
            }
          }
          out.push(plan);
        }
      }
    }
    if (result.source.status === "changed" || result.source.status === "never-true") {
      try {
        // The source as the entry spells it: an encrypted one stays encrypted,
        // under the key it decrypted with, and mint keys the pin accordingly.
        // HEAD is recorded only where the entry already records a commit.
        const minted = await mintCitation({
          root: run.root,
          src: result.source.src,
          ...(run.key === undefined ? {} : { key: run.key }),
          ...(result.citation.source["commit-sha"] === undefined
            ? { commitSha: false as const }
            : {}),
          gitClient: git,
          ...(pageOptions.sourceIndex === undefined
            ? {}
            : { sourceIndex: pageOptions.sourceIndex }),
        });
        out.push({ kind: "source-accepted", result, minted });
      } catch (error) {
        // A range the file no longer reaches cannot be re-minted; its finding stays reported.
        if (!(error instanceof CiteError)) throw error;
      }
    }
    return out;
  };

  const pages: UpdatePage[] = [];
  const updateOne = async (
    label: string,
    content: string,
    path?: string,
  ): Promise<PageCitationReport> => {
    const setup = prepared.setupFor(label, content);
    if (setup.sidecar !== undefined) hits.record(setup.sidecar, label);
    const report = await checkCitations({ file: label, content, format: forced?.name }, setup.options);
    const { format } = report;
    const severity = resolveSeverity(setup.options.severity);
    const page = readPage(label, content, {
      ...(forced === undefined ? {} : { format: forced.name }),
      ...(setup.options.citations === undefined ? {} : { citations: setup.options.citations }),
      ...(setup.options.owned === undefined ? {} : { owned: setup.options.owned }),
    });
    const lines = splitLines(content);
    const rewritten: UpdateRewrite[] = [];
    const refused: UpdateRewrite[] = [];
    /** `<index>\0<rule>` of every finding a rewrite settled. */
    const settled = new Set<string>();
    /**
     * Why a repair was declined, by entry index, said with the skipped
     * finding it concerns. The rule is carried so the reason lands on that
     * finding and not on another one about the same entry.
     */
    const declined = new Map<number, Declined>();

    // Misplaced markers first: the page is rewritten once, with every movable
    // marker relocated, and every pin below is taken against that page.
    const markers = decideMarkers({ page, report, lines, accept, only });
    const movedPage =
      markers.moves.length === 0
        ? undefined
        : applyMarkerMoves(
            content,
            markers.moves.map(({ misplaced }) => ({
              from: misplaced.line,
              place: misplaced.place,
            })),
            (line) => markerIndent(content, line, format, page.bodyLine),
          );
    let after = movedPage?.content ?? content;
    const afterLines = movedPage === undefined ? lines : splitLines(after);
    const movedIndexes = new Set(markers.moves.map(({ entry }) => entry.origin.index));
    const lineNow = (line: number): number => movedPage?.line(line) ?? line;
    // The manifest's entries for this page, edited in memory and written
    // back as one value once the page is done.
    const owner = setup.sidecar?.owner;
    const entries: unknown[] | undefined =
      setup.sidecar?.citations === undefined
        ? undefined
        : (JSON.parse(JSON.stringify(setup.sidecar.citations.map((c) => c.entry))) as unknown[]);
    let manifestDirty = false;
    for (const result of report.citations) {
      // `--only` selects the repairs to make. It does not select the shift a
      // marker move forces on the entries below it, which is planned for
      // every entry further down.
      const selected =
        only === undefined ||
        (result.citation.id !== undefined && only.has(result.citation.id));
      const entry = page.citations.find((c) => c.origin.index === result.origin.index);
      const plans: Plan[] = [];

      const move = selected
        ? markers.moves.find((m) => m.entry.origin.index === result.origin.index)
        : undefined;
      if (move !== undefined) {
        plans.push({
          kind: "marker-moved",
          result,
          from: move.misplaced.line,
          to: lineNow(move.misplaced.line),
        });
      }
      // The pin a marker anchors is taken against the page the moves left, so
      // the next check reads it as current however the run split.
      const marker = entry?.marker;
      const recorded = entry?.citation.claim?.integrity;
      if (
        selected &&
        result.anchor === "marker" &&
        marker !== undefined &&
        recorded !== undefined &&
        result.claim !== null
      ) {
        const quote = entry?.citation.quote === true;
        const now = anchoredNow(after, format, afterLines, lineNow(marker.line), quote);
        const status = result.claim.status;
        if (now !== undefined && now.pin !== recorded) {
          // A `current` claim already covers the unit the marker belongs to,
          // so only a move that split its run can leave it needing a pin.
          const unitText = afterLines.slice(now.span.start - 1, now.span.end);
          if (status === "moved" || (status === "current" && move !== undefined)) {
            plans.push({
              kind: "claim-reanchored",
              result,
              pin: now.pin,
              held: result.claim.fileLines ?? "",
              now: spellLines(now.span),
            });
          } else if (status === "reanchored") {
            // The marker travels with its text, so nothing moves but the pin.
            const held: Plan = {
              kind: "claim-words-held",
              result,
              pin: now.pin,
              at: now.span.start,
              fromLines: result.claim.fileLines ?? "",
              toLines: spellLines(now.span),
            };
            if (result.claim.commitSha !== undefined) held.commitSha = result.claim.commitSha;
            plans.push(held);
          } else if (status === "changed" && accept) {
            const kind = quote ? "block" : "paragraph";
            // A marker pins everything it anchors, so the range limit applies
            // to that, exactly as it does to a claim-lines re-pin.
            const wide = tooWide(now.span);
            if (wide !== undefined) {
              declined.set(result.origin.index, {
                rule: "claim-changed",
                why: `Not re-pinned: the ${kind} ${wide}.`,
              });
            } else {
              const replaced = replacementAt(result.claim, unitText, format);
              // `--only` naming the entry is the judgement the guard demands,
              // so a named accept stands and says `replaced` in the log.
              plans.push(
                replaced === undefined || only !== undefined
                  ? {
                      kind: "claim-accepted",
                      result,
                      pin: now.pin,
                      markerLine: lineNow(marker.line),
                      unit: { lines: now.span, kind, text: unitText },
                      ...(replaced === undefined ? {} : { replaced: true as const }),
                    }
                  : {
                      kind: "claim-replaced",
                      result,
                      at: now.span.start,
                      commitSha: replaced,
                      pin: recorded,
                      would: now.pin,
                    },
              );
            }
          }
        }
      }

      if (selected) {
        plans.push(...(await plansFor(result, entry, page, lines, lineNow, declined)));
      }

      // A claim-lines entry the moves pushed along keeps its pinned text, so
      // its lines are rewritten in the same write. This one runs outside
      // `--only`: the page has already moved under the entry, so leaving its
      // lines behind would need a second run to put right.
      const spec = entry?.citation.claim?.lines;
      // A claim whose text moved is repaired by `claim-moved`, which finds
      // where the text went. Shifting its lines by the marker's delta would
      // point them somewhere else again, so the shift leaves it alone.
      const wentElsewhere = result.claim?.status === "moved";
      if (
        movedPage !== undefined &&
        spec !== undefined &&
        !wentElsewhere &&
        !plans.some((p) => p.kind === "claim-moved")
      ) {
        const at = parseLines(spec);
        const file = at === undefined ? undefined : toFileLines(at, page.bodyLine);
        const to =
          file === undefined ? undefined : { start: lineNow(file.start), end: lineNow(file.end) };
        if (
          file !== undefined &&
          to !== undefined &&
          to.end - to.start === file.end - file.start &&
          (to.start !== file.start || to.end !== file.end)
        ) {
          plans.push({
            kind: "claim-shifted",
            result,
            lines: lineSpec(toBodyLines(to, page.bodyLine)),
            from: spellLines(file),
            to: spellLines(to),
          });
        }
      }

      for (const plan of plans) {
        // A refused claim writes nothing, in either channel; its row is the
        // whole of it, and it keeps the finding from being reported twice.
        if (plan.kind === "claim-replaced") {
          refused.push(rewriteOf(plan));
          settled.add(`${String(result.origin.index)}\0${settles(plan)}`);
          continue;
        }
        if (plan.kind === "marker-moved") {
          // The page already carries the move.
        } else if (result.origin.kind === "manifest") {
          // The manifest's entry list is shorter than the report's index, so
          // there is nothing to splice. Said rather than dropped: a silent
          // skip would report the check's own message and no reason.
          const held = entries?.[result.origin.index];
          if (held === undefined) {
            declined.set(result.origin.index, {
              rule: settles(plan),
              why: `Not rewritten: ${owner?.file ?? "the manifest"} has no entry at index ${String(result.origin.index)}.`,
            });
            continue;
          }
          if (!applyToEntry(held, plan)) continue;
          manifestDirty = true;
        } else {
          after = apply(after, format, plan);
        }
        rewritten.push(rewriteOf(plan));
        settled.add(`${String(result.origin.index)}\0${settles(plan)}`);
      }
    }
    // A marker that moved settles its finding even where the entry is out of
    // the loop's reach, and a stacked run that split keeps the rest reported.
    for (const index of movedIndexes) settled.add(`${String(index)}\0marker-misplaced`);
    if (manifestDirty && owner !== undefined && entries !== undefined) {
      if (setup.sidecar?.entry === undefined) {
        throw new CiteError(
          `${label} carries no ${owner.join}: value, so its citations cannot be keyed in ${owner.file}.`,
        );
      }
      await manifests.write(owner, setup.sidecar.entry, entries, 0);
    }
    // A marker that stays says so in place of the check's wording, at the
    // severity of the rule that kept it there. An accept this run declined
    // says why beside the finding that kept its work undone.
    const stayAt = new Map(markers.stays.map((stay) => [stay.line, stay]));
    const skipped = report.findings
      .filter(
        (finding) =>
          (only === undefined || (finding.id !== undefined && only.has(finding.id))) &&
          !settled.has(`${String(finding.index ?? -1)}\0${finding.rule}`),
      )
      .map((finding) => {
        if (finding.rule === "marker-misplaced") {
          const stay = stayAt.get(finding.line ?? -1);
          if (stay === undefined) return finding;
          const level = severity[stay.rule];
          return {
            ...finding,
            message: stay.message,
            ...(level === "off" ? {} : { severity: level }),
          };
        }
        const turned = finding.index === undefined ? undefined : declined.get(finding.index);
        const why = turned?.rule === finding.rule ? turned.why : undefined;
        return why === undefined ? finding : { ...finding, message: `${finding.message} ${why}` };
      });
    const diff = after === content ? "" : unifiedDiff(label, content, after);
    const written = after !== content && path !== undefined && opts.dryRun !== true;
    if (written) {
      try {
        await writeFileAtomic(path, after);
      } catch (error) {
        throw await writes.restore(label, error);
      }
      writes.record(path, label, content);
    }
    const out: UpdatePage = { file: label, rewritten, refused, skipped, diff, written };
    // The stdin page has nowhere to be written; the caller prints it instead.
    if (path === undefined) out.content = after;
    pages.push(out);
    return report;
  };

  const reports: PageCitationReport[] = [];
  if (usingStdin) reports.push(await updateOne(STDIN_LABEL, opts.stdinContent ?? ""));
  for (const file of files) {
    reports.push(await updateOne(file, await readTarget(run, file), resolve(run.base, file)));
  }
  assertNoOrphanJoins(prepared, hits);

  // One write per manifest, after every page that touches it is settled.
  const changedManifests = manifests.changed();
  const rewrittenManifests: ManifestChange[] = [];
  for (const changed of changedManifests) {
    const write = opts.dryRun !== true;
    if (write) {
      try {
        await writeFileAtomic(changed.path, changed.text);
      } catch (error) {
        throw await writes.restore(changed.file, error);
      }
      // A manifest joins the run's written files the moment it lands, so a
      // later manifest's failure puts this one back with the pages. Without
      // it the tree would keep pins no page content matches.
      writes.record(changed.path, changed.file, changed.before);
    }
    rewrittenManifests.push({ file: changed.file, diff: changed.diff, written: write });
  }
  // A re-mint records HEAD when git has one. Where git is not there the entry
  // is re-pinned without a commit, and the run says so once.
  const reminted = pages.some((page) =>
    page.rewritten.some((r) => r.reason === "accepted" && r.end === "source"),
  );
  sayNotices(reports, opts.onNotice, reminted && !(await git.available()) ? [GIT_UNAVAILABLE_COMMIT] : []);

  const rewritten = pages.reduce((n, page) => n + citationsIn(page.rewritten), 0);
  // A refused claim counts as skipped: `--accept` was asked for it and the
  // run left it undone, which is what the summary's second number means.
  const skipped = pages.reduce((n, page) => n + page.skipped.length + page.refused.length, 0);
  const undone = pages.some(
    (page) =>
      page.refused.length > 0 || page.skipped.some((finding) => finding.severity === "error"),
  );
  return {
    pages,
    rewritten,
    skipped,
    ...(rewrittenManifests.length > 0 ? { manifests: rewrittenManifests } : {}),
    exitCode: undone ? 1 : 0,
  };
}
