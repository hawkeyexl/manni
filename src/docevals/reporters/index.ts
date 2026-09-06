/** Reporter dispatch. */
import type { EngineReport } from "../core/engine.js";
import { renderHuman } from "./human.js";
import { renderJson } from "./json.js";
import { renderMarkdown } from "./markdown.js";
import { renderGithub } from "./github.js";
import { parseFormat, REPORT_FORMATS, type ReportFormat } from "./format.js";
import { renderSarif } from "./sarif.js";
import { renderJunit } from "./junit.js";
import { renderHtml } from "./html.js";

export {
  REPORT_FORMATS,
  SUMMARY_FORMATS,
  parseFormat,
  type ReportFormat,
  type SummaryFormat,
} from "./format.js";

export function render(report: EngineReport, format: ReportFormat): string {
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
    case "human":
      return renderHuman(report);
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
