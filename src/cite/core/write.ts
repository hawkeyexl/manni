/**
 * Every way the tool rewrites a page. Frontmatter appends go through meta's
 * `applyFrontmatter` (comments and key order preserved). A `moved` rewrite
 * splices the `src:` line textually at `lineFor("/citations/N/src")`, so
 * nothing else in the block is touched. Inline statements are inserted or
 * replaced by offset with the page's own EOL. Files are written with
 * `writeFileAtomic`.
 */
import type { Citation } from "../types.js";
import { notImplemented } from "./not-implemented.js";

/** Append one entry to `citations` (creating the key), via the format's extractor. */
export function appendFrontmatterCitation(
  content: string,
  format: string,
  citation: Citation,
  filePath?: string,
): string {
  return notImplemented("appendFrontmatterCitation", content, format, citation, filePath);
}

/** Replace the scalar on the `src:` (or `integrity:`/`commit:`) line of entry N. */
export function spliceEntryField(
  content: string,
  format: string,
  index: number,
  field: "src" | "integrity" | "commit",
  value: string,
): string {
  return notImplemented("spliceEntryField", content, format, index, field, value);
}

/** Insert a statement line before the line containing `offset`, with the page's EOL. */
export function insertStatementBefore(
  content: string,
  offset: number,
  statement: string,
): string {
  return notImplemented("insertStatementBefore", content, offset, statement);
}

/** Replace the statement text between `start` and `end`. */
export function replaceStatement(
  content: string,
  start: number,
  end: number,
  statement: string,
): string {
  return notImplemented("replaceStatement", content, start, end, statement);
}

/** A unified diff of two texts, `---`/`+++` headers with the same label. */
export function unifiedDiff(label: string, before: string, after: string): string {
  return notImplemented("unifiedDiff", label, before, after);
}
