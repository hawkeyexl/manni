/**
 * Pretty output for `check` and `update`.
 *
 * A citation is one row: its name, its claim end, its source end, and, when a
 * manifest owns the entry, where that is. Both ends read in file lines, the
 * only lines a person sees. Marks: ✓ current, ✗ error, ↕ warning, ℹ notice,
 * · skipped or baselined; a file line is ✓, ✗ (an error), ⚠ (a warning, no
 * error) or ℹ (notices only). Diffs, commit subjects and a changed claim's
 * current lines print only under `showDiff`; a decrypted path only under
 * `reveal`. Colour via `shouldColor`; never under `--no-color`/`NO_COLOR`.
 */
import type { ValidationResult } from "../../meta/index.js";
import { palette } from "../../shared/color.js";
import { errorSite, messageFor } from "../core/adapt.js";
import { parseSrc } from "../core/range.js";
import { shortCommit, shortPin, shortSrc, spellAt } from "../core/spell.js";
import type {
  CheckRun,
  CitationFinding,
  CitationResult,
  PageCitationReport,
  Removal,
  RemoveRun,
  UpdateRewrite,
  UpdateRun,
} from "../types.js";

export interface PrettyOptions {
  color: boolean;
  quiet?: boolean;
  showDiff?: boolean;
  reveal?: boolean;
  /** `remove --dry-run`: the footer says what the run would have removed. */
  dryRun?: boolean;
}

/** Diff lines printed under a `changed` row before the rest is elided. */
export const DIFF_LINE_CAP = 60;

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** A finding's mark, by severity: ✗ error, ↕ warning, ℹ notice. */
function severityMark(severity: CitationFinding["severity"], c: ReturnType<typeof palette>): string {
  switch (severity) {
    case "error":
      return c.red("✗");
    case "warning":
      return c.yellow("↕");
    case "notice":
      return c.dim("ℹ");
  }
}

/** A page's findings, split into the ones the baseline let through and the ones it forgave. */
export interface SplitFindings {
  reported: CitationFinding[];
  baselined: CitationFinding[];
}

/**
 * Which of a page's findings the run actually reported.
 *
 * The baseline works on the adapted `ValidationResult`: a forgiven finding is
 * removed from `errors` and counted in `baselined`, while `pages[].findings`
 * keeps every finding the check produced. So a finding is baselined exactly
 * when no error in the adapted result is left to account for it. Each error
 * is consumed once, so two identical findings need two identical errors.
 */
export function splitBaselined(
  page: PageCitationReport,
  result: ValidationResult | undefined,
): SplitFindings {
  if (result === undefined) return { reported: [...page.findings], baselined: [] };
  const pool = [...result.errors];
  const out: SplitFindings = { reported: [], baselined: [] };
  for (const finding of page.findings) {
    const instancePath =
      finding.index === undefined ? "" : `/citations/${String(finding.index)}`;
    // A finding that sits on a manifest carries that file's line, and one
    // whose manifest lies outside the tree carries no line at all.
    const line = errorSite(finding).line;
    const at = pool.findIndex(
      (e) =>
        e.keyword === finding.rule &&
        e.instancePath === instancePath &&
        e.message === finding.message &&
        (e.line ?? null) === (line ?? null),
    );
    if (at === -1) {
      out.baselined.push(finding);
    } else {
      pool.splice(at, 1);
      out.reported.push(finding);
    }
  }
  return out;
}

/** The adapted result for a page: same position first, then by file label. */
export function resultFor(run: CheckRun, index: number): ValidationResult | undefined {
  const page = run.pages[index];
  if (page === undefined) return undefined;
  const aligned = run.results[index];
  if (aligned !== undefined && aligned.file === page.file) return aligned;
  return run.results.find((r) => r.file === page.file);
}

/** Whether a finding is about this citation. Every entry has an index, in either channel. */
function belongsTo(finding: CitationFinding, result: CitationResult): boolean {
  return finding.index !== undefined && finding.index === result.origin.index;
}

/** `<id>`, else nothing: the ends say which entry it is. */
function labelOf(result: CitationResult): string {
  return result.citation.id ?? "";
}

/** A page-level finding's label: its id, its index, or the source it names. */
function labelOfFinding(finding: CitationFinding): string {
  if (finding.id !== undefined) return finding.id;
  if (finding.index !== undefined) return `#${String(finding.index)}`;
  return finding.src ?? "page";
}

