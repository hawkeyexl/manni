/**
 * `manni graph lookup`, `graph retrieve` and `graph traverse --context`
 * (proposal 0090): the runtime's served cores over the chunk artifact on
 * disk.
 *
 * The context comes from `artifactContext`, the same function
 * `createRetriever` builds on, so the CLI and a script answer alike over the
 * same artifact. Only the graph differs in how it arrives: here it is the
 * built Turtle, held to the manifest's digest of its JSON-LD form.
 *
 * Every retrieval setting comes from `graph.retrieve`, which overrides the
 * defaults the manifest recorded at export. A refusal is an answer and exits
 * 0; a usage or operational error is a `GraphError`, exit 2.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { integrityOf } from "../../meta/index.js";
import { errorMessage } from "../../shared/errors.js";
import { loadRunConfig, type GraphConfig } from "../core/config.js";
import { emitJsonLd } from "../core/emit-jsonld.js";
import { compactIri, loadGraph, storeToQuads } from "../core/load.js";
import { PREFIXES } from "../core/vocab.js";
import { createLocalEmbedder, EmbedderUnavailableError } from "../embed/local.js";
import { createMockEmbedder } from "../embed/mock.js";
import type { ChunksManifest, ProvenanceRecord, WithholdReason } from "../runtime/chunks.js";
import type { QueryEmbedder } from "../runtime/entry.js";
import { GraphIndex } from "../runtime/graph.js";
import {
  artifactContext,
  IMPACT_DEPTH,
  lookup,
  ModelMismatchError,
  parseChunksManifest,
  retrieve,
  StaleArtifactError,
  walkPassages,
  type LookupEdge,
  type LookupResult,
  type PassageBundle,
  type RetrieveMode,
  type RetrieverContext,
  type WhereCondition,
} from "../runtime/retrieve.js";
import { GraphError } from "../types.js";
import { CHUNKS_MANIFEST } from "./chunks.js";
import { langRequired, noIndexFor } from "./search.js";
import { checkScope, checkTraverseInputs } from "./traverse.js";

/** The plumbing every served verb shares. */
export interface ArtifactOptions {
  config?: string;
  noConfig?: boolean;
  /** Graph .ttl path (default: config `out`). */
  graph?: string;
  /** Directory holding `chunks.json`, its rows and the search index (default: beside the graph). */
  index?: string;
  cwd?: string;
  /** Injection seam for tests: the query embedder, or `null` for none. */
  embedder?: QueryEmbedder | null;
  /** The graph already in hand, in place of reading `graph`: what `graph check` checks. */
  quads?: ReturnType<typeof storeToQuads>;
}

export interface LookupCommandOptions extends ArtifactOptions {
  question: string;
  /** `graph serve --withhold`; `graph lookup` takes no such flag. */
  withhold?: WithholdReason[];
}

export interface RetrieveCommandOptions extends ArtifactOptions {
  question: string;
  lang?: string;
  variant?: string;
  /** `--software-subject`. */
  subject?: string;
  mode?: RetrieveMode;
  seeds?: number;
  depth?: number;
  maxChars?: number;
  withhold?: WithholdReason[];
  where?: WhereCondition[];
}

export interface TraverseContextOptions extends ArtifactOptions {
  node: string;
  depth?: number;
  predicates?: string[];
  reverse?: boolean;
  impact?: boolean;
  variant?: string;
  subject?: string;
  lang?: string;
  limit?: number;
  maxChars?: number;
  withhold?: WithholdReason[];
  where?: WhereCondition[];
}

/** An opened artifact: what `graph serve` holds across calls. */
export interface Artifact {
  ctx: RetrieverContext;
  config: GraphConfig;
  label: string;
  quads: ReturnType<typeof storeToQuads>;
}

/** The query embedder for the manifest's model, or `null` when entry stays lexical. */
async function queryEmbedder(manifest: ChunksManifest, mode: RetrieveMode | undefined): Promise<QueryEmbedder | null> {
  const model = manifest.model;
  if (model === null || mode === "lexical") return null;
  if (model.id === "mock") return createMockEmbedder({ dims: model.dimensions });
  try {
    return await createLocalEmbedder({ model: model.id, role: "query" });
  } catch (e) {
    // The optional peer is missing: lexical entry, which the trace records.
    if (e instanceof EmbedderUnavailableError) return null;
    throw new GraphError(`Failed to load embedding model ${model.id}: ${errorMessage(e)}`);
  }
}

