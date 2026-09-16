/**
 * Lexical entry (ADR 01019) — text query → ranked seed nodes.
 *
 * Loads the `search.json` artifact (produced by `manni kg export --format search`)
 * and scores it with MiniSearch. The artifact carries body text, which the graph
 * deliberately does not (ADR 01008), so a query can match what a document *says*
 * and not merely what it is titled.
 *
 * MiniSearch is this runtime's one production dependency; the bundle-purity gate
 * allow-lists exactly it. Two guards keep ranking a dockg contract rather than a
 * library's: ties are broken by IRI here (MiniSearch does not define tie order),
 * and the on-disk artifact format is ours, so upgrading MiniSearch can never
 * change a committed artifact.
 *
 * Platform-neutral: no `node:` imports.
 */
import MiniSearch from "minisearch";
import type { SearchEntry, SearchIndexDoc } from "../core/search-index.js";
import { byCodeUnit } from "../core/sort.js";
import type { EntryCandidate } from "./trace.js";

export interface LexicalSearchOptions {
  /** Maximum candidates to return. Default 10. */
  limit?: number;
}

export interface LexicalIndex {
  /** Ranked candidates, best first, ties broken by IRI. */
  search(query: string, options?: LexicalSearchOptions): EntryCandidate[];
  /** Indexed entry count. */
  size(): number;
  /** The entry behind an IRI, for callers that want its title/type. */
  entry(iri: string): SearchEntry | undefined;
}

/**
 * Build a lexical index from the search artifact — a JSON string or the parsed
 * document.
 */
export function createLexicalIndex(
  input: string | SearchIndexDoc,
): LexicalIndex {
  const doc = (
    typeof input === "string" ? (JSON.parse(input) as SearchIndexDoc) : input
  ) as SearchIndexDoc | null;
  // Shape-check rather than trust: handed something that is valid JSON but not
  // a search artifact, MiniSearch's `addAll` throws "documents is not
  // iterable" from inside the library. An empty index is the honest answer.
  const entries = Array.isArray(doc?.entries) ? doc.entries : [];

  const mini = new MiniSearch<SearchEntry>({
    fields: ["title", "labels", "description", "text"],
    storeFields: ["id"],
    idField: "id",
    // Titles and labels are the strongest signal that a node *is* the subject;
    // body text is evidence it merely mentions it.
    searchOptions: {
      boost: { title: 3, labels: 2, description: 1.5 },
      prefix: true,
      fuzzy: 0.2,
    },
  });
  mini.addAll(entries);

  const byIri = new Map(entries.map((e) => [e.id, e]));

  return {
    size: () => entries.length,
    entry: (iri) => byIri.get(iri),
    search(query, options = {}) {
      const trimmed = query.trim();
      if (trimmed === "") return [];
      const hits = mini.search(trimmed);
      // MiniSearch does not define an order for equal scores; sort explicitly so
      // the same query against the same artifact always ranks identically.
      hits.sort((a, b) =>
        a.score === b.score
          ? byCodeUnit(String(a.id), String(b.id))
          : b.score - a.score,
      );
      return hits
        .slice(0, options.limit ?? 10)
        .map((h) => ({ iri: String(h.id), score: h.score, via: "lexical" }));
    },
  };
}