/** Whether the entry spelled this source encrypted. */
function citesEncrypted(src: string): boolean {
  try {
    return parseSrc(src).encrypted;
  } catch {
    return false;
  }
}

/**
 * The claim end column: where it is, in file lines, and how it reads. A marker
 * says where it is and, when it is misplaced, where it belongs. Its claim
 * status reads bare: the marker's own line is what a reader acts on.
 */
function claimColumn(result: CitationResult): string {
  const { claim, marker } = result;
  const anchoredByMarker = result.anchor === "marker" && result.markerLine !== undefined;
  const moves = marker?.misplaced === undefined ? "" : ` -> :${String(marker.misplaced.to)}`;
  const where = anchoredByMarker
    ? `marker :${String(result.markerLine ?? 0)}${moves}`
    : claim?.fileLines === undefined
      ? ""
      : `:${claim.fileLines}`;
  if (claim === null) return where;
  let status: string;
  switch (claim.status) {
    case "moved":
      status = anchoredByMarker ? "moved" : `moved -> :${claim.newFileLines ?? "?"}`;
      break;
    case "moved-ambiguous": {
      const at = (claim.candidateFileLines ?? []).map((lines) => `:${lines}`);
      status = `moved, ${plural(at.length, "candidate")} (${at.join(", ")})`;
      break;
    }
    case "reanchored": {
      const since = claim.commitSha === undefined ? "" : ` since ${shortCommit(claim.commitSha)}`;
      const to = claim.newFileLines === undefined ? "" : ` -> :${claim.newFileLines}`;
      status = `reanchored${since}${to}`;
      break;
    }
    case "changed":
      status = changedText(claim);
      break;
    default:
      status = claim.status;
  }
  return where === "" ? status : `${where} ${status}`;
}

/** How a changed claim's column says since when, as the source column does. */
function changedText(claim: NonNullable<CitationResult["claim"]>): string {
  if (claim.historyAvailable === false) return "changed (history unavailable; fetch-depth: 0)";
  if (claim.commitSha === undefined) return "changed";
  const since = claim.commitsSince ?? [];
  const count = since.length === 0 ? "uncommitted" : plural(since.length, "commit");
  return `changed since ${shortCommit(claim.commitSha)}, ${count}`;
}

/**
 * The source end column: the source as the entry spelled it, plus the
 * decrypted path only under `reveal`, and only beside an encrypted source,
 * the one spelling that hides it.
 */
function sourceColumn(
  result: CitationResult,
  opts: PrettyOptions,
  dim: (s: string) => string,
): string {
  const { source } = result;
  const src = shortSrc(source.src);
  const encrypted = citesEncrypted(source.src);
  const reveal = (path: string | undefined): string =>
    opts.reveal === true && path !== undefined && encrypted ? ` ${dim(`(${path})`)}` : "";
  // A source that followed its text to another file has a second ciphertext
  // in the message, and `--reveal` is the one place either is a path.
  return `${src}${reveal(source.resolvedPath)} ${messageFor(source)}${reveal(source.resolvedNewPath)}`;
}

/** The subjects and diff under a changed source, dim, the diff capped. */
function diffLines(result: CitationResult, dim: (s: string) => string): string[] {
  const out: string[] = [];
  for (const subject of result.source.commitsSince ?? []) out.push(dim(`        ${subject}`));
  const diff = result.source.diff;
  if (diff === undefined || diff === "") return out;
  const lines = diff.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const shown = lines.slice(0, DIFF_LINE_CAP);
  for (const line of shown) out.push(dim(`        ${line}`));
  const more = lines.length - shown.length;
  if (more > 0) out.push(dim(`        … (${plural(more, "more line")})`));
  return out;
}

/**
 * What `--show-diff` adds under a claim row: the page's commit subjects since
 * the baseline and the claim's own diff. With no baseline there is no diff to
 * print, so a changed claim shows the lines it covers now instead.
 */
function claimLines(result: CitationResult, dim: (s: string) => string): string[] {
  const claim = result.claim;
  const diff = claim?.diff;
  if (claim === null || diff === undefined || diff === "") {
    return capped(claim?.text ?? [], dim);
  }
  const out: string[] = [];
  for (const subject of claim.commitsSince ?? []) out.push(dim(`        ${subject}`));
  return [...out, ...capped(diff.split(/\r?\n/), dim)];
}

