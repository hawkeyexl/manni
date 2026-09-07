/**
 * `manni cite update`: rewrite moved entries; with `--accept`, re-mint changed ones.
 *
 * A `moved` entry gets its `src` rewritten where it stands: the `src:` line
 * spliced in the frontmatter (comments and quoting untouched), the statement
 * text rebuilt inline in the form it was written. `--accept` re-mints a
 * `changed` or `never-true` entry at HEAD and splices `integrity` (and
 * `commit`, when the entry carries a line of its own). Every finding the run
 * did not resolve is reported as skipped, and an error-severity one is work
 * left undone: exit 1, as `fill` has it. Writes by default (0025).
 */
import { resolve } from "node:path";
import { writeFileAtomic } from "../../meta/index.js";
import { STDIN_LABEL } from "../../meta/internal.js";
import { checkCitations } from "../core/check-page.js";
import { mintCitation } from "../core/mint.js";
import { readPage } from "../core/page.js";
import { replaceStatement, spliceEntryField, unifiedDiff } from "../core/write.js";
import { CiteError } from "../errors.js";
import type {
  Citation,
  CitationFinding,
  CitationResult,
  InlineStatement,
  PageCitationReport,
  UpdateOptions,
  UpdatePage,
  UpdateRewrite,
  UpdateRun,
} from "../types.js";
import { prepareRun, readTarget, sayNotices } from "./check.js";

type Plan =
  | { kind: "moved"; result: CitationResult; src: string }
  | { kind: "accepted"; result: CitationResult; minted: Citation };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The keys a finding about this citation would carry (see `keyOfFinding`). */
function keysOf(result: CitationResult): string[] {
  const { origin } = result;
  if (origin.kind === "frontmatter") return [`index:${origin.index}`];
  const keys = [`line:${origin.line}`];
  if (origin.anchorLine !== undefined) keys.push(`line:${origin.anchorLine}`);
  return keys;
}

function keyOfFinding(finding: CitationFinding): string {
  return finding.index === undefined ? `line:${finding.line ?? 0}` : `index:${finding.index}`;
}

type InlineField = "src" | "integrity" | "commit";

/**
 * Replace one string field's value inside a statement's JSON text, leaving
 * the author's spacing and key order alone, as `spliceEntryField` leaves a
 * YAML line. `undefined` when the text carries no such field.
 */
