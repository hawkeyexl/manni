/** Report rendering. */
import type { BatchReportWithBudget } from "../aggregate.js";
import type { CalibrationReport } from "../calibrate/types.js";
import type { RunReport } from "../types.js";
import { renderBatchMarkdown, renderBatchPretty } from "./batch.js";
import {
  renderCalibrationMarkdown,
  renderCalibrationPretty,
} from "./calibration.js";
import { renderPretty } from "./pretty.js";
import { renderMarkdown } from "./markdown.js";
import { REPORT_FORMATS, parseFormat, type ReportFormat } from "./format.js";

export {
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
  }
}

/**
 * The aggregate counterpart. Kept a separate entry point rather than an
 * overload of `render`, because the two carry different questions and the JSON
 * shapes must stay distinguishable to a downstream consumer (ADR 01018).
 */
export function renderBatch(
  // The widened shape: `budget` is optional, so a plain `BatchReport` still
  // passes, and one carrying an exhausted budget is rendered rather than
  // narrowed away (ADR 01018's aggregate owns the field).
  report: BatchReportWithBudget,
  format: ReportFormat,
): string {
  parseFormat(format, REPORT_FORMATS, "format");
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderBatchMarkdown(report);
    case "pretty":
      return renderBatchPretty(report);
  }
}

/**
 * The calibration counterpart (ADR 01022). A third entry point rather than a
 * mode of the other two: a calibration report answers "was it right?", and a
 * consumer must be able to tell that shape apart from a verdict report without
 * inspecting it.
 */
export function renderCalibration(
  report: CalibrationReport,
  format: ReportFormat,
): string {
  parseFormat(format, REPORT_FORMATS, "format");
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderCalibrationMarkdown(report);
    case "pretty":
      return renderCalibrationPretty(report);
  }
}