/** The artifact beside the graph, held to the graph it was built from. */
export async function openArtifact(opts: ArtifactOptions, mode?: RetrieveMode): Promise<Artifact> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadRunConfig(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    },
    cwd,
  );
  const graphPath = resolve(cwd, opts.graph ?? config.out);
  const indexDir = opts.index === undefined ? dirname(graphPath) : resolve(cwd, opts.index);
  const shown = (path: string): string => relative(cwd, path).split("\\").join("/");
  const manifestPath = join(indexDir, CHUNKS_MANIFEST);
  const label = shown(manifestPath);
  if (!existsSync(manifestPath)) throw new GraphError(`${label} does not exist; run manni graph publish.`);
  let manifest: ChunksManifest;
  try {
    manifest = parseChunksManifest(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new GraphError(`${label} is not a chunk manifest; run manni graph publish.`);
  }
  const quads = opts.quads ?? storeToQuads(loadGraph(graphPath));
  if (integrityOf(Buffer.from(emitJsonLd(quads), "utf8")) !== manifest.graph) {
    throw new GraphError(`${label} was built from another graph; run manni graph publish.`);
  }
  const graph = GraphIndex.fromQuads(quads, Object.fromEntries(PREFIXES));
  const read = async (path: string): Promise<string> => {
    const abs = resolve(indexDir, path);
    try {
      return await readFile(abs, "utf8");
    } catch {
      throw new GraphError(`${shown(abs)} does not exist; run manni graph publish.`);
    }
  };
  const embedder = opts.embedder === undefined ? await queryEmbedder(manifest, mode) : opts.embedder;
  // The config's settings, not the ones the manifest recorded for other hosts.
  const ctx = artifactContext({ ...manifest, retrieve: { ...config.retrieve } }, graph, read, { embedder });
  return { ctx, config, label, quads };
}

/** The library's two artifact errors, in the CLI's words. */
async function served<T>(label: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof StaleArtifactError) {
      throw new GraphError(`${label} was built from another graph; run manni graph publish.`);
    }
    if (e instanceof ModelMismatchError) {
      throw new GraphError(
        `chunks.json was embedded with ${e.expected}, and this run loads ${e.actual}; run manni graph publish again.`,
      );
    }
    throw e;
  }
}

/** The result, and the two settings its pretty form names. */
export async function runLookup(
  opts: LookupCommandOptions,
): Promise<{ result: LookupResult; settings: { depth: number; maxChars: number } }> {
  const artifact = await openArtifact(opts);
  const { config } = artifact;
  const result = await lookupIn(artifact, opts);
  return { result, settings: { depth: config.retrieve.depth, maxChars: config.retrieve.maxChars } };
}

/** `lookup` over an artifact already open: `graph lookup` and the MCP `lookup` tool. */
export async function lookupIn(
  { ctx, label }: Artifact,
  opts: Pick<LookupCommandOptions, "question" | "withhold">,
): Promise<LookupResult> {
  return served(label, () =>
    lookup({ ...ctx, question: opts.question, ...(opts.withhold === undefined ? {} : { withhold: opts.withhold }) }),
  );
}

export async function runRetrieve(opts: RetrieveCommandOptions): Promise<PassageBundle> {
  return retrieveIn(await openArtifact(opts, opts.mode), opts);
}

/** `retrieve` over an artifact already open: `graph retrieve` and the MCP `retrieve` tool. */
export async function retrieveIn(
  { ctx, label }: Artifact,
  opts: Omit<RetrieveCommandOptions, keyof ArtifactOptions>,
): Promise<PassageBundle> {
  const languages = Object.keys(ctx.manifest.languages).sort();
  if (opts.lang === undefined && languages.length > 1) {
    throw new GraphError(langRequired(languages), "lang-required");
  }
  if (opts.lang !== undefined) {
    const wanted = opts.lang.toLowerCase();
    if (!languages.some((l) => l.toLowerCase() === wanted)) {
      throw new GraphError(noIndexFor(opts.lang, languages), "unknown-scope");
    }
  }
  checkScope(ctx.graph, opts);
  return served(label, () =>
    retrieve({
      ...ctx,
      question: opts.question,
      ...(opts.lang === undefined ? {} : { lang: opts.lang }),
      ...(opts.variant === undefined ? {} : { variant: opts.variant }),
      ...(opts.subject === undefined ? {} : { softwareSubject: opts.subject }),
      ...(opts.mode === undefined ? {} : { mode: opts.mode }),
      ...(opts.seeds === undefined ? {} : { seeds: opts.seeds }),
      ...(opts.depth === undefined ? {} : { depth: opts.depth }),
      ...(opts.maxChars === undefined ? {} : { maxChars: opts.maxChars }),
      ...(opts.withhold === undefined ? {} : { withhold: opts.withhold }),
      ...(opts.where === undefined ? {} : { where: opts.where }),
    }),
  );
}

