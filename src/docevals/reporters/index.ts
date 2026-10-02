/** Reporter dispatch. */
import type { EngineReport } from "../core/engine.js";
import { renderPretty, type ColorOptions } from "./pretty.js";
import { renderJson } from "./json.js";
import { renderMarkdown } from "./markdown.js";
import { renderGithub } from "./github.js";
import { parseFormat, REPORT_FORMATS, type ReportFormat } from "./format.js";
import { renderSarif } from "./sarif.js";
import { renderJunit } from "./junit.js";
import { renderHtml } from "./html.js";

export type { ColorOptions } from "./pretty.js";
export {
  REPORT_FORMATS,
  SUMMARY_FORMATS,
  parseFormat,
  type ReportFormat,
  type SummaryFormat,
} from "./format.js";

/**
 * `opts.color` reaches the pretty reporter alone. Every other format is read
 * by a machine or a browser, so it never carries terminal escapes.
 */
export function render(
  report: EngineReport,
  format: ReportFormat,
  opts: ColorOptions = {},
): string {
  // Same entry guard as renderList/renderFill, and for the same reason: this is
  // exported from src/index.ts, so library callers arrive with no CLI parser in
  // front. Before this, an unknown format fell off the switch and returned
  // `undefined` — which the CLI then printed.
  //
  // Routed through parseFormat rather than a `default:` branch so all three
  // render entry points emit one message built in one place. A hand-written
  // message here drifts from parseFormat's the first time either is reworded.
  parseFormat(format, REPORT_FORMATS, "format");
  switch (format) {
    case "pretty":
      return renderPretty(report, opts);
    case "json":
      return renderJson(report);
    case "markdown":
      return renderMarkdown(report);
    case "sarif":
      return renderSarif(report);
    case "junit":
      return renderJunit(report);
    case "github":
      return renderGithub(report);
    case "html":
      return renderHtml(report);
  }
}
