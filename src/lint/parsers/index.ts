/**
 * Parser registry. Maps file extensions to parsers and resolves a parser by
 * name for the `--as` override.
 *
 * Shaped after docmeta's extractor registry, and for the same reason:
 * everything downstream of `parse()` operates on the generic `DocumentTree`, so
 * adding a format is one file plus one line here - no change to matching,
 * rules, templates, or reporting.
 *
 * A format is registered here when, and only when, a parser reads it. That is
 * what `manni lint tools` lists and what `--as` accepts, so neither can name a
 * format the tool does not read. An extension no parser claims is skipped by
 * name, never parsed as Markdown the way the pre-rewrite `inferFileType` did.
 */
import type { ContentKind, DocumentParser } from "../types.js";
import { markdownParser, mdxParser } from "./markdown.js";
import { htmlParser } from "./html.js";
import { rstParser } from "./rst.js";
import { xmlParser } from "./xml.js";
import { asciidocParser } from "./asciidoc.js";

export const PARSERS: DocumentParser[] = [
  markdownParser,
  mdxParser,
  htmlParser,
  asciidocParser,
  rstParser,
  xmlParser,
];

const byExtension = new Map<string, DocumentParser>();
const byName = new Map<string, DocumentParser>();
for (const parser of PARSERS) {
  byName.set(parser.name, parser);
  for (const ext of parser.extensions) byExtension.set(ext.toLowerCase(), parser);
}

/** Resolve a parser for a file extension (including the dot). */
export function parserForExtension(ext: string): DocumentParser | undefined {
  return byExtension.get(ext.toLowerCase());
}

/** Resolve a parser by its `--as` name. */
export function parserByName(name: string): DocumentParser | undefined {
  return byName.get(name.toLowerCase());
}

/** Extensions collected from a directory walk. */
export function supportedExtensions(): string[] {
  return PARSERS.flatMap((p) => p.walkExtensions ?? p.extensions);
}

/** Every format the tool reads, for `manni lint tools`. */
export function listFormats(): {
  name: string;
  label: string;
  extensions: string[];
  kinds: ContentKind[];
}[] {
  return PARSERS.map((p) => ({
    name: p.name,
    label: p.label,
    extensions: p.extensions,
    kinds: p.kinds,
  }));
}
