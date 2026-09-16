/**
 * `manni kg traverse` — node-centric graph walking from the CLI (ADR 01018).
 *
 * A thin Node wrapper over the browser-native runtime: it reads the built
 * Turtle, hands the quads to the same `GraphIndex` a browser would build from
 * `graph.jsonld`, and runs the same walker. `query` stays triple-pattern;
 * `traverse` answers "what is connected to this node, and why".
 *
 * The trace is always in the JSON output — retrieval provenance is part of the
 * contract, not an opt-in (ADR 01018).
 */
import { resolve } from "node:path";
import { loadConfig } from "../core/config.js";
import {
  compactIri,
  expandTerm,
  loadGraph,
  storeToQuads,
} from "../core/load.js";
import { SOFTWARE_SUBJECT_IRIS } from "../core/iirds.js";
import { NS, PREFIXES } from "../core/vocab.js";
import { DockgError } from "../types.js";
import { GraphIndex } from "../runtime/graph.js";
import {
  impact,
  resolveSubject,
  resolveVariant,
  traverse,
  type Direction,
  type TraverseResult,
} from "../runtime/traverse.js";

export interface TraverseOptions {
  config?: string;
  /** Graph .ttl path (default: config `out`). */
  graph?: string;
  /** Starting node: full IRI or a `prefix:local` CURIE. */
  node: string;
  depth?: number;
  predicates?: string[];
  /** Walk inbound edges instead of outbound. */
  reverse?: boolean;
  /** Transitive inbound reach — what is affected if this node changes. */
  impact?: boolean;
  /** Scope filter: a product variant IRI, title, or slug. */
  variant?: string;
  /** Scope filter: a software subject. */
  subject?: string;
  /** Scope filter: a BCP-47 language tag, matched exactly (ADR 01037). */
  lang?: string;
  limit?: number;
  cwd?: string;
}

export interface TraverseReport {
  /** The resolved starting IRI. */
  node: string;
  nodes: Array<{ iri: string; depth: number; title?: string }>;
  trace: TraverseResult["trace"];
}

export function runTraverse(opts: TraverseOptions): TraverseReport {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const store = loadGraph(resolve(cwd, opts.graph ?? config.out));
  const graph = GraphIndex.fromQuads(
    storeToQuads(store),
    Object.fromEntries(PREFIXES),
  );

  const node = expandTerm(opts.node);
  if (!graph.has(node)) {
    throw new DockgError(
      `Node not found in the graph: ${opts.node} — check the IRI, or run \`manni kg build\` first.`,
    );
  }
  if (opts.variant && !resolveVariant(graph, opts.variant)) {
    throw new DockgError(
      `Unknown product variant: ${opts.variant} — no iirds:ProductVariant matches that IRI, title, or slug.`,
    );
  }
  // An unresolvable scope filter silently disables itself in the walker, which
  // would hand back exactly the nodes the filter was meant to exclude. Fail
  // loudly instead — same contract as --variant above.
  if (opts.subject && !resolveSubject(graph, opts.subject)) {
    throw new DockgError(
      `Unknown software subject: ${opts.subject} — expected one of ` +
        `${Object.keys(SOFTWARE_SUBJECT_IRIS).sort().join(", ")}, or a full IRI.`,
    );
  }

  const predicates = opts.predicates?.map(expandTerm);
  const direction: Direction = opts.reverse ? "in" : "out";
  const result = opts.impact
    ? impact(graph, node, {
        depth: opts.depth,
        predicates,
        variant: opts.variant,
        subject: opts.subject,
        language: opts.lang,
        limit: opts.limit,
      })
    : traverse(graph, {
        seeds: [node],
        depth: opts.depth,
        predicates,
        direction,
        variant: opts.variant,
        subject: opts.subject,
        language: opts.lang,
        limit: opts.limit,
      });

  return {
    node,
    nodes: result.nodes.map((n) => {
      const title = graph.literal(n.iri, `${NS.dcterms}title`);
      return title === undefined
        ? { iri: n.iri, depth: n.depth }
        : { iri: n.iri, depth: n.depth, title };
    }),
    trace: result.trace,
  };
}

export function renderTraverse(
  report: TraverseReport,
  format: "pretty" | "json",
): string {
  if (format === "json") return JSON.stringify(report, null, 2);

  const lines: string[] = [];
  for (const n of report.nodes) {
    const indent = "  ".repeat(n.depth);
    const title = n.title ? ` — ${n.title}` : "";
    lines.push(`${indent}${compactIri(n.iri)}${title}`);
  }
  if (report.nodes.length === 0) lines.push("(no nodes)");

  if (report.trace.exclusions.length > 0) {
    lines.push("");
    lines.push("excluded by scope:");
    for (const e of report.trace.exclusions) {
      lines.push(
        `  ${compactIri(e.node)} — ${compactIri(e.rule)} ${compactIri(e.value)}`,
      );
    }
  }

  lines.push("");
  lines.push(
    `${report.nodes.length} node${report.nodes.length === 1 ? "" : "s"}, ` +
      `${report.trace.hops.length} hop${report.trace.hops.length === 1 ? "" : "s"}, ` +
      `${report.trace.exclusions.length} excluded`,
  );
  return lines.join("\n");
}
