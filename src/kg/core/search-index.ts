/**
 * The lexical search artifact (ADR 01019) — `kg/search.<lang>.json`, a sibling
 * of the graph rather than prose inside it. One file per language since
 * ADR 01038; this module builds the whole index and partitions it.
 *
 * The graph is an index, not a corpus (ADR 01008): sections carry only titles,
 * so a lexical index built from the graph alone cannot find anything a document
 * actually *says*. This module walks the built graph, reads each document's
 * markdown from disk (the same pattern the iiRDS projection uses for
 * renditions), and emits a deterministic JSON index the browser runtime loads in
 * one fetch.
 *
 * Granularity golden rule: **every node indexes exactly the text it owns.** A
 * Section carries its own text down to the next heading of any rank; a Document
 * carries title + description plus the prose no section covers (its preamble,
 * or its whole body when it has no sections). Duplicating would let a node
 * shadow the nodes beneath it in the rankings; carrying nothing would leave
 * that prose findable nowhere.
 *
 * Slicing reuses the runtime's own functions, so index-time and retrieval-time
 * text cannot drift — with one deliberate difference: retrieval uses
 * `sliceSection` (subtree included, because asking for a section should give
 * you its subsections), indexing uses `sectionOwnText`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compactIri } from "./load.js";
import { byCodeUnit } from "./sort.js";
import { NS } from "./vocab.js";
import { UNDETERMINED } from "./localizations.js";
import type { GraphIndex } from "../runtime/graph.js";
import {
  documentPreamble,
  sectionOccurrences,
  sectionOwnText,
} from "../runtime/resolve.js";

const DOCKG_DOCUMENT = `${NS.dockg}Document`;
const DOCKG_SECTION = `${NS.dockg}Section`;
const SKOS_CONCEPT = `${NS.skos}Concept`;
const DOCKG_PATH = `${NS.dockg}path`;
const DOCKG_LEVEL = `${NS.dockg}level`;
const DCTERMS_TITLE = `${NS.dcterms}title`;
const DCTERMS_DESCRIPTION = `${NS.dcterms}description`;
const SKOS_PREF_LABEL = `${NS.skos}prefLabel`;
const SKOS_ALT_LABEL = `${NS.skos}altLabel`;
const DCTERMS_LANGUAGE = `${NS.dcterms}language`;

/** One indexable node. Empty fields are omitted so the artifact stays tight. */
export interface SearchEntry {
  /** Node IRI. */
  id: string;
  /** Compacted class IRI, e.g. `dockg:Section`. */
  type: string;
  title?: string;
  /** Space-joined alternative labels, deduped case-insensitively. */
  labels?: string;
  description?: string;
  /** Body text, per the granularity rule. */
  text?: string;
}

export interface SearchIndexDoc {
  version: 1;
  entries: SearchEntry[];
}

export interface SearchIndexOptions {
  /** Read a document's source. Defaults to reading `cwd`-relative from disk. */
  readDoc?: (path: string) => string | undefined;
  /** Warnings channel (missing sources are non-fatal — the entry loses text). */
  warnings?: string[];
}

/** Space-join labels, dropping case-insensitive duplicates, sorted. */
function joinLabels(values: string[]): string | undefined {
  const seen = new Map<string, string>();
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, v.trim());
  }
  const out = [...seen.values()].sort(byCodeUnit);
  return out.length > 0 ? out.join(" ") : undefined;
}

/**
 * A leading YAML frontmatter block, and the blank lines after it.
 *
 * Only a document with *no* sections gets body text, and its body is the whole
 * file — frontmatter included, unless it is stripped here. That block is
 * machinery, not prose: left in, a query for `label` or `alt-labels` matches
 * every sectionless document, and the artifact carries YAML nobody can read.
 * Section slices start at their heading, so they never see it.
 */
const FRONTMATTER =
  /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)(?:\r?\n)*/;

function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER, "");
}

/** Drop undefined fields so entries serialize identically for equal inputs. */
function entry(
  id: string,
  type: string,
  fields: Omit<SearchEntry, "id" | "type">,
): SearchEntry {
  const out: SearchEntry = { id, type };
  if (fields.title !== undefined) out.title = fields.title;
  if (fields.labels !== undefined) out.labels = fields.labels;
  if (fields.description !== undefined) out.description = fields.description;
  if (fields.text !== undefined) out.text = fields.text;
  return out;
}

