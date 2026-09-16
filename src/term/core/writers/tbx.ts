/**
 * `term write -f tbx`: the set as a TBX v2 (2008) termbase, the exchange format
 * translation memory and terminology systems import. One `<termEntry>` per
 * term, one `<langSet>` in the term's language, and one `<tig>` per
 * designation, with its administrative status: the label is preferred, an
 * alt-label admitted, a hidden-label deprecated.
 */
import type { Term, TermField, TermShape, TermWriter } from "../../types.js";
import { DEFAULT_LANGUAGE, droppedFields, requireShape } from "./render-util.js";

const HOLDS: readonly TermField[] = ["label", "definition", "alt-labels", "hidden-labels"];

function text(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function attribute(value: string): string {
  return text(value).replaceAll('"', "&quot;");
}

function tig(designation: string, status: string): string[] {
  return [
    "          <tig>",
    `            <term>${text(designation)}</term>`,
    `            <termNote type="administrativeStatus">${status}</termNote>`,
    "          </tig>",
  ];
}

function termEntry(term: Term): string[] {
  const { record } = term;
  return [
    `      <termEntry id="${attribute(term.id)}">`,
    ...(record.definition === undefined
      ? []
      : [`        <descrip type="definition">${text(record.definition)}</descrip>`]),
    `        <langSet xml:lang="${attribute(term.language ?? DEFAULT_LANGUAGE)}">`,
    ...tig(record.label, "preferredTerm-admn-sts"),
    ...(record["alt-labels"] ?? []).flatMap((label) => tig(label, "admittedTerm-admn-sts")),
    ...(record["hidden-labels"] ?? []).flatMap((label) => tig(label, "deprecatedTerm-admn-sts")),
    "        </langSet>",
    "      </termEntry>",
  ];
}

export const tbxWriter: TermWriter = {
  format: "tbx",
  shapes: ["file"],
  holds: (_shape: TermShape) => HOLDS,
  render(terms, target) {
    requireShape("tbx", target, "file");
    // The file's default language is the first term's; each langSet states its own anyway.
    const language = terms[0]?.language ?? DEFAULT_LANGUAGE;
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<martif type="TBX" xml:lang="${attribute(language)}">`,
      "  <martifHeader>",
      "    <fileDesc>",
      "      <sourceDesc>",
      "        <p>manni term write</p>",
      "      </sourceDesc>",
      "    </fileDesc>",
      "  </martifHeader>",
      "  <text>",
      "    <body>",
      ...terms.flatMap(termEntry),
      "    </body>",
      "  </text>",
      "</martif>",
    ];
    const content = lines.map((line) => `${line}\n`).join("");
    return {
      files: [{ path: target.path, content }],
      removals: [],
      dropped: droppedFields(terms, HOLDS),
      skipped: [],
    };
  },
};
