/**
 * Reporter for `derive`.
 *
 * Two shapes, decided by the run. An apply or dry run reports *changes* —
 * what each field went from and to, with the evidence — and has its own
 * `pretty` and `json`. A `--check` run reports *findings*, and every format
 * including `pretty` and `json` is handed to `render()` in ./index.ts, so
 * `github`, `sarif` and `junit` come for free and a stale stamp lands in the
 * same annotation, rule id (`derived:stale/derived`) and JUnit case shape a
 * schema violation does. That is why the findings formats are refused
 * without `--check`: they describe findings, and only `--check` produces any.
 */
import { DocmetaError, type RunSummary, type ValidationResult } from "../types.js";
import type { DeriveFileResult, DeriveRun } from "../commands/derive.js";
import type { DerivedField } from "../core/derive/types.js";
import { toJsonText } from "../core/json-text.js";
import { palette } from "../../shared/color.js";
import { formatList, render, type ReportOptions } from "./index.js";

/**
 * Every value `derive -f` accepts: the same five as `validate`, because a
 * `--check` run renders through validate's reporters. Stated as its own list
 * so the two can grow apart without either edit reaching the other.
 */
export const DERIVE_FORMATS = ["pretty", "json", "github", "sarif", "junit"] as const;

export type DeriveReportFormat = (typeof DERIVE_FORMATS)[number];

/** `"pretty, json, github, sarif, or junit"`, for messages and help text. */
export const DERIVE_FORMAT_LIST = formatList(DERIVE_FORMATS);

export function isDeriveFormat(value: string): value is DeriveReportFormat {
  return (DERIVE_FORMATS as readonly string[]).includes(value);
}

/** The JUnit `classname` a derive finding ships under, not validate's. */
const JUNIT_CLASSNAME = "manni.derive";

export type DeriveReportOptions = ReportOptions;

export function renderDerive(
  run: DeriveRun,
  format: DeriveReportFormat,
  opts: DeriveReportOptions = {},
): string {
  if (run.check) {
    const { results, summary } = asValidation(run);
    return render(format, results, summary, {
      classname: JUNIT_CLASSNAME,
      ...opts,
    });
  }
  switch (format) {
    case "json":
      return JSON.stringify(run, null, 2);
    case "pretty":
      return renderDerivePretty(run, opts);
    case "github":
    case "sarif":
    case "junit":
      throw new DocmetaError(
        `${format} is a findings format, which only --check produces`,
      );
    default: {
      // Exhaustive, like `render()`: a format added to `DERIVE_FORMATS`
      // without a case here is a compile error, and the throw covers a
      // caller of the public API handing in a string the union does not name.
      const unreachable: never = format;
      throw new DocmetaError(
        `Unknown report format ${JSON.stringify(unreachable)}. Use ${DERIVE_FORMAT_LIST}.`,
      );
    }
  }
}

/** A `--check` run as `validate` would report it: one result per file, its findings as errors. */
function asValidation(run: DeriveRun): { results: ValidationResult[]; summary: RunSummary } {
  const results = run.results.map((r): ValidationResult => {
    const errors = r.findings ?? [];
    return { file: r.file, format: r.format, ok: errors.length === 0, schemas: [], errors };
  });
  const failed = results.filter((r) => !r.ok).length;
  return {
    results,
    summary: {
      files: results.length,
      passed: results.length - failed,
      failed,
      errors: results.reduce((n, r) => n + r.errors.length, 0),
    },
  };
}

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function renderDerivePretty(run: DeriveRun, opts: DeriveReportOptions = {}): string {
  const c = palette(opts.color ?? false);
  const lines: string[] = [];

  for (const result of run.results) {
    if (result.error !== undefined) {
      lines.push(`${c.red("✗")} ${result.file}`);
      lines.push(`    ${result.error}`);
      continue;
    }
    const pending = result.fields.filter((f) => f.status === "stale" || f.status === "unset");
    if (pending.length === 0) {
      if (opts.quiet) continue;
      lines.push(`${result.file}  ${c.dim("current")}${unknownNote(result, c.dim)}`);
      continue;
    }
    lines.push(result.file);
    const nameWidth = Math.max(...pending.map((f) => f.field.length));
    const changeWidth = Math.max(...pending.map((f) => change(f).length));
    for (const f of pending) {
      const name = c.cyan(f.field.padEnd(nameWidth));
      const from = f.status === "unset" ? c.dim("(unset)") : c.dim(fmt(f.asserted));
      const to = c.green(fmt(f.derived));
      const pad = " ".repeat(changeWidth - change(f).length);
      const trail = c.dim(`(${f.source ?? "a source"}: ${f.evidence ?? "no evidence"})`);
      lines.push(`    ${name}  ${from} → ${to}${pad}  ${trail}`);
    }
    const note = unknownNote(result, c.dim);
    if (note !== "") lines.push(`   ${note}`);
  }

  const s = run.summary;
  const parts = [plural(s.files, "file")];
  if (run.dryRun) {
    parts.push(`${s.changed} would change`, plural(s.stale + s.unset, "field"));
  } else {
    parts.push(`${s.changed} changed`, `${plural(s.written, "field")} written`);
  }
  if (s.errors > 0) parts.push(plural(s.errors, "error"));
  let footer = parts.join(", ");
  if (run.dryRun) footer += " — dry run, nothing written";

  if (lines.length > 0) lines.push("");
  lines.push(s.errors > 0 ? c.yellow(footer) : footer);
  return lines.join("\n");
}

/** `from → to` uncolored, for measuring the column. */
function change(f: DerivedField): string {
  const from = f.status === "unset" ? "(unset)" : fmt(f.asserted);
  return `${from} → ${fmt(f.derived)}`;
}

/** Which of a file's fields no source could answer, so silence is not mistaken for agreement. */
function unknownNote(result: DeriveFileResult, dim: (s: string) => string): string {
  const unknown = result.fields.filter((f) => f.status === "unknown").map((f) => f.field);
  if (unknown.length === 0) return "";
  return dim(`  (${unknown.join(", ")}: no source could answer)`);
}

/** Strings bare, everything else as compact JSON. */
function fmt(value: unknown): string {
  if (typeof value === "string") return value;
  // `toJsonText`, not `JSON.stringify`, so the `String(value)` fallback stays
  // visibly reachable — see there.
  return toJsonText(value) ?? String(value);
}