/** Lines under a row, dim and capped, with a count of the ones left out. */
function capped(lines: readonly string[], dim: (s: string) => string): string[] {
  const shown = lines.slice(0, DIFF_LINE_CAP);
  const out = shown.map((line) => dim(`        ${line}`));
  const more = lines.length - shown.length;
  if (more > 0) out.push(dim(`        … (${plural(more, "more line")})`));
  return out;
}

/**
 * The line a row sorts on: the marker's line for a marker-anchored entry,
 * else the claim's first file line. That is the line the row opens with, so
 * the claim column climbs down the page. A bare pin anchors nowhere and has
 * none.
 */
function anchorSortLine(result: CitationResult): number | undefined {
  if (result.anchor === "marker" && result.markerLine !== undefined) return result.markerLine;
  const first = result.claim?.fileLines?.split("-")[0];
  if (first === undefined) return undefined;
  const line = Number.parseInt(first, 10);
  return Number.isNaN(line) ? undefined : line;
}

/**
 * A page's citations in the order their rows print: by anchor line, with the
 * bare pins after them in the order the page keeps them. The entries
 * themselves are left alone, so json and the findings keep frontmatter order.
 */
function rowOrder(citations: readonly CitationResult[]): CitationResult[] {
  return [...citations].sort((a, b) => {
    const left = anchorSortLine(a);
    const right = anchorSortLine(b);
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    return left - right;
  });
}

/** One row of a page's citation table, before the columns are padded. */
interface Row {
  mark: string;
  label: string;
  claim: string;
  source: string;
  where: string;
  /** Lines printed under the row: findings that are not an end, and diffs. */
  under: string[];
}

function padTo(text: string, width: number, plain: number): string {
  // Colour codes are not width, so the visible length is passed in.
  return width <= plain ? text : text + " ".repeat(width - plain);
}

