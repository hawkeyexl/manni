/**
 * What `manni term fill` plans before any model is asked (proposal 0086 § 3):
 * the concepts pages name and the termbase lacks, the entries a `graph:` block
 * can define, where new pages go and in which format, and how the crawl's
 * candidates merge. Pure: no file is read or written here.
 *
 * A name resolves to a term by its label, id or an alt-label, ignoring case,
 * the way `concepts:` resolves for the graph.
 */
import { dirname, extname } from "node:path";
import type { Term, TermBlock, TermSet } from "../types.js";

/** Where a concept was named: a file, and its line when known. */
export interface NamedAt {
  file: string;
  line?: number;
}

/** A concept some page names, with what the pages say about it. */
export interface NamedConcept {
  /** As the first page to name it spells it. */
  label: string;
  /** The language of the first naming page that has one. */
  language?: string;
  from: NamedAt[];
  altLabels: string[];
  broader: string[];
  narrower: string[];
  related: string[];
  /** A `graph:` block's definition for it. */
  definition?: string;
}

export function fold(value: string): string {
  return value.trim().toLowerCase();
}

/** Every term by its folded label, id and alt-labels; the first term to claim a key keeps it. */
export function termIndex(terms: readonly Term[]): Map<string, Term> {
  const index = new Map<string, Term>();
  const claim = (key: string, term: Term): void => {
    if (!index.has(fold(key))) index.set(fold(key), term);
  };
  for (const term of terms) {
    claim(term.record.label, term);
    claim(term.id, term);
    for (const alt of term.record["alt-labels"] ?? []) claim(alt, term);
  }
  return index;
}

function addUnique(list: string[], value: string): void {
  if (!list.some((v) => fold(v) === fold(value))) list.push(value);
}

const EDGE_LISTS = { broader: "broader", narrower: "narrower", "related-concepts": "related" } as const;

/**
 * Every concept one page names on another's behalf, merged by label ignoring
 * case: each `concepts:` reference, then each value of a `graph:` block's
 * `broader`, `narrower` and `related-concepts`. A block's own `label` is the
 * page naming itself, so it never makes a concept. It enriches one: a concept
 * a block labels takes its alt-labels, edges and definition. A name spelled
 * as a block's alt-label joins that block's concept.
 */
export function namedConcepts(set: Pick<TermSet, "references" | "blocks">): NamedConcept[] {
  // A block's alt-labels, each to the label it is an alt-label of.
  const alias = new Map<string, string>();
  for (const block of set.blocks) {
    for (const alt of block.altLabels ?? []) if (!alias.has(fold(alt))) alias.set(fold(alt), block.label);
  }
  const concepts: NamedConcept[] = [];
  const byKey = new Map<string, NamedConcept>();
  const named = (value: string, at: NamedAt, language: string | undefined): void => {
    const label = alias.get(fold(value)) ?? value;
    let concept = byKey.get(fold(label));
    if (concept === undefined) {
      concept = { label: label.trim(), from: [], altLabels: [], broader: [], narrower: [], related: [] };
      concepts.push(concept);
      byKey.set(fold(label), concept);
    }
    if (concept.language === undefined && language !== undefined) concept.language = language;
    if (!concept.from.some((f) => f.file === at.file && f.line === at.line)) concept.from.push(at);
  };
  const at = (file: string, line: number | undefined): NamedAt => (line === undefined ? { file } : { file, line });

  for (const reference of set.references) {
    named(reference.label, at(reference.file, reference.line), reference.language);
  }
  for (const block of set.blocks) {
    for (const edge of block.edges) named(edge.value, at(block.file, edge.line ?? block.line), block.language);
  }
  for (const block of set.blocks) {
    const concept = byKey.get(fold(block.label));
    if (concept !== undefined) enrich(concept, block);
  }
  return concepts;
}

/** What a block labelled with `concept` says about it. */
function enrich(concept: NamedConcept, block: TermBlock): void {
  for (const alt of block.altLabels ?? []) if (fold(alt) !== fold(concept.label)) addUnique(concept.altLabels, alt);
  for (const edge of block.edges) addUnique(concept[EDGE_LISTS[edge.field]], edge.value);
  if (concept.definition === undefined && block.definition !== undefined) concept.definition = block.definition;
}

/** What `fill` does from metadata alone: the concepts to create, and the existing entries a block defines. */
export interface MetadataPlan {
  create: NamedConcept[];
  /** Entries with no definition, and a block's definition for them where one exists. */
  missing: { term: Term; carried?: string }[];
}

