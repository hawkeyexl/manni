/**
 * Pretty output for `check` and `update`. Marks: ✓ current, ✗ error,
 * ↕ warning, ℹ notice, · skipped; a file line is ✓, ✗ (an error), ⚠ (a
 * warning, no error) or ℹ (notices only). Diffs and
 * commit subjects print only under `showDiff`; a decrypted path only under
 * `reveal`. Colour via `shouldColor`; never under `--no-color`/`NO_COLOR`.
 */
import type { ValidationResult } from "../../meta/index.js";
import { palette } from "../../shared/color.js";
import { parseSrc } from "../core/range.js";
import type {
  CheckRun,
  CitationFinding,
  CitationResult,
  PageCitationReport,
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
    const at = pool.findIndex(
      (e) =>
        e.keyword === finding.rule &&
        e.instancePath === instancePath &&
        e.message === finding.message &&
        (e.line ?? null) === (finding.line ?? null),
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

/** Whether a finding is about this citation: by index for frontmatter, by line for inline. */
function belongsTo(finding: CitationFinding, result: CitationResult): boolean {
  const { origin } = result;
  if (origin.kind === "frontmatter") return finding.index === origin.index;
  if (finding.index !== undefined || finding.line === undefined) return false;
  return finding.line === origin.anchorLine || finding.line === origin.line;
}

/** `<id>`, else `#N` for a frontmatter entry, else `inline`. */
function labelOf(result: CitationResult): string {
  if (result.citation.id !== undefined) return result.citation.id;
  return result.origin.kind === "frontmatter" ? `#${String(result.origin.index)}` : "inline";
}

/** A page-side finding's label: its id, its index, or the source it names. */
function labelOfFinding(finding: CitationFinding): string {
  if (finding.id !== undefined) return finding.id;
  if (finding.index !== undefined) return `#${String(finding.index)}`;
  return finding.src ?? "page";
}

/** Whether the page spelled this source encrypted. */
function citesEncrypted(src: string): boolean {
  try {
    return parseSrc(src).encrypted;
  } catch {
    return false;
  }
}

/**
 * The `src` column: as the page spelled it, plus the decrypted path only
 * under `reveal`, and only beside an encrypted source, the one spelling that
 * hides it.
 */
function srcColumn(result: CitationResult, opts: PrettyOptions, dim: (s: string) => string): string {
  const src = result.citation.src;
  if (opts.reveal && result.resolvedPath !== undefined && citesEncrypted(src)) {
    return `${src} ${dim(`(${result.resolvedPath})`)}`;
  }
  return src;
}

/** The subjects and diff under a `changed` row, dim, the diff capped. */
function diffLines(result: CitationResult, dim: (s: string) => string): string[] {
  const out: string[] = [];
  for (const subject of result.commitsSince ?? []) out.push(dim(`        ${subject}`));
  if (result.diff === undefined || result.diff === "") return out;
  const lines = result.diff.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const shown = lines.slice(0, DIFF_LINE_CAP);
  for (const line of shown) out.push(dim(`        ${line}`));
  const more = lines.length - shown.length;
  if (more > 0) out.push(dim(`        … (${plural(more, "more line")})`));
  return out;
}

export function renderCheckPretty(run: CheckRun, opts: PrettyOptions): string {
  const c = palette(opts.color);
  const lines: string[] = [];
  const quiet = opts.quiet ?? false;

  const markFor = (finding: CitationFinding): string => severityMark(finding.severity, c);
  const location = (line: number | undefined): string =>
    line === undefined ? "" : c.dim(`   (line ${String(line)})`);

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

    for (const result of page.citations) {
      const own = page.findings.filter((f) => belongsTo(f, result) && !placed.has(f));
      const label = c.cyan(labelOf(result));
      const src = srcColumn(result, opts, c.dim);
      if (own.length === 0) {
        if (quiet) continue;
        const skipped = result.status === "skipped";
        const mark = skipped ? c.dim("·") : c.green("✓");
        const message = skipped ? "skipped" : "current";
        lines.push(`    ${mark} ${label}   ${src}   ${message}`);
        continue;
      }
      for (const finding of own) {
        placed.add(finding);
        const forgivenHere = isBaselined.has(finding);
        const row = `${finding.message}${location(finding.line)}`;
        lines.push(
          forgivenHere
            ? `    ${c.dim("·")} ${label}   ${src}   ${c.dim(`${finding.message} (baselined)`)}${location(finding.line)}`
            : `    ${markFor(finding)} ${label}   ${src}   ${row}`,
        );
        if (opts.showDiff && finding.rule === "changed") lines.push(...diffLines(result, c.dim));
      }
    }

    // Findings about no classified citation: a statement nothing references,
    // an entry the schema refused, a claim that never appeared.
    for (const finding of page.findings) {
      if (placed.has(finding)) continue;
      const label = c.cyan(labelOfFinding(finding));
      lines.push(
        isBaselined.has(finding)
          ? `    ${c.dim("·")} ${label}   ${c.dim(`${finding.message} (baselined)`)}${location(finding.line)}`
          : `    ${markFor(finding)} ${label}   ${finding.message}${location(finding.line)}`,
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
      const label = rewrite.id ?? (rewrite.index === undefined ? "inline" : `#${String(rewrite.index)}`);
      lines.push(
        `${page.file}: ${c.cyan(label)}  ${rewrite.from} -> ${rewrite.to}  ${c.dim(`(${rewrite.reason})`)}`,
      );
    }
    for (const finding of page.skipped) {
      const mark = severityMark(finding.severity, c);
      lines.push(
        `${page.file}: ${c.cyan(labelOfFinding(finding))}  ${mark} skipped: ${finding.message}`,
      );
    }
  }
  const summary = `${plural(run.rewritten, "citation")} rewritten in ${plural(files, "file")}, ${String(run.skipped)} skipped`;
  lines.push(run.exitCode === 0 ? c.green(summary) : c.red(summary));
  return lines.join("\n");
}
