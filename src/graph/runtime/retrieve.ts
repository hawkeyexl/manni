/**
 * Served passages with their proof (proposal 0090): the cores every host
 * calls, the two seams a host supplies, and `createRetriever`, the script
 * surface.
 *
 * - `retrieve` ranks entry passages, walks outward from them, and assembles a
 *   bundle within a character budget.
 * - `lookup` takes only a question. It picks the language, then returns three
 *   full sections: the ranked matches, everything reached outward from them,
 *   and everything that depends on them. Nothing is dropped; a passage past a
 *   section's budget keeps its node and record and loses only its text.
 *
 * A host supplies a `VectorStore`, which ranks rows for a query, and a
 * `ChunkSource`, which reads rows by id. The CLI and `createRetriever` build
 * the same context over the same artifact, so both answer alike.
 *
 * Platform-neutral: no `node:` imports. Each language's rows name their own
 * model, and the query is embedded with the queried language's. The default
 * embedder loads each model from the sibling `graph/embed` file when a
 * language first needs it, and a host where that fails falls back to lexical
 * entry and says so in the trace.
 */
import { byCodeUnit } from "../core/sort.js";
import { canonicalLanguageTag, parseLocalizations } from "../core/localizations.js";
import { normalize } from "../core/vector-index.js";
import type { Citation, ContextBlock, Refusal } from "./assemble.js";
import type { ChunkRow, ChunksManifest, ProvenanceRecord, WithholdReason } from "./chunks.js";
import { rrfMerge, type QueryEmbedder } from "./entry.js";
import { GraphIndex } from "./graph.js";
import { createLexicalIndex, type LexicalIndex } from "./lexical.js";
import {
  createTrace,
  type EntryCandidate,
  type EntryVia,
  type Hop,
  type QueryTrace,
  type Resolution,
  type ScopeExclusion,
} from "./trace.js";
import { impact as impactWalk, resolveSubject, resolveVariant, traverse } from "./traverse.js";
import { searchIndexDigest } from "./vector.js";

// ---- the seams ---------------------------------------------------------------

/** One condition on a chunk row's `metadata`. A list field matches when it contains the value. */
export interface WhereCondition {
  field: string;
  value: string;
}

/** What a vector store is asked. `vector` is `null` when the host did not embed the query. */
export interface VectorStoreQuery {
  text: string;
  vector: number[] | null;
  k: number;
  language: string | null;
  /** Every condition must hold. Empty when the caller set none. */
  where: WhereCondition[];
}

export interface VectorStoreMatch {
  id: string;
  score: number;
  /** The row, when the store holds it. Otherwise the id is read through the `ChunkSource`. */
  row?: ChunkRow;
}

/** Ranks chunk rows for a query. */
export interface VectorStore {
  query(q: VectorStoreQuery): Promise<VectorStoreMatch[]>;
}

/** Reads chunk rows by id, from one language or, with `null`, from every one. */
export interface ChunkSource {
  get(ids: string[], language: string | null): Promise<ChunkRow[]>;
}