export function renderCheckPretty(run: CheckRun, opts: PrettyOptions): string {
  const c = palette(opts.color);
  const lines: string[] = [];
  const quiet = opts.quiet ?? false;
  // A finding about an entry a manifest owns names the manifest, because
  // its line is a line of that file and not of the page above it.
  const location = (finding: CitationFinding): string => {
    const { file, line } = errorSite(finding);
    if (line === undefined) return "";
    if (file === undefined) return c.dim(`   (line ${String(line)})`);
    return c.dim(`   (${file}:${String(line)})`);
  };

  run.pages.forEach((page, index) => {
    const { reported, baselined } = splitBaselined(page, resultFor(run, index));
    const errors = reported.filter((f) => f.severity === "error").length;
    const warned = reported.some((f) => f.severity === "warning");
    // "baselined" is a participle, not a noun: 1 baselined, 2 baselined.
    const forgiven =
      baselined.length > 0 ? c.dim(`  (${String(baselined.length)} baselined)`) : "";

    if (reported.length === 0) {
      if (quiet) return;
      lines.push(`${c.green("✓")} ${page.file}${forgiven}`);
    } else {
      // The most severe finding marks the file. Only ✗ is a failure.
      const mark = errors > 0 ? c.red("✗") : warned ? c.yellow("⚠") : c.dim("ℹ");
      lines.push(`${mark} ${page.file}${forgiven}`);
    }

    const isBaselined = new Set(baselined);
    const placed = new Set<CitationFinding>();
    const rows: Row[] = [];

    for (const result of rowOrder(page.citations)) {
      const own = page.findings.filter((f) => belongsTo(f, result) && !placed.has(f));
      for (const finding of own) placed.add(finding);
      const live = own.filter((f) => !isBaselined.has(f));
      if (own.length === 0 && quiet) continue;
      const worst =
        live.find((f) => f.severity === "error") ??
        live.find((f) => f.severity === "warning") ??
        live[0];
      const mark =
        worst !== undefined
          ? severityMark(worst.severity, c)
          : own.length > 0
            ? c.dim("·")
            : result.source.status === "skipped" && result.claim === null
              ? c.dim("·")
              : c.green("✓");

      // The ends are the row; anything else about the entry is a line under
      // it. A misplaced marker is part of the row too: it reads there as
      // `marker :<line> -> :<place>`.
      const endRules = new Set(["claim-", "source-", "marker-misplaced"]);
      const under: string[] = [];
      for (const finding of own) {
        const isEnd = [...endRules].some((prefix) => finding.rule.startsWith(prefix));
        if (isEnd) continue;
        const text = isBaselined.has(finding)
          ? c.dim(`${finding.message} (baselined)`)
          : finding.message;
        under.push(`      ${severityMark(finding.severity, c)} ${text}${location(finding)}`);
      }
      if (opts.showDiff) {
        if (own.some((f) => f.rule === "source-changed")) under.push(...diffLines(result, c.dim));
        if (own.some((f) => f.rule === "claim-changed" || f.rule === "claim-reanchored")) {
          under.push(...claimLines(result, c.dim));
        }
      }
      const forgivenEnd = own.length > 0 && live.length === 0 ? c.dim(" (baselined)") : "";
      rows.push({
        mark,
        label: labelOf(result),
        claim: claimColumn(result),
        source: `${sourceColumn(result, opts, c.dim)}${forgivenEnd}`,
        where:
          result.origin.kind === "manifest"
            ? `${result.origin.file}${result.origin.line === undefined ? "" : `:${String(result.origin.line)}`}`
            : "",
        under,
      });
    }

    // Columns are as wide as this page needs them, and no wider.
    const width = (pick: (row: Row) => string): number =>
      rows.reduce((n, row) => Math.max(n, pick(row).length), 0);
    const labelWidth = width((row) => row.label);
    const claimWidth = width((row) => row.claim);
    const anyWhere = rows.some((row) => row.where !== "");
    const sourceWidth = anyWhere ? width((row) => row.source) : 0;
    for (const row of rows) {
      const label = padTo(c.cyan(row.label), labelWidth, row.label.length);
      const source = padTo(row.source, sourceWidth, row.source.length);
      const text = `    ${row.mark} ${label}   ${padTo(row.claim, claimWidth, row.claim.length)}   ${source}${row.where === "" ? "" : `   ${c.dim(row.where)}`}`;
      lines.push(text.replace(/\s+$/, ""));
      lines.push(...row.under);
    }

    // Findings about no entry: a marker naming nothing, a reserved page key.
    for (const finding of page.findings) {
      if (placed.has(finding)) continue;
      const label = c.cyan(labelOfFinding(finding));
      lines.push(
        isBaselined.has(finding)
          ? `    ${c.dim("·")} ${label}   ${c.dim(`${finding.message} (baselined)`)}${location(finding)}`
          : `    ${severityMark(finding.severity, c)} ${label}   ${finding.message}${location(finding)}`,
      );
    }
  });

  const { summary } = run;
  const warnings = summary.warnings ?? 0;
  const notices = summary.notices ?? 0;
  const baselined = summary.baseline?.suppressed ?? 0;
  const findings = summary.errors + warnings + notices + baselined;
  const parts = [plural(findings, "finding")];
  if (warnings > 0) parts.push(`(${plural(warnings, "warning")})`);
  if (notices > 0) parts.push(`(${plural(notices, "notice")})`);
  if (baselined > 0) parts.push(`(${String(baselined)} baselined)`);
  const summaryText = `${plural(summary.files, "file")} checked, ${String(summary.passed)} passed, ${String(summary.failed)} failed, ${parts.join(" ")}`;
  if (lines.length > 0) lines.push("");
  lines.push(summary.failed > 0 ? c.red(summaryText) : c.green(summaryText));
  if (summary.baseline?.written) {
    lines.push(c.dim(`Baseline written to ${summary.baseline.path}`));
  }
  return lines.join("\n");
}

/** `line 9`, or `lines 9-12`, from a line spec. */
function spellAtSpec(spec: string): string {
  const span = spanOf(spec);
  return span === undefined ? `lines ${spec}` : spellAt(span);
}

/** A line spec as numbers, or undefined when it does not read as one. */
function spanOf(spec: string): { start: number; end: number } | undefined {
  const [first, second] = spec.split("-");
  const start = Number(first);
  const end = second === undefined ? start : Number(second);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return { start, end };
}

/**
 * What a re-pin over the unit newly covers, so the widening is in the log as
 * well as in the diff. A span that only lost marker lines gains nothing, and
 * says that instead.
 */
function widening(held: string, now: string): string {
  const was = spanOf(held);
  const is = spanOf(now);
  if (was === undefined || is === undefined) return "";
  const parts: string[] = [];
  if (is.start < was.start) {
    parts.push(spellAt({ start: is.start, end: Math.min(was.start - 1, is.end) }));
  }
  if (is.end > was.end) {
    parts.push(spellAt({ start: Math.max(was.end + 1, is.start), end: is.end }));
  }
  if (parts.length === 0) return ", which held a marker line";
  return `, ${parts.join(" and ")} newly pinned`;
}

