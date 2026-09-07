/**
 * JSON output. `{ summary, pages }` for check; the `UpdateRun` for update.
 * `resolvedPath`, `diff` and `commitsSince` are stripped from every citation:
 * output never says more than the page did.
 */
import type { CheckRun, CitationResult, PageCitationReport, UpdateRun } from "../types.js";

/**
 * The fields of a `CitationResult` a machine format may carry. An allowlist
 * rather than a strip: a field added to `CitationResult` later stays private
 * until someone decides here that it is safe to print.
 */
export type PublicCitationResult = Pick<
  CitationResult,
  "citation" | "origin" | "status" | "newSrc" | "candidates" | "commit" | "historyAvailable" | "truncatedSearch"
>;

export function publicCitation(result: CitationResult): PublicCitationResult {
  const out: PublicCitationResult = {
    citation: result.citation,
    origin: result.origin,
    status: result.status,
  };
  if (result.newSrc !== undefined) out.newSrc = result.newSrc;
  if (result.candidates !== undefined) out.candidates = result.candidates;
  if (result.commit !== undefined) out.commit = result.commit;
  if (result.historyAvailable !== undefined) out.historyAvailable = result.historyAvailable;
  if (result.truncatedSearch !== undefined) out.truncatedSearch = result.truncatedSearch;
  return out;
}

export interface PublicPageReport extends Omit<PageCitationReport, "citations"> {
  citations: PublicCitationResult[];
}

export function publicPage(page: PageCitationReport): PublicPageReport {
  return { ...page, citations: page.citations.map(publicCitation) };
}

export function renderCheckJson(run: CheckRun): string {
  return JSON.stringify({ summary: run.summary, pages: run.pages.map(publicPage) }, null, 2);
}

export function renderUpdateJson(run: UpdateRun): string {
  return JSON.stringify(run, null, 2);
}