/** A `fetch` as the runtime uses it: GET for files, POST for the HTTP store. */
export type RetrieverFetch = (
  url: string,
  init?: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// ---- errors ------------------------------------------------------------------

/** The rows or the graph were built from another graph than the manifest names. */
export class StaleArtifactError extends Error {
  constructor(manifestGraph: string, found: string, file = "graph.jsonld") {
    super(`chunks.json was built from graph ${manifestGraph}, and ${file} is ${found}; publish again.`);
    this.name = "StaleArtifactError";
  }
}

/** The query embedder is not the model the queried language's rows were embedded with. */
export class ModelMismatchError extends Error {
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(`chunks.json was embedded with ${expected}, and the embedder loads ${actual}.`);
    this.name = "ModelMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

// ---- results -----------------------------------------------------------------

export type PassageRole = "match" | "context" | "dependent";

export interface WithheldNode {
  node: string;
  because: WithholdReason[];
  /** `export` when the rows left it out, `query` when this call did. */
  at: "export" | "query";
}

export interface FilteredNode {
  node: string;
  /** The first `where` field the row did not satisfy. */
  field: string;
}

/** The trace a served result carries: the walk's, plus what the trust floor and the filter left out. */
export interface RetrievalTrace {
  entry: {
    /** The ranked entry candidates that became matches, or the node a walk started from. */
    candidates: EntryCandidate[];
    /** `"lexical"` when the vector path was wanted and unavailable. */
    fallback?: "lexical";
    /** On `lookup`: each language's best entry score. */
    languages?: Record<string, number>;
    /** On `lookup`: the language chosen. */
    chosen?: string;
  };
  hops: Hop[];
  exclusions: ScopeExclusion[];
  resolutions: Resolution[];
  withheld: WithheldNode[];
  filtered: FilteredNode[];
}

/** One served passage in a bundle. */
export interface PassageBlock extends ContextBlock {
  title: string;
  page: string;
  provenance: ProvenanceRecord;
  role: PassageRole;
}

/** What `retrieve`, `traverse` and `impact` return. */
export interface PassageBundle {
  /** The question, on `retrieve`. */
  question?: string;
  /** The node the walk started from, on `traverse` and `impact`. */
  node?: string;
  language: string | null;
  context: PassageBlock[];
  citations: Citation[];
  /** The delivered fields of each cited page, once per page. */
  pages: Record<string, { metadata: Record<string, unknown> }>;
  trace: RetrievalTrace;
  /** Present when nothing could be served. `context` is then empty. */
  refusal?: Refusal;
  /** True when the budget dropped a passage. */
  truncated: boolean;
}

export interface LookupPassage {
  iri: string;
  title: string;
  page: string;
  lines: string;
  /** `null` when the section's budget ran out before it. */
  text: string | null;
  truncated: boolean;
  provenance: ProvenanceRecord;
}

export interface LookupMatch extends LookupPassage {
  rank: number;
  /** `null` where a path did not run, or did not rank the passage. */
  score: { lexical: number | null; vector: number | null; fused: number };
}

export interface LookupReached extends LookupPassage {
  depth: number;
}

/** An edge in the graph's own direction. */
export interface LookupEdge {
  from: string;
  predicate: string;
  to: string;
}

export interface LookupSection<P> {
  passages: P[];
  truncated: boolean;
}

export interface LookupWalk extends LookupSection<LookupReached> {
  edges: LookupEdge[];
}

/** What `lookup` returns: three full sections, each with its proof. */
export interface LookupResult {
  question: string;
  language: string | null;
  matches: LookupSection<LookupMatch>;
  traversal: LookupWalk;
  impact: LookupWalk;
  pages: Record<string, { metadata: Record<string, unknown> }>;
  citations: Citation[];
  trace: RetrievalTrace;
  /** Present only when there are no matches, or every match was withheld. Every section is then empty. */
  refusal?: Refusal;
}

// ---- the context every core reads --------------------------------------------

/** The model one language's rows were embedded with, as `chunks.json` records it. */
export interface EmbeddingModel {
  id: string;
  dimensions: number;
}

export interface RetrieverContext {
  manifest: ChunksManifest;
  graph: GraphIndex;
  /** One language's lexical index, or `undefined` when it has none. */
  lexical(language: string): Promise<LexicalIndex | undefined>;
  store: VectorStore;
  chunks: ChunkSource;
  /** The query embedder for one model, or `null` to send no query vector. */
  embedder(model: EmbeddingModel): Promise<QueryEmbedder | null>;
}

export type RetrieveMode = "lexical" | "vector" | "hybrid";

export interface RetrieveOptions {
  question: string;
  lang?: string;
  variant?: string;
  softwareSubject?: string;
  seeds?: number;
  depth?: number;
  maxChars?: number;
  mode?: RetrieveMode;
  /** Tightens the trust floor for this call. */
  withhold?: WithholdReason[];
  where?: WhereCondition[];
}

export interface WalkOptions {
  node: string;
  /** Walk inward, to what depends on the node. */
  impact?: boolean;
  depth?: number;
  predicates?: string[];
  reverse?: boolean;
  lang?: string;
  variant?: string;
  softwareSubject?: string;
  limit?: number;
  maxChars?: number;
  withhold?: WithholdReason[];
  where?: WhereCondition[];
}

export interface LookupOptions {
  question: string;
  /** The serve host's query-time floor. */
  withhold?: WithholdReason[];
}

/** The depth `graph traverse --impact` uses by default, and so `lookup`'s inward walk. */
export const IMPACT_DEPTH = 3;

// ponytail: one fixed candidate pool per leg; raise it when filters routinely
// exhaust the pool before `seeds` matches are found.
const ENTRY_POOL = 50;

// ---- the trust floor and the filter --------------------------------------------

/** Whether a record falls under one withhold reason. A stale verdict never counts. */
export function withholds(record: ProvenanceRecord, reason: WithholdReason): boolean {
  if (reason === "drifted") return record.pins.error > 0;
  return record.evals !== null && record.evals.current && record.evals.fail + record.evals.error > 0;
}

/** The first condition a row fails, or `undefined` when it meets them all. */
function failedField(row: ChunkRow, where: readonly WhereCondition[]): string | undefined {
  for (const { field, value } of where) {
    const held = row.metadata[field];
    const values = Array.isArray(held) ? held : [held];
    if (!values.some((v) => v !== undefined && v !== null && scalarText(v) === value)) return field;
  }
  return undefined;
}

function scalarText(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

// ---- entry ---------------------------------------------------------------------

interface Ranked {
  iri: string;
  via: EntryVia;
  fused: number;
  lexical: number | null;
  vector: number | null;
  row?: ChunkRow;
}

interface Entry {
  ranked: Ranked[];
  fallback: boolean;
  /** The lexical leg's best score, else the vector leg's: what `lookup` compares languages by. */
  best: number | undefined;
}

function modelOf(manifest: ChunksManifest, language: string): EmbeddingModel | null {
  return manifest.languages[language]?.model ?? null;
}

async function rank(
  ctx: RetrieverContext,
  question: string,
  language: string,
  mode: RetrieveMode | undefined,
  where: WhereCondition[],
): Promise<Entry> {
  const model = modelOf(ctx.manifest, language);
  const wantVector = mode === "vector" || mode === "hybrid" || (mode === undefined && model !== null);
  let vector: EntryCandidate[] = [];
  const storeRows = new Map<string, ChunkRow>();
  // A language with no model, in a corpus where another has one, enters
  // lexically as a host that cannot load the model does, and says so.
  let fallback =
    mode === undefined && model === null && Object.values(ctx.manifest.languages).some((l) => l.model !== null);
  if (wantVector && question.trim() !== "") {
    let queryVector: number[] | null = null;
    const embedder = model === null ? null : await ctx.embedder(model);
    if (model !== null && embedder !== null) {
      if (embedder.model !== model.id) throw new ModelMismatchError(model.id, embedder.model);
      queryVector = Array.from(await embedder.embed(question));
    }
    const found = await ctx.store.query({ text: question, vector: queryVector, k: ENTRY_POOL, language, where });
    for (const m of found) if (m.row !== undefined) storeRows.set(m.id, m.row);
    vector = found
      .map((m): EntryCandidate => ({ iri: m.id, score: m.score, via: "vector" }))
      .sort((a, b) => (a.score === b.score ? byCodeUnit(a.iri, b.iri) : b.score - a.score));
    fallback = queryVector === null && vector.length === 0;
  }
  let lexical: EntryCandidate[] = [];
  if (mode !== "vector" || fallback) {
    const index = await ctx.lexical(language);
    lexical = index?.search(question, { limit: ENTRY_POOL }) ?? [];
  }
  const lexicalScore = new Map(lexical.map((c) => [c.iri, c.score]));
  const vectorScore = new Map(vector.map((c) => [c.iri, c.score]));
  const ranked = rrfMerge([lexical, vector].filter((leg) => leg.length > 0)).map((c): Ranked => {
    const row = storeRows.get(c.iri);
    return {
      iri: c.iri,
      via: c.via,
      fused: c.score,
      lexical: lexicalScore.get(c.iri) ?? null,
      vector: vectorScore.get(c.iri) ?? null,
      ...(row === undefined ? {} : { row }),
    };
  });
  // Words shared with the question say which language it is in; a similarity
  // from a model trained on one language says less. So the lexical leg's best
  // score speaks for the language, and the vector leg's only without it.
  const best = lexical[0]?.score ?? vector[0]?.score;
  return { ranked, fallback, best };
}

// ---- rows ----------------------------------------------------------------------

/** Reads rows and holds them to the manifest's graph. */
async function rowsFor(
  ctx: RetrieverContext,
  ids: readonly string[],
  language: string | null,
): Promise<Map<string, ChunkRow>> {
  const out = new Map<string, ChunkRow>();
  if (ids.length === 0) return out;
  for (const row of await ctx.chunks.get([...ids], language)) {
    if (row.graph !== ctx.manifest.graph) {
      throw new StaleArtifactError(ctx.manifest.graph, row.graph, ctx.manifest.languages[row.language]?.file ?? "a chunk row");
    }
    out.set(row.id, row);
  }
  return out;
}

function chunkFile(ctx: RetrieverContext, language: string | null): string {
  return language === null ? "" : (ctx.manifest.languages[language]?.file ?? "");
}

/** What happened to one node on its way to being served. */
type Admission = { kind: "row"; row: ChunkRow } | { kind: "withheld" } | { kind: "skipped" };

/**
 * One node through the trust floor, the filter and the chunk lookup, each
 * outcome traced. A node with no row and no export record is not a passage.
 */
function admit(
  ctx: RetrieverContext,
  iri: string,
  row: ChunkRow | undefined,
  language: string | null,
  floor: { withhold: readonly WithholdReason[]; where: readonly WhereCondition[]; exported: ReadonlyMap<string, WithholdReason[]> },
  trace: RetrievalTrace,
): Admission {
  const exported = floor.exported.get(iri);
  if (exported !== undefined) {
    trace.withheld.push({ node: iri, because: exported, at: "export" });
    return { kind: "withheld" };
  }
  const sourceUrl = row === undefined ? chunkFile(ctx, language) : chunkFile(ctx, row.language);
  if (row === undefined) {
    trace.resolutions.push({ iri, sourceUrl, ok: false, error: "no chunk row" });
    return { kind: "skipped" };
  }
  const field = failedField(row, floor.where);
  if (field !== undefined) {
    trace.filtered.push({ node: iri, field });
    return { kind: "skipped" };
  }
  const because = floor.withhold.filter((reason) => withholds(row.provenance, reason));
  if (because.length > 0) {
    trace.withheld.push({ node: iri, because, at: "query" });
    return { kind: "withheld" };
  }
  trace.resolutions.push({ iri, sourceUrl, ok: true });
  return { kind: "row", row };
}

function floorOf(
  ctx: RetrieverContext,
  withhold: readonly WithholdReason[] | undefined,
  where: readonly WhereCondition[] | undefined,
): Parameters<typeof admit>[4] {
  return {
    withhold: withhold ?? [],
    where: where ?? [],
    exported: new Map(ctx.manifest.withheld.map((w) => [w.id, w.because])),
  };
}

function emptyTrace(): RetrievalTrace {
  return { entry: { candidates: [] }, hops: [], exclusions: [], resolutions: [], withheld: [], filtered: [] };
}

interface Matched {
  ranked: Ranked;
  row: ChunkRow;
  rank: number;
}

/**
 * The top `seeds` passages among the ranked candidates. A candidate that is
 * not a passage, or that the filter rejects, gives its place to the next; a
 * withheld one keeps its place and is left out.
 */
async function selectMatches(
  ctx: RetrieverContext,
  entry: Entry,
  language: string,
  seeds: number,
  floor: Parameters<typeof admit>[4],
  trace: RetrievalTrace,
): Promise<{ kept: Matched[]; withheld: number }> {
  const rows = await rowsFor(
    ctx,
    entry.ranked.filter((r) => r.row === undefined).map((r) => r.iri),
    language,
  );
  const kept: Matched[] = [];
  let withheld = 0;
  for (const ranked of entry.ranked) {
    if (kept.length + withheld >= seeds) break;
    const row = ranked.row ?? rows.get(ranked.iri);
    if (row !== undefined && row.graph !== ctx.manifest.graph) {
      throw new StaleArtifactError(ctx.manifest.graph, row.graph, chunkFile(ctx, language) || "a chunk row");
    }
    const admitted = admit(ctx, ranked.iri, row, language, floor, trace);
    if (admitted.kind === "skipped") continue;
    trace.entry.candidates.push({ iri: ranked.iri, score: ranked.fused, via: ranked.via });
    if (admitted.kind === "withheld") withheld += 1;
    else kept.push({ ranked, row: admitted.row, rank: kept.length + withheld + 1 });
  }
  // Ranks count the withheld places too, so a reader sees the gap.
  return { kept, withheld };
}

// ---- walks ---------------------------------------------------------------------

interface Reached {
  iri: string;
  depth: number;
  row: ChunkRow;
}

/** Copy a walk's events into the served trace. */
function absorb(trace: RetrievalTrace, walked: QueryTrace): void {
  trace.hops.push(...walked.hops);
  trace.exclusions.push(...walked.exclusions);
}

/** Every reached node past the seeds that is a servable passage, in walk order. */
async function passagesOf(
  ctx: RetrieverContext,
  nodes: readonly { iri: string; depth: number }[],
  language: string | null,
  floor: Parameters<typeof admit>[4],
  trace: RetrievalTrace,
): Promise<Reached[]> {
  const rows = await rowsFor(ctx, nodes.map((n) => n.iri), language);
  const out: Reached[] = [];
  for (const n of nodes) {
    const admitted = admit(ctx, n.iri, rows.get(n.iri), language, floor, trace);
    if (admitted.kind === "row") out.push({ iri: n.iri, depth: n.depth, row: admitted.row });
  }
  return out;
}

/** An edge as the graph holds it, from a hop in either direction. */
function edgeOf(graph: GraphIndex, hop: Hop): LookupEdge {
  const predicate = graph.compact(hop.predicate);
  return hop.direction === "out"
    ? { from: hop.from, predicate, to: hop.to }
    : { from: hop.to, predicate, to: hop.from };
}

// ---- language and scope --------------------------------------------------------

function languagesOf(manifest: ChunksManifest): string[] {
  return Object.keys(manifest.languages).sort(byCodeUnit);
}

/** The manifest's own spelling of a tag, matched in any case. */
function languageNamed(manifest: ChunksManifest, tag: string): string | undefined {
  const wanted = canonicalLanguageTag(tag);
  return languagesOf(manifest).find((l) => canonicalLanguageTag(l) === wanted);
}

function refusal(reason: Refusal["reason"], detail: string): Refusal {
  return { reason, detail };
}

/** The refusal an unresolvable scope earns, or `undefined` when every filter resolves. */
function scopeRefusal(
  ctx: RetrieverContext,
  scope: { variant?: string; softwareSubject?: string; lang?: string },
): Refusal | undefined {
  if (scope.variant !== undefined && resolveVariant(ctx.graph, scope.variant) === undefined) {
    return refusal("unknown-scope", `No product variant matches ${scope.variant}.`);
  }
  if (scope.softwareSubject !== undefined && resolveSubject(ctx.graph, scope.softwareSubject) === undefined) {
    return refusal("unknown-scope", `No software subject matches ${scope.softwareSubject}.`);
  }
  if (scope.lang !== undefined && languageNamed(ctx.manifest, scope.lang) === undefined) {
    const have = languagesOf(ctx.manifest).join(", ") || "none";
    return refusal("unknown-scope", `No localization ${scope.lang}; this corpus has ${have}.`);
  }
  return undefined;
}

// ---- assembly ------------------------------------------------------------------

function pagesOf(
  manifest: ChunksManifest,
  pages: Iterable<string>,
): Record<string, { metadata: Record<string, unknown> }> {
  const out: Record<string, { metadata: Record<string, unknown> }> = {};
  for (const page of [...new Set(pages)].sort(byCodeUnit)) {
    out[page] = { metadata: manifest.pages[page]?.metadata ?? {} };
  }
  return out;
}

/** Blocks in order within the budget; a block past it is dropped, as `assemble` drops it. */
function bundleOf(
  ctx: RetrieverContext,
  head: { question: string } | { node: string },
  language: string | null,
  items: readonly { row: ChunkRow; depth: number; role: PassageRole }[],
  maxChars: number,
  trace: RetrievalTrace,
  empty: Refusal,
): PassageBundle {
  const base = { ...head, language, trace };
  if (items.length === 0) {
    return { ...base, context: [], citations: [], pages: {}, truncated: false, refusal: empty };
  }
  const context: PassageBlock[] = [];
  let used = 0;
  let truncated = false;
  for (const { row, depth, role } of items) {
    if (used + row.text.length > maxChars) {
      truncated = true;
      continue;
    }
    used += row.text.length;
    context.push({
      iri: row.id,
      title: row.title,
      text: row.text,
      sourceUrl: row.page,
      depth,
      page: row.page,
      provenance: row.provenance,
      role,
    });
  }
  if (context.length === 0) {
    return {
      ...base,
      context: [],
      citations: [],
      pages: {},
      truncated,
      refusal: refusal("no-content", "Every matching passage exceeded the character budget."),
    };
  }
  return {
    ...base,
    context,
    citations: context.map((b) => ({ iri: b.iri, title: b.title, sourceUrl: b.sourceUrl })),
    pages: pagesOf(ctx.manifest, context.map((b) => b.page)),
    truncated,
  };
}

/** Lay a section's passages against its budget: past it, a passage keeps all but its text. */
function budget(passages: { text: string | null; truncated: boolean }[], maxChars: number): boolean {
  let used = 0;
  let cut = false;
  for (const p of passages) {
    const n = p.text?.length ?? 0;
    if (used + n > maxChars) {
      p.text = null;
      p.truncated = true;
      cut = true;
    } else {
      used += n;
    }
  }
  return cut;
}

function passageOf(row: ChunkRow): LookupPassage {
  return {
    iri: row.id,
    title: row.title,
    page: row.page,
    lines: row.lines,
    text: row.text,
    truncated: false,
    provenance: row.provenance,
  };
}

// ---- the cores -----------------------------------------------------------------

/** Rank, choose, walk outward, assemble: the bundle a steering caller asked for. */
export async function retrieve(input: RetrieverContext & RetrieveOptions): Promise<PassageBundle> {
  const ctx = input;
  const trace = emptyTrace();
  const settings = ctx.manifest.retrieve;
  const seeds = input.seeds ?? settings.seeds;
  const depth = input.depth ?? settings.depth;
  const maxChars = input.maxChars ?? settings.maxChars;
  const head = { question: input.question };
  const refuse = (r: Refusal, language: string | null): PassageBundle =>
    bundleOf(ctx, head, language, [], maxChars, trace, r);

  const scope = scopeRefusal(ctx, input);
  if (scope !== undefined) return refuse(scope, null);
  const languages = languagesOf(ctx.manifest);
  const language = input.lang === undefined ? languages[0] : languageNamed(ctx.manifest, input.lang);
  if (input.lang === undefined && languages.length > 1) {
    return refuse(
      refusal("lang-required", `This corpus has more than one localization (${languages.join(", ")}); pass lang to choose one.`),
      null,
    );
  }
  if (language === undefined) return refuse(refusal("no-route", "This artifact holds no passages."), null);

  const where = input.where ?? [];
  const entry = await rank(ctx, input.question, language, input.mode, where);
  if (entry.fallback) trace.entry.fallback = "lexical";
  const floor = floorOf(ctx, input.withhold, where);
  const { kept, withheld } = await selectMatches(ctx, entry, language, seeds, floor, trace);
  if (kept.length === 0) {
    return refuse(
      withheld > 0
        ? refusal("withheld", "Every match was withheld by the trust floor; trace.withheld names them.")
        : refusal("no-route", "No passage in the docs matches this question."),
      language,
    );
  }

  const walked = createTrace();
  const { nodes } = traverse(ctx.graph, {
    seeds: kept.map((m) => m.row.id),
    depth,
    direction: "out",
    ...(input.variant === undefined ? {} : { variant: input.variant }),
    ...(input.softwareSubject === undefined ? {} : { subject: input.softwareSubject }),
    language,
    trace: walked,
  });
  absorb(trace, walked);
  const inScope = new Set(nodes.filter((n) => n.depth === 0).map((n) => n.iri));
  const reached = await passagesOf(ctx, nodes.filter((n) => n.depth > 0), language, floor, trace);
  const items = [
    ...kept.filter((m) => inScope.has(m.row.id)).map((m) => ({ row: m.row, depth: 0, role: "match" as const })),
    ...reached.map((r) => ({ row: r.row, depth: r.depth, role: "context" as const })),
  ];
  return bundleOf(ctx, head, language, items, maxChars, trace, refusal("no-route", "Every match is outside the requested scope."));
}

/** A walk from one node, as a bundle: `traverse`, or `impact` with `impact: true`. */
export async function walkPassages(input: RetrieverContext & WalkOptions): Promise<PassageBundle> {
  const ctx = input;
  const trace = emptyTrace();
  const maxChars = input.maxChars ?? ctx.manifest.retrieve.maxChars;
  const node = ctx.graph.expand(input.node);
  const head = { node };
  const refuse = (r: Refusal): PassageBundle => bundleOf(ctx, head, null, [], maxChars, trace, r);
  if (!ctx.graph.has(node)) return refuse(refusal("unknown-node", `No node ${input.node} in the graph.`));
  const scope = scopeRefusal(ctx, input);
  if (scope !== undefined) return refuse(scope);
  const language = input.lang === undefined ? null : (languageNamed(ctx.manifest, input.lang) ?? null);

  const walked = createTrace();
  const options = {
    ...(input.depth === undefined ? {} : { depth: input.depth }),
    ...(input.predicates === undefined ? {} : { predicates: input.predicates }),
    ...(input.variant === undefined ? {} : { variant: input.variant }),
    ...(input.softwareSubject === undefined ? {} : { subject: input.softwareSubject }),
    ...(input.lang === undefined ? {} : { language: input.lang }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    trace: walked,
  };
  const { nodes } =
    input.impact === true
      ? impactWalk(ctx.graph, node, options)
      : traverse(ctx.graph, { ...options, seeds: [node], direction: input.reverse === true ? "in" : "out" });
  absorb(trace, walked);
  trace.entry.candidates.push({ iri: node, score: 1, via: "explicit" });

  const floor = floorOf(ctx, input.withhold, input.where);
  const start = await passagesOf(ctx, [{ iri: node, depth: 0 }], language, floor, trace);
  const reached = await passagesOf(ctx, nodes.filter((n) => n.iri !== node), language, floor, trace);
  const inward = input.impact === true || input.reverse === true;
  const items = [
    ...start.map((r) => ({ row: r.row, depth: 0, role: "match" as const })),
    ...reached.map((r) => ({ row: r.row, depth: r.depth, role: inward ? ("dependent" as const) : ("context" as const) })),
  ];
  const languageOut = language ?? start[0]?.row.language ?? null;
  return bundleOf(
    ctx,
    head,
    languageOut,
    items,
    maxChars,
    trace,
    refusal("no-route", "No passage was reachable from this node under the active scope filter."),
  );
}

/**
 * The one call: a question in, three full sections out. It enters every
 * localization, keeps the one whose best match scores highest, and never asks
 * for a language.
 */
export async function lookup(input: RetrieverContext & LookupOptions): Promise<LookupResult> {
  const ctx = input;
  const trace = emptyTrace();
  const { seeds, depth, maxChars } = ctx.manifest.retrieve;
  const empty = (language: string | null, r: Refusal): LookupResult => ({
    question: input.question,
    language,
    matches: { passages: [], truncated: false },
    traversal: { passages: [], edges: [], truncated: false },
    impact: { passages: [], edges: [], truncated: false },
    pages: {},
    citations: [],
    trace,
    refusal: r,
  });

  // The language first, by its lexical scores, so only its model loads. With
  // no lexical match anywhere, each language's vector leg speaks for it.
  const choose = async (mode: RetrieveMode | undefined) => {
    const scores: Record<string, number> = {};
    let chosen: { language: string; entry: Entry; best: number } | undefined;
    for (const language of languagesOf(ctx.manifest)) {
      const entry = await rank(ctx, input.question, language, mode, []);
      if (entry.best === undefined) continue;
      scores[language] = entry.best;
      if (chosen === undefined || entry.best > chosen.best) chosen = { language, entry, best: entry.best };
    }
    return { scores, chosen };
  };
  let picked = await choose("lexical");
  if (picked.chosen === undefined) picked = await choose(undefined);
  else picked.chosen.entry = await rank(ctx, input.question, picked.chosen.language, undefined, []);
  trace.entry.languages = picked.scores;
  if (picked.chosen === undefined) return empty(null, refusal("no-route", "No passage in the docs matches this question."));
  const { language, entry } = picked.chosen;
  trace.entry.chosen = language;
  if (entry.fallback) trace.entry.fallback = "lexical";

  const floor = floorOf(ctx, input.withhold, []);
  const { kept, withheld } = await selectMatches(ctx, entry, language, seeds, floor, trace);
  if (kept.length === 0) {
    return empty(
      language,
      withheld > 0
        ? refusal("withheld", "Every match was withheld by the trust floor; trace.withheld names them.")
        : refusal("no-route", "No passage in the docs matches this question."),
    );
  }

  const seedIris = kept.map((m) => m.row.id);
  const walk = async (direction: "out" | "in", reach: number): Promise<LookupWalk> => {
    const walked = createTrace();
    const { nodes } = traverse(ctx.graph, { seeds: seedIris, depth: reach, direction, language, trace: walked });
    absorb(trace, walked);
    const reached = await passagesOf(ctx, nodes.filter((n) => n.depth > 0), language, floor, trace);
    const passages = reached.map((r): LookupReached => ({ ...passageOf(r.row), depth: r.depth }));
    return {
      passages,
      edges: walked.hops.map((h) => edgeOf(ctx.graph, h)),
      truncated: budget(passages, maxChars),
    };
  };

  const matches = kept.map(
    (m): LookupMatch => ({
      ...passageOf(m.row),
      rank: m.rank,
      score: { lexical: m.ranked.lexical, vector: m.ranked.vector, fused: m.ranked.fused },
    }),
  );
  const matchesTruncated = budget(matches, maxChars);
  const traversal = await walk("out", depth);
  const impact = await walk("in", IMPACT_DEPTH);

  const served = [...matches, ...traversal.passages, ...impact.passages];
  const citations: Citation[] = [];
  const cited = new Set<string>();
  for (const p of served) {
    if (p.text === null || cited.has(p.iri)) continue;
    cited.add(p.iri);
    citations.push({ iri: p.iri, title: p.title, sourceUrl: p.page });
  }
  return {
    question: input.question,
    language,
    matches: { passages: matches, truncated: matchesTruncated },
    traversal,
    impact,
    pages: pagesOf(ctx.manifest, served.map((p) => p.page)),
    citations,
    trace,
  };
}

// ---- the shipped seams and parsers -------------------------------------------------

/** Ranks rows by cosine in memory, among those meeting `where`. Rows without a vector are never ranked. */
export function createStaticVectorStore(rows: readonly ChunkRow[]): VectorStore {
  return {
    query(q) {
      if (q.vector === null) return Promise.resolve([]);
      const query = normalize(Float32Array.from(q.vector));
      const scored: VectorStoreMatch[] = [];
      for (const row of rows) {
        if (row.vector === undefined || row.vector.length !== query.length) continue;
        if (q.language !== null && row.language !== q.language) continue;
        // Before the `k` cut, as a server store does, so a strict filter cannot starve the pool.
        if (failedField(row, q.where) !== undefined) continue;
        const stored = normalize(Float32Array.from(row.vector));
        let score = 0;
        for (const [i, value] of query.entries()) score += value * (stored[i] ?? 0);
        scored.push({ id: row.id, score, row });
      }
      scored.sort((a, b) => (a.score === b.score ? byCodeUnit(a.id, b.id) : b.score - a.score));
      return Promise.resolve(scored.slice(0, q.k));
    },
  };
}

/**
 * A store behind a site's own server. It POSTs `{ text, vector, k, language,
 * where }` as JSON and expects `{ matches: [{ id, score, row? }] }`.
 */
export function createHttpVectorStore(options: { url: string; fetch?: RetrieverFetch }): VectorStore {
  const doFetch = options.fetch ?? defaultFetch;
  return {
    async query(q) {
      const response = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: q.text, vector: q.vector, k: q.k, language: q.language, where: q.where }),
      });
      if (!response.ok) throw new Error(`${options.url} answered HTTP ${String(response.status)}.`);
      const body = JSON.parse(await response.text()) as { matches?: unknown };
      if (!Array.isArray(body.matches)) throw new Error(`${options.url} returned no matches array.`);
      return body.matches.filter(isMatch);
    },
  };
}