export async function runTraverseContext(opts: TraverseContextOptions): Promise<PassageBundle> {
  return traverseIn(await openArtifact(opts), opts);
}

/** A walk over an artifact already open: `graph traverse --context` and the MCP `traverse` and `impact` tools. */
export async function traverseIn(
  { ctx, label, quads }: Artifact,
  opts: Omit<TraverseContextOptions, keyof ArtifactOptions>,
): Promise<PassageBundle> {
  const { node, predicates } = checkTraverseInputs(ctx.graph, quads, opts);
  return served(label, () =>
    walkPassages({
      ...ctx,
      node,
      ...(opts.impact === true ? { impact: true } : {}),
      ...(opts.reverse === true ? { reverse: true } : {}),
      ...(opts.depth === undefined ? {} : { depth: opts.depth }),
      ...(predicates === undefined ? {} : { predicates }),
      ...(opts.lang === undefined ? {} : { lang: opts.lang }),
      ...(opts.variant === undefined ? {} : { variant: opts.variant }),
      ...(opts.subject === undefined ? {} : { softwareSubject: opts.subject }),
      ...(opts.limit === undefined ? {} : { limit: opts.limit }),
      ...(opts.maxChars === undefined ? {} : { maxChars: opts.maxChars }),
      ...(opts.withhold === undefined ? {} : { withhold: opts.withhold }),
      ...(opts.where === undefined ? {} : { where: opts.where }),
    }),
  );
}

// ---- pretty output ---------------------------------------------------------------

/** Labels pages from the directory every one of them shares. */
function labeller(pages: readonly string[]): (p: { iri: string; page: string; title: string }) => string {
  const dirs = pages.map((p) => p.split("/").slice(0, -1));
  const first = dirs[0] ?? [];
  let shared = first.length;
  for (const d of dirs) {
    let i = 0;
    while (i < shared && d[i] === first[i]) i++;
    shared = i;
  }
  return (p) => {
    const short = p.page.split("/").slice(shared).join("/");
    return p.iri.includes("#") ? `${short} § ${p.title}` : short;
  };
}

