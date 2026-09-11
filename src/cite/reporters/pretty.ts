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
import { shortCommit, shortPin, shortSrc } from "../core/spell.js";
import type {
  CheckRun,
  CitationFinding,
  CitationResult,
  PageCitationReport,
  UpdateRewrite,
  UpdateRun,
} from "../types.js";

export interface PrettyOptions {
  color: boolean;
  quiet?: boolean;
  showDiff?: boolean;
  reveal?: boolean;
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

/** The claim end column: where it is, in file lines, and how it reads. */
function claimColumn(result: CitationResult): string {
  const { claim } = result;
  const where =
    result.anchor === "marker" && result.markerLine !== undefined
      ? `marker :${String(result.markerLine)}`
      : claim?.fileLines === undefined
        ? ""
        : `:${claim.fileLines}`;
  if (claim === null) return where;
  let status: string;
  switch (claim.status) {
    case "moved":
      status = `moved -> :${claim.newFileLines ?? "?"}`;
      break;
    case "moved-ambiguous": {
      const at = (claim.candidateFileLines ?? []).map((lines) => `:${lines}`);
      status = `moved, ${plural(at.length, "candidate")} (${at.join(", ")})`;
      break;
    }
    default:
      status = claim.status;
  }
  return where === "" ? status : `${where} ${status}`;
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
  const revealed =
    opts.reveal && source.resolvedPath !== undefined && citesEncrypted(source.src)
      ? ` ${dim(`(${source.resolvedPath})`)}`
      : "";
  return `${src}${revealed} ${messageFor(source)}`;
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

/** The page lines a changed claim covers now, dim and capped: what `--show-diff` adds. */
function claimLines(result: CitationResult, dim: (s: string) => string): string[] {
  const text = result.claim?.text ?? [];
  const shown = text.slice(0, DIFF_LINE_CAP);
  const out = shown.map((line) => dim(`        ${line}`));
  const more = text.length - shown.length;
  if (more > 0) out.push(dim(`        … (${plural(more, "more line")})`));
  return out;
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

    for (const result of page.citations) {
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

      // The ends are the row; anything else about the entry is a line under it.
      const endRules = new Set(["claim-", "source-"]);
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
        if (own.some((f) => f.rule === "claim-changed")) under.push(...claimLines(result, c.dim));
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

/** What one rewritten end says it did. */
export function rewriteLine(rewrite: UpdateRewrite): string {
  const word = rewrite.from.includes("-") ? "lines" : "line";
  const status = rewrite.status === "never-true" ? "never true" : rewrite.status;
  if (rewrite.reason === "moved") {
    return rewrite.end === "claim"
      ? `claim ${word} ${rewrite.from} -> ${rewrite.to} (moved)`
      : `source ${shortSrc(rewrite.from)} -> ${shortSrc(rewrite.to)} (moved)`;
  }
  if (rewrite.end === "claim") {
    return `claim at line ${String(rewrite.at ?? 0)} re-pinned (${status}; now "${rewrite.text ?? ""}")`;
  }
  const at = rewrite.commitSha === undefined ? "" : ` at ${shortCommit(rewrite.commitSha)}`;
  return `source ${shortSrc(rewrite.src ?? "")} re-pinned${at} (${status}; ${shortPin(rewrite.from)} -> ${shortPin(rewrite.to)})`;
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
