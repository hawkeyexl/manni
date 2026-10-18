/**
 * SKOS concept schemes (proposal 0086 § 5): each `skos:Concept` is a term
 * per language its `skos:prefLabel` holds, all sharing the id the concept's
 * IRI ends in, so the languages join on `id` as TBX's do (proposal 0084).
 *
 * The loader hands this reader Turtle, or N-Quads it expanded from JSON-LD,
 * so one parse covers both. A value no term field holds is not dropped
 * quietly: the reader counts it and says so once per file.
 *
 * RDF is a set of triples, so the order a file lists its concepts in says
 * nothing. Terms come out sorted by id, and a concept's languages sorted by
 * tag, so a Turtle file and its JSON-LD twin read the same.
 */
import { Parser, type Quad, type Term as RdfTerm } from "n3";
import { errorMessage } from "../../../shared/errors.js";
import { TermError } from "../../errors.js";
import type { Term, TermField, TermInput, TermReader, TermReadResult } from "../../types.js";
import { recordOf, termOf } from "./normalize.js";

export const SKOS = "http://www.w3.org/2004/02/skos/core#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const CONCEPT = `${SKOS}Concept`;

/**
 * How a property's values sit in a term. `text` and `texts` are literals per
 * language, one value or a list; `concepts` and `iris` are IRIs the concept
 * holds in every language, as a target's id or as written; `code` is one
 * literal the concept holds in every language.
 */
export type SkosKind = "text" | "texts" | "concepts" | "iris" | "code";

/** Every SKOS property a term field holds, in the order a concept is written. */
export const SKOS_PROPERTIES: readonly { property: string; field: TermField; kind: SkosKind }[] = [
  { property: "prefLabel", field: "label", kind: "text" },
  { property: "altLabel", field: "alt-labels", kind: "texts" },
  { property: "hiddenLabel", field: "hidden-labels", kind: "texts" },
  { property: "definition", field: "definition", kind: "text" },
  { property: "scopeNote", field: "scope-note", kind: "text" },
  { property: "notation", field: "notation", kind: "code" },
  { property: "broader", field: "broader", kind: "concepts" },
  { property: "narrower", field: "narrower", kind: "concepts" },
  { property: "related", field: "related-terms", kind: "concepts" },
  { property: "exactMatch", field: "exact-matches", kind: "iris" },
  { property: "closeMatch", field: "close-matches", kind: "iris" },
  { property: "broadMatch", field: "broad-matches", kind: "iris" },
  { property: "narrowMatch", field: "narrow-matches", kind: "iris" },
  { property: "relatedMatch", field: "related-matches", kind: "iris" },
  { property: "note", field: "notes", kind: "texts" },
  { property: "example", field: "contexts", kind: "texts" },
];

const BY_IRI = new Map(SKOS_PROPERTIES.map((p) => [`${SKOS}${p.property}`, p]));

/** Read for what it says about the scheme, which no term holds, so never reported. */
const UNDERSTOOD: ReadonlySet<string> = new Set([RDF_TYPE, `${SKOS}inScheme`, `${SKOS}topConceptOf`]);

/** The prefixes a notice spells a property with. */
const PREFIXES: readonly [string, string][] = [
  ["skos", SKOS],
  ["rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  ["rdfs", "http://www.w3.org/2000/01/rdf-schema#"],
  ["dcterms", "http://purl.org/dc/terms/"],
  ["owl", "http://www.w3.org/2002/07/owl#"],
];

const LABEL = "SKOS concept";

function nameOf(iri: string): string {
  for (const [prefix, namespace] of PREFIXES) {
    if (iri.startsWith(namespace)) return `${prefix}:${iri.slice(namespace.length)}`;
  }
  return `<${iri}>`;
}

/** What an IRI ends in, after its last `#` or `/`, percent-decoded. `undefined` when that is empty. */
export function localName(iri: string): string | undefined {
  const tail = iri.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/")) + 1);
  if (tail === "") return undefined;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/** Values a file held that no term does, counted per reason in the order first met. */
class Unread {
  private readonly counts = new Map<string, number>();
  add(reason: string): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }
  notices(file: string): string[] {
    return [...this.counts].map(
      ([reason, n]) => `${file}: ${reason}, so ${n === 1 ? "1 value was" : `${String(n)} values were`} not read.`,
    );
  }
}

function parse(input: TermInput): Quad[] {
  try {
    return new Parser().parse(input.content);
  } catch (error) {
    throw new TermError(`${input.file}: could not be read as SKOS: ${errorMessage(error)}`);
  }
}

/** A concept's quads, as one entry per concept, in the order first met. */
function concepts(quads: readonly Quad[]): Map<string, { subject: RdfTerm; quads: Quad[] }> {
  const typed = new Set(
    quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === CONCEPT).map((q) => q.subject.id),
  );
  const found = new Map<string, { subject: RdfTerm; quads: Quad[] }>();
  for (const quad of quads) {
    if (!typed.has(quad.subject.id)) continue;
    const entry = found.get(quad.subject.id) ?? { subject: quad.subject, quads: [] };
    entry.quads.push(quad);
    found.set(quad.subject.id, entry);
  }
  return found;
}

