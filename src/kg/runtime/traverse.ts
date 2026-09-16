/**
 * The deterministic walker (ADR 01018) — breadth-first traversal over a
 * `GraphIndex` with scope filtering, recording every hop and every exclusion
 * into a `QueryTrace`. This is the engine: generic RDF engines return bindings
 * without the path that produced them, and dockg's scope rules (ADR 01014)
 * are domain semantics no general engine knows.
 *
 * Determinism: neighbors come back sorted from the index, the frontier is
 * processed in (depth, IRI) order, and results are emitted in discovery order —
 * so the same graph + query always yields the same nodes *and* the same trace.
 *
 * Platform-neutral: no `node:` imports, no npm dependencies.
 */
import { byCodeUnit } from "../core/sort.js";
import { NS, RDF_TYPE } from "../core/vocab.js";
import {
  DOCKG_NOT_APPLICABLE_TO_VARIANT,
  DOCKG_NOT_SOFTWARE_SUBJECT,
  IIRDS_HAS_SUBJECT,
  IIRDS_RELATES_TO_PRODUCT_VARIANT,
  SOFTWARE_SUBJECT_IRIS,
} from "../core/iirds.js";
import type { GraphIndex } from "./graph.js";
import { createTrace, type QueryTrace, type ScopeExclusion } from "./trace.js";

const DCTERMS_TITLE = `${NS.dcterms}title`;
const DCTERMS_REFERENCES = `${NS.dcterms}references`;
const DCTERMS_LANGUAGE = `${NS.dcterms}language`;

/** A section IRI's document, or the IRI itself when it has no fragment. */
function documentOf(iri: string): string {
  const hash = iri.indexOf("#");
  return hash === -1 ? iri : iri.slice(0, hash);
}

export type Direction = "out" | "in" | "both";

export interface ScopeFilter {
  /** Product variant: an IRI, a `dcterms:title` (e.g. "SP-X100"), or a slug. */
  variant?: string;
  /** Software subject: an IRI or a `kg.about-product-aspect` value (e.g. "architecture"). */
  subject?: string;
  /**
   * BCP-47 tag (ADR 01037). Matched exactly against `dcterms:language`, with no
   * fallback: `de-AT` is not `de`, because relatedness between locales is an
   * inference and this runtime does not infer.
   */
  language?: string;
}

export interface TraverseOptions extends ScopeFilter {
  /** Starting nodes (IRIs). */
  seeds: string[];
  /** Maximum hops from a seed. Default 1. */
  depth?: number;
  /** Restrict to these predicates (full IRIs). Default: every predicate. */
  predicates?: string[];
  /** Which edge directions to follow. Default "out". */
  direction?: Direction;
  /** Stop after this many nodes (seeds included). */
  limit?: number;
  /**
   * Follow `rdf:type` edges into class nodes. Default false, deliberately:
   * class nodes are schema, not content, and every document shares them — so
   * traversing them makes every document reachable from every other in two
   * hops (`a → dockg:Document → b`). That is exactly the edge contamination
   * graph-governed retrieval exists to avoid.
   */
  includeTypeEdges?: boolean;
  /** Append to an existing trace instead of starting a new one. */
  trace?: QueryTrace;
}

export interface TraversedNode {
  iri: string;
  /** Hops from the nearest seed; seeds are 0. */
  depth: number;
}

export interface TraverseResult {
  nodes: TraversedNode[];
  trace: QueryTrace;
}

/**
 * Resolve a variant input to its IRI: an exact node IRI, a `dcterms:title`
 * match on an `iirds:ProductVariant`, or a trailing-segment slug match.
 */
export function resolveVariant(
  graph: GraphIndex,
  input: string,
): string | undefined {
  if (graph.has(input)) return input;
  const wanted = input.toLowerCase();
  const variants = graph.instancesOf(`${NS.iirds}ProductVariant`);
  for (const v of variants) {
    if (graph.literal(v, DCTERMS_TITLE)?.toLowerCase() === wanted) return v;
  }
  for (const v of variants) {
    if (v.slice(v.lastIndexOf("/") + 1).toLowerCase() === wanted) return v;
  }
  return undefined;
}