function spliceJsonField(text: string, field: InlineField, value: string): string | undefined {
  const keyed = new RegExp(`("${field}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
  if (!keyed.test(text)) return undefined;
  // A function, so a `$` in the value is a character and not a back-reference.
  return text.replace(keyed, (_match, lead: string) => lead + JSON.stringify(value));
}

/** The inline entry statement on `line`, from a fresh read of the page. */
function statementAt(content: string, format: string, label: string, line: number): InlineStatement {
  const statement = readPage(label, content, { format }).statements.find((s) => s.line === line);
  if (statement?.payload.kind !== "entry" || !isRecord(statement.payload.entry)) {
    throw new CiteError(`Cannot find the statement at ${label}:${line} to rewrite; edit it by hand.`);
  }
  return statement;
}

/**
 * Rewrite fields of the inline entry on `line`. The page is re-read for the
 * offsets, because an earlier splice may have moved them; the line has not,
 * since every rewrite keeps its line count. A field the statement does not
 * carry is left out (`commit` on an entry that never recorded one). The
 * result is read back before it is trusted, as the YAML splice is.
 */
function rewriteInline(
  content: string,
  format: string,
  label: string,
  line: number,
  fields: Partial<Record<InlineField, string>>,
): string {
  const statement = statementAt(content, format, label, line);
  const original = content.slice(statement.start, statement.end);
  const refuse = (): CiteError =>
    new CiteError(`Cannot rewrite the statement at ${label}:${line} (\`${original}\`); edit it by hand.`);
  let text = original;
  const wanted: [InlineField, string][] = [];
  for (const field of ["src", "integrity", "commit"] as const) {
    const value = fields[field];
    if (value === undefined) continue;
    const spliced = spliceJsonField(text, field, value);
    if (spliced === undefined) {
      if (field === "commit") continue;
      throw refuse();
    }
    text = spliced;
    wanted.push([field, value]);
  }
  const out = replaceStatement(content, statement.start, statement.end, text);
  const check = statementAt(out, format, label, line).payload;
  const entry = check.kind === "entry" && isRecord(check.entry) ? check.entry : undefined;
  if (entry === undefined || wanted.some(([field, value]) => entry[field] !== value)) throw refuse();
  return out;
}

function apply(content: string, format: string, label: string, plan: Plan): string {
  const { origin } = plan.result;
  if (plan.kind === "moved") {
    return origin.kind === "frontmatter"
      ? spliceEntryField(content, format, origin.index, "src", plan.src)
      : rewriteInline(content, format, label, origin.line, { src: plan.src });
  }
  const { integrity, commit } = plan.minted;
  if (origin.kind === "frontmatter") {
    let out = spliceEntryField(content, format, origin.index, "integrity", integrity);
    if (commit !== undefined) {
      // An entry with no `commit:` line of its own (none, or the page-level
      // default) keeps none: the splice replaces a scalar, it does not add a key.
      try {
        out = spliceEntryField(out, format, origin.index, "commit", commit);
      } catch (error) {
        if (!(error instanceof CiteError)) throw error;
      }
    }
    return out;
  }
  return rewriteInline(content, format, label, origin.line, { integrity, commit });
}

function rewriteOf(plan: Plan): UpdateRewrite {
  const { citation, origin } = plan.result;
  const out: UpdateRewrite =
    plan.kind === "moved"
      ? { from: citation.src, to: plan.src, reason: "moved" }
      : { from: citation.integrity, to: plan.minted.integrity, reason: "accepted" };
  if (citation.id !== undefined) out.id = citation.id;
  if (origin.kind === "frontmatter") {
    out.index = origin.index;
    if (origin.line !== undefined) out.line = origin.line;
  } else {
    out.line = origin.line;
  }
  return out;
}

export async function runUpdate(opts: UpdateOptions): Promise<UpdateRun> {
  const { run, files, usingStdin, forced, pageOptions } = await prepareRun(opts, "updated", "update", true);
  const only = opts.only !== undefined && opts.only.length > 0 ? new Set(opts.only) : undefined;
  const accept = opts.accept === true;

  const planFor = async (result: CitationResult): Promise<Plan | undefined> => {
    if (result.status === "moved" && result.newSrc !== undefined) {
      return { kind: "moved", result, src: result.newSrc };
    }
    if (!accept || (result.status !== "changed" && result.status !== "never-true")) return undefined;
    try {
      // The src as the page spells it: a token stays a token, and mint keys
      // the pin accordingly. HEAD is recorded when git has one.
      const minted = await mintCitation({
        root: run.root,
        src: result.citation.src,
        salt: run.salt,
        gitClient: pageOptions.gitClient,
        sourceIndex: pageOptions.sourceIndex,
      });
      return { kind: "accepted", result, minted };
    } catch (error) {
      // A range the file no longer reaches cannot be re-minted; its finding stays reported.
      if (error instanceof CiteError) return undefined;
      throw error;
    }
  };

  const pages: UpdatePage[] = [];
  const updateOne = async (label: string, content: string, path?: string): Promise<PageCitationReport> => {
    const report = await checkCitations({ file: label, content, format: forced?.name }, pageOptions);
    const { format } = report;
    const rewritten: UpdateRewrite[] = [];
    /** `<key>\0<rule>` of every finding a rewrite settled. */
    const settled = new Set<string>();
    let after = content;
    for (const result of report.citations) {
      if (only !== undefined && (result.citation.id === undefined || !only.has(result.citation.id))) continue;
      const plan = await planFor(result);
      if (plan === undefined) continue;
      after = apply(after, format, label, plan);
      rewritten.push(rewriteOf(plan));
      for (const key of keysOf(result)) settled.add(`${key}\0${result.status}`);
    }
    const skipped = report.findings.filter(
      (finding) =>
        (only === undefined || (finding.id !== undefined && only.has(finding.id))) &&
        !settled.has(`${keyOfFinding(finding)}\0${finding.rule}`),
    );
    const diff = rewritten.length === 0 ? "" : unifiedDiff(label, content, after);
    const written = rewritten.length > 0 && path !== undefined && opts.dryRun !== true;
    if (written) await writeFileAtomic(path, after);
    pages.push({ file: label, rewritten, skipped, diff, written });
    return report;
  };

  const reports: PageCitationReport[] = [];
  if (usingStdin) reports.push(await updateOne(STDIN_LABEL, opts.stdinContent ?? ""));
  for (const file of files) {
    reports.push(await updateOne(file, await readTarget(run, file), resolve(run.base, file)));
  }
  sayNotices(reports, opts.onNotice);

  const rewritten = pages.reduce((n, page) => n + page.rewritten.length, 0);
  const skipped = pages.reduce((n, page) => n + page.skipped.length, 0);
  const undone = pages.some((page) => page.skipped.some((finding) => finding.severity === "error"));
  return { pages, rewritten, skipped, exitCode: undone ? 1 : 0 };
}
