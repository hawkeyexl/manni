/**
 * JSON output. `{ summary, pages }` for check; the `UpdateRun` for update.
 *
 * A citation prints its two ends and how they are anchored. `resolvedPath`,
 * `diff`, `commitsSince` and a changed claim's current lines are left out of
 * every citation: output never says more than the page did. It is an
 * allowlist rather than a strip, so a field added to the result stays private
 * until someone decides here that it is safe to print.
 */
import type {
  CheckRun,
  CitationAnchor,
  CitationResult,
  OriginKind,
  PageCitationReport,
  UpdateRun,
} from "../types.js";

export interface PublicClaimEnd {
  lines?: string;
  fileLines?: string;
  status: string;
  newLines?: string;
  candidates?: string[];
}

export interface PublicSourceEnd {
  src: string;
  status: string;
  newLines?: string;
  newSrc?: string;
  candidates?: string[];
  commitSha?: string;
  historyAvailable?: boolean;
  truncatedSearch?: boolean;
}

export interface PublicCitationResult {
  id?: string;
  origin: { kind: OriginKind; file: string; line?: number };
  anchor: CitationAnchor;
  claim: PublicClaimEnd | null;
  source: PublicSourceEnd;
}

export function publicCitation(result: CitationResult): PublicCitationResult {
  const origin: PublicCitationResult["origin"] = {
    kind: result.origin.kind,
    file: result.origin.file,
  };
  if (result.origin.line !== undefined) origin.line = result.origin.line;

  const source: PublicSourceEnd = { src: result.source.src, status: result.source.status };
  if (result.source.newLines !== undefined) source.newLines = result.source.newLines;
  if (result.source.newSrc !== undefined) source.newSrc = result.source.newSrc;
  if (result.source.candidates !== undefined) source.candidates = result.source.candidates;
  if (result.source.commitSha !== undefined) source.commitSha = result.source.commitSha;
  if (result.source.historyAvailable !== undefined) {
    source.historyAvailable = result.source.historyAvailable;
  }
  if (result.source.truncatedSearch !== undefined) {
    source.truncatedSearch = result.source.truncatedSearch;
  }

  let claim: PublicClaimEnd | null = null;
  if (result.claim !== null) {
    claim = { status: result.claim.status };
    if (result.claim.lines !== undefined) claim.lines = result.claim.lines;
    if (result.claim.fileLines !== undefined) claim.fileLines = result.claim.fileLines;
    if (result.claim.newLines !== undefined) claim.newLines = result.claim.newLines;
    if (result.claim.candidates !== undefined) claim.candidates = result.claim.candidates;
  }

  // Key order is the order the plan spells a citation in: what it is called,
  // where it is kept, what anchors it, then its two ends.
  return {
    ...(result.citation.id === undefined ? {} : { id: result.citation.id }),
    origin,
    anchor: result.anchor,
    claim,
    source,
  };
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
