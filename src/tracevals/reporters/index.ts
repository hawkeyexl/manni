/** Report rendering. */
import type { BatchReportWithBudget } from "../aggregate.js";
import type { CalibrationReport } from "../calibrate/types.js";
import { TracevalsError, type RunReport } from "../types.js";
import { renderBatchMarkdown, renderBatchPretty } from "./batch.js";
import {
  renderCalibrationMarkdown,
  renderCalibrationPretty,
} from "./calibration.js";
import { ciInputFromBatch, ciInputFromRun, type CiInput } from "./ci.js";
import { renderGithub } from "./github.js";
import { renderJunit } from "./junit.js";
import { renderPretty } from "./pretty.js";
import { renderMarkdown } from "./markdown.js";
import { renderSarif } from "./sarif.js";
import {
  CALIBRATE_FORMATS,
  REPORT_FORMATS,
  parseFormat,
  type ReportFormat,
} from "./format.js";

export {
  CALIBRATE_FORMATS,
  REPORT_FORMATS,
  SUMMARY_FORMATS,
  parseFormat,
  type ReportFormat,
  type SummaryFormat,
} from "./format.js";

export function render(report: RunReport, format: ReportFormat): string {
  // The same entry guard the sibling entry points carry, and for docevals'
  // reason: these are exported from `src/index.ts`, so a library caller
  // arrives with no CLI parser in front of them. A `default:` branch would
  // silently render pretty for a misspelt format instead of saying so.
  parseFormat(format, REPORT_FORMATS, "format");
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderMarkdown(report);
    case "pretty":
      return renderPretty(report);
    case "github":
      return renderGithub(ciInputFromRun(report), renderMarkdown(report));
    case "sarif":
      return renderSarif(ciInputFromRun(report));
    case "junit":
      return renderJunit(ciInputFromRun(report));
  }
}

/**
 * The aggregate counterpart. Kept a separate entry point rather than an
 * overload of `render`, because the two carry different questions and the JSON
 * shapes must stay distinguishable to a downstream consumer (ADR 01018).
 *
 * The CI formats annotate findings, and findings live in the per-trace
 * reports, not in the aggregate's rates. So they need `runs`, the reports the
 * batch was aggregated from, and refuse to render without them rather than
 * emit a clean-looking report with every finding missing.
 */
export function renderBatch(
  // The widened shape: `budget` is optional, so a plain `BatchReport` still
  // passes, and one carrying an exhausted budget is rendered rather than
  // narrowed away (ADR 01018's aggregate owns the field).
  report: BatchReportWithBudget,
  format: ReportFormat,
  runs?: readonly RunReport[],
): string {
  parseFormat(format, REPORT_FORMATS, "format");
  const ci = (): CiInput => {
    if (runs === undefined) {
      throw new TracevalsError(
        `format "${format}" annotates findings, which live in the per-trace reports; pass them as renderBatch's third argument`,
      );
    }
    return ciInputFromBatch(report, runs);
  };
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderBatchMarkdown(report);
    case "pretty":
      return renderBatchPretty(report);
    case "github":
      return renderGithub(ci(), renderBatchMarkdown(report));
    case "sarif":
      return renderSarif(ci());
    case "junit":
      return renderJunit(ci());
  }
}

/**
 * The calibration counterpart (ADR 01022). A third entry point rather than a
 * mode of the other two: a calibration report answers "was it right?", and a
 * consumer must be able to tell that shape apart from a verdict report without
 * inspecting it. It takes `run`'s format type, because `calibrate` shares
 * `run`'s flags, and refuses the CI formats here.
 */
export function renderCalibration(
  report: CalibrationReport,
  format: ReportFormat,
): string {
  const narrowed = parseFormat(format, CALIBRATE_FORMATS, "format");
  switch (narrowed) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderCalibrationMarkdown(report);
    case "pretty":
      return renderCalibrationPretty(report);
  }
}
