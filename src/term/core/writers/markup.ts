/**
 * The small pieces every document writer and every in-place write shares:
 * escaping, a definition's paragraphs, the acronym test, and indentation.
 */
import type { Term } from "../../types.js";

export function xmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function xmlAttribute(value: string): string {
  return xmlText(value).replaceAll('"', "&quot;");
}

/**
 * A definition's paragraphs, each as its lines: paragraphs split on blank
 * lines, each line trimmed, empty lines and paragraphs dropped. Every body
 * reader reads a definition back the same way, joining a paragraph's lines
 * with one space.
 */
export function paragraphsOf(definition: string | undefined): string[][] {
  if (definition === undefined) return [];
  return definition
    .split(/\r?\n[ \t]*\r?\n/)
    .map((paragraph) =>
      paragraph
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    )
    .filter((lines) => lines.length > 0);
}

/** A paragraph as one line, for markup whose readers collapse whitespace anyway. */
export function paragraphText(lines: readonly string[]): string {
  return lines.join(" ");
}

/** Whether an alt-label is written as an acronym: it has letters, and none of them is lowercase. */
export function isAcronym(label: string): boolean {
  return /\p{L}/u.test(label) && !/\p{Ll}/u.test(label);
}

/** The language every term carries, when they all carry the same one. A file holds one language. */
export function sharedLanguage(terms: readonly Term[]): string | undefined {
  const [first] = terms;
  const language = first?.language;
  if (language === undefined) return undefined;
  return terms.every((t) => t.language === language) ? language : undefined;
}

/**
 * `text`, whose lines are at indentation zero, placed at `indent`: the first
 * line as is (it lands where the old entry started), every later non-empty
 * line prefixed, and lines joined with `eol`.
 */
export function reindent(text: string, indent: string, eol: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : `${indent}${line}`))
    .join(eol);
}

/** Lines as a file: `\n`-joined with one trailing newline. */
export function fileOf(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}
