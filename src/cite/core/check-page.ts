/**
 * `checkCitations`: the programmatic core a docevals `tool:cite` grader calls
 * for one page. Reads the entries and markers, classifies both ends of each
 * citation, applies the severity table, and returns findings whose messages
 * spell sources exactly as the entry spelled them.
 *
 * The claim end is page-side, so it is judged even under `--no-check-sources`,
 * which a public docs checkout runs. The source end needs the files.
 *
 * `quote: true` is settled here. The claim must still be a fenced block
 * (`anchor-invalid`), and the block is faithful when it reproduces the cited
 * lines as pinned (which survives a move and a missing source) or as they are
 * now (a block someone refreshed ahead of a re-mint). Neither: `quote-drift`.
 */
import type {
  CheckPageOptions,
  CitationFinding,
  CitationResult,
  CiteRule,
  CiteSeverity,
  ClaimEnd,
  GitClient,
  PageCitation,
  PageCitationReport,
  PageCitations,
  PageLines,
  SourceEnd,
  SourceIndex,
} from "../types.js";
import { findingsFor, misplacedMessageFor } from "./adapt.js";
import { misplacedMarkers, type MisplacedMarker } from "./reanchor.js";
import { spellLines } from "../../shared/pin.js";
import { classifyCitation, MOVE_BUDGET_BYTES } from "./classify.js";
import { blockMatches, claimEnd, claimLineNow, claimLinesNow } from "./claims.js";
import { GIT_UNAVAILABLE_HISTORY, PAGE_HISTORY_UNAVAILABLE, gitClient } from "./git.js";
import { claimHistory, refineClaim } from "./history.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { readPage } from "./page.js";
import { STDIN_LABEL } from "../../meta/internal.js";
import { parseSrc, sourceRange, spellSource } from "./range.js";
import { buildSourceIndex, readSource } from "./sources.js";
import { resolveSeverity, ruleId } from "./severity.js";
import { anchoredLines, fenceSpanAt } from "./statements.js";

function byLine(a: CitationFinding, b: CitationFinding): number {
  return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
}

/** A page-side finding under the configured table: dropped when `off`, else re-levelled. */
function relevel(
  finding: CitationFinding,
  severity: Readonly<Record<CiteRule, CiteSeverity>>,
): CitationFinding | undefined {
  const level = severity[finding.rule];
  if (level === "off") return undefined;
  return { ...finding, severity: level };
}

interface QuoteInput {
  page: PageCitations;
  lines: string[];
  root: string;
  index: Parameters<typeof readSource>[1];
  key?: string;
  checkSources: boolean;
}

/** The cited lines as they are now, or undefined when they cannot be read. */
async function citedNow(
  input: QuoteInput,
  source: SourceEnd,
  entry: PageCitation,
): Promise<string | undefined> {
  const range = sourceRange(entry.citation.source);
  const read = await readSource(input.root, input.index, range, input.key);
  if (read.kind === "missing") return undefined;
  // After a move the bytes live at the new range; compare against those.
  const at = source.status === "moved" && source.newSrc !== undefined ? parseSrc(source.newSrc) : range;
  try {
    return sliceLines(splitLines(read.text), at);
  } catch {
    return undefined;
  }
}

/** Whether a block reproduces the citation, as pinned or as the source is now. */
function faithful(
  blockText: string,
  pin: string,
  key: string | undefined,
  now: string | undefined,
): boolean {
  return hashLines(splitLines(blockText).join("\n"), key) === pin || (now !== undefined && blockMatches(blockText, now));
}

/** The lines inside a block's fences, joined as the hashing rule joins them. */
function insideOf(lines: readonly string[], block: PageLines): string {
  return lines.slice(block.start, block.end - 1).join("\n");
}

/**
 * The quote check for one entry: where its block is, whether that is still a
 * fenced block, and whether it still reproduces the source. Findings here are
 * `anchor-invalid` (page-side) and `quote-drift` (needs the source).
 */
async function quoteFindings(
  input: QuoteInput,
  entry: PageCitation,
  result: CitationResult,
): Promise<{ rule: CiteRule; message: string; line?: number }[]> {
  const { citation } = entry;
  if (citation.quote !== true || result.anchor === null) return [];
  const id = citation.id;
  const named = (text: string): string => (id === undefined ? text : `${id}: ${text}`);
  const { page } = input;

  let block: PageLines | undefined;
  if (result.anchor === "marker" && entry.marker !== undefined) {
    block = anchoredLines(page.content, entry.marker.end, page.format, true);
    if (block === undefined) {
      return [
        {
          rule: "quote-drift",
          message: "quote: true, but no fenced block follows the marker",
          ...(result.markerLine === undefined ? {} : { line: result.markerLine }),
        },
      ];
    }
  } else {
    const at = result.claim === null ? undefined : claimLinesNow(result.claim);
    if (at === undefined) return [];
    const span = fenceSpanAt(page.content, at.start, page.format);
    if (span === undefined || span.end !== at.end) {
      return [
        {
          rule: "anchor-invalid",
          message: named(
            `the quote's claim lines ${at.start === at.end ? String(at.start) : `${String(at.start)}-${String(at.end)}`} are no longer a fenced block.`,
          ),
          line: at.start,
        },
      ];
    }
    block = span;
  }

  if (!input.checkSources || result.source.status === "missing") return [];
  const key = sourceRange(citation.source).encrypted ? input.key : undefined;
  const now = await citedNow(input, result.source, entry);
  const inside = insideOf(input.lines, block);
  if (faithful(inside, citation.source.integrity, key, now)) return [];
  return [
    {
      rule: "quote-drift",
      message: "quote: true, but the fenced block does not reproduce the cited lines",
      line: block.start,
    },
  ];
}