/** Whether a re-pin covered a span other than the stored one. */
function widened(rewrite: UpdateRewrite): boolean {
  return (
    rewrite.fromLines !== undefined &&
    rewrite.toLines !== undefined &&
    rewrite.fromLines !== rewrite.toLines
  );
}

/** `lines 9 -> 9-12` for a re-pin that moved, `at line 9` for one that did not. */
function movedSpan(rewrite: UpdateRewrite): string {
  if (widened(rewrite)) return `lines ${rewrite.fromLines ?? ""} -> ${rewrite.toLines ?? ""}`;
  const at = rewrite.toLines ?? rewrite.fromLines ?? String(rewrite.at ?? 0);
  return `at ${spellAtSpec(at)}`;
}

/**
 * What one claim `--accept` refused to re-pin says, and what to do about it.
 * The line names which test refused it: the share is printed when overlap is
 * what fired, and the text is called different when no sentence was shared.
 */
export function refusalLine(rewrite: UpdateRewrite): string {
  const at = shortCommit(rewrite.commitSha ?? "");
  const where = `claim at ${spellAtSpec(String(rewrite.at ?? 0))} skipped:`;
  if (rewrite.wordShare !== undefined) {
    const share = Math.round(rewrite.wordShare * 100);
    return `${where} that line now holds text sharing ${String(share)}% of the claim's words at ${at}. Re-add it with cite add.`;
  }
  return `${where} that line now holds different text than the claim at ${at}. Re-add it with cite add.`;
}

/** What one rewritten end says it did. */
export function rewriteLine(rewrite: UpdateRewrite): string {
  const word = rewrite.from.includes("-") ? "lines" : "line";
  const status = rewrite.status === "never-true" ? "never true" : rewrite.status;
  if (rewrite.end === "marker") {
    return `marker line ${rewrite.from} -> ${rewrite.to} (misplaced)`;
  }
  if (rewrite.reason === "shifted") {
    return `claim ${word} ${rewrite.from} -> ${rewrite.to} (shifted by a marker)`;
  }
  // The words held while the anchor moved (0053). A claim-lines entry moved
  // onto its new run, so the row names both spans.
  if (rewrite.reason === "re-anchored" && rewrite.status === "reanchored") {
    const since = rewrite.commitSha === undefined ? "" : ` since ${shortCommit(rewrite.commitSha)}`;
    return `claim ${movedSpan(rewrite)} re-pinned (reanchored; words unchanged${since})`;
  }
  if (rewrite.reason === "re-anchored") {
    const held = rewrite.lines ?? "";
    const now = rewrite.newLines ?? "";
    return `claim re-pinned over ${spellAtSpec(now)} (moved; was ${spellAtSpec(held)}${widening(held, now)})`;
  }
  if (rewrite.reason === "moved") {
    return rewrite.end === "claim"
      ? `claim ${word} ${rewrite.from} -> ${rewrite.to} (moved)`
      : `source ${shortSrc(rewrite.from)} -> ${shortSrc(rewrite.to)} (moved)`;
  }
  if (rewrite.end === "claim") {
    // A re-pin over a unit wider than the stored lines names both spans, so
    // the widening is in the log as well as in the diff.
    if (widened(rewrite)) {
      return `claim ${movedSpan(rewrite)} re-pinned (${status}; now "${rewrite.text ?? ""}")`;
    }
    // A marker anchors its claim, so the marker's line is where the entry is,
    // as `check` reports it. A claim-lines entry reads at the claim.
    const where =
      rewrite.markerLine === undefined
        ? `line ${String(rewrite.at ?? 0)}`
        : `marker line ${String(rewrite.markerLine)}`;
    return `claim at ${where} re-pinned (${status}; now "${rewrite.text ?? ""}")`;
  }
  const at = rewrite.commitSha === undefined ? "" : ` at ${shortCommit(rewrite.commitSha)}`;
  const src = shortSrc(rewrite.src ?? "");
  // A re-mint over the span the old first and last line now bracket names both
  // ranges, so the log says which lines were accepted.
  const where = rewrite.toLines === undefined ? src : `${src} -> ${atLines(src, rewrite.toLines)}`;
  return `source ${where} re-pinned${at} (${status}; ${shortPin(rewrite.from)} -> ${shortPin(rewrite.to)})`;
}

/** The same source spelled at other lines: `path:200-212` and `"200-215"` read `path:200-215`. */
function atLines(src: string, lines: string): string {
  const colon = src.lastIndexOf(":");
  return `${colon === -1 ? src : src.slice(0, colon)}:${lines}`;
}

