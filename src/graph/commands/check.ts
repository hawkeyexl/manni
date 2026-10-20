/**
 * `manni graph check` — graph-level validation: run the published SHACL shapes
 * (plus the TS-side SKOS integrity checks) over the built graph and report
 * findings with the doc paths responsible. Each page's sample questions are
 * asked too (proposal 0086 §7), with each golden-set file's, and the question
 * set's health is summed up after the findings (proposal 0087). Errors exit 1; warnings and notices are
 * reported but pass.
 */
import { dirname, resolve } from "node:path";
import type { Severity } from "../../shared/severity.js";
import { loadRunConfig } from "../core/config.js";
import { loadGraph, compactIri, parseGraph } from "../core/load.js";
import { documentBase } from "../core/discover.js";
import { bundledShapesPath } from "../core/pkg.js";
import {
  compareFindings,
  validateGraph,
  type CheckFinding,
} from "../core/shacl.js";
import {
  askSampleQuestions,
  renderQuestionSummary,
  type QuestionSummary,
} from "./questions.js";
import { palette } from "../../shared/color.js";
import { guidanceLines } from "../../shared/guidance.js";
import { renderCheckGithub } from "../reporters/github.js";
import type { CheckFormat } from "../reporters/index.js";
import { renderCheckSarif } from "../reporters/sarif.js";

export interface CheckOptions {
  config?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** Graph .ttl path (default: config `out`). */
  graph?: string;
  /** Shapes .ttl paths (default: config `check.shapes`, then bundled). */
  shapes?: string[];
  cwd?: string;
  /**
   * The graph as Turtle, in place of reading `graph`: what `buildGraph`
   * returns, so `manni check` checks a build it never wrote.
   */
  turtle?: string;
}

export interface CheckReport {
  findings: CheckFinding[];
  /** Counts on the family's scale, not SHACL's (proposal 0051 §2). */
  errors: number;
  warnings: number;
  notices: number;
  /** Shapes files used, as given (for reporting). */
  shapes: string[];
  /** The question set's health (proposal 0087); absent when no question exists. */
  questions?: QuestionSummary;
  /**
   * The directory each finding's `docs` are labelled from, which SARIF
   * resolves them against. Not printed in JSON, which labels pages as before.
   */
  root: string;
  exitCode: 0 | 1;
}

export async function runCheck(opts: CheckOptions = {}): Promise<CheckReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadRunConfig(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    },
    cwd,
  );
  const graphPath = resolve(cwd, opts.graph ?? config.out);
  const store =
    opts.turtle === undefined
      ? loadGraph(graphPath)
      : parseGraph(opts.turtle, "the built graph");

  // CLI flag over config over the bundled contract — same precedence as
  // every other knob.
  const shapesInput =
    opts.shapes && opts.shapes.length > 0 ? opts.shapes : config.check.shapes;
  // Each file keeps the spelling it was given, which a finding's guidance
  // names when the file carries no header of its own.
  const sources =
    shapesInput.length > 0
      ? shapesInput.map((p) => ({ path: resolve(cwd, p), label: p }))
      : [bundledShapesPath(import.meta.url)];
  const shapes = sources.map((s) => (typeof s === "string" ? s : s.path));

  // Pages read from where `build` labels them, and a vector sidecar from
  // beside the graph, as `export search` and `search` read them. Golden-set
  // files resolve from the config file's directory.
  const root = documentBase(config, {}, cwd);
  const asked = await askSampleQuestions(
    store,
    config.check.questions,
    root,
    dirname(graphPath),
    {
      source: {
        ...(opts.config === undefined ? {} : { configPath: opts.config }),
        ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
      },
      cwd,
    },
    config.questionFiles,
    config.configDir,
  );
  const findings = [...(await validateGraph(store, sources)), ...asked.findings].sort(
    compareFindings,
  );
  const count = (severity: Severity): number =>
    findings.filter((f) => f.severity === severity).length;
  const errors = count("error");

  return {
    findings,
    errors,
    warnings: count("warning"),
    notices: count("notice"),
    shapes,
    ...(asked.summary ? { questions: asked.summary } : {}),
    root,
    // Only an `error` fails the run; a warning and a notice are reported and
    // pass, as they were when they were called violations and warnings.
    exitCode: errors > 0 ? 1 : 0,
  };
}

/** `2 errors`, `1 warning`, `0 notices` — each count pluralized on its own. */
function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? "" : "s"}`;
}

export function renderCheck(
  report: CheckReport,
  format: CheckFormat,
  opts: { color?: boolean } = {},
): string {
  if (format === "json") {
    const { exitCode: _exitCode, root: _root, ...rest } = report;
    return JSON.stringify(rest, null, 2);
  }
  if (format === "sarif") return renderCheckSarif(report);
  const summary = report.questions ? renderQuestionSummary(report.questions) : [];
  if (format === "github") {
    // The summary is plain text after the annotations, which GitHub logs as is.
    const annotations = renderCheckGithub(report);
    if (summary.length === 0) return annotations;
    return [...(annotations === "" ? [] : [annotations, ""]), ...summary].join("\n");
  }
  const c = palette(opts.color === true);
  const lines: string[] = [];
  for (const f of report.findings) {
    // The pages first: they are what the author edits. The node and the
    // predicate follow, dim, for whoever reads the graph.
    const pages = f.docs.length > 0 ? f.docs.join(", ") : "(no page)";
    lines.push(`${f.severity}: ${pages}: ${f.message}`);
    const at = `at ${compactIri(f.focusNode)}${f.path ? ` ${compactIri(f.path)}` : ""}`;
    for (const line of [at, ...guidanceLines(f.guidance)]) lines.push(`  ${c.dim(line)}`);
  }
  if (report.findings.length > 0) lines.push("");
  if (summary.length > 0) lines.push(...summary, "");
  lines.push(
    `${plural(report.errors, "error")}, ${plural(report.warnings, "warning")}, ${plural(report.notices, "notice")}`,
  );
  return lines.join("\n");
}
