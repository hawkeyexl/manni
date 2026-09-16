/**
 * Markdown and MDX definition lists, in PHP Markdown Extra's syntax:
 *
 *     Term
 *     Another term
 *     :   The definition, whose continuation lines
 *         are indented by four spaces or a tab.
 *
 *         A blank line and an indented line start a second paragraph.
 *
 * A definition list does not say what it is, so it is read only in a file
 * whose metadata declares `type: term-set`. The term lines sit directly above
 * the first `:` line; the first is the label and the rest are alt-labels. An
 * unindented line directly below a definition line continues it, as Markdown
 * Extra's lazy continuation does. A second `:` definition, directly below or
 * after a blank line, is kept out of the record and said as a notice.
 */
import type { Term, TermInput, TermReadResult, TermReader } from "../../types.js";
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

const LABEL = "definition list";
/** A definition line: `:` then one or more spaces or tabs and the text, or a bare `:`. */
const DEFINITION = /^:(?:[ \t]+(.*))?$/;
const INDENTED = /^(?: {4}|\t)/;
const HEADING = /^#{1,6}(?:[ \t]|$)/;

interface Definition {
  line: number;
  paragraphs: string[][];
}

function definitionStart(line: BodyLine | undefined): string | undefined {
  if (line === undefined || line.code) return undefined;
  const match = DEFINITION.exec(line.text);
  return match === null ? undefined : (match[1] ?? "");
}

function read(input: TermInput): TermReadResult {
  const terms: Term[] = [];
  const notices: string[] = [];
  if (input.metadata["type"] !== "term-set") return { terms, notices };

  const lines = bodyLines(input);
  let i = 0;
  while (i < lines.length) {
    const first = lines[i];
    if (first === undefined) break;
    if (first.code || isBlank(first)) {
      i++;
      continue;
    }

    // A run of term lines, then a definition line directly below them.
    const labels: BodyLine[] = [];
    let j = i;
    for (;;) {
      const line = lines[j];
      if (line === undefined || line.code || isBlank(line) || definitionStart(line) !== undefined) break;
      labels.push(line);
      j++;
    }
    const opener = definitionStart(lines[j]);
    if (opener === undefined) {
      // A paragraph, not an entry: skip to its end.
      i = j === i ? i + 1 : j;
      continue;
    }
    if (labels.length === 0 || labels.some((l) => HEADING.test(l.text))) {
      const orphan = lines[j];
      if (orphan !== undefined) notices.push(skippedNotice(input, orphan.line, LABEL, "term"));
      i = readDefinitions(lines, j, []);
      continue;
    }

    const definitions: Definition[] = [];
    i = readDefinitions(lines, j, definitions);
    const firstLabel = labels[0];
    const [kept] = definitions;
    if (firstLabel === undefined || kept === undefined) continue;
    const text = definitionText(kept.paragraphs);
    if (text === undefined) {
      notices.push(skippedNotice(input, firstLabel.line, LABEL, "definition"));
      continue;
    }
    for (const extra of definitions.slice(1)) {
      notices.push(
        `${input.file}:${String(extra.line)}: kept the first of ${String(definitions.length)} definitions for "${firstLabel.text.trim()}".`,
      );
    }
    const last = lastContentLine(lines, i);
    terms.push(
      termOf(input, "markdown-deflist", {
        labels: labels.map((l) => ({ text: l.text, line: l.line })),
        definition: text,
        definitionLine: kept.line,
        start: textStart(firstLabel),
        end: last?.end ?? firstLabel.end,
      }),
    );
  }
  return { terms, notices };
}

/** The last non-blank line before index `stop`. */
function lastContentLine(lines: readonly BodyLine[], stop: number): BodyLine | undefined {
  for (let k = stop - 1; k >= 0; k--) {
    const line = lines[k];
    if (line !== undefined && !isBlank(line)) return line;
  }
  return undefined;
}

/**
 * Read the definitions starting at index `at`, which is a definition line,
 * into `out`. Returns the index just past the last line they cover.
 */
function readDefinitions(lines: readonly BodyLine[], at: number, out: Definition[]): number {
  let i = at;
  for (;;) {
    const opener = lines[i];
    const text = definitionStart(opener);
    if (opener === undefined || text === undefined) return i;
    const definition: Definition = { line: opener.line, paragraphs: [[text]] };
    out.push(definition);
    i++;
    for (;;) {
      const line = lines[i];
      if (line === undefined || line.code) return i;
      if (definitionStart(line) !== undefined) break;
      if (!isBlank(line)) {
        // Indented or lazy, a line directly below belongs to the paragraph.
        definition.paragraphs.at(-1)?.push(line.text.replace(INDENTED, ""));
        i++;
        continue;
      }
      // A blank line: what follows decides.
      const k = nextNonBlank(lines, i);
      const next = lines[k];
      if (next === undefined || next.code) return i;
      if (definitionStart(next) !== undefined) {
        i = k;
        break;
      }
      if (!INDENTED.test(next.text)) return i;
      definition.paragraphs.push([]);
      i = k;
    }
  }
}

export const markdownDeflistReader: TermReader = {
  construct: "markdown-deflist",
  label: LABEL,
  formats: ["markdown", "mdx"],
  read,
};
