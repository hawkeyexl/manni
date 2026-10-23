/**
 * JUnit for `check`: meta's renderer over the adapted results, under the
 * `manni.strategy` classname, with each failure's message the finding's own
 * rather than opened by the field's JSON Pointer.
 */
import { renderJunit } from "../../meta/index.js";
import { JUNIT_CLASSNAME, type StrategyReport } from "../commands/findings.js";
import { FIELD_LABEL } from "./sarif.js";

/** A `message="` attribute's opening label. The value is escaped, so `message="` opens nothing else. */
const MESSAGE_LABEL = new RegExp(`message="${FIELD_LABEL.source.slice(1)}`, "g");

export function renderFindingsJunit(report: StrategyReport): string {
  return renderJunit(report.results, { frame: report.frame, classname: JUNIT_CLASSNAME }).replace(MESSAGE_LABEL, 'message="');
}
