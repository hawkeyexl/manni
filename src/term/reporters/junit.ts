/**
 * JUnit for `check` and `lint`: meta's renderer over the adapted results,
 * under the `manni.term` classname, with each failure's message the finding's
 * own. Meta's renderer opens every message with the field's JSON Pointer,
 * `(root)` for a finding about a whole entry, which says nothing about a term.
 * The failure's `type` is already the rule id.
 */
import { renderJunit } from "../../meta/index.js";
import { JUNIT_CLASSNAME, type TermReport } from "../commands/findings.js";
import { FIELD_LABEL } from "./sarif.js";

/** A `message="` attribute's opening label. The value is escaped, so `message="` opens nothing else. */
const MESSAGE_LABEL = new RegExp(`message="${FIELD_LABEL.source.slice(1)}`, "g");

export function renderFindingsJunit(report: TermReport): string {
  return renderJunit(report.results, { frame: report.frame, classname: JUNIT_CLASSNAME }).replace(
    MESSAGE_LABEL,
    'message="',
  );
}
