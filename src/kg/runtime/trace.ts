/**
 * Query trace — the explainability contract (ADR 01018). Every runtime stage
 * appends to a trace, and no API returns results without one: retrieval
 * provenance is part of the contract exactly as PROV provenance is part of the
 * build. The trace answers "how and why did this result come back": which nodes
 * were seeded, every hop walked, every node scope excluded (and by which rule),
 * and every content resolution attempted.
 *
 * Events are appended in traversal order, which is itself deterministic, so the
 * trace is byte-stable for a given graph + query.
 */

/** How a seed was found. `hybrid` means several legs agreed on it. */
export type EntryVia = "explicit" | "lexical" | "vector" | "hybrid";

/** A starting node, with the score/reason that made it a seed. */
export interface EntryCandidate {
  iri: string;
  /**
   * Relevance score: 1 for an explicitly requested seed, otherwise the fused
   * `rrfMerge` score. Note that fusion is **rank**-based, so a searched seed's
   * score reflects its position (1/(60 + rank)), not the engine's relevance —
   * it orders candidates but is not a magnitude to threshold on.
   */
  score: number;
  via: EntryVia;
}

/** One edge walked, in either direction. */
export interface Hop {
  from: string;
  predicate: string;
  to: string;
  /** Hops from the nearest seed (seeds are depth 0; their neighbors are 1). */
  depth: number;
  direction: "out" | "in";
}

/** A node the scope filter removed, and why. */
export interface ScopeExclusion {
  node: string;
  /**
   * The predicate that disqualified the node: a `dockg:not*` IRI when an
   * explicit negative named the target, or the positive predicate (e.g.
   * `iirds:relates-to-product-variant`) when the node declared a scope set that
   * omits the target.
   */
  rule: string;
  /**
   * The filter target being applied — the variant or subject IRI the query
   * asked for. Under a `dockg:not*` rule the node named this explicitly; under
   * a positive rule this is what the node's declared set was missing.
   */
  value: string;
}

/** One content-resolution attempt. */
export interface Resolution {
  iri: string;
  sourceUrl: string;
  ok: boolean;
  /** Present when `ok` is false. */
  error?: string;
}

export interface QueryTrace {
  entry: EntryCandidate[];
  hops: Hop[];
  exclusions: ScopeExclusion[];
  resolutions: Resolution[];
}

export function createTrace(): QueryTrace {
  return { entry: [], hops: [], exclusions: [], resolutions: [] };
}

/**
 * Every node named anywhere in the trace as reached — seeds plus hop targets.
 * The trace-completeness contract: a traversal's results must be a subset of
 * this, so every returned node is explainable by recorded events.
 */
export function reachedNodes(trace: QueryTrace): Set<string> {
  const reached = new Set<string>();
  for (const e of trace.entry) reached.add(e.iri);
  for (const h of trace.hops) reached.add(h.to);
  return reached;
}
