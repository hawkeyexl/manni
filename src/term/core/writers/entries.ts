/**
 * One entry of each many-per-file construct, as text. The document writers
 * assemble files from these, and each construct's reader splices the same
 * text back in place, so an entry a render wrote and an entry an in-place
 * write replaced are byte for byte the same.
 *
 * Each returns the entry's lines at indentation zero, `\n`-joined, with no
 * trailing newline. The caller indents and terminates.
 */
import type { Term, TermRecord } from "../../types.js";
import { isAcronym, paragraphText, paragraphsOf, xmlAttribute, xmlText } from "./markup.js";

function labelsOf(record: TermRecord): string[] {
  return [record.label, ...(record["alt-labels"] ?? [])];
}

/**
 * A Markdown Extra definition list entry: the label and each alt-label on a
 * line, then `:   ` and the definition, continuation lines and later
 * paragraphs indented four spaces. A term with no definition gets a bare `:`,
 * which the reader reports rather than reading as prose.
 */
export function markdownEntry(record: TermRecord): string {
  const lines = labelsOf(record);
  const paragraphs = paragraphsOf(record.definition);
  if (paragraphs.length === 0) return [...lines, ":"].join("\n");
  paragraphs.forEach((paragraph, p) => {
    if (p > 0) lines.push("");
    paragraph.forEach((line, i) => {
      lines.push(p === 0 && i === 0 ? `:   ${line}` : `    ${line}`);
    });
  });
  return lines.join("\n");
}

/**
 * An AsciiDoc labelled list entry: each term as `term::`, the definition's
 * first line after the last term's `::`, and each later paragraph after a `+`
 * continuation line.
 */
export function asciidocEntry(record: TermRecord): string {
  const labels = labelsOf(record);
  const paragraphs = paragraphsOf(record.definition);
  const lines = labels.map((label) => `${label}::`);
  paragraphs.forEach((paragraph, p) => {
    if (p > 0) lines.push("+");
    paragraph.forEach((line, i) => {
      if (p === 0 && i === 0) lines[lines.length - 1] = `${lines[lines.length - 1] ?? ""} ${line}`;
      else lines.push(line);
    });
  });
  return lines.join("\n");
}

/** A `.. glossary::` entry: the terms on their own lines, the definition indented three spaces. */
export function rstEntry(record: TermRecord): string {
  const lines = labelsOf(record);
  paragraphsOf(record.definition).forEach((paragraph, p) => {
    if (p > 0) lines.push("");
    for (const line of paragraph) lines.push(`   ${line}`);
  });
  return lines.join("\n");
}

/** The `<dd>` or `<glossdef>` body: one paragraph inline, several as `<p>`s. */
function blockDefinition(open: string, close: string, paragraph: string, definition: string | undefined): string[] {
  const paragraphs = paragraphsOf(definition);
  const [only] = paragraphs;
  if (only === undefined) return [];
  if (paragraphs.length === 1) return [`${open}${xmlText(paragraphText(only))}${close}`];
  return [
    open,
    ...paragraphs.map((lines) => `  <${paragraph}>${xmlText(paragraphText(lines))}</${paragraph}>`),
    close,
  ];
}

/** An HTML `<dt>` per term, the first carrying the id, then a `<dd>` when there is a definition. */
export function htmlDlEntry(term: Term): string {
  const [label, ...alts] = labelsOf(term.record);
  return [
    `<dt id="${xmlAttribute(term.id)}">${xmlText(label ?? "")}</dt>`,
    ...alts.map((alt) => `<dt>${xmlText(alt)}</dt>`),
    ...blockDefinition("<dd>", "</dd>", "p", term.record.definition),
  ].join("\n");
}

/**
 * A DITA 2.0 `<glossentry>`: glossterm, glossdef, then a glossBody holding the
 * scope note as glossUsage and one glossAlt per alt-label. `language` is set as
 * `xml:lang` where the entry is the file's root, which is where a reader looks.
 */
export function ditaEntry(term: Term, language?: string): string {
  const { record } = term;
  const alts = record["alt-labels"] ?? [];
  const scopeNote = record["scope-note"];
  const lang = language === undefined ? "" : ` xml:lang="${xmlAttribute(language)}"`;
  const body =
    scopeNote === undefined && alts.length === 0
      ? []
      : [
          "  <glossBody>",
          ...(scopeNote === undefined ? [] : [`    <glossUsage>${xmlText(scopeNote)}</glossUsage>`]),
          ...alts.flatMap((alt) => {
            const element = isAcronym(alt) ? "glossAcronym" : "glossSynonym";
            return ["    <glossAlt>", `      <${element}>${xmlText(alt)}</${element}>`, "    </glossAlt>"];
          }),
          "  </glossBody>",
        ];
  return [
    `<glossentry id="${xmlAttribute(term.id)}"${lang}>`,
    `  <glossterm>${xmlText(record.label)}</glossterm>`,
    ...blockDefinition("<glossdef>", "</glossdef>", "p", record.definition).map((line) => `  ${line}`),
    ...body,
    "</glossentry>",
  ].join("\n");
}

/**
 * A DocBook `<glossentry>`: the label as glossterm, each alt-label as an
 * acronym when it is all caps and a glossterm otherwise, the definition as
 * paras with a glossseealso per related term, then a glosssee.
 */
export function docbookEntry(term: Term): string {
  const { record } = term;
  const related = record["related-terms"] ?? [];
  const paragraphs = paragraphsOf(record.definition);
  const glossdef =
    paragraphs.length === 0 && related.length === 0
      ? []
      : [
          "  <glossdef>",
          ...paragraphs.map((lines) => `    <para>${xmlText(paragraphText(lines))}</para>`),
          ...related.map((target) => `    <glossseealso>${xmlText(target)}</glossseealso>`),
          "  </glossdef>",
        ];
  return [
    `<glossentry xml:id="${xmlAttribute(term.id)}">`,
    `  <glossterm>${xmlText(record.label)}</glossterm>`,
    ...(record["alt-labels"] ?? []).map((alt) =>
      isAcronym(alt) ? `  <acronym>${xmlText(alt)}</acronym>` : `  <glossterm>${xmlText(alt)}</glossterm>`,
    ),
    ...glossdef,
    ...(record.see === undefined ? [] : [`  <glosssee>${xmlText(record.see)}</glosssee>`]),
    "</glossentry>",
  ].join("\n");
}
