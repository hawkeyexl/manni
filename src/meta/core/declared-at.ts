/**
 * Where one value of a document's merged metadata was written.
 *
 * A document's metadata is its own block plus whatever a collection's
 * manifest supplies (proposal 0037). The merge's `locate` answers for a value
 * a manifest supplied, and the extractor's `lineFor` for a value the document
 * carries. A sibling tool that points a result at the entry declaring it asks
 * here, so "which file, which line" is decided once.
 */
import type { ExtractedMetadata } from "../types.js";
import type { SourceLocation } from "./external-metadata.js";

/** A file, and the 1-based line in it when one is known. */
export interface DeclaredAt {
  file: string;
  line?: number;
}

/** A document's metadata as the merge left it. */
export interface LocatedMetadata {
  extracted: Pick<ExtractedMetadata, "lineFor" | "present">;
  /** The merge's `locate`. Absent when no manifest was read for the document. */
  locate?: (pointer: string) => SourceLocation | undefined;
}

/**
 * The file and line behind `pointer`. A manifest-supplied value names the
 * manifest, with its line when the manifest recorded one. Anything else names
 * `label`, the document, with the line its own block gives. A document with no
 * block gives no line: one would be invented.
 */
export function declaredAt(
  label: string,
  pointer: string,
  metadata: LocatedMetadata,
): DeclaredAt {
  const at = metadata.locate?.(pointer);
  if (at !== undefined) {
    return { file: at.file, ...(at.line === undefined ? {} : { line: at.line }) };
  }
  if (!metadata.extracted.present) return { file: label };
  const line = metadata.extracted.lineFor(pointer);
  return { file: label, ...(line === undefined ? {} : { line }) };
}