function isMatch(m: unknown): m is VectorStoreMatch {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.score === "number";
}

/** The rows of one `chunks.<tag>.jsonl`, for ingestion into a vector DB. */
export function parseChunkRows(text: string): ChunkRow[] {
  const rows: ChunkRow[] = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    const row: unknown = JSON.parse(line);
    if (!isChunkRow(row)) throw new Error(`Line ${String(i + 1)} is not a chunk row.`);
    rows.push(row);
  }
  return rows;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The fields the cores read, so a damaged row fails here and not deep in a query. */
function isChunkRow(v: unknown): v is ChunkRow {
  return (
    isRecord(v) &&
    ["id", "graph", "page", "lines", "language", "title", "text"].every((k) => typeof v[k] === "string") &&
    (v.vector === undefined || Array.isArray(v.vector)) &&
    isRecord(v.metadata) &&
    isRecord(v.provenance)
  );
}

/** `chunks.json`, checked to be one, down to the fields the cores read. */
export function parseChunksManifest(input: string | object): ChunksManifest {
  const doc: unknown = typeof input === "string" ? JSON.parse(input) : input;
  const valid =
    isRecord(doc) &&
    doc.format === "manni-graph-chunks" &&
    doc.version === 1 &&
    ["graph", "graphFile", "searchIndex"].every((k) => typeof doc[k] === "string") &&
    !("model" in doc) &&
    isRecord(doc.retrieve) &&
    isRecord(doc.pages) &&
    Array.isArray(doc.withheld) &&
    isRecord(doc.languages) &&
    Object.values(doc.languages).every((l) => isRecord(l) && typeof l.file === "string" && isModel(l.model));
  if (!valid) throw new Error('Not a manni graph chunk manifest: expected format "manni-graph-chunks", version 1.');
  return doc as unknown as ChunksManifest;
}