/** The marker end of a result: its line, plus its misplacement when it has one. */
function markerEnd(
  entry: PageCitation,
  misplaced: MisplacedMarker | undefined,
): Pick<CitationResult, "marker"> {
  const { marker } = entry;
  if (marker === undefined) return {};
  if (misplaced === undefined) return { marker: { line: marker.line } };
  return {
    marker: {
      line: marker.line,
      misplaced: { unit: spellLines(misplaced.unit), to: misplaced.to },
    },
  };
}

/** How a citation is anchored, and the page line it anchors to. */
function anchorOf(
  entry: PageCitation,
  claim: ClaimEnd | null,
  page: PageCitations,
): Pick<CitationResult, "anchor" | "markerLine" | "anchorLine"> {
  const { citation, marker } = entry;
  const hasLines = citation.claim?.lines !== undefined;
  const out: Pick<CitationResult, "anchor" | "markerLine" | "anchorLine"> = { anchor: null };
  if (marker !== undefined) out.markerLine = marker.line;
  // Lines and a marker both is `anchor-invalid`: neither anchor is trusted.
  if (hasLines && marker !== undefined) return out;
  if (hasLines) {
    out.anchor = "claim";
    const at = claim === null ? undefined : claimLineNow(claim);
    if (at !== undefined) out.anchorLine = at;
    return out;
  }
  if (marker !== undefined) {
    out.anchor = "marker";
    const unit = anchoredLines(page.content, marker.end, page.format, citation.quote === true);
    out.anchorLine = unit?.start ?? marker.line;
  }
  return out;
}