type Raw = Partial<Record<TermField, string | string[]>>;

function append(raw: Raw, field: TermField, value: string): void {
  const current = raw[field];
  raw[field] = Array.isArray(current) ? [...current, value] : [value];
}

function readConcept(
  input: TermInput,
  subject: RdfTerm,
  quads: readonly Quad[],
  unread: Unread,
  notices: string[],
): Term[] {
  const id = subject.termType === "NamedNode" ? localName(subject.value) : undefined;
  const name = id ?? subject.value;
  const languages = new Map<string, Raw>();
  for (const quad of quads) {
    if (quad.predicate.value === `${SKOS}prefLabel` && quad.object.termType === "Literal") {
      languages.set(quad.object.language, languages.get(quad.object.language) ?? {});
    }
  }
  if (languages.size === 0) {
    notices.push(`${input.file}: skipped SKOS concept "${name}", which has no skos:prefLabel.`);
    return [];
  }

  const shared: Raw = {};
  for (const { predicate, object } of quads) {
    if (UNDERSTOOD.has(predicate.value)) continue;
    const property = BY_IRI.get(predicate.value);
    const spelled = nameOf(predicate.value);
    if (property === undefined) {
      unread.add(`${spelled} is not a term field`);
      continue;
    }
    const literal = property.kind === "text" || property.kind === "texts" || property.kind === "code";
    if (literal !== (object.termType === "Literal")) {
      unread.add(`${spelled} on "${name}" is not ${literal ? "text" : "an IRI"}`);
      continue;
    }
    if (property.kind === "code") {
      if (shared[property.field] === undefined) shared[property.field] = object.value;
      else unread.add(`"${name}" holds one ${spelled}`);
      continue;
    }
    if (property.kind === "concepts" || property.kind === "iris") {
      const value = property.kind === "concepts" ? (localName(object.value) ?? object.value) : object.value;
      append(shared, property.field, value);
      continue;
    }
    const language = object.termType === "Literal" ? object.language : "";
    const raw = languages.get(language);
    if (raw === undefined) {
      unread.add(language === "" ? `"${name}" has no untagged skos:prefLabel` : `"${name}" has no skos:prefLabel in ${language}`);
      continue;
    }
    if (property.kind === "texts") {
      append(raw, property.field, object.value);
    } else if (raw[property.field] === undefined) {
      raw[property.field] = object.value;
    } else {
      unread.add(`"${name}" holds one ${spelled} per language`);
    }
  }

  const terms: Term[] = [];
  for (const language of [...languages.keys()].sort()) {
    const record = recordOf({ ...languages.get(language), ...shared });
    if (record === undefined) continue;
    // ponytail: no line per triple from n3, so every term sits on line 1; track token lines if findings need them.
    terms.push(
      termOf(input, { record, recordId: id, construct: "skos", line: 1, lines: {}, language: language === "" ? undefined : language }),
    );
  }
  return terms;
}

function read(input: TermInput): TermReadResult {
  const unread = new Unread();
  const notices: string[] = [];
  const entries = [...concepts(parse(input)).values()].map(({ subject, quads }) => ({
    subject: subject.value,
    terms: readConcept(input, subject, quads, unread, notices),
  }));
  entries.sort((a, b) => {
    const [x, y] = [a.terms[0]?.id ?? "", b.terms[0]?.id ?? ""];
    return x === y ? (a.subject < b.subject ? -1 : 1) : x < y ? -1 : 1;
  });
  return { terms: entries.flatMap((entry) => entry.terms), notices: [...notices, ...unread.notices(input.file)] };
}

export const skosReader: TermReader = {
  construct: "skos",
  label: LABEL,
  formats: ["skos"],
  read,
};
