/**
 * reStructuredText glossaries: the Sphinx `.. glossary::` directive, which says
 * what it is, so no metadata declaration is needed.
 *
 *     .. glossary::
 *        :sorted:
 *
 *        source directory
 *        source dir
 *           The directory that holds sources.
 *
 *           A blank line starts another paragraph.
 *
 * Option lines directly below the directive are skipped. The first content
 * line sets the base indentation: a line there is a term, a line indented
 * further is definition, and a blank line may sit between the two. Terms on
 * adjacent lines share the definition below them; the first is the label and the rest are alt-labels. A term's
 * classifier (`term : index key`) is not part of the label. The directive ends
 * where indentation returns to or below its own.
 *
 * rST has no fences, so code is found here: the body of a `code-block`,
 * `code` or `sourcecode` directive, and the literal block after a paragraph
 * ending in `::`, are never read.
 */
import type { Term, TermInput, TermReadResult, TermReader } from "../../types.js";
import { LIST_HOLDS, rstEntry } from "../writers/entries.js";
import { applyEntries } from "./splice.js";
import { bodyLines, definitionText, isBlank, skippedNotice, termOf, textStart, type BodyLine } from "./body.js";

const LABEL = ".. glossary::";
const DIRECTIVE = /^[ \t]*\.\.[ \t]+glossary::[ \t]*$/;
const CODE_DIRECTIVE = /^[ \t]*\.\.[ \t]+(?:code-block|code|sourcecode)::/;
const EXPLICIT_MARKUP = /^[ \t]*\.\.(?:[ \t]|$)/;
const OPTION = /^[ \t]*:[^:\s][^:]*:(?:[ \t].*)?$/;
const CLASSIFIER = /[ \t]+:[ \t]+/;

/** Indentation width, with a tab advancing to the next multiple of 8 as rST reads it. */
function indentOf(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width++;
    else if (ch === "\t") width += 8 - (width % 8);
    else break;
  }
  return width;
}

/** Whether a line introduces an indented block that is code. */
function opensLiteral(line: BodyLine): boolean {
  if (CODE_DIRECTIVE.test(line.text)) return true;
  return !EXPLICIT_MARKUP.test(line.text) && line.text.trimEnd().endsWith("::");
}

function read(input: TermInput): TermReadResult {
  const terms: Term[] = [];
  const notices: string[] = [];
  const lines = bodyLines(input);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (isBlank(line)) {
      i++;
      continue;
    }
    if (DIRECTIVE.test(line.text)) {
      i = readGlossary(input, lines, i, terms, notices);
      continue;
    }
    i = opensLiteral(line) ? blockEnd(lines, i + 1, indentOf(line.text)) : i + 1;
  }
  return { terms, notices };
}

/**
 * The index of the first non-blank line at or after `from` indented `indent`
 * or less: where a block opened at that indentation ends.
 */
function blockEnd(lines: readonly BodyLine[], from: number, indent: number): number {
  let k = from;
  for (let l = lines[k]; l !== undefined && (isBlank(l) || indentOf(l.text) > indent); l = lines[k]) k++;
  return k;
}

interface Definition {
  line: number;
  paragraphs: string[][];
  last: BodyLine;
  gap: boolean;
}

/** Read the glossary whose directive is at index `at`. Returns the index just past it. */
function readGlossary(
  input: TermInput,
  lines: readonly BodyLine[],
  at: number,
  terms: Term[],
  notices: string[],
): number {
  const directive = lines[at];
  if (directive === undefined) return at + 1;
  const end = blockEnd(lines, at + 1, indentOf(directive.text));

  let i = at + 1;
  for (let l = lines[i]; i < end && l !== undefined && !isBlank(l) && OPTION.test(l.text); l = lines[i]) i++;

  let base: number | undefined;
  let labels: BodyLine[] = [];
  let definition: Definition | undefined;
  let orphan = false;

  const close = (): void => {
    const [first] = labels;
    if (first !== undefined) {
      const text = definition === undefined ? undefined : definitionText(definition.paragraphs);
      if (definition !== undefined && text !== undefined) {
        terms.push(
          termOf(input, "rst-glossary", {
            labels: labels.map((l) => ({ text: termText(l), line: l.line })),
            definition: text,
            definitionLine: definition.line,
            start: textStart(first),
            end: definition.last.end,
          }),
        );
      } else {
        notices.push(skippedNotice(input, first.line, LABEL, "definition"));
      }
    }
    labels = [];
    definition = undefined;
  };

  let blank = false;
  for (; i < end; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (isBlank(line)) {
      if (definition !== undefined) definition.gap = true;
      blank = true;
      continue;
    }
    const indent = indentOf(line.text);
    base ??= indent;
    if (indent <= base) {
      // A term after a definition, or after a blank line below terms that
      // never got one, starts a new entry.
      if (definition !== undefined || blank) close();
      orphan = false;
      blank = false;
      labels.push(line);
      continue;
    }
    blank = false;
    if (definition !== undefined) {
      if (definition.gap) {
        definition.paragraphs.push([]);
        definition.gap = false;
      }
      definition.paragraphs.at(-1)?.push(line.text);
      definition.last = line;
    } else if (labels.length > 0) {
      definition = { line: line.line, paragraphs: [[line.text]], last: line, gap: false };
    } else if (!orphan) {
      notices.push(skippedNotice(input, line.line, LABEL, "term"));
      orphan = true;
    }
  }
  close();
  return end;
}

/** A term line's label: trimmed, without a classifier. */
function termText(line: BodyLine): string {
  const text = line.text.trim();
  const match = CLASSIFIER.exec(text);
  return match === null ? text : text.slice(0, match.index);
}

export const rstGlossaryReader: TermReader = {
  construct: "rst-glossary",
  label: LABEL,
  formats: ["rst"],
  read,
  apply: (input, terms) =>
    applyEntries(input, read, terms, { holds: LIST_HOLDS, id: false, serialize: (term) => rstEntry(term.record) }),
};