/** The proof under a passage: pins, dates and eval verdicts, each when there is one. */
function proofLines(record: ProvenanceRecord): string[] {
  const out: string[] = [];
  const { pins, dates, evals } = record;
  if (pins.total > 0) {
    const counts = (["current", "notice", "warning", "error"] as const)
      .filter((s) => pins[s] > 0)
      .map((s) => `${String(pins[s])} ${s}`);
    const findings = pins.items.flatMap((item) => {
      const f = item.findings[0];
      return f === undefined ? [] : [`${f.rule} at line ${item.claim} (${item.source})`];
    });
    out.push(`pins     ${counts.join(", ")}${findings.length > 0 ? `: ${findings.join("; ")}` : ""}`);
  }
  const days = [
    ...(dates.lastUpdated.day === null ? [] : [`updated ${dates.lastUpdated.day}`]),
    ...(dates.lastVerified === null ? [] : [`verified ${dates.lastVerified}`]),
  ];
  if (days.length > 0) out.push(`dates    ${days.join(", ")}`);
  if (evals !== null) {
    const counts = (
      [
        ["pass", evals.pass],
        ["fail", evals.fail],
        ["needs review", evals.needsReview],
        ["skipped", evals.skipped],
        ["error", evals.error],
      ] as const
    )
      .filter(([, n]) => n > 0)
      .map(([word, n]) => `${String(n)} ${word}`);
    if (counts.length > 0) {
      out.push(`evals    ${counts.join(", ")}${evals.current ? "" : " (stale: the page changed since the report)"}`);
    }
  }
  return out;
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

function refusalLine(r: { reason: string; detail: string }): string {
  return `Refused, ${r.reason}: ${r.detail}`;
}

/** The pretty form of a lookup result; `-f json` prints the result itself. */
export function renderLookup(
  result: LookupResult,
  format: "pretty" | "json",
  settings: { depth: number; maxChars: number },
): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (result.refusal !== undefined) return refusalLine(result.refusal);

  const all = [...result.matches.passages, ...result.traversal.passages, ...result.impact.passages];
  const label = labeller(all.map((p) => p.page));
  const width = Math.max(0, ...all.map((p) => label(p).length));
  const rankOf = new Map(result.matches.passages.map((p) => [p.iri, p.rank]));
  const named = new Map(all.map((p) => [p.iri, label(p)]));
  const nameOf = (iri: string): string => {
    const rank = rankOf.get(iri);
    return rank === undefined ? (named.get(iri) ?? compactIri(iri)) : `#${String(rank)}`;
  };
  const cut = `(text not included: over the ${settings.maxChars.toLocaleString("en-US")}-character budget)`;
  const lines: string[] = [];
  const block = (head: string, p: { text: string | null; provenance: ProvenanceRecord }): void => {
    const body = [head, ...proofLines(p.provenance).map((l) => `   ${l}`)];
    if (p.text === null) body[body.length - 1] = `${body[body.length - 1] ?? ""}   ${cut}`;
    lines.push(...body);
  };

  lines.push("Matches");
  for (const p of result.matches.passages) {
    const scores = [
      ...(p.score.lexical === null ? [] : [`lexical ${p.score.lexical.toFixed(1)}`]),
      ...(p.score.vector === null ? [] : [`vector ${p.score.vector.toFixed(2)}`]),
    ].join(", ");
    block(`${String(p.rank).padEnd(2)} ${label(p).padEnd(width)}  ${scores}`.trimEnd(), p);
  }
  const firstEdge = (edges: readonly LookupEdge[], test: (e: LookupEdge) => boolean): LookupEdge | undefined =>
    edges.find(test);
  lines.push(`Traversal, depth ${String(settings.depth)}`);
  if (result.traversal.passages.length === 0) lines.push("   (none)");
  for (const p of result.traversal.passages) {
    const edge = firstEdge(result.traversal.edges, (e) => e.to === p.iri);
    const how = edge === undefined ? "" : `from ${nameOf(edge.from)} via ${edge.predicate}`;
    block(`   ${label(p).padEnd(width)}  ${how}`.trimEnd(), p);
  }
  lines.push(`Impact, depth ${String(IMPACT_DEPTH)}`);
  if (result.impact.passages.length === 0) lines.push("   (none)");
  for (const p of result.impact.passages) {
    const edge = firstEdge(result.impact.edges, (e) => e.from === p.iri);
    const verb = edge === undefined ? "" : `, ${edge.predicate.slice(edge.predicate.indexOf(":") + 1)} ${nameOf(edge.to)}`;
    block(`   ${label(p).padEnd(width)}  depth ${String(p.depth)}${verb}`, p);
  }
  const m = result.matches.passages.length;
  const t = result.traversal.passages.length;
  const i = result.impact.passages.length;
  lines.push("");
  lines.push(
    `${plural(m, "match", "matches")}, ${String(t)} reached outward, ${String(i)} ${i === 1 ? "depends" : "depend"} on them, ` +
      `in ${result.language ?? "no language"}. Pass -f json for the text, edges and trace.`,
  );
  return lines.join("\n");
}

/** The pretty form of a bundle: its rows, without lookup's section headings. */
export function renderBundle(bundle: PassageBundle, format: "pretty" | "json"): string {
  if (format === "json") return JSON.stringify(bundle, null, 2);
  if (bundle.refusal !== undefined) return refusalLine(bundle.refusal);
  const label = labeller(bundle.context.map((b) => b.page));
  const width = Math.max(0, ...bundle.context.map((b) => label(b).length));
  const lines: string[] = [];
  for (const b of bundle.context) {
    lines.push(`${label(b).padEnd(width)}  ${b.role}${b.depth > 0 ? `, depth ${String(b.depth)}` : ""}`);
    lines.push(...proofLines(b.provenance).map((l) => `   ${l}`));
  }
  const n = bundle.context.length;
  lines.push("");
  lines.push(
    `${plural(n, "passage", "passages")}, in ${bundle.language ?? "every language"}` +
      `${bundle.truncated ? ", and more left out by the budget" : ""}. Pass -f json for the text and trace.`,
  );
  return lines.join("\n");
}