export function buildSearchIndex(
  graph: GraphIndex,
  cwd: string,
  options: SearchIndexOptions = {},
): SearchIndexDoc {
  const warnings = options.warnings ?? [];
  const readDoc =
    options.readDoc ??
    ((path: string): string | undefined => {
      const abs = resolve(cwd, path);
      return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
    });

  const entries: SearchEntry[] = [];
  const sourceOf = new Map<string, string | undefined>();

  // Group sections by their parent document once. Re-scanning every section per
  // document is quadratic across the corpus, and the section loop below needs
  // the same grouping anyway.
  const allSections = graph.instancesOf(DOCKG_SECTION);
  const sectionsOf = new Map<string, string[]>();
  for (const section of allSections) {
    const hash = section.indexOf("#");
    if (hash < 0) continue;
    const doc = section.slice(0, hash);
    const siblings = sectionsOf.get(doc);
    if (siblings) siblings.push(section);
    else sectionsOf.set(doc, [section]);
  }

  // Documents. Sections resolve their slice from the parent's source, so read
  // each document once and remember it.
  for (const doc of graph.instancesOf(DOCKG_DOCUMENT)) {
    const path = graph.literal(doc, DOCKG_PATH);
    const source = path === undefined ? undefined : readDoc(path);
    sourceOf.set(doc, source);
    if (path !== undefined && source === undefined) {
      warnings.push(
        `Source not found for ${path} — indexed without body text.`,
      );
    }

    // Granularity rule: a section owns its slice, so a document with sections
    // keeps only the prose that belongs to no section — the preamble before the
    // first heading. Without this, that text is indexed nowhere and is
    // unfindable. A document with no sections owns its whole body.
    // Newlines normalized to LF: section slices and `documentPreamble` already
    // re-join on "\n", so without this a sectionless CRLF document is the one
    // entry in the artifact carrying "\r\n".
    const body =
      source === undefined
        ? undefined
        : stripFrontmatter(source).replace(/\r\n/g, "\n");
    const text =
      body === undefined
        ? undefined
        : (sectionsOf.get(doc)?.length ?? 0) > 0
          ? documentPreamble(body)
          : body;

    entries.push(
      entry(doc, compactIri(DOCKG_DOCUMENT), {
        title: graph.literal(doc, DCTERMS_TITLE),
        description: graph.literal(doc, DCTERMS_DESCRIPTION),
        text,
      }),
    );
  }

  // Sections: title plus the slice of the parent document they own. Occurrences
  // are per-document, so compute each document's map once.
  const occurrencesOf = new Map<string, Map<string, number>>();
  for (const section of allSections) {
    const hash = section.indexOf("#");
    const doc = hash < 0 ? section : section.slice(0, hash);
    const title = graph.literal(section, DCTERMS_TITLE);
    const source = sourceOf.get(doc);
    const levelText = graph.literal(section, DOCKG_LEVEL);
    const parsed =
      levelText === undefined ? NaN : Number.parseInt(levelText, 10);
    const level = Number.isNaN(parsed) ? undefined : parsed;

    let occurrences = occurrencesOf.get(doc);
    if (!occurrences) {
      occurrences = sectionOccurrences(graph, doc);
      occurrencesOf.set(doc, occurrences);
    }

    // Heading text repeats (the corpus has two `## Install`), so the section's
    // occurrence disambiguates which slice is actually its own.
    const text =
      source !== undefined && title !== undefined
        ? sectionOwnText(source, title, level, occurrences.get(section) ?? 0)
        : undefined;

    entries.push(entry(section, compactIri(DOCKG_SECTION), { title, text }));
  }

  // Concepts: label surface only — they are index nodes with no body of their
  // own, but they are worth seeding from (concept → the documents about it).
  for (const concept of graph.instancesOf(SKOS_CONCEPT)) {
    const pref = graph.literals(concept, SKOS_PREF_LABEL);
    const alt = graph.literals(concept, SKOS_ALT_LABEL);
    entries.push(
      entry(concept, compactIri(SKOS_CONCEPT), {
        title: pref[0],
        labels: joinLabels([...pref, ...alt]),
      }),
    );
  }

  entries.sort((a, b) => byCodeUnit(a.id, b.id));
  return { version: 1, entries };
}

/** Serialize deterministically, with the trailing newline the other emitters use. */
export function emitSearchIndex(doc: SearchIndexDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Split one index into per-language indexes (ADR 01038).
 *
 * A document's language is the `dcterms:language` it carries; a **section takes
 * its document's**, which is containment rather than inference — a section is
 * part of exactly one document and has no language of its own. A document
 * declaring none lands in the `und` bucket.
 *
 * **Concepts belong to every locale.** A `skos:Concept` is shared vocabulary
 * minted from labels across the corpus, not a document in some language, so it
 * is replicated into each language's index rather than filed under `und`. Doing
 * otherwise had two visible costs: `--lang de` could never return a concept,
 * and a corpus whose every document declared a language still grew a phantom
 * `und` localization holding only concepts — which then made `manni kg search`
 * demand `--lang` on what is, to its author, a single-language corpus.
 *
 * Entry order inside each index is preserved, so each one is sorted for the
 * same reason the whole index was.
 */
export function partitionByLanguage(
  graph: GraphIndex,
  index: SearchIndexDoc,
): Map<string, SearchIndexDoc> {
  const documentType = compactIri(DOCKG_DOCUMENT);
  const sectionType = compactIri(DOCKG_SECTION);

  /** The language of an entry, or undefined when it belongs to every locale. */
  const languageOf = (entry: SearchEntry): string | undefined => {
    if (entry.type !== documentType && entry.type !== sectionType) {
      return undefined;
    }
    const hash = entry.id.indexOf("#");
    const doc = hash === -1 ? entry.id : entry.id.slice(0, hash);
    return graph.literal(doc, DCTERMS_LANGUAGE) ?? UNDETERMINED;
  };

  const out = new Map<string, SearchIndexDoc>();
  const shared: SearchEntry[] = [];
  for (const entry of index.entries) {
    const language = languageOf(entry);
    if (language === undefined) {
      shared.push(entry);
      continue;
    }
    const bucket = out.get(language);
    if (bucket) bucket.entries.push(entry);
    else out.set(language, { version: 1, entries: [entry] });
  }

  // A corpus of nothing but concepts still needs somewhere to put them.
  if (out.size === 0 && shared.length > 0) {
    out.set(UNDETERMINED, { version: 1, entries: [] });
  }
  for (const bucket of out.values()) {
    bucket.entries.push(...shared);
    bucket.entries.sort((a, b) => byCodeUnit(a.id, b.id));
  }
  return out;
}

/** Documents (not sections) per language, for the manifest's counts. */
export function documentsByLanguage(graph: GraphIndex): Map<string, number> {
  const out = new Map<string, number>();
  for (const doc of graph.instancesOf(DOCKG_DOCUMENT)) {
    const language = graph.literal(doc, DCTERMS_LANGUAGE) ?? UNDETERMINED;
    out.set(language, (out.get(language) ?? 0) + 1);
  }
  return out;
}