/** Resolve a software-subject input to its iiRDS IRI. */
export function resolveSubject(
  graph: GraphIndex,
  input: string,
): string | undefined {
  const mapped = SOFTWARE_SUBJECT_IRIS[input.toLowerCase()];
  if (mapped) return mapped;
  const expanded = graph.expand(input);
  return expanded.startsWith("http") ? expanded : undefined;
}

/**
 * Decide whether a node survives the scope filter, and if not, why.
 *
 * Rules, in the spirit of ADR 01014 (absence of a positive claim is not a
 * negative claim, so both polarities are explicit):
 * - An explicit negative (`dockg:notApplicableToVariant` /
 *   `dockg:notSoftwareSubject`) naming the target **excludes** the node.
 * - A node that declares a positive set which omits the target is **excluded**
 *   — it scoped itself elsewhere — recorded under the positive predicate so
 *   the trace distinguishes this from an explicit negative.
 * - A node that makes no claim is **kept**: unscoped content applies broadly.
 */
export function scopeExclusion(
  graph: GraphIndex,
  iri: string,
  scope: { variantIri?: string; subjectIri?: string; language?: string },
): ScopeExclusion | undefined {
  // [target, positive predicate, negative predicate, object kind]. Language
  // joins the same table with two differences, both deliberate: its objects are
  // literals, and it has **no negative predicate** — a document has one
  // language (`sh:maxCount 1`), so "not in German" is not a claim an author
  // makes and there is nothing for a `dockg:not*` term to express (ADR 01037).
  const checks: Array<
    [string | undefined, string, string | undefined, "iri" | "literal"]
  > = [
    [
      scope.variantIri,
      IIRDS_RELATES_TO_PRODUCT_VARIANT,
      DOCKG_NOT_APPLICABLE_TO_VARIANT,
      "iri",
    ],
    [scope.subjectIri, IIRDS_HAS_SUBJECT, DOCKG_NOT_SOFTWARE_SUBJECT, "iri"],
    [scope.language, DCTERMS_LANGUAGE, undefined, "literal"],
  ];
  for (const [target, positive, negative, kind] of checks) {
    if (!target) continue;
    if (negative !== undefined) {
      const denied = graph
        .values(iri, negative)
        .some((v) => v.kind === kind && v.value === target);
      if (denied) return { node: iri, rule: negative, value: target };
    }

    // Language is the one dimension a section inherits. Applicability is
    // explicit-only by ADR 01013 — a section may legitimately scope itself
    // differently from its document — but a section's *text* is in its
    // document's language and cannot differ, and the per-locale indexes file it
    // that way (`partitionByLanguage`). Without this a link with an anchor
    // reaches a section directly (derive.ts mints section IRIs as
    // `dcterms:references` targets) and carries English prose past a `de`
    // filter that excluded the document it belongs to.
    const subject = positive === DCTERMS_LANGUAGE ? documentOf(iri) : iri;
    const claimed = graph.values(subject, positive);
    if (claimed.length > 0) {
      const matches = claimed.some(
        (v) => v.kind === kind && v.value === target,
      );
      if (!matches) return { node: iri, rule: positive, value: target };
    }
  }
  return undefined;
}