function isModel(v: unknown): boolean {
  return v === null || (isRecord(v) && typeof v.id === "string" && typeof v.dimensions === "number");
}

/** Reads one `chunks.<tag>.jsonl`, given as its text or its URL. */
export function createChunkFileSource(textOrUrl: string, options: { fetch?: RetrieverFetch } = {}): ChunkSource {
  const isText = textOrUrl.trim() === "" || textOrUrl.trimStart().startsWith("{");
  let rows: Promise<ChunkRow[]> | undefined;
  const load = (): Promise<ChunkRow[]> =>
    (rows ??= isText
      ? Promise.resolve(parseChunkRows(textOrUrl))
      : fetchText(options.fetch ?? defaultFetch, textOrUrl).then(parseChunkRows));
  return {
    async get(ids, language) {
      const want = new Set(ids);
      return (await load()).filter((r) => want.has(r.id) && (language === null || r.language === language));
    },
  };
}

// ---- the context, from an artifact -------------------------------------------------

function defaultFetch(url: string, init?: Parameters<RetrieverFetch>[1]): ReturnType<RetrieverFetch> {
  return globalThis.fetch(url, init);
}

async function fetchText(doFetch: RetrieverFetch, url: string): Promise<string> {
  const response = await doFetch(url);
  if (!response.ok) throw new Error(`${url} answered HTTP ${String(response.status)}.`);
  return response.text();
}

