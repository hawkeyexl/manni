/** Report rendering. */
import type { BatchReportWithBudget } from "../aggregate.js";
import type { CalibrationReport } from "../calibrate/types.js";
import type { RunReport } from "../types.js";
import { renderBatchHuman, renderBatchMarkdown } from "./batch.js";
import {
  renderCalibrationHuman,
  renderCalibrationMarkdown,
} from "./calibration.js";
import { renderHuman } from "./human.js";
import { renderMarkdown } from "./markdown.js";

export type ReportFormat = "human" | "json" | "markdown";

export function render(report: RunReport, format: ReportFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderMarkdown(report);
    default:
      return renderHuman(report);
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
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderBatchMarkdown(report);
    default:
      return renderBatchHuman(report);
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
  switch (format) {
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderCalibrationMarkdown(report);
    default:
      return renderCalibrationHuman(report);
  }
}
