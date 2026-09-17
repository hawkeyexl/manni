/**
 * What the body readers share: the body as lines, with the ones inside fenced
 * code marked, and the one way an entry becomes a `Term`.
 *
 * The body starts after a leading fenced metadata block (`---`, `+++`, `;;;`),
 * found the way the extractors find it. A native header (an AsciiDoc
 * attribute block, an rST docinfo field list) is read from the top, because
 * no construct read here can be mistaken for one.
 */
import { locateFrontmatter } from "../../../meta/index.js";
import { codeEndAt, codeRegions } from "../../../shared/code-regions.js";
import type { Term, TermConstruct, TermField, TermInput, TermRecord } from "../../types.js";
import { slugOf } from "../id.js";

export interface BodyLine {
  /** The line without its terminator or a trailing CR. */
  text: string;
  /** Offset of the line's first character in the file's content. */
  start: number;
  /** Offset just past the line's text, before any CR or LF. */
  end: number;
  /** 1-based file line. */
  line: number;
  /** Whether the line sits in fenced code. */
  code: boolean;
}

/** Offset of the line's first non-blank character: where an entry that starts on it begins. */
export function textStart(line: BodyLine): number {
  return line.start + (line.text.length - line.text.trimStart().length);
}

export function isBlank(line: BodyLine): boolean {
  return line.text.trim() === "";
}

/** The index of the first line at or after `from` that is not blank prose (the length when none). */
export function nextNonBlank(lines: readonly BodyLine[], from: number): number {
  let k = from;
  for (let line = lines[k]; line !== undefined && !line.code && isBlank(line); line = lines[k]) k++;
  return k;
}

/** The file's body, line by line. */
export function bodyLines(input: TermInput): BodyLine[] {
  const { content } = input;
  const bodyStart = locateFrontmatter(content)?.closeEnd ?? 0;
  const body = content.slice(bodyStart);
  const code = codeRegions(body, input.format, { spans: false });
  let line = 1;
  for (let i = 0; i < bodyStart; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  const out: BodyLine[] = [];
  let pos = bodyStart;
  while (pos < content.length) {
    const nl = content.indexOf("\n", pos);
    const stop = nl === -1 ? content.length : nl;
    const end = stop > pos && content.charCodeAt(stop - 1) === 13 ? stop - 1 : stop;
    out.push({
      text: content.slice(pos, end),
      start: pos,
      end,
      line,
      code: codeEndAt(code, pos - bodyStart) !== undefined,
    });
    line++;
    pos = stop + 1;
  }
  return out;
}

/**
 * A definition's text: each line trimmed, the lines of a paragraph joined with
 * one space, paragraphs separated by one blank line. Undefined when nothing is
 * left.
 */
export function definitionText(paragraphs: readonly (readonly string[])[]): string | undefined {
  const text = paragraphs
    .map((lines) =>
      lines
        .map((l) => l.trim())
        .filter((l) => l !== "")
        .join(" "),
    )
    .filter((p) => p !== "")
    .join("\n\n");
  return text === "" ? undefined : text;
}

export interface EntryLabel {
  text: string;
  line: number;
}

export interface Entry {
  /** The terms in source order; the first is the label. At least one, each non-empty. */
  labels: readonly EntryLabel[];
  definition: string;
  definitionLine: number;
  start: number;
  end: number;
}

/** A read entry as a `Term`. */
export function termOf(input: TermInput, construct: TermConstruct, entry: Entry): Term {
  const [first, ...rest] = entry.labels;
  const label = first?.text.trim() ?? "";
  const record: TermRecord = { label };
  const fieldLines: Partial<Record<TermField, number>> = { label: first?.line ?? entry.definitionLine };
  const alts = rest.map((l) => l.text.trim()).filter((t) => t !== "");
  const [firstAlt] = rest;
  if (alts.length > 0 && firstAlt !== undefined) {
    record["alt-labels"] = alts;
    fieldLines["alt-labels"] = firstAlt.line;
  }
  record.definition = entry.definition;
  fieldLines.definition = entry.definitionLine;
  const language = input.metadata["language"];
  return {
    id: slugOf(label),
    record,
    ...(typeof language === "string" && language.trim() !== "" ? { language: language.trim() } : {}),
    location: {
      file: input.file,
      ...(input.path === undefined ? {} : { path: input.path }),
      construct,
      line: first?.line ?? entry.definitionLine,
      fieldLines,
      span: { start: entry.start, end: entry.end },
    },
  };
}

/** The notice for an entry a reader could not read. */
export function skippedNotice(
  input: TermInput,
  line: number,
  label: string,
  missing: "term" | "definition",
): string {
  return `${input.file}:${String(line)}: skipped a ${label} entry with no ${missing}.`;
}