/**
 * The context over one artifact, with `read` resolving a path relative to the
 * manifest. The CLI reads files and `createRetriever` fetches, through this
 * one function, so both serve the same rows, stores and indexes.
 */
export function artifactContext(
  manifest: ChunksManifest,
  graph: GraphIndex,
  read: (path: string) => Promise<string>,
  seams: { store?: VectorStore; chunks?: ChunkSource; embedder: RetrieverContext["embedder"] },
): RetrieverContext {
  // Each model loads once, when a language that needs it is first queried.
  const embedders = new Map<string, Promise<QueryEmbedder | null>>();
  const embedder = (model: EmbeddingModel): Promise<QueryEmbedder | null> => {
    let pending = embedders.get(model.id);
    if (pending === undefined) {
      pending = seams.embedder(model);
      embedders.set(model.id, pending);
    }
    return pending;
  };

  const loaded = new Map<string, Promise<ChunkRow[]>>();
  const rowsOf = (language: string): Promise<ChunkRow[]> => {
    let pending = loaded.get(language);
    if (pending === undefined) {
      const entry = manifest.languages[language];
      pending = entry === undefined ? Promise.resolve([]) : read(entry.file).then(parseChunkRows);
      loaded.set(language, pending);
    }
    return pending;
  };
  const allRows = async (language: string | null): Promise<ChunkRow[]> =>
    language === null ? (await Promise.all(languagesOf(manifest).map(rowsOf))).flat() : rowsOf(language);

  const chunks: ChunkSource = seams.chunks ?? {
    async get(ids, language) {
      const want = new Set(ids);
      return (await allRows(language)).filter((r) => want.has(r.id));
    },
  };
  const store: VectorStore = seams.store ?? {
    async query(q) {
      return createStaticVectorStore(await allRows(q.language)).query(q);
    },
  };

  let localizations: Promise<ReturnType<typeof parseLocalizations>> | undefined;
  const lexicons = new Map<string, Promise<LexicalIndex | undefined>>();
  const lexical = (language: string): Promise<LexicalIndex | undefined> => {
    let pending = lexicons.get(language);
    if (pending === undefined) {
      pending = (async () => {
        localizations ??= read(manifest.searchIndex).then(parseLocalizations);
        const doc = await localizations;
        const wanted = canonicalLanguageTag(language);
        const entry = doc?.languages.find((l) => canonicalLanguageTag(l.language) === wanted);
        return entry === undefined ? undefined : createLexicalIndex(await read(entry.search.path));
      })();
      lexicons.set(language, pending);
    }
    return pending;
  };

  return { manifest, graph, lexical, store, chunks, embedder };
}

