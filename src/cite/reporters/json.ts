/**
 * JSON output. `{ summary, pages }` for check; the run itself for update,
 * remove and history.
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
  HistoryRun,
  MarkerEnd,
  OriginKind,
  PageCitationReport,
  RemoveRun,
  UpdateRewrite,
  UpdateRun,
} from "../types.js";

export interface PublicClaimEnd {
  lines?: string;
  fileLines?: string;
  status: string;
  /** A pointer claim's pointer, and where the value is now when it moved (0108). */
  pointer?: string;
  newPointer?: string;
  newLines?: string;
  candidates?: string[];
  /** The baseline the claim was read against: the page's own history says it. */
  commitSha?: string;
  historyAvailable?: boolean;
}

export interface PublicSourceEnd {
  src: string;
  /** The checkout the source is in, by its `cite.repos` name; present only for a repo entry. */
  repo?: string;
  status: string;
  newLines?: string;
  newSrc?: string;
  candidates?: string[];
  /** The entry's recorded `commit-sha`, as it is written. */
  commitSha?: string;
  /** The full hash the verdict was read against, when history found one (0097). */
  baselineSha?: string;
  historyAvailable?: boolean;
  truncatedSearch?: boolean;
}

export interface PublicCitationResult {
  id?: string;
  origin: { kind: OriginKind; file: string; line?: number };
  anchor: CitationAnchor;
  /** The marker that names the entry: its line, and its misplacement when it has one. */
  marker?: MarkerEnd;
  /** A pointer claim's value line now (0108). */
  at?: number;
  claim: PublicClaimEnd | null;
  source: PublicSourceEnd;
}

export function publicCitation(result: CitationResult): PublicCitationResult {
  const origin: PublicCitationResult["origin"] = {
    kind: result.origin.kind,
    file: result.origin.file,
  };
  if (result.origin.line !== undefined) origin.line = result.origin.line;

  const source: PublicSourceEnd = {
    src: result.source.src,
    ...(result.source.repo === undefined ? {} : { repo: result.source.repo }),
    status: result.source.status,
  };
  if (result.source.newLines !== undefined) source.newLines = result.source.newLines;
  if (result.source.newSrc !== undefined) source.newSrc = result.source.newSrc;
  if (result.source.candidates !== undefined) source.candidates = result.source.candidates;
  if (result.source.commitSha !== undefined) source.commitSha = result.source.commitSha;
  if (result.source.baselineSha !== undefined) source.baselineSha = result.source.baselineSha;
  if (result.source.historyAvailable !== undefined) {
    source.historyAvailable = result.source.historyAvailable;
  }
  if (result.source.truncatedSearch !== undefined) {
    source.truncatedSearch = result.source.truncatedSearch;
  }

  let claim: PublicClaimEnd | null = null;
  const pointer = result.claim?.pointer;
  if (result.claim !== null && pointer !== undefined) {
    // A metadata value (0108): where it is, as pointers. Its line is `at`.
    claim = { status: result.claim.status, pointer };
    if (result.claim.newPointer !== undefined) claim.newPointer = result.claim.newPointer;
    if (result.claim.candidates !== undefined) claim.candidates = result.claim.candidates;
    if (result.claim.commitSha !== undefined) claim.commitSha = result.claim.commitSha;
    if (result.claim.historyAvailable !== undefined) claim.historyAvailable = result.claim.historyAvailable;
  } else if (result.claim !== null) {
    claim = { status: result.claim.status };
    if (result.claim.lines !== undefined) claim.lines = result.claim.lines;
    if (result.claim.fileLines !== undefined) claim.fileLines = result.claim.fileLines;
    if (result.claim.newLines !== undefined) claim.newLines = result.claim.newLines;
    if (result.claim.candidates !== undefined) claim.candidates = result.claim.candidates;
    if (result.claim.commitSha !== undefined) claim.commitSha = result.claim.commitSha;
    if (result.claim.historyAvailable !== undefined) {
      claim.historyAvailable = result.claim.historyAvailable;
    }
  }

  // Key order is the order the plan spells a citation in: what it is called,
  // where it is kept, what anchors it, then its two ends.
  return {
    ...(result.citation.id === undefined ? {} : { id: result.citation.id }),
    origin,
    anchor: result.anchor,
    ...(result.marker === undefined ? {} : { marker: result.marker }),
    ...(pointer === undefined || result.anchorLine === undefined ? {} : { at: result.anchorLine }),
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

export function renderRemoveJson(run: RemoveRun): string {
  // The whole run, with nothing stripped: `RemoveRun` carries no
  // pretty-only field, as `UpdateRewrite.markerLine` is below. A field added
  // to it for the terminal alone is stripped here, as that one is.
  return JSON.stringify(run, null, 2);
}

/** `{ summary, pages }` for `history`: the run itself, which carries nothing pretty-only. */
export function renderHistoryJson(run: HistoryRun): string {
  return JSON.stringify(run, null, 2);
}

export function renderUpdateJson(run: UpdateRun): string {
  // `markerLine` is the pretty report's line for a marker-anchored claim.
  // `at` is the claim's own first file line, which is what data says.
  const strip = (rows: readonly UpdateRewrite[]): Omit<UpdateRewrite, "markerLine">[] =>
    rows.map(({ markerLine: _pretty, ...rewrite }) => rewrite);
  const pages = run.pages.map((page) => ({
    ...page,
    rewritten: strip(page.rewritten),
    refused: strip(page.refused),
  }));
  return JSON.stringify({ ...run, pages }, null, 2);
}
