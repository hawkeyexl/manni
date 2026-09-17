/**
 * JUnit for `check`: meta's renderer over the adapted results, under the
 * `manni.cite` classname, with each failure's message the one the github
 * annotation carries.
 * Meta's renderer opens every message with the entry's JSON Pointer, `(root)`
 * for a finding about no entry, which says nothing about a citation. The
 * failure's `type` is already the rule id.
 */
import { renderJunit } from "../../meta/index.js";
import type { CheckRun } from "../types.js";
import { ENTRY_LABEL, withFindingMessages } from "./sarif.js";

/** JUnit `classname` for the citation tool's findings. */
export const JUNIT_CLASSNAME = "manni.cite";

/** A `message="` attribute's opening label. The value is escaped, so `message="` opens nothing else. */
const MESSAGE_LABEL = new RegExp(`message="${ENTRY_LABEL.source.replace(/^\^/, "")}`, "g");

export function renderCheckJunit(run: CheckRun): string {
  return renderJunit(withFindingMessages(run), { frame: run.frame, classname: JUNIT_CLASSNAME }).replace(
    MESSAGE_LABEL,
    'message="',
  );
}
