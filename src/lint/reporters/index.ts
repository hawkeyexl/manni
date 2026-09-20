/**
 * Reporters render a run to a string. The CLI writes the result to stdout;
 * diagnostics go to stderr separately, so a report is never interleaved with
 * anything a consumer has to parse around.
 */
import { LintError, type Finding } from "../types.js";
import type { LintRun } from "../commands/lint.js";
import type { FormatInfo, ToolInfo } from "../commands/tools.js";
import type { TemplateInfo, TemplatesInfo } from "../commands/templates.js";
import { palette, type Colors } from "../../shared/color.js";
import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../shared/github.js";
import type { ReportFormat as FamilyFormat } from "../../meta/index.js";
import { REPORT_FORMAT_LIST } from "../../meta/internal.js";
import { ruleId, TOOL_NAME } from "../core/rule-id.js";
import { renderJunit } from "./junit.js";
import { renderSarif } from "./sarif.js";

export { renderJunit, toValidationResults } from "./junit.js";

/**
 * Every `-f` value, plus `--explain`.
 *
 * The findings formats are the family's, taken from meta rather than restated,
 * so a format added there is available here the moment lint's `render` grows a
 * case for it - and a value lint does not handle is a compile error instead of
 * a silent fall-through to pretty. `explain` is lint's own: it is reachable
 * through `--explain` and never through `-f`, because it reports on
 * configuration rather than on documents.
 */
export type ReportFormat = FamilyFormat | "explain";

/** Listing commands have nothing to annotate, so they offer no `github`. */
export type ListFormat = "pretty" | "json";

