/**
 * DocBook's `<glossary>`, in DocBook 5's namespace or DocBook 4's none. It is
 * self-declaring, so any file holding one is read, and every `<glossentry>`
 * under it, `<glossdiv>`s included, is a term.
 *
 * Where an entry names several terms, the first `<glossterm>` is the label and
 * a later one, or an `<acronym>`, is an alt-label (proposal 0052 § 4).
 */
import type { TermField, TermInput, TermReader, TermReadResult } from "../../types.js";
import { nothing, recordOf, skipped, termOf, textOf } from "./normalize.js";
import {
  childrenOf,
  descendantsOf,
  lineOfElement,
  nameOf,
  parseXml,
  spanOfElement,
  textOfElement,
  type XmlElement,
} from "./xml.js";

const LABEL = "DocBook glossary";

/** A cross-reference's target as written: its text, else its `otherterm` idref. */
function referenceOf(el: XmlElement): string | undefined {
  return textOf(textOfElement(el)) ?? textOf(el.getAttribute("otherterm"));
}

/** A glossdef's prose: each paragraph's text, a blank line between, cross-references left out. */
function definitionOf(glossdef: XmlElement): string {
  const blocks = childrenOf(glossdef).filter((child) => nameOf(child) !== "glossseealso");
  if (blocks.length === 0) return textOfElement(glossdef);
  return blocks
    .map(textOfElement)
    .filter((text) => text !== "")
    .join("\n\n");
}

function read(input: TermInput): TermReadResult {
  const xml = parseXml(input);
  if (xml === null) return nothing();
  const glossaries = nameOf(xml.root) === "glossary" ? [xml.root] : descendantsOf(xml.root, "glossary");
  if (glossaries.length === 0) return nothing();

  const seen = new Set<XmlElement>();
  const result = nothing();
  for (const glossary of glossaries) {
    for (const entry of descendantsOf(glossary, "glossentry")) {
      if (seen.has(entry)) continue;
      seen.add(entry);

      const raw: Partial<Record<TermField, unknown>> = {};
      const lines: Partial<Record<TermField, number | undefined>> = {};
      const alts: string[] = [];
      const definitions: string[] = [];
      const related: string[] = [];
      for (const child of childrenOf(entry)) {
        const name = nameOf(child);
        if (name === "glossterm" && raw.label === undefined) {
          raw.label = textOfElement(child);
          lines.label = lineOfElement(child);
        } else if (name === "glossterm" || name === "acronym") {
          alts.push(textOfElement(child));
          lines["alt-labels"] ??= lineOfElement(child);
        } else if (name === "glossdef") {
          definitions.push(definitionOf(child));
          lines.definition ??= lineOfElement(child);
          for (const seeAlso of childrenOf(child, "glossseealso")) {
            const target = referenceOf(seeAlso);
            if (target !== undefined) related.push(target);
            lines["related-terms"] ??= lineOfElement(seeAlso);
          }
        } else if (name === "glosssee" && raw.see === undefined) {
          raw.see = referenceOf(child);
          lines.see = lineOfElement(child);
        }
      }
      raw["alt-labels"] = alts;
      raw.definition = definitions.filter((text) => text !== "").join("\n\n");
      raw["related-terms"] = related;

      const line = lineOfElement(entry);
      const record = recordOf(raw);
      if (record === undefined) {
        result.notices.push(skipped(input, line, LABEL));
        continue;
      }
      const span = spanOfElement(xml, entry);
      result.terms.push(
        termOf(input, {
          record,
          constructId: entry.getAttribute("xml:id"),
          construct: "docbook-glossary",
          line,
          lines,
          ...(span === undefined ? {} : { span }),
        }),
      );
    }
  }
  return result;
}

export const docbookGlossaryReader: TermReader = {
  construct: "docbook-glossary",
  label: LABEL,
  formats: ["xml"],
  read,
};
