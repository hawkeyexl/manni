/**
 * A MadCap Flare glossary, `.flglo` (proposal 0125, decision 18). Each
 * `<GlossaryEntry>` is a term: its first `<Term>` the label, later ones
 * alt-labels, and its `glossTerm` the id, because that is what a topic's
 * `MadCap:glossaryTerm` cites. An older entry with no `glossTerm` takes the
 * label's slug.
 *
 * A `<Definition>` with a `Link` names a topic rather than defining the term,
 * so it reads as no definition. An entry whose `conditions` the target
 * excludes is not read. The `conditions` on `<CatapultGlossary>` tags the file
 * and filters nothing, as in Flare. Read-only: Flare owns the file.
 */
import { includes, parseConditionTags } from "../../../shared/flare/index.js";
import { TermError } from "../../errors.js";
import type { TermField, TermInput, TermReader, TermReadResult } from "../../types.js";
import { nothing, recordOf, skipped, termOf, textOf } from "./normalize.js";
import { childrenOf, lineOfElement, nameOf, parseXml, spanOfElement, textOfElement } from "./xml.js";

const LABEL = "Flare glossary";

function read(input: TermInput): TermReadResult {
  const xml = parseXml(input);
  if (xml === null) throw new TermError(`${input.file}: could not be read as a Flare glossary.`);
  if (nameOf(xml.root) !== "catapultglossary") {
    throw new TermError(
      `${input.file}: is not a Flare glossary: its root element is <${xml.root.nodeName}>, not <CatapultGlossary>.`,
    );
  }

  const result = nothing();
  for (const entry of childrenOf(xml.root, "glossaryentry")) {
    if (!includes(input.conditions, parseConditionTags(entry.getAttribute("conditions")))) continue;

    const raw: Partial<Record<TermField, unknown>> = {};
    const lines: Partial<Record<TermField, number | undefined>> = {};
    const terms = childrenOf(entry, "terms").flatMap((list) => childrenOf(list, "term"));
    const [first, ...rest] = terms;
    if (first !== undefined) {
      raw.label = textOfElement(first);
      lines.label = lineOfElement(first);
    }
    raw["alt-labels"] = rest.map(textOfElement);
    lines["alt-labels"] = rest[0] === undefined ? undefined : lineOfElement(rest[0]);
    const definition = childrenOf(entry, "definition")[0];
    if (definition !== undefined && textOf(definition.getAttribute("Link")) === undefined) {
      raw.definition = textOfElement(definition);
      lines.definition = lineOfElement(definition);
    }

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
        constructId: entry.getAttribute("glossTerm"),
        construct: "flare-glossary",
        line,
        lines,
        ...(span === undefined ? {} : { span }),
      }),
    );
  }
  return result;
}

export const flareGlossaryReader: TermReader = {
  construct: "flare-glossary",
  label: LABEL,
  formats: ["flare-glossary"],
  read,
};