export interface ReportOptions {
  color?: boolean;
  /**
   * Directory the run's relative paths are relative to, forwarded to the SARIF
   * reporter and ignored by the others. Defaults to the process cwd, which is
   * right for the CLI because `runLint` defaults its `cwd` the same way.
   *
   * It is here rather than only on `renderSarif` because `render` is the entry
   * point a library caller reaches for, and without it that caller was pinned
   * to the process cwd with no way out short of bypassing `render` entirely -
   * for the one reporter whose whole output is paths.
   */
  root?: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** `line:column` of a finding, the anchor an editor can jump to. */
function locate(finding: Finding): string {
  return `${finding.position.start.line}:${finding.position.start.column}`;
}

/** A finding as prose: the heading it is about, then what is wrong with it. */
function describeFinding(finding: Finding): string {
  return finding.heading != null
    ? `${finding.heading}: ${finding.message}`
    : finding.message;
}

export function renderPretty(run: LintRun, opts: ReportOptions = {}): string {
  const c = palette(opts.color ?? false);
  const lines: string[] = [];

  for (const result of run.results) {
    // A skip is reported, never silently dropped: an unreadable format that
    // leaves no trace is indistinguishable from a file that passed.
    if (result.skipped != null) {
      const why = result.reason ?? result.skipped;
      lines.push(`${c.yellow("-")} ${result.file}  ${c.dim(`skipped: ${why}`)}`);
      continue;
    }
    if (result.success) {
      lines.push(`${c.green("✓")} ${result.file}`);
      continue;
    }
    lines.push(`${c.red("✗")} ${result.file}`);
    for (const finding of result.findings) {
      // The namespaced id rather than the bare `type`: it is what SARIF,
      // JUnit and the GitHub annotation file the finding under, so the string
      // a reader copies out of the terminal is the one they can search for.
      lines.push(
        `    ${c.dim(locate(finding))}  ${c.cyan(ruleId(finding.type))}  ${describeFinding(finding)}`,
      );
    }
  }

  const { checked, passed, failed, skipped } = run.summary;
  const summary = `${plural(checked, "file")} checked, ${passed} passed, ${failed} failed, ${skipped} skipped`;
  if (lines.length > 0) lines.push("");
  lines.push(failed > 0 ? c.red(summary) : c.green(summary));
  return lines.join("\n");
}

/**
 * The published JSON shape, and the reason this builds objects by hand rather
 * than stringifying `run.results` directly.
 *
 * manni docevals reads `[{ file, success, errors: [{ type, heading, message,
 * position: { start: { line, column } } }] }]` off stdout, and it parses
 * rather than validates - a renamed key produces zero findings, not an error.
 * So: a bare array at the top level, and `errors`, even though the internal
 * field is `findings`. Adding keys is safe; renaming or nesting is not.
 */
export function renderJson(run: LintRun): string {
  const results = run.results.map((result) => ({
    file: result.file,
    success: result.success,
    errors: result.findings.map((finding) => ({
      type: finding.type,
      // Additive, and deliberately beside `type` rather than instead of it.
      // `ruleId` is the family id every other reporter files this finding
      // under; `tool` names which tool produced it, the question a second
      // lint job makes worth asking.
      ruleId: ruleId(finding.type),
      tool: TOOL_NAME,
      heading: finding.heading,
      message: finding.message,
      position: finding.position,
    })),
    // Additive, and the one thing this shape could not say. A skipped file is
    // `{success: false, errors: []}`, which is also what a failure whose
    // finding vanished looks like - so a consumer counting failures counted a
    // file nothing read as a file that was read and found wanting. Null rather
    // than absent, because a key that comes and goes makes "not skipped" and
    // "an older manni" the same observation. The prose `reason` stays off the
    // wire; it is a diagnostic for the pretty and SARIF reports.
    skipped: result.skipped ?? null,
  }));
  return JSON.stringify(results, null, 2);
}

/**
 * GitHub workflow commands: one annotation per finding, shaped as cite's are -
 * `::<severity> file=…,line=…,col=…,title=<ruleId>::<message>`.
 *
 * The rule id is a `title=` property rather than a `[type]` prefix inside the
 * message. GitHub renders the title as the alert's own heading, so the prefix
 * spelled the rule's name a second time; and `title` is the field a reader can
 * group and filter on, which prose can never be.
 *
 * The level is the severity, not a constant `error`. The family scale was
 * chosen to be GitHub's for exactly this: `::warning` and `::notice` render
 * inline like `::error` but do not fail the check, which is the severity
 * invariant in GitHub's terms. Every structural finding is an `error` today.
 *
 * Line breaks are escaped rather than collapsed to spaces, as this once did.
 * `%0A` is the format's own answer and GitHub renders it as a multi-line
 * annotation, so the message arrives whole; collapsing threw away the author's
 * line breaks to solve a problem the escape already solves, and its `\r?\n`
 * pattern let a bare carriage return through into the command untouched.
 *
 * The escaping itself is the family's, from `src/shared/github.ts`. It lives
 * there precisely so a second renderer cannot re-derive it: the replacements
 * are order-dependent (`%` first, or the escape sequences get escaped again),
 * and a local copy that got the order wrong would look identical in review and
 * only show itself on a message carrying a literal `%`.
 */
export function renderGithub(run: LintRun): string {
  const lines: string[] = [];
  for (const result of run.results) {
    for (const finding of result.findings) {
      const params = [
        `file=${escapeWorkflowCommandProperty(result.file)}`,
        `line=${finding.position.start.line}`,
        `col=${finding.position.start.column}`,
        `title=${escapeWorkflowCommandProperty(ruleId(finding.type))}`,
      ];
      const message = escapeWorkflowCommandMessage(describeFinding(finding));
      lines.push(`::${finding.severity} ${params.join(",")}::${message}`);
    }
  }
  return lines.join("\n");
}

/**
 * `--explain`: the resolution chain per file, rather than findings.
 *
 * Printing every stage, including the ones that had nothing to say, is the
 * point. "Which template linted this page?" is usually asked because the answer
 * was surprising, and the surprising part is almost always a stage the reader
 * forgot applies - a stray `$template`, an override glob matching more than
 * intended. A report that showed only the winning stage would hide exactly the
 * thing being looked for.
 */
export function renderExplain(run: LintRun, opts: ReportOptions = {}): string {
  const c = palette(opts.color ?? false);
  const lines: string[] = [];

  for (const result of run.results) {
    // Not the pass/fail glyphs: `--explain` reports whether a page was routed,
    // and a routed page may still be full of findings. Reusing the tick would
    // read as a clean bill of health for a document nothing has looked at yet.
    const chosen = result.template;
    lines.push(`${chosen ? c.cyan("▸") : c.dim("-")} ${c.bold(result.file)}`);

    const steps = result.resolution?.steps ?? [];
    if (steps.length === 0) {
      lines.push(`    ${c.dim("(no resolution recorded)")}`);
    }
    for (const step of steps) {
      const mark = step.ref ? c.green("→") : c.dim("·");
      const label = step.ref ? c.bold(step.ref) : c.dim(step.detail);
      const suffix = step.ref ? `  ${c.dim(step.detail)}` : "";
      lines.push(`    ${mark} ${step.stage.padEnd(20)} ${label}${suffix}`);
    }

    const cause = result.resolution?.cause;
    if (cause === "unknown-type") {
      const type = result.resolution?.unknownType ?? "(none recorded)";
      const near = result.resolution?.suggestions ?? [];
      const known = result.resolution?.knownTypes ?? [];
      // The same fallback the pretty reporter gives. Without it a typo with no
      // near miss - which is most of them, since a near miss needs the typo to
      // be close - printed the failure and nothing to act on, while the plain
      // lint output for that page listed every doctype available.
      const hint = near.length
        ? `; did you mean ${near.join(", ")}?`
        : known.length
          ? `; known doctypes: ${known.join(", ")}`
          : "";
      lines.push(`    ${c.red("✗")} no template serves type "${type}"${hint}`);
    } else if (cause === "no-type") {
      lines.push(`    ${c.dim("skipped: the page declares no type")}`);
    }
    lines.push("");
  }

  const routed = run.results.filter((r) => r.template != null).length;
  lines.push(
    `${run.results.length} file${run.results.length === 1 ? "" : "s"}, ` +
      `${routed} routed, ${run.results.length - routed} unrouted`,
  );
  return lines.join("\n");
}

export function render(
  run: LintRun,
  format: ReportFormat,
  opts: ReportOptions = {},
): string {
  switch (format) {
    case "json":
      return renderJson(run);
    case "github":
      return renderGithub(run);
    case "sarif":
      return renderSarif(run, opts.root === undefined ? {} : { root: opts.root });
    case "junit":
      return renderJunit(run);
    case "explain":
      return renderExplain(run, opts);
    case "pretty":
      return renderPretty(run, opts);
    default: {
      // Exhaustive, and the guard is what makes the claim true: sharing an arm
      // with `pretty` narrowed nothing, so a format added to meta's
      // `REPORT_FORMATS` - which is what the CLI validates `-f` against - was
      // accepted here and silently rendered as a human report. Now it is a
      // compile error, and this is its runtime half for library callers.
      const unreachable: never = format;
      throw new LintError(
        `Unknown report format ${JSON.stringify(unreachable)}. Use ${REPORT_FORMAT_LIST}.`,
      );
    }
  }
}

/** One template per line: the ref to pass, its title, and the types it serves. */
function templateLine(c: Colors, entry: TemplateInfo): string {
  const title = entry.title !== "" ? `  ${c.dim("—")}  ${entry.title}` : "";
  const types =
    entry.types.length > 0 ? entry.types.join(", ") : "(no types declared)";
  return `  ${c.cyan(entry.id)}${title}  ${c.dim(`types: ${types}`)}  ${c.dim(`[${entry.source}]`)}`;
}

export function renderTemplates(
  info: TemplatesInfo,
  format: ListFormat,
  opts: ReportOptions = {},
): string {
  if (format === "json") return JSON.stringify(info, null, 2);

  const c = palette(opts.color ?? false);
  const lines: string[] = [c.bold("Templates:")];
  if (info.templates.length === 0) {
    lines.push(c.dim("  (none)"));
  } else {
    for (const entry of info.templates) lines.push(templateLine(c, entry));
  }
  return lines.join("\n");
}

/** One input format as `markdown  Markdown (.md, .markdown)  kinds: paragraph, codeBlock, list`. */
function formatLine(c: Colors, entry: FormatInfo): string {
  return (
    `      ${c.cyan(entry.name)}  ${entry.label} (${entry.extensions.join(", ")})` +
    `  ${c.dim(`kinds: ${entry.kinds.join(", ")}`)}`
  );
}

/**
 * `manni lint tools`: one block per job. Every column is printed for every
 * job, the negatives included - "not configured" beside a job that still runs
 * on defaults is the answer someone ran this command to get.
 */
export function renderTools(
  tools: ToolInfo[],
  format: ListFormat,
  opts: ReportOptions = {},
): string {
  if (format === "json") return JSON.stringify(tools, null, 2);

  const c = palette(opts.color ?? false);
  const lines: string[] = [c.bold("Jobs:")];
  for (const entry of tools) {
    const state = [
      entry.configured ? "configured" : "not configured",
      entry.available ? "available" : "unavailable",
    ].join(", ");
    lines.push(
      `  ${c.cyan(entry.job)}  tool: ${c.bold(entry.tool)} ${entry.version}  [${state}]`,
    );
    lines.push(`    config: ${c.dim(entry.config)}`);
    lines.push(`    ${c.dim("formats:")}`);
    for (const info of entry.formats) lines.push(formatLine(c, info));
  }
  return lines.join("\n");
}
