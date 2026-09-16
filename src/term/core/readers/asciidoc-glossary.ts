/**
 * AsciiDoc glossary lists: a labelled list under a `[glossary]` block
 * attribute line, which says what it is, so no metadata declaration is needed.
 *
 *     [glossary]
 *     mud:: wet, cold dirt
 *     jam::
 *       sweet, sticky mess
 *     command-line interface::
 *     CLI:: a program you drive
 *     +
 *     A `+` line starts another paragraph of the same definition.
 *
 * A block title (`.Terms`) and blank lines may sit between the attribute and
 * the list. Terms stacked on adjacent lines share the definition below the
 * last of them; the first is the label and the rest are alt-labels. The
 * definition is the text after `::` and the non-blank lines directly below.
 * The list ends at a blank line followed by anything but another item, and at
 * a section title, a block attribute or title line, a delimited block, or code.
 */
import type { Term, TermInput, TermReadResult, TermReader } from "../../types.js";
import { LIST_HOLDS, asciidocEntry } from "../writers/entries.js";
import { applyEntries } from "./splice.js";
import {
  bodyLines,
  definitionText,
  isBlank,
  nextNonBlank,
  skippedNotice,
  termOf,
  textStart,
  type BodyLine,
} from "./body.js";

const LABEL = "[glossary] list";
const ATTRIBUTE = /^\[glossary\][ \t]*$/;
/** `term::` or `term:: definition`. A term ending in `:` is a deeper `:::` level, not this list's. */
const ITEM = /^[ \t]*(.*?[^:\s])::(?:[ \t]+(.*))?$/;
const BLOCK_TITLE = /^\.[^.\s]/;
/** Lines that end the list outright: a section title, an attribute line, a delimiter. */
const LIST_END = /^(?:=+[ \t]|\[.*\][ \t]*$|(?:-{4,}|={4,}|\*{4,}|\.{4,}|_{4,}|\+{4,}|\|===)[ \t]*$)/;

interface Open {
  labels: BodyLine[];
  definitionLine: number;
  paragraphs: string[][];
  last: BodyLine;
}

function item(line: BodyLine): { term: string; text: string | undefined } | undefined {
  const match = ITEM.exec(line.text);
  const term = match?.[1];
  if (match === null || term === undefined) return undefined;
  const text = match[2]?.trim();
  return { term, text: text === "" ? undefined : text };
}

function read(input: TermInput): TermReadResult {
  const terms: Term[] = [];
  const notices: string[] = [];
  const lines = bodyLines(input);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (line === undefined || line.code || !ATTRIBUTE.test(line.text)) continue;
    // Blank lines and a block title may sit between the attribute and its list.
    let start = i;
    for (let l = lines[start]; l !== undefined && !l.code && (isBlank(l) || BLOCK_TITLE.test(l.text)); l = lines[start]) {
      start++;
    }
    const first = lines[start];
    if (first === undefined || first.code || item(first) === undefined) continue;
    i = readList(input, lines, start, terms, notices);
  }
  return { terms, notices };
}

/** Read the list starting at index `at`, an item. Returns the index just past it. */
function readList(
  input: TermInput,
  lines: readonly BodyLine[],
  at: number,
  terms: Term[],
  notices: string[],
): number {
  let pending: BodyLine[] = [];
  let open: Open | undefined;

  const close = (): void => {
    if (open !== undefined) {
      const text = definitionText(open.paragraphs);
      const [firstLabel] = open.labels;
      if (text !== undefined && firstLabel !== undefined) {
        terms.push(
          termOf(input, "asciidoc-glossary", {
            labels: open.labels.map((l) => ({ text: itemTerm(l), line: l.line })),
            definition: text,
            definitionLine: open.definitionLine,
            start: textStart(firstLabel),
            end: open.last.end,
          }),
        );
      } else if (firstLabel !== undefined) {
        notices.push(skippedNotice(input, firstLabel.line, LABEL, "definition"));
      }
      open = undefined;
    }
    const [firstPending] = pending;
    if (firstPending !== undefined) {
      notices.push(skippedNotice(input, firstPending.line, LABEL, "definition"));
      pending = [];
    }
  };

  let i = at;
  for (;;) {
    const line = lines[i];
    if (line === undefined || line.code) break;

    if (isBlank(line)) {
      close();
      const k = nextNonBlank(lines, i);
      const next = lines[k];
      if (next === undefined || next.code || item(next) === undefined) break;
      i = k;
      continue;
    }

    const entry = item(line);
    if (entry !== undefined) {
      if (open !== undefined) close();
      pending.push(line);
      if (entry.text !== undefined) {
        open = { labels: pending, definitionLine: line.line, paragraphs: [[entry.text]], last: line };
        pending = [];
      }
      i++;
      continue;
    }

    if (line.text.trim() === "+" && open !== undefined) {
      open.paragraphs.push([]);
      i++;
      continue;
    }
    if (LIST_END.test(line.text) || BLOCK_TITLE.test(line.text)) break;

    if (open !== undefined) {
      open.paragraphs.at(-1)?.push(line.text);
      open.last = line;
    } else if (pending.length > 0) {
      open = { labels: pending, definitionLine: line.line, paragraphs: [[line.text]], last: line };
      pending = [];
    } else {
      break;
    }
    i++;
  }
  close();
  return i;
}

function itemTerm(line: BodyLine): string {
  return item(line)?.term ?? line.text;
}

export const asciidocGlossaryReader: TermReader = {
  construct: "asciidoc-glossary",
  label: LABEL,
  formats: ["asciidoc"],
  read,
  apply: (input, terms) =>
    applyEntries(input, read, terms, { holds: LIST_HOLDS, id: false, serialize: (term) => asciidocEntry(term.record) }),
};