/** Breadth-first traversal with scope filtering and full trace recording. */
export function traverse(
  graph: GraphIndex,
  options: TraverseOptions,
): TraverseResult {
  const trace = options.trace ?? createTrace();
  const maxDepth = options.depth ?? 1;
  const direction: Direction = options.direction ?? "out";
  const allowed =
    options.predicates && options.predicates.length > 0
      ? new Set(options.predicates.map((p) => graph.expand(p)))
      : undefined;

  const variantIri = options.variant
    ? resolveVariant(graph, options.variant)
    : undefined;
  const subjectIri = options.subject
    ? resolveSubject(graph, options.subject)
    : undefined;
  // Language needs no resolution step: the filter value and the graph value are
  // both BCP-47 tags, matched exactly.
  const scope = { variantIri, subjectIri, language: options.language };

  const excluded = new Set<string>();
  const keep = (iri: string): boolean => {
    if (excluded.has(iri)) return false;
    const exclusion = scopeExclusion(graph, iri, scope);
    if (exclusion) {
      excluded.add(iri);
      trace.exclusions.push(exclusion);
      return false;
    }
    return true;
  };

  const nodes: TraversedNode[] = [];
  const seen = new Set<string>();
  let frontier: string[] = [];

  // A seed `findEntry` already recorded keeps its real provenance. Re-recording
  // it as `explicit`/1 would leave the trace answering "why did retrieval start
  // here?" twice, with the lexical/vector score contradicted by a flat 1.
  const alreadySeeded = new Set(trace.entry.map((e) => e.iri));

  for (const seed of [...options.seeds].sort(byCodeUnit)) {
    if (!graph.has(seed) || seen.has(seed)) continue;
    seen.add(seed);
    if (!alreadySeeded.has(seed)) {
      trace.entry.push({ iri: seed, score: 1, via: "explicit" });
    }
    // A seed always expands, even when the scope filter excludes it. The
    // filter governs what the walk *reaches*, not where the caller chose to
    // start — and the canonical query is exactly this shape: from an English
    // page, `--impact --lang de` asks what German content a change here
    // affects. Gating the seed made that return nothing at all, because the
    // seed excluded itself before the frontier was ever populated.
    //
    // It is still kept out of the results and recorded in the trace, so the
    // answer honors the filter even though the walk started outside it.
    if (keep(seed)) nodes.push({ iri: seed, depth: 0 });
    frontier.push(seed);
  }

  const limit = options.limit ?? Infinity;
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const from of frontier) {
      if (nodes.length >= limit) break;
      for (const { predicate, target, dir } of neighbors(
        graph,
        from,
        direction,
      )) {
        if (allowed && !allowed.has(predicate)) continue;
        if (!options.includeTypeEdges && predicate === RDF_TYPE) continue;
        // The hop is recorded before filtering: the trace shows the edge was
        // walked even when the target is then scope-excluded.
        trace.hops.push({ from, predicate, to: target, depth, direction: dir });
        if (seen.has(target)) continue;
        seen.add(target);
        if (!keep(target)) continue;
        if (nodes.length >= limit) break;
        nodes.push({ iri: target, depth });
        next.push(target);
      }
    }
    frontier = next;
  }

  return { nodes, trace };
}

function neighbors(
  graph: GraphIndex,
  iri: string,
  direction: Direction,
): Array<{ predicate: string; target: string; dir: "out" | "in" }> {
  const out: Array<{ predicate: string; target: string; dir: "out" | "in" }> =
    [];
  if (direction === "out" || direction === "both") {
    for (const e of graph.out(iri)) out.push({ ...e, dir: "out" });
  }
  if (direction === "in" || direction === "both") {
    for (const e of graph.in(iri)) out.push({ ...e, dir: "in" });
  }
  return out;
}

/** Who links to this node (one hop inbound over `dcterms:references`). */
export function reverseReferences(
  graph: GraphIndex,
  iri: string,
  options: Omit<TraverseOptions, "seeds" | "direction" | "predicates"> = {},
): TraverseResult {
  return traverse(graph, {
    ...options,
    seeds: [iri],
    direction: "in",
    predicates: [DCTERMS_REFERENCES],
    depth: options.depth ?? 1,
  });
}

/**
 * Transitive inbound reach — "what is affected if this node changes".
 * Excludes the node itself from the returned set. Defaults to depth 3 rather
 * than the walker's 1, because impact analysis is only useful transitively.
 */
export function impact(
  graph: GraphIndex,
  iri: string,
  options: Omit<TraverseOptions, "seeds" | "direction"> = {},
): TraverseResult {
  const result = traverse(graph, {
    ...options,
    seeds: [iri],
    direction: "in",
    depth: options.depth ?? 3,
    // The seed *may* occupy a slot in the walker's limit, so ask for one more:
    // `limit` means "this many *affected* nodes". Whether it actually takes
    // one depends on the scope filter — a seed the filter excludes still
    // expands but is not in `nodes` — so the slack is trimmed below rather
    // than assumed spent.
    limit: options.limit === undefined ? undefined : options.limit + 1,
  });
  const affected = result.nodes.filter((n) => n.iri !== iri);
  return {
    nodes:
      options.limit === undefined ? affected : affected.slice(0, options.limit),
    trace: result.trace,
  };
}
