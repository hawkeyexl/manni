/**
 * `term write -f csv`: one row per term, for a translation or terminology
 * system to import. The headers describe themselves, so a system maps columns
 * by name: `ID`, then six columns per language the set holds, then the four
 * language-neutral relation columns.
 */
import { TERM_FIELDS, type Term, type TermField, type TermShape, type TermWriter } from "../../types.js";
import { DEFAULT_LANGUAGE, droppedFields, requireShape } from "./render-util.js";

/** The per-language columns, in order, with their header names. */
const LANGUAGE_COLUMNS: readonly (readonly [TermField, string])[] = [
  ["label", "Term"],
  ["definition", "Definition"],
  ["abstract", "Abstract"],
  ["alt-labels", "Alt labels"],
  ["hidden-labels", "Hidden labels"],
  ["scope-note", "Scope note"],
];

/** The columns every language shares: they name other terms, not words in a language. */
const NEUTRAL_COLUMNS: readonly (readonly [TermField, string])[] = [
  ["broader", "Broader"],
  ["narrower", "Narrower"],
  ["related-terms", "Related terms"],
  ["see", "See"],
];

/**
 * The one separator a list field is joined with inside its cell. A value that
 * itself contains ` | ` cannot be split back apart; that is the price of one
 * cell per field, which is what a translation system imports.
 */
const LIST_SEPARATOR = " | ";

/** RFC 4180 quoting: a cell holding a quote, comma or line break is quoted, with quotes doubled. */
function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function fieldText(term: Term, field: TermField): string {
  const value = term.record[field];
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.join(LIST_SEPARATOR);
}

export const csvWriter: TermWriter = {
  format: "csv",
  shapes: ["file"],
  holds: (_shape: TermShape) => TERM_FIELDS,
  render(terms, target) {
    requireShape("csv", target, "file");
    // Languages in order of first appearance, so the columns follow the set.
    const languages: string[] = [];
    for (const term of terms) {
      const language = term.language ?? DEFAULT_LANGUAGE;
      if (!languages.includes(language)) languages.push(language);
    }

    const header = [
      "ID",
      ...languages.flatMap((language) => LANGUAGE_COLUMNS.map(([, name]) => `${name} [${language}]`)),
      ...NEUTRAL_COLUMNS.map(([, name]) => name),
    ];
    const rows = terms.map((term) => {
      const own = term.language ?? DEFAULT_LANGUAGE;
      return [
        term.id,
        ...languages.flatMap((language) =>
          LANGUAGE_COLUMNS.map(([field]) => (language === own ? fieldText(term, field) : "")),
        ),
        ...NEUTRAL_COLUMNS.map(([field]) => fieldText(term, field)),
      ];
    });

    const content = [header, ...rows].map((row) => `${row.map(cell).join(",")}\n`).join("");
    return { files: [{ path: target.path, content }], removals: [], dropped: droppedFields(terms, TERM_FIELDS) };
  },
};
