/**
 * DITA 2.0 glossary topics. A `<glossentry>` is a topic, so a file whose root
 * is one holds one term; a `<glossgroup>` holds a term per glossentry inside
 * it. Both are self-declaring, so neither needs `type: term`.
 *
 * Only elements that survive in DITA 2.0 are read. `<glossdef>` is the
 * definition: DITA specializes it from `<abstract>`, but it is where a DITA
 * author writes what the term means, and mapping it anywhere else would drop
 * every definition from a round trip through DITA (proposal 0052 § 4).
 */
import type { Term, TermField, TermInput, TermReader, TermReadResult } from "../../types.js";
import { nothing, recordOf, skipped, termOf } from "./normalize.js";
import {
  childrenOf,
  descendantsOf,
  lineOfElement,
  nameOf,
  parseXml,
  spanOfElement,
  textOfElement,
  type ParsedXml,
  type XmlElement,
} from "./xml.js";

type Construct = "dita-glossentry" | "dita-glossgroup";

/** A glossdef's prose: its `<p>`s with a blank line between, or its text when it has none. */
function definitionOf(glossdef: XmlElement): string {
  const paragraphs = childrenOf(glossdef, "p");
  if (paragraphs.length === 0) return textOfElement(glossdef);
  return paragraphs
    .map(textOfElement)
    .filter((text) => text !== "")
    .join("\n\n");
}

function readEntry(
  input: TermInput,
  xml: ParsedXml,
  entry: XmlElement,
  construct: Construct,
  label: string,
): Term | string {
  const raw: Partial<Record<TermField, unknown>> = {};
  const lines: Partial<Record<TermField, number | undefined>> = {};
  const [glossterm] = childrenOf(entry, "glossterm");
  if (glossterm !== undefined) {
    raw.label = textOfElement(glossterm);
    lines.label = lineOfElement(glossterm);
  }
  const [glossdef] = childrenOf(entry, "glossdef");
  if (glossdef !== undefined) {
    raw.definition = definitionOf(glossdef);
    lines.definition = lineOfElement(glossdef);
  }
  const alts: string[] = [];
  for (const body of childrenOf(entry, "glossbody")) {
    const [usage] = childrenOf(body, "glossusage");
    if (usage !== undefined && raw["scope-note"] === undefined) {
      raw["scope-note"] = textOfElement(usage);
      lines["scope-note"] = lineOfElement(usage);
    }
    for (const alt of childrenOf(body, "glossalt")) {
      for (const form of childrenOf(alt)) {
        const name = nameOf(form);
        if (name !== "glosssynonym" && name !== "glossacronym") continue;
        alts.push(textOfElement(form));
        lines["alt-labels"] ??= lineOfElement(form);
      }
    }
  }
  raw["alt-labels"] = alts;

  const line = lineOfElement(entry);
  const record = recordOf(raw);
  if (record === undefined) return skipped(input, line, label);
  const span = spanOfElement(xml, entry);
  return termOf(input, {
    record,
    constructId: entry.getAttribute("id"),
    construct,
    line,
    lines,
    ...(span === undefined ? {} : { span }),
  });
}

function collect(
  input: TermInput,
  xml: ParsedXml,
  entries: readonly XmlElement[],
  construct: Construct,
  label: string,
): TermReadResult {
  const result = nothing();
  for (const entry of entries) {
    const read = readEntry(input, xml, entry, construct, label);
    if (typeof read === "string") result.notices.push(read);
    else result.terms.push(read);
  }
  return result;
}

const GLOSSENTRY_LABEL = "DITA glossentry";
const GLOSSGROUP_LABEL = "DITA glossgroup";

export const ditaGlossentryReader: TermReader = {
  construct: "dita-glossentry",
  label: GLOSSENTRY_LABEL,
  formats: ["xml"],
  read(input) {
    const xml = parseXml(input);
    if (xml === null || nameOf(xml.root) !== "glossentry") return nothing();
    return collect(input, xml, [xml.root], "dita-glossentry", GLOSSENTRY_LABEL);
  },
};

export const ditaGlossgroupReader: TermReader = {
  construct: "dita-glossgroup",
  label: GLOSSGROUP_LABEL,
  formats: ["xml"],
  read(input) {
    const xml = parseXml(input);
    if (xml === null || nameOf(xml.root) !== "glossgroup") return nothing();
    // A glossgroup may nest glossgroups; every glossentry inside is a term.
    return collect(input, xml, descendantsOf(xml.root, "glossentry"), "dita-glossgroup", GLOSSGROUP_LABEL);
  },
};
