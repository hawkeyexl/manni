/**
 * `manni kg check` — graph-level validation: run the published SHACL shapes
 * (plus the TS-side SKOS integrity checks) over the built graph and report
 * findings with the doc paths responsible. Violations exit 1; warnings and
 * info findings are reported but pass.
 */
import { resolve } from "node:path";
import { loadRunConfig } from "../core/config.js";
import { loadGraph, compactIri } from "../core/load.js";
import { bundledShapesPath } from "../core/pkg.js";
import { validateGraph, type CheckFinding } from "../core/shacl.js";

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
  violations: number;
  warnings: number;
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
  const violations = findings.filter((f) => f.severity === "violation").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  return {
    findings,
    violations,
    warnings,
    shapes,
    exitCode: violations > 0 ? 1 : 0,
  };
}

export function renderCheck(
  report: CheckReport,
  format: "pretty" | "json",
): string {
  if (format === "json") {
    const { exitCode: _exitCode, ...rest } = report;
    return JSON.stringify(rest, null, 2);
  }
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
    `${report.violations} violation${report.violations === 1 ? "" : "s"}, ${report.warnings} warning${report.warnings === 1 ? "" : "s"}`,
  );
  return lines.join("\n");
}
