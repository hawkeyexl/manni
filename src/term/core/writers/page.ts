/**
 * A term page: one term per file, its record in the file's metadata channel
 * and an empty body. The metadata reads `title` (the label), `description`
 * (the abstract, when there is one), `type: term`, `id`, `language` (when the
 * term has one), then the ten fields in the vocabulary's order.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { extractorByName } from "../../../meta/internal.js";
import { TermError } from "../../errors.js";
import { TERM_FIELDS, type Term } from "../../types.js";
import { fileOf, xmlAttribute, xmlText } from "./markup.js";

export function pageMetadata(term: Term): Record<string, unknown> {
  const { record } = term;
  const metadata: Record<string, unknown> = { title: record.label };
  if (record.abstract !== undefined) metadata["description"] = record.abstract;
  metadata["type"] = "term";
  metadata["id"] = term.id;
  if (term.language !== undefined) metadata["language"] = term.language;
  for (const field of TERM_FIELDS) {
    const value = record[field];
    if (value !== undefined) metadata[field] = value;
  }
  return metadata;
}

/**
 * A Markdown, MDX, AsciiDoc or reStructuredText term page: a fenced YAML block
 * and no body. The block is written by the format's own extractor, the one an
 * in-place write goes through, so a render and a write-back agree on how a
 * value is spelled.
 */
export function metadataPage(format: string, term: Term): string {
  const apply = extractorByName(format)?.apply;
  if (apply === undefined) throw new TermError(`manni cannot write ${format} metadata.`);
  return apply("---\n---\n", pageMetadata(term));
}

/** A fenced YAML block, which Markdown, MDX, AsciiDoc and reStructuredText all read. */
export function yamlFrontmatter(metadata: Record<string, unknown>): string {
  return `---\n${stringifyYaml(metadata, { lineWidth: 0 })}---\n`;
}

/**
 * A `<meta content>` value as the HTML extractor reads it back: the value is
 * parsed as a YAML scalar, so a string that would parse as anything else, and
 * every list, is written as JSON, which is YAML and stays on one line.
 */
function metaContent(value: unknown): string {
  if (typeof value === "string" && !value.includes("\n")) {
    try {
      if (parseYaml(value) === value) return value;
    } catch {
      // Not plain YAML: JSON below.
    }
  }
  return JSON.stringify(value);
}

export function htmlPage(term: Term): string {
  const metadata = pageMetadata(term);
  const metas = Object.entries(metadata)
    .filter(([key]) => key !== "title")
    .map(([key, value]) => `    <meta name="${xmlAttribute(key)}" content="${xmlAttribute(metaContent(value))}">`);
  return fileOf([
    "<!DOCTYPE html>",
    "<html>",
    "  <head>",
    `    <title>${xmlText(term.record.label)}</title>`,
    ...metas,
    "  </head>",
    "  <body></body>",
    "</html>",
  ]);
}
