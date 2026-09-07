/**
 * `checkCitations`: the programmatic core a docevals `tool:cite` grader calls
 * for one page. Reads both channels, classifies each entry, applies the
 * severity table, and returns findings whose messages spell sources exactly
 * as the page spelled them.
 *
 * `quote: true` is settled here, because it needs the source: a fenced block
 * is faithful when it reproduces the cited lines as pinned (the ladder's
 * test, which survives a move and a missing source) or as they are now (a
 * block someone refreshed ahead of a re-mint). Neither → `quote-drift`.
 */
import type {
  CheckPageOptions,
  CitationFinding,
  CitationResult,
  CiteRule,
  CiteSeverity,
  PageCitation,
  PageCitationReport,
  SourceRange,
} from "../types.js";
import { findingsFor } from "./adapt.js";
import { classifyCitation, MOVE_BUDGET_BYTES } from "./classify.js";
import { blockMatches } from "./claims.js";
import { gitClient, noGit } from "./git.js";
import { hashLines, sliceLines, splitLines } from "./hash.js";
import { readPage } from "./page.js";
import { parseSrc } from "./range.js";
import { buildSourceIndex, readSource } from "./sources.js";
import { resolveSeverity, ruleId } from "./severity.js";
import { fencedBlockAfter, fencedBlocks, offsetOfLine } from "./statements.js";

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

/** A key naming the citation a finding is about, so a rule is reported once per entry. */
function keyOf(finding: Pick<CitationFinding, "index" | "line">): string {
  return finding.index === undefined ? `line:${String(finding.line ?? 0)}` : `index:${String(finding.index)}`;
}

function keyOfCitation(entry: PageCitation): string {
  const { origin } = entry;
  return origin.kind === "frontmatter" ? `index:${String(origin.index)}` : `line:${String(origin.line)}`;
}

interface QuoteInput {
  content: string;
  bodyOffset: number;
  format: string;
  root: string;
  index: Parameters<typeof readSource>[1];
  salt: string;
}

/** The cited lines as they are now, or undefined when they cannot be read. */
async function citedNow(
  input: QuoteInput,
  result: CitationResult,
  range: SourceRange,
): Promise<string | undefined> {
  const source = await readSource(input.root, input.index, range);
  if (source.kind === "missing") return undefined;
  // After a move the bytes live at the new range; compare against those.
  const at = result.status === "moved" && result.newSrc !== undefined ? parseSrc(result.newSrc) : range;
  try {
    return sliceLines(splitLines(source.text), at);
  } catch {
    return undefined;
  }
}

/** Whether a block reproduces the citation, as pinned or as the source is now. */
function faithful(blockText: string, pin: string, salt: string | undefined, now: string | undefined): boolean {
  if (hashLines(splitLines(blockText).join("\n"), salt) === pin) return true;
  return now !== undefined && blockMatches(blockText, now);
}

/**
 * The quote check for one entry: the block it anchors to, else (frontmatter,
 * unreferenced) any block in the body. `undefined` when the quote holds or
 * cannot be judged; else the finding's message.
 */
async function quoteDrift(input: QuoteInput, result: CitationResult): Promise<string | undefined> {
  const range = parseSrc(result.citation.src);
  const salt = range.obfuscated ? input.salt : undefined;
  const pin = result.citation.integrity;
  const now = await citedNow(input, result, range);
  const { origin } = result;

  if (origin.anchorLine !== undefined) {
    const block = fencedBlockAfter(input.content, offsetOfLine(input.content, origin.anchorLine), input.format);
    if (block !== undefined && block.line === origin.anchorLine) {
      return faithful(block.text, pin, salt, now)
        ? undefined
        : "quote: true, but the fenced block does not reproduce the cited lines";
    }
    // No block at the anchor: a reference or inline statement with no block
    // after it was already reported by readPage, so only a frontmatter entry
    // anchored by its claim falls through to the body search.
    if (origin.kind === "inline") return undefined;
  }
  const blocks = fencedBlocks(input.content, input.bodyOffset, input.format);
  if (blocks.some((block) => faithful(block.text, pin, salt, now))) return undefined;
  return blocks.length === 0
    ? "quote: true, but the page has no fenced block"
    : "quote: true, but no fenced block reproduces the cited lines";
}

export async function checkCitations(
  page: { file: string; content: string; format?: string },
  opts: CheckPageOptions,
): Promise<PageCitationReport> {
  const read = readPage(page.file, page.content, page.format === undefined ? undefined : { format: page.format });
  const salt = opts.salt ?? "";
  const severity = resolveSeverity(opts.severity);
  const client = opts.gitClient ?? (opts.git === false ? noGit() : gitClient(opts.root));

  const results: CitationResult[] = [];
  const findings: CitationFinding[] = [];
  const notices: string[] = [];
  const reported = new Set<string>();
  for (const finding of read.findings) {
    const kept = relevel(finding, severity);
    if (kept === undefined) continue;
    findings.push(kept);
    if (kept.rule === "quote-drift") reported.add(keyOf(kept));
  }

  if (opts.sources === false) {
    for (const { citation, origin } of read.citations) {
      const result: CitationResult = { citation, origin, status: "skipped" };
      const commit = citation.commit ?? read.commit;
      if (commit !== undefined) result.commit = commit;
      results.push(result);
    }
  } else {
    const indexOpts: Parameters<typeof buildSourceIndex>[2] = { gitClient: client };
    if (opts.git !== undefined) indexOpts.git = opts.git;
    const index = opts.sourceIndex ?? (await buildSourceIndex(opts.root, salt, indexOpts));
    const quoteInput: QuoteInput = {
      content: read.content,
      bodyOffset: read.bodyOffset,
      format: read.format,
      root: opts.root,
      index,
      salt,
    };
    const classifyOpts: Parameters<typeof classifyCitation>[1] = { root: opts.root, index, git: client, salt };
    if (opts.git !== undefined) classifyOpts.useGit = opts.git;
    if (read.commit !== undefined) classifyOpts.pageCommit = read.commit;

    for (const entry of read.citations) {
      const result = await classifyCitation(entry, classifyOpts);
      results.push(result);
      if (!entry.citation.quote || result.status === "missing") continue;
      if (severity["quote-drift"] === "off" || reported.has(keyOfCitation(entry))) continue;
      const message = await quoteDrift(quoteInput, result);
      if (message === undefined) continue;
      const finding: CitationFinding = {
        rule: "quote-drift",
        ruleId: ruleId("quote-drift"),
        severity: severity["quote-drift"],
        message,
        src: entry.citation.src,
      };
      const line = entry.origin.anchorLine ?? entry.origin.line;
      if (line !== undefined) finding.line = line;
      if (entry.citation.id !== undefined) finding.id = entry.citation.id;
      if (entry.origin.kind === "frontmatter") finding.index = entry.origin.index;
      findings.push(finding);
    }
  }

  findings.push(...findingsFor(results, severity));

  const unavailable = results.find((r) => r.historyAvailable === false);
  if (unavailable?.commit !== undefined) {
    notices.push(
      `commit ${unavailable.commit.slice(0, 7)} not found in history; use fetch-depth: 0 to enable never-true and diffs`,
    );
  }
  if (results.some((r) => r.truncatedSearch === true)) {
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