// ---- the script surface --------------------------------------------------------------

export interface CreateRetrieverOptions {
  /** `chunks.json`: its URL, or the parsed manifest. Every other file resolves from its directory. */
  manifest: string | object;
  /** Default: the static store over the rows' vectors. */
  store?: VectorStore;
  /** Default: the chunk files the manifest names. */
  chunks?: ChunkSource;
  /** Default: `graph/embed` with each language's model, loaded when first queried. `false` forces lexical entry. */
  embed?: QueryEmbedder | false;
  /** Default: the global `fetch`. */
  fetch?: RetrieverFetch;
}

/**
 * The cores over one artifact. `withhold` on `retrieve`, `traverse` and
 * `impact` tightens the floor the artifact was exported with, per call, as
 * the CLI's `--withhold` does. It never lowers it: exported rows stay out.
 * `lookup` takes only a question and serves the exported floor.
 */
export interface Retriever {
  readonly manifest: ChunksManifest;
  lookup(question: string): Promise<LookupResult>;
  retrieve(
    question: string,
    options?: Pick<
      RetrieveOptions,
      "lang" | "variant" | "softwareSubject" | "depth" | "maxChars" | "mode" | "where" | "withhold"
    >,
  ): Promise<PassageBundle>;
  traverse(
    node: string,
    options?: Pick<
      WalkOptions,
      "depth" | "predicates" | "reverse" | "lang" | "variant" | "softwareSubject" | "limit" | "maxChars" | "where" | "withhold"
    >,
  ): Promise<PassageBundle>;
  impact(
    node: string,
    options?: Pick<
      WalkOptions,
      "depth" | "lang" | "variant" | "softwareSubject" | "limit" | "maxChars" | "where" | "withhold"
    >,
  ): Promise<PassageBundle>;
}

