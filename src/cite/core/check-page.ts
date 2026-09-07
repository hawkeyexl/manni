/**
 * `checkCitations`: the programmatic core a docevals `tool:cite` grader calls
 * for one page. Reads both channels, classifies each entry, applies the
 * severity table, and returns findings whose messages spell sources exactly
 * as the page spelled them.
 */
import type { CheckPageOptions, PageCitationReport } from "../types.js";
import { notImplemented } from "./not-implemented.js";

export function checkCitations(
  page: { file: string; content: string; format?: string },
  opts: CheckPageOptions,
): Promise<PageCitationReport> {
  return notImplemented("checkCitations", page, opts);
}
