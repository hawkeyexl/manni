/**
 * `term write -f tbx` and `-f tbx3`: the set as a TBX v2 (`<martif>`) or v3
 * (`<tbx>`) termbase, the exchange format translation memory and terminology
 * systems import (proposal 0084).
 *
 * One entry per id, in first-appearance order, with a language section per
 * term in set order, written in `tbx-model.ts`'s canonical form. Where terms
 * sharing an id disagree on `concept-entry`, the first term's value is kept
 * and the render reports it.
 *
 * The header depends on where the terms came from:
 * - all from one TBX file, at the version `-f` names: that file, with
 *   unchanged entries and everything outside them copied byte for byte;
 * - all from one TBX file at the other version: canonical entries, under a
 *   header holding the source header's children;
 * - anything else: manni's own header, and each TBX source is reported as a
 *   header dropped.
 */
import { TERM_FIELDS, type MergeConflict, type Term, type TermField, type TermShape, type TermWriter } from "../../types.js";
import { exportTbxSource } from "../readers/tbx.js";
import {
  TBX_V3_NAMESPACE,
  escapeAttribute,
  lf,
  tbxEntryLines,
  tbxSourceOf,
  type TbxDocument,
  type TbxVersion,
} from "../readers/tbx-model.js";
import { reindent } from "./markup.js";
import { conceptGroups, mergeFirst } from "./merge.js";
import { DEFAULT_LANGUAGE, droppedFields, requireShape } from "./render-util.js";

/**
 * TBX-Basic has no category for these. `transfer-comments` is a termNote in
 * TBX-Linguist, so it is written on a designation and not at a language.
 */
const NOT_HELD: readonly TermField[] = [
  "abstract",
  "broader",
  "narrower",
  "related-terms",
  "see",
  "scope-note",
  "transfer-comments",
];
const HOLDS: readonly TermField[] = TERM_FIELDS.filter((field) => !NOT_HELD.includes(field));

/** The designation fields only TBX-Linguist defines. A v3 file carrying one declares itself TBX-Linguist. */
const LINGUIST_FIELDS = ["register", "reading", "reading-note", "grammatical-number", "transfer-comments"] as const;

/** Where the body's entries start: inside `<text><body>`. */
const ENTRY_INDENT = "      ";

/** manni's own header content, at the header's children's indentation. */
const OWN_HEADER = ["    <fileDesc>", "      <sourceDesc>", "        <p>manni term write</p>", "      </sourceDesc>", "    </fileDesc>"];

function isLinguist(terms: readonly Term[]): boolean {
  return terms.some((t) => (t.record.designations ?? []).some((d) => LINGUIST_FIELDS.some((f) => d[f] !== undefined)));
}

/** The TBX document every term was read from, when there is one and only one. */
function soleSource(terms: readonly Term[]): { document: TbxDocument; file: string } | undefined {
  let found: { document: TbxDocument; file: string } | undefined;
  for (const term of terms) {
    const source = tbxSourceOf(term);
    if (source === undefined || (found !== undefined && found.document !== source.document)) return undefined;
    found ??= { document: source.document, file: term.location.file };
  }
  return found?.document.body === undefined ? undefined : found;
}

/** The TBX files the terms came from, as their terms name them, in order of first appearance. */
export function tbxHeaderFiles(terms: readonly Term[]): string[] {
  const files = new Map<TbxDocument, string>();
  for (const term of terms) {
    const source = tbxSourceOf(term);
    if (source !== undefined && !files.has(source.document)) files.set(source.document, term.location.file);
  }
  return [...new Set(files.values())];
}

/** The source header's children, at the header's children's indentation and LF. */
function carriedHeader(document: TbxDocument): string[] | undefined {
  const span = document.header;
  if (span === undefined) return undefined;
  const raw = lf(document.content.slice(span.start, span.end));
  const lines = raw.split("\n");
  const indents = lines.filter((line) => line.trim() !== "").map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  if (indents.length === 0) return undefined;
  const strip = Math.min(...indents);
  return lines.filter((line) => line.trim() !== "").map((line) => `    ${line.slice(strip).trimEnd()}`);
}

/** Every entry, canonical, at the body's indentation; and where terms sharing an id disagree on `concept-entry`. */
function entries(terms: readonly Term[], version: TbxVersion): { lines: string[]; conflicts: MergeConflict[] } {
  const lines: string[] = [];
  const conflicts: MergeConflict[] = [];
  for (const group of conceptGroups(terms)) {
    const [head, ...rest] = group;
    if (head === undefined) continue;
    const merge = mergeFirst(
      head.id,
      group.map((t) => t.record["concept-entry"]),
      "concept-entry.",
    );
    conflicts.push(...merge.conflicts);
    const { "concept-entry": _concept, ...record } = head.record;
    const joined: Term = {
      ...head,
      record: Object.keys(merge.merged).length === 0 ? record : { ...record, "concept-entry": merge.merged },
    };
    const text = tbxEntryLines([joined, ...rest], { version, style: "dca" }).join("\n");
    lines.push(`${ENTRY_INDENT}${reindent(text, ENTRY_INDENT, "\n")}`);
  }
  return { lines, conflicts };
}

function rootOpen(version: TbxVersion, terms: readonly Term[]): string {
  // The file's default language is the first term's; each language section states its own anyway.
  const language = escapeAttribute(terms[0]?.language ?? DEFAULT_LANGUAGE);
  if (version === 2) return `<martif type="TBX" xml:lang="${language}">`;
  const type = isLinguist(terms) ? "TBX-Linguist" : "TBX-Basic";
  return `<tbx type="${type}" style="dca" xml:lang="${language}" xmlns="${TBX_V3_NAMESPACE}">`;
}

function tbxWriterFor(format: "tbx" | "tbx3", version: TbxVersion): TermWriter {
  return {
    format,
    shapes: ["file"],
    holds: (_shape: TermShape) => HOLDS,
    render(terms, target) {
      requireShape(format, target, "file");
      const dropped = droppedFields(terms, HOLDS);
      const source = soleSource(terms);
      if (source?.document.version === version) {
        return {
          files: [{ path: target.path, content: exportTbxSource(source.document, source.file, terms) }],
          removals: [],
          dropped,
          skipped: [],
          droppedHeaders: [],
        };
      }
      const header = (source === undefined ? undefined : carriedHeader(source.document)) ?? OWN_HEADER;
      const [root, headerTag] = version === 2 ? ["martif", "martifHeader"] : ["tbx", "tbxHeader"];
      const body = entries(terms, version);
      const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        rootOpen(version, terms),
        `  <${headerTag}>`,
        ...header,
        `  </${headerTag}>`,
        "  <text>",
        "    <body>",
        ...body.lines,
        "    </body>",
        "  </text>",
        `</${root}>`,
      ];
      return {
        files: [{ path: target.path, content: lines.map((line) => `${line}\n`).join("") }],
        removals: [],
        dropped,
        skipped: [],
        ...(body.conflicts.length === 0 ? {} : { conflicts: body.conflicts }),
        droppedHeaders: source === undefined ? tbxHeaderFiles(terms) : [],
      };
    },
  };
}

export const tbxWriter = tbxWriterFor("tbx", 2);
export const tbx3Writer = tbxWriterFor("tbx3", 3);