export function planFromMetadata(set: TermSet): MetadataPlan {
  const index = termIndex(set.terms);
  const create = namedConcepts(set).filter((concept) => !index.has(fold(concept.label)));
  // A block that labels an existing entry defines it, whether or not any page names it.
  const carried = new Map<Term, string>();
  for (const block of set.blocks) {
    const term = index.get(fold(block.label));
    if (term !== undefined && block.definition !== undefined && !carried.has(term)) carried.set(term, block.definition);
  }
  const missing = set.terms
    // A `see:` entry redirects, and its target holds the definition.
    .filter((t) => t.record.definition === undefined && t.record.see === undefined)
    .map((term) => {
      const definition = carried.get(term);
      return definition === undefined ? { term } : { term, carried: definition };
    });
  return { create, missing };
}

/** The one directory every term page shares, or `undefined` when there is none or more than one. */
export function sharedTermDirectory(terms: readonly Term[]): string | undefined {
  const dirs = new Set(
    terms
      .filter((t) => t.location.construct === "page" && t.location.path !== undefined)
      .map((t) => dirname(t.location.path ?? "")),
  );
  return dirs.size === 1 ? [...dirs][0] : undefined;
}

/** The term page formats `fill` writes, by extension. */
export const FILL_PAGE_FORMATS: Readonly<Record<string, string>> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "mdx",
  ".adoc": "asciidoc",
  ".asciidoc": "asciidoc",
  ".rst": "rst",
  ".html": "html",
  ".htm": "html",
  ".dita": "dita",
};

function mostCommon(extensions: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const ext of extensions) if (ext in FILL_PAGE_FORMATS) counts.set(ext, (counts.get(ext) ?? 0) + 1);
  let best: string | undefined;
  for (const [ext, n] of counts) if (best === undefined || n > (counts.get(best) ?? 0)) best = ext;
  return best;
}

/**
 * The extension new pages take: the one most term pages in `dir` use, else
 * the most common among `pages`, else `.md`. Ties go to the first seen.
 */
export function pageExtension(terms: readonly Term[], dir: string, pages: readonly string[]): string {
  const inDir = terms
    .filter((t) => t.location.construct === "page" && t.location.path !== undefined)
    .filter((t) => dirname(t.location.path ?? "") === dir)
    .map((t) => extname(t.location.path ?? "").toLowerCase());
  return mostCommon(inDir) ?? mostCommon(pages.map((p) => extname(p).toLowerCase())) ?? ".md";
}

/** One term a crawl found on one page, or one `keywords:` value. */
export interface FoundTerm {
  file: string;
  line?: number;
  label: string;
  altLabels?: string[];
  definition?: string;
  /** Absent for a `keywords:` value, which no model scored. */
  confidence?: number;
  language?: string;
}

/** A crawl candidate, merged across pages. */
export interface Candidate {
  label: string;
  altLabels: string[];
  /** From the most confident finding that has one. */
  definition?: string;
  /** The highest any finding gave; absent when only keywords name it. */
  confidence?: number;
  language?: string;
  /** One per page, in the order found. */
  from: NamedAt[];
}

/** Findings merged by label ignoring case; a candidate's pages are its distinct files. */
export function mergeFound(found: readonly FoundTerm[]): Candidate[] {
  const out: Candidate[] = [];
  const byKey = new Map<string, Candidate>();
  for (const f of found) {
    let c = byKey.get(fold(f.label));
    if (c === undefined) {
      c = { label: f.label.trim(), altLabels: [], from: [] };
      out.push(c);
      byKey.set(fold(f.label), c);
    }
    for (const alt of f.altLabels ?? []) if (fold(alt) !== fold(c.label)) addUnique(c.altLabels, alt);
    if (c.language === undefined && f.language !== undefined) c.language = f.language;
    if (!c.from.some((at) => at.file === f.file)) c.from.push(f.line === undefined ? { file: f.file } : { file: f.file, line: f.line });
    if (f.confidence !== undefined && (c.confidence === undefined || f.confidence > c.confidence)) {
      c.confidence = f.confidence;
      if (f.definition !== undefined) c.definition = f.definition;
    } else if (c.definition === undefined && f.definition !== undefined) {
      c.definition = f.definition;
    }
  }
  return out;
}

/** The candidates on at least `minPages` pages that no known name (folded) already covers. */
export function newCandidates(candidates: readonly Candidate[], known: ReadonlySet<string>, minPages: number): Candidate[] {
  return candidates.filter(
    (c) => c.from.length >= minPages && !known.has(fold(c.label)) && !c.altLabels.some((a) => known.has(fold(a))),
  );
}