export async function checkCitations(
  page: { file: string; content: string; format?: string },
  opts: CheckPageOptions,
): Promise<PageCitationReport> {
  const readOptions: Parameters<typeof readPage>[2] = {};
  if (page.format !== undefined) readOptions.format = page.format;
  if (opts.citations !== undefined) readOptions.citations = opts.citations;
  if (opts.owned !== undefined) readOptions.owned = opts.owned;
  const read = readPage(page.file, page.content, readOptions);
  const severity = resolveSeverity(opts.severity);
  const client = opts.gitClient ?? gitClient(opts.root);
  // The page's history lives in the page's own repository, which is not the
  // sources' when `--root` sent those to another checkout.
  const pageGit =
    opts.pageGitClient ??
    (opts.pageRoot === undefined || opts.pageRoot === opts.root
      ? client
      : gitClient(opts.pageRoot));
  const checkSources = opts.checkSources !== false;
  const lines = splitLines(read.content);

  const results: CitationResult[] = [];
  const findings: CitationFinding[] = [];
  const notices: string[] = [];
  for (const finding of read.findings) {
    const kept = relevel(finding, severity);
    if (kept !== undefined) findings.push(kept);
  }

  const index = checkSources
    ? (opts.sourceIndex ?? (await buildSourceIndex(opts.root, { gitClient: client })))
    : undefined;
  const classifyOpts =
    index === undefined
      ? undefined
      : ({ root: opts.root, index, git: client, ...(opts.key === undefined ? {} : { key: opts.key }) } satisfies Parameters<
          typeof classifyCitation
        >[1]);

  // A quote is judged page-side even with the sources off, so this stands
  // whether or not there is an index; `quoteFindings` reads a source only
  // when `checkSources` says it may.
  const quoteInput: QuoteInput = {
    page: read,
    lines,
    root: opts.root,
    index: index ?? emptyIndex,
    checkSources,
    ...(opts.key === undefined ? {} : { key: opts.key }),
  };

  // Every marker line that splits a paragraph, read once for the page: its
  // entry's claim is judged against it, and each one is its own finding.
  const misplaced = misplacedMarkers(read, lines);
  const misplacedAt = new Map(misplaced.map((found) => [found.line, found]));

  for (const entry of read.citations) {
    const split = entry.marker === undefined ? undefined : misplacedAt.get(entry.marker.line);
    const claim = await withClaimHistory(
      { page: read, entry, claim: claimEnd(read, entry, lines, split), lines },
      { path: read.file, git: pageGit, ...(opts.pageCommitCap === undefined ? {} : { cap: opts.pageCommitCap }), ...(opts.owned === undefined ? {} : { manifest: opts.owned.file }) },
    );
    const source: SourceEnd =
      classifyOpts === undefined
        ? skippedSource(entry)
        : await classifyCitation(entry, classifyOpts);
    const result: CitationResult = {
      citation: entry.citation,
      origin: entry.origin,
      ...anchorOf(entry, claim, read),
      ...markerEnd(entry, split),
      claim,
      source,
    };
    results.push(result);

    for (const found of await quoteFindings(quoteInput, entry, result)) {
      const level = severity[found.rule];
      if (level === "off") continue;
      const finding: CitationFinding = {
        rule: found.rule,
        ruleId: ruleId(found.rule),
        severity: level,
        message: found.message,
        src: source.src,
        index: entry.origin.index,
      };
      if (found.line !== undefined) finding.line = found.line;
      if (entry.citation.id !== undefined) finding.id = entry.citation.id;
      findings.push(finding);
    }
  }

  // One finding per misplaced marker, so a run of three is three. An orphan
  // in a run is reported too, with no id, beside its `marker-orphan`.
  const misplacedLevel = severity["marker-misplaced"];
  if (misplacedLevel !== "off") {
    for (const found of misplaced) {
      const entry = found.entry;
      const finding: CitationFinding = {
        rule: "marker-misplaced",
        ruleId: ruleId("marker-misplaced"),
        severity: misplacedLevel,
        message: misplacedMessageFor(entry?.citation.id, {
          line: found.line,
          unit: spellLines(found.unit),
          place: found.place,
          block: found.block,
        }),
        line: found.line,
      };
      if (entry !== undefined) {
        finding.index = entry.origin.index;
        finding.src = spellSource(entry.citation.source);
        if (entry.citation.id !== undefined) finding.id = entry.citation.id;
      }
      findings.push(finding);
    }
  }

  findings.push(...findingsFor(results, severity));

  // History is read for a citation with a commit, and for every claim that no
  // longer holds, so a page holding either and with no git to read it through
  // says why its verdicts are plainer. With the sources off nothing is
  // classified, but a claim end still is, and it still wants the page's past.
  const wantsSourceHistory =
    checkSources &&
    read.citations.some(({ citation }) => citation.source["commit-sha"] !== undefined);
  const wantsClaimHistory = results.some((r) => r.claim?.status === "changed");
  if (wantsSourceHistory && !(await client.available())) notices.push(GIT_UNAVAILABLE_HISTORY);
  else if (wantsClaimHistory && !(await pageGit.available())) {
    notices.push(GIT_UNAVAILABLE_HISTORY);
  }
  // A claim whose walk ran out of commits: the rest of the history would have
  // told a layout change from an edit.
  if (results.some((r) => r.claim?.historyAvailable === false)) {
    notices.push(PAGE_HISTORY_UNAVAILABLE);
  }

  const unavailable = results.find((r) => r.source.historyAvailable === false);
  if (unavailable?.source.commitSha !== undefined) {
    notices.push(
      `commit ${unavailable.source.commitSha.slice(0, 7)} not found in history; use fetch-depth: 0 to enable never-true and diffs`,
    );
  }
  if (results.some((r) => r.source.truncatedSearch === true)) {
    notices.push(
      `a move search hit its ${String(MOVE_BUDGET_BYTES / (1024 * 1024))} MiB budget before covering the file; a citation may read changed rather than moved`,
    );
  }

  return {
    file: read.file,
    format: read.format,
    citations: results,
    findings: findings.sort(byLine),
    notices,
  };
}

/**
 * The claim end read against the page's history, for a claim that no longer
 * holds. Every other status is what it was: the walk runs only where a
 * verdict is in doubt, so a clean corpus costs no git at all.
 */
async function withClaimHistory(
  now: {
    page: PageCitations;
    entry: PageCitation;
    claim: ClaimEnd | null;
    lines: readonly string[];
  },
  read: { path: string; git: GitClient; cap?: number; manifest?: string },
): Promise<ClaimEnd | null> {
  const { claim } = now;
  if (claim === null || claim.status !== "changed") return claim;
  // A page read from stdin has no path in the repository, so it has no history.
  if (read.path === STDIN_LABEL) return claim;
  const input = { page: now.page, entry: now.entry, claim, ...read };
  const history = await claimHistory(input);
  return refineClaim({ ...input, lines: now.lines, history });
}

/** With `--no-check-sources` no file is read, so every source end is `skipped`. */
function skippedSource(entry: PageCitation): SourceEnd {
  const { source } = entry.citation;
  const out: SourceEnd = { src: spellSource(source), status: "skipped" };
  if (source["commit-sha"] !== undefined) out.commitSha = source["commit-sha"];
  return out;
}

/** Stands in where a quote is judged page-side only; nothing is ever read from it. */
const emptyIndex: SourceIndex = { files: () => [], has: () => false };
