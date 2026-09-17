/**
 * Extractor registry. Maps file extensions to extractors and resolves an
 * extractor by name (for the `--as` override). A registered extractor reads
 * its format, so registration is what makes an extension supported.
 */
import type { MetadataExtractor } from "../types.js";
import { markdownExtractor } from "./markdown.js";
import { mdxExtractor } from "./mdx.js";
import { asciidocExtractor } from "./asciidoc.js";
import { rstExtractor } from "./rst.js";
import { xmlExtractor } from "./xml.js";
import { htmlExtractor } from "./html.js";

export const EXTRACTORS: MetadataExtractor[] = [
  markdownExtractor,
  mdxExtractor,
  asciidocExtractor,
  rstExtractor,
  xmlExtractor,
  htmlExtractor,
];

const byExtension = new Map<string, MetadataExtractor>();
const byName = new Map<string, MetadataExtractor>();
for (const ex of EXTRACTORS) {
  byName.set(ex.name, ex);
  for (const ext of ex.extensions) byExtension.set(ext.toLowerCase(), ex);
}

/** Resolve the extractor for a file extension (incl. dot). */
export function extractorForExtension(
  ext: string,
): MetadataExtractor | undefined {
  return byExtension.get(ext.toLowerCase());
}

/** Resolve an extractor by its `--as` name. */
export function extractorByName(name: string): MetadataExtractor | undefined {
  return byName.get(name.toLowerCase());
}

/** Extensions handled by registered extractors (used for directory walks). */
export function supportedExtensions(): string[] {
  return EXTRACTORS.flatMap((e) => e.extensions);
}

/** All registered format names, with their writable status. */
export function listFormats(): {
  name: string;
  extensions: string[];
  writable: boolean;
}[] {
  return EXTRACTORS.map((e) => ({
    name: e.name,
    extensions: e.extensions,
    // Writability is the presence of the optional `apply` method, so a format
    // never has to declare it twice and the two can't drift apart.
    writable: typeof e.apply === "function",
  }));
}
