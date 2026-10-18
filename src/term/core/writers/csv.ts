/**
 * `term write -f csv`: one row per id, for a translation or terminology
 * system to import. The headers describe themselves, so a system maps columns
 * by name: `ID`, then six columns per language the set holds, each filled
 * from that language's term, then the four language-neutral relation columns,
 * which take the first term's value.
 */
import type { MergeConflict, Term, TermField, TermRecord, TermShape, TermWriter } from "../../types.js";
import { conceptGroups, mergeFirst } from "./merge.js";
import { droppedFields, languageKey, languageOf, requireShape } from "./render-util.js";

/** The fields the columns hold: the ten of terminology 1.0.0. Every other field is reported dropped. */
const HOLDS = [
  "label",
  "definition",
  "abstract",
  "alt-labels",
  "hidden-labels",
  "broader",
  "narrower",
  "related-terms",
  "see",
  "scope-note",
] as const satisfies readonly TermField[];
type CsvField = (typeof HOLDS)[number];

/** The per-language columns, in order, with their header names. */
const LANGUAGE_COLUMNS: readonly (readonly [CsvField, string])[] = [
  ["label", "Term"],
  ["definition", "Definition"],
  ["abstract", "Abstract"],
  ["alt-labels", "Alt labels"],
  ["hidden-labels", "Hidden labels"],
  ["scope-note", "Scope note"],
];

/** The columns every language shares: they name other terms, not words in a language. */
const NEUTRAL_COLUMNS: readonly (readonly [CsvField, string])[] = [
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

function fieldText(record: Partial<Pick<TermRecord, CsvField>>, field: CsvField): string {
  const value = record[field];
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.join(LIST_SEPARATOR);
}

/**
 * The set joined on id: one row per id, holding at most one term per
 * language. A second term with an id and language a row already holds starts
 * a row of its own, so a repeated id in one language is written, not lost.
 */
function rowsOf(terms: readonly Term[]): Term[][] {
  return conceptGroups(terms).flatMap((group) => {
    const rows: Term[][] = [];
    for (const term of group) {
      const row = rows.find((r) => !r.some((t) => languageKey(t) === languageKey(term)));
      if (row === undefined) rows.push([term]);
      else row.push(term);
    }
    return rows;
  });
}

export const csvWriter: TermWriter = {
  format: "csv",
  shapes: ["file"],
  holds: (_shape: TermShape) => HOLDS,
  render(terms, target) {
    requireShape("csv", target, "file");
    // Languages in order of first appearance, so the columns follow the set.
    const languages = new Map<string, string>();
    for (const term of terms) {
      if (!languages.has(languageKey(term))) languages.set(languageKey(term), languageOf(term));
    }

    const header = [
      "ID",
      ...[...languages.values()].flatMap((language) => LANGUAGE_COLUMNS.map(([, name]) => `${name} [${language}]`)),
      ...NEUTRAL_COLUMNS.map(([, name]) => name),
    ];
    const conflicts: MergeConflict[] = [];
    const rows = rowsOf(terms).map((row) => {
      const [first] = row;
      const id = first?.id ?? "";
      // The neutral columns name other terms, so the row holds them once.
      const neutral = mergeFirst(
        id,
        row.map((t) => Object.fromEntries(NEUTRAL_COLUMNS.map(([field]) => [field, t.record[field]]))),
      );
      conflicts.push(...neutral.conflicts);
      return [
        id,
        ...[...languages.keys()].flatMap((language) => {
          const own = row.find((t) => languageKey(t) === language);
          return LANGUAGE_COLUMNS.map(([field]) => (own === undefined ? "" : fieldText(own.record, field)));
        }),
        ...NEUTRAL_COLUMNS.map(([field]) => fieldText(neutral.merged, field)),
      ];
    });

    const content = [header, ...rows].map((row) => `${row.map(cell).join(",")}\n`).join("");
    return {
      files: [{ path: target.path, content }],
      removals: [],
      dropped: droppedFields(terms, HOLDS),
      skipped: [],
      ...(conflicts.length === 0 ? {} : { conflicts }),
    };
  },
};