export function renderUpdatePretty(run: UpdateRun, opts: PrettyOptions): string {
  const c = palette(opts.color);
  const lines: string[] = [];
  let files = 0;
  for (const page of run.pages) {
    if (page.rewritten.length > 0) files += 1;
    if (opts.showDiff && page.diff !== "") {
      for (const line of page.diff.split(/\r?\n/)) {
        if (line !== "") lines.push(c.dim(line));
      }
    }
    for (const rewrite of page.rewritten) {
      const label = rewrite.id ?? `#${String(rewrite.index)}`;
      lines.push(`${page.file}: ${c.cyan(label)} ${rewriteLine(rewrite)}`);
    }
    // A claim `--accept` refused reads beside the rewrites, because it is the
    // one row `--accept` was asked for and did not write.
    for (const rewrite of page.refused) {
      const label = rewrite.id ?? `#${String(rewrite.index)}`;
      lines.push(`${page.file}: ${c.cyan(label)} ${refusalLine(rewrite)}`);
    }
    for (const finding of page.skipped) {
      const mark = severityMark(finding.severity, c);
      lines.push(
        `${page.file}: ${c.cyan(labelOfFinding(finding))}  ${mark} skipped: ${finding.message}`,
      );
    }
  }
  // The manifests, after the pages: a dry run owes the diff of every file it
  // would have written, and an entry a manifest owns is written there.
  if (opts.showDiff) {
    for (const manifest of run.manifests ?? []) {
      for (const line of manifest.diff.split(/\r?\n/)) {
        if (line !== "") lines.push(c.dim(line));
      }
    }
  }
  const summary = `${plural(run.rewritten, "citation")} rewritten in ${plural(files, "file")}, ${String(run.skipped)} skipped`;
  lines.push(run.exitCode === 0 ? c.green(summary) : c.red(summary));
  return lines.join("\n");
}

/** `line 30`, or `lines 30 and 42` for several, as a sentence reads them. */
function spellLineList(at: readonly number[], noun: string): string {
  // No lines is the noun alone. Every caller has at least one, and a
  // sentence reading "lines  and " would be the only sign that one did not.
  if (at.length === 0) return noun;
  const spelled = at.map((line) => String(line));
  if (spelled.length === 1) return `${noun} ${spelled[0] ?? ""}`;
  const last = spelled[spelled.length - 1] ?? "";
  return `${noun}s ${spelled.slice(0, -1).join(", ")} and ${last}`;
}

/** What one removal says it did: the entry, where it was kept, and its markers. */
export function removalLine(removal: Removal, c: ReturnType<typeof palette>): string {
  const markers = spellLineList(removal.markerLines, "line");
  if (removal.origin === undefined) {
    // A marker naming no entry: there is nothing else to report about it.
    const named = removal.markerLines.length === 1 ? "the marker" : "the markers";
    return `removed ${named} ${c.cyan(removal.id ?? "")} at ${markers}, which named no entry`;
  }
  const name = removal.id ?? `/citations/${String(removal.index ?? 0)}`;
  const where =
    removal.origin.kind === "manifest"
      ? `${removal.origin.file}${removal.origin.line === undefined ? "" : `:${String(removal.origin.line)}`}`
      : "frontmatter";
  const also =
    removal.markerLines.length === 0
      ? ""
      : `, and ${removal.markerLines.length === 1 ? "its marker" : "its markers"} at ${markers}`;
  return `removed ${c.cyan(name)} from ${where}${also}`;
}

export function renderRemovePretty(run: RemoveRun, opts: PrettyOptions): string {
  const c = palette(opts.color);
  const lines: string[] = [];
  let files = 0;
  for (const page of run.pages) {
    if (page.removed.length > 0) files += 1;
    if (opts.showDiff && page.diff !== "") {
      for (const line of page.diff.split(/\r?\n/)) {
        if (line !== "") lines.push(c.dim(line));
      }
    }
    for (const removal of page.removed) {
      lines.push(`${page.file}: ${removalLine(removal, c)}`);
    }
  }
  // The manifests, after the pages, as `update` prints them.
  if (opts.showDiff) {
    for (const manifest of run.manifests ?? []) {
      for (const line of manifest.diff.split(/\r?\n/)) {
        if (line !== "") lines.push(c.dim(line));
      }
    }
  }
  const verb = opts.dryRun === true ? "would be removed" : "removed";
  lines.push(c.green(`${plural(run.removed, "citation")} ${verb} from ${plural(files, "file")}`));
  return lines.join("\n");
}
