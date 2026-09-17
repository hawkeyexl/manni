/**
 * `manni term formats`: what is read and written, from the registries alone. A
 * construct a reader does not exist for is not listed, and `write` appears
 * only where a reader has `apply` or a registered document writer renders the
 * construct, so the listing never promises more than the build does.
 */
import { TERM_READERS } from "../core/readers/index.js";
import { TERM_WRITERS } from "../core/writers/index.js";
import type { TermConstruct, TermReader, TermShape, TermWriteFormat, TermWriter } from "../types.js";

export const FORMATS_FORMATS = ["pretty", "json"] as const;
export type FormatsFormat = (typeof FORMATS_FORMATS)[number];

export interface FormatRow {
  /** The input format a reader reads (`markdown`, `xml`), or a `write -f` value. */
  format: string;
  /** The construct, for a reader's row. */
  construct?: TermConstruct;
  /** What the construct or the render is called: `definition list`, `TBX v2 Core`; empty for none. */
  label: string;
  read: boolean;
  write: boolean;
}

/**
 * The construct each document `-f` value renders, per shape, and the input
 * format that construct is read back from. A directory holds one entry per
 * file, which is a page; a file holds them all, in the format's list construct.
 */
export const DOCUMENT_RENDERS: Partial<
  Record<TermWriteFormat, { input: string; shapes: Partial<Record<TermShape, TermConstruct>> }>
> = {
  markdown: { input: "markdown", shapes: { directory: "page", file: "markdown-deflist" } },
  mdx: { input: "mdx", shapes: { directory: "page", file: "markdown-deflist" } },
  asciidoc: { input: "asciidoc", shapes: { directory: "page", file: "asciidoc-glossary" } },
  rst: { input: "rst", shapes: { directory: "page", file: "rst-glossary" } },
  html: { input: "html", shapes: { directory: "page", file: "html-dl" } },
  dita: { input: "xml", shapes: { directory: "dita-glossentry", file: "dita-glossgroup" } },
  docbook: { input: "xml", shapes: { file: "docbook-glossary" } },
};

/** What `formats` calls an interchange render. */
const INTERCHANGE_LABELS: Partial<Record<TermWriteFormat, string>> = {
  tbx: "TBX v2 Core",
  skos: "JSON-LD",
  vale: "style",
};

function rendered(writers: readonly TermWriter[], format: string, construct: TermConstruct): boolean {
  return writers.some((writer) => {
    const render = DOCUMENT_RENDERS[writer.format];
    if (render?.input !== format) return false;
    return writer.shapes.some((shape) => render.shapes[shape] === construct);
  });
}

export function listFormats(
  opts: { readers?: readonly TermReader[]; writers?: readonly TermWriter[] } = {},
): FormatRow[] {
  const readers = opts.readers ?? TERM_READERS;
  const writers = opts.writers ?? TERM_WRITERS;

  // Input formats in order of first appearance, then each format's readers in registry order.
  const formats: string[] = [];
  for (const reader of readers) {
    for (const format of reader.formats) if (!formats.includes(format)) formats.push(format);
  }
  const rows: FormatRow[] = [];
  for (const format of formats) {
    for (const reader of readers.filter((r) => r.formats.includes(format))) {
      rows.push({
        format,
        construct: reader.construct,
        label: reader.label,
        read: true,
        write: reader.apply !== undefined || rendered(writers, format, reader.construct),
      });
    }
  }
  for (const writer of writers) {
    if (DOCUMENT_RENDERS[writer.format] !== undefined) continue;
    rows.push({ format: writer.format, label: INTERCHANGE_LABELS[writer.format] ?? "", read: false, write: true });
  }
  return rows;
}
