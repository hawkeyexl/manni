/**
 * `manni kg check` — graph-level validation: run the published SHACL shapes
 * (plus the TS-side SKOS integrity checks) over the built graph and report
 * findings with the doc paths responsible. Errors exit 1; warnings and
 * notices are reported but pass.
 */
import { resolve } from "node:path";
import type { Severity } from "../../shared/severity.js";
import { loadRunConfig } from "../core/config.js";
import { loadGraph, compactIri } from "../core/load.js";
import { bundledShapesPath } from "../core/pkg.js";
import { validateGraph, type CheckFinding } from "../core/shacl.js";
import { renderCheckGithub } from "../reporters/github.js";
import type { CheckFormat } from "../reporters/index.js";

export interface CheckOptions {
  config?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** Graph .ttl path (default: config `out`). */
  graph?: string;
  /** Shapes .ttl paths (default: config `check.shapes`, then bundled). */
  shapes?: string[];
  cwd?: string;
}

export interface CheckReport {
  findings: CheckFinding[];
  /** Counts on the family's scale, not SHACL's (proposal 0051 §2). */
  errors: number;
  warnings: number;
  notices: number;
  /** Shapes files used, as given (for reporting). */
  shapes: string[];
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
  const store = loadGraph(resolve(cwd, opts.graph ?? config.out));

  // CLI flag over config over the bundled contract — same precedence as
  // every other knob.
  const shapesInput =
    opts.shapes && opts.shapes.length > 0 ? opts.shapes : config.check.shapes;
  const shapes =
    shapesInput.length > 0
      ? shapesInput.map((p) => resolve(cwd, p))
      : [bundledShapesPath(import.meta.url)];

  const findings = await validateGraph(store, shapes);
  const count = (severity: Severity): number =>
    findings.filter((f) => f.severity === severity).length;
  const errors = count("error");

  return {
    findings,
    errors,
    warnings: count("warning"),
    notices: count("notice"),
    shapes,
    // Only an `error` fails the run; a warning and a notice are reported and
    // pass, as they were when they were called violations and warnings.
    exitCode: errors > 0 ? 1 : 0,
  };
}

/** `2 errors`, `1 warning`, `0 notices` — each count pluralized on its own. */
function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? "" : "s"}`;
}

export function renderCheck(report: CheckReport, format: CheckFormat): string {
  if (format === "json") {
    const { exitCode: _exitCode, ...rest } = report;
    return JSON.stringify(rest, null, 2);
  }
  if (format === "github") return renderCheckGithub(report);
  const lines: string[] = [];
  for (const f of report.findings) {
    const where = f.docs.length > 0 ? ` [${f.docs.join(", ")}]` : "";
    lines.push(
      `${f.severity}: ${compactIri(f.focusNode)}${
        f.path ? ` ${compactIri(f.path)}` : ""
      } — ${f.message}${where}`,
    );
  }
  if (report.findings.length > 0) lines.push("");
  lines.push(
    `${plural(report.errors, "error")}, ${plural(report.warnings, "warning")}, ${plural(report.notices, "notice")}`,
  );
  return lines.join("\n");
}