interface EmbedModule {
  createLocalEmbedder(o: { model: string; role: "query" }): Promise<QueryEmbedder>;
  createMockEmbedder(o: { dims: number }): QueryEmbedder;
}

/**
 * One language's model, loaded from the `graph/embed` file beside this one.
 * The specifier is not a literal, so a bundler leaves it alone, and a host
 * that cannot load it gets `null`: lexical entry, traced as a fallback.
 */
async function defaultEmbedder(model: EmbeddingModel): Promise<QueryEmbedder | null> {
  try {
    const specifier = "./embed.js";
    const embed = (await import(/* @vite-ignore */ specifier)) as EmbedModule;
    return model.id === "mock"
      ? embed.createMockEmbedder({ dims: model.dimensions })
      : await embed.createLocalEmbedder({ model: model.id, role: "query" });
  } catch {
    return null;
  }
}

/** The retrieval cores over a published artifact. Returns data and calls no model but the embedder. */
export async function createRetriever(options: CreateRetrieverOptions): Promise<Retriever> {
  const doFetch = options.fetch ?? defaultFetch;
  const fromUrl = typeof options.manifest === "string";
  const manifest = parseChunksManifest(
    typeof options.manifest === "string" ? await fetchText(doFetch, options.manifest) : options.manifest,
  );
  const base = typeof options.manifest === "string" ? options.manifest.slice(0, options.manifest.lastIndexOf("/") + 1) : "";
  const resolvePath = (path: string): string => (fromUrl && !/^[a-z][a-z0-9+.-]*:/i.test(path) ? base + path : path);
  const read = (path: string): Promise<string> => fetchText(doFetch, resolvePath(path));

  const graphText = await read(manifest.graphFile);
  const digest = `sha256-${(await searchIndexDigest(graphText)).slice("sha256:".length)}`;
  if (digest !== manifest.graph) throw new StaleArtifactError(manifest.graph, digest);
  const graph = GraphIndex.fromJsonLd(graphText);

  const embed = options.embed;
  const embedder: RetrieverContext["embedder"] =
    embed === false ? () => Promise.resolve(null) : embed === undefined ? defaultEmbedder : () => Promise.resolve(embed);
  const ctx = artifactContext(manifest, graph, read, {
    ...(options.store === undefined ? {} : { store: options.store }),
    ...(options.chunks === undefined ? {} : { chunks: options.chunks }),
    embedder,
  });

  return {
    manifest,
    lookup: (question) => lookup({ ...ctx, question }),
    retrieve: (question, o = {}) => retrieve({ ...ctx, ...o, question }),
    traverse: (node, o = {}) => walkPassages({ ...ctx, ...o, node }),
    impact: (node, o = {}) => walkPassages({ ...ctx, ...o, node, impact: true }),
  };
}
