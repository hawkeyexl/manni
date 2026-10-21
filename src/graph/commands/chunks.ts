/**
 * `manni graph export chunks` (proposal 0090): every servable passage of the
 * built graph, keyed by its node IRI, with its text, its vector when a
 * sidecar holds one, its delivered metadata and its provenance record.
 *
 * A passage is a section's `sliceSection`, its heading through the next
 * heading of the same or higher rank, or a document's whole body. Provenance
 * needs git, cite and meta, none of which the runtime can run, so the record
 * is built here, on the Node side, as the search index is, and every host
 * reads the rows.
 *
 * Byte-stable: keys are sorted, rows are in id order, and nothing reads the
 * wall clock. A page with an uncommitted body change has no day git can
 * attest, so its `lastUpdated.day` is `null` rather than today's date.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { runCheck } from "../../cite/index.js";
import type { CitationResult, PageCitationReport } from "../../cite/types.js";
import { integrityOf, runDerive } from "../../meta/index.js";
import { errorMessage } from "../../shared/errors.js";
import { analyzeDoc, formatOf, isTreeFormat } from "../core/analyze.js";
import type { GraphConfig } from "../core/config.js";
import { documentBase, routesFrom } from "../core/discover.js";
import { emitJsonLd } from "../core/emit-jsonld.js";
import { openMetaView, withExternalMetadata, type MetaViewSource } from "../core/external.js";
import { deliveredFields } from "../core/graph-output.js";
import { STDIN_PATH } from "../core/iri.js";
import { loadGraph, storeToQuads } from "../core/load.js";
import {
  canonicalLanguageTag,
  isLanguageTag,
  LOCALIZATIONS_FILENAME,
  parseLocalizations,
  UNDETERMINED,
} from "../core/localizations.js";
import { byCodeUnit } from "../core/sort.js";
import { decodeVectorIndex } from "../core/vector-index.js";
import { NS, PREFIXES } from "../core/vocab.js";
import type {
  ChunkRow,
  ChunksManifest,
  DerivedDate,
  EvalItem,
  PassageStatement,
  PinItem,
  PinSummary,
  ProvenanceEvals,
  ProvenanceRecord,
} from "../runtime/chunks.js";
import { GraphIndex } from "../runtime/graph.js";
// The floor is applied at export here and again at query in the runtime: one rule.
import { withholds } from "../runtime/retrieve.js";
import { documentSectionOrder, sectionLines, sectionOccurrences } from "../runtime/resolve.js";
import { GraphError, type DocModel } from "../types.js";
import { bodyOf, sectionSpans } from "./questions.js";

const run = promisify(execFile);

const DOCUMENT = `${NS.graph}Document`;
const PATH = `${NS.graph}path`;
const LEVEL = `${NS.graph}level`;
const TITLE = `${NS.dcterms}title`;
const LANGUAGE = `${NS.dcterms}language`;

/** The manifest's file name, beside its rows. */
export const CHUNKS_MANIFEST = "chunks.json";

/** `chunks.de.jsonl`: one language's rows. */
export function chunksFilename(language: string): string {
  return `chunks.${language}.jsonl`;
}

export interface ChunksOptions {
  cwd: string;
  config: GraphConfig;
  source: MetaViewSource;
  graphPath: string;
  /** The directory the manifest and rows go to, which also holds the search manifest and sidecars. */
  outDir: string;
  /** The docevals report: `--evals` as typed (from `cwd`), else the config's (from its directory). */
  evals?: { label: string; path: string };
}

export interface ChunksResult {
  manifestPath: string;
  rows: number;
  withheld: number;
  warnings: string[];
  notices: string[];
  /** The manifest and each language's rows, absolute. */
  files: string[];
}

/** One passage before it becomes a row. */
interface Passage {
  id: string;
  page: string;
  /** Body lines. */
  start: number;
  end: number;
  title: string;
  text: string;
  language: string;
  metadata: Record<string, unknown>;
}

export async function exportChunks(opts: ChunksOptions): Promise<ChunksResult> {
  const { cwd, config } = opts;
  const warnings: string[] = [];
  const notices: string[] = [];

  const quads = storeToQuads(loadGraph(opts.graphPath));
  const graph = GraphIndex.fromQuads(quads, Object.fromEntries(PREFIXES));
  const graphDigest = integrityOf(Buffer.from(emitJsonLd(quads), "utf8"));
  const sources = documentBase(config, {}, cwd);

  // The pages the graph holds that are on disk, as the build labelled them.
  const pages: { doc: string; path: string; content: string }[] = [];
  for (const doc of graph.instancesOf(DOCUMENT)) {
    const path = graph.literal(doc, PATH);
    if (path === undefined || path === STDIN_PATH) continue;
    const abs = resolve(sources, path);
    if (!existsSync(abs)) continue;
    pages.push({ doc, path, content: readFileSync(abs, "utf8") });
  }
  pages.sort((a, b) => byCodeUnit(a.path, b.path));
  const paths = pages.map((p) => p.path);

  // What `build` reads: each page's own model, its manifests merged in.
  const allPaths = new Set(paths);
  const routes = routesFrom(config, sources);
  const view = await openMetaView(opts.source, cwd, paths, sources);
  const models = await withExternalMetadata(
    pages.map((p) => analyzeDoc(p.content, p.path, allPaths, { routes })),
    view,
  );

  const git = await gitState(sources, paths);
  if (git.reason !== undefined) {
    notices.push(`git cannot read this directory (${git.reason}), so records carry no commit and no derived dates.`);
  } else if (git.dirty.size > 0 && git.commit !== null) {
    const n = git.dirty.size;
    warnings.push(
      `${String(n)} ${n === 1 ? "page differs" : "pages differ"} from ${git.commit.slice(0, 8)}, so their records describe uncommitted text.`,
    );
  }
  const worktree = git.commit === null ? null : git.dirty.size > 0 ? "modified" : "clean";

  const pins = await pinsByPage(opts, sources, paths, new Map(models.map((m) => [m.path, m.frontmatter])));
  const dates = await datesByPage(opts, sources, paths, git.commit !== null);
  const evals = readEvals(opts, sources, pages, warnings);
  if (opts.evals === undefined) warnings.push("no docevals report is configured, so records carry no eval verdicts.");

  const vectors = readVectors(opts.outDir);
  if (vectors === undefined) {
    warnings.push(
      "no vector sidecar, so chunks carry no vectors and retrieval is lexical only; configure graph.embed to add them.",
    );
  }

  const rows: ChunkRow[] = [];
  const pageMetadata: Record<string, { metadata: Record<string, unknown> }> = {};
  for (const [n, page] of pages.entries()) {
    const model = models[n];
    if (model === undefined) continue;
    const refs = view.refsFor(page.path, model.frontmatter);
    const { $schema: _schema, ...own } = model.frontmatter;
    void _schema;
    const metadata = plain(await deliveredFields(own, refs, view.validator)) as Record<string, unknown>;
    pageMetadata[page.path] = { metadata };
    const { bodyLine } = bodyOf(page.content, model.format);
    const blocks: { start: number; end: number; status: PassageStatement["status"]; data: Record<string, unknown> }[] = [];
    const bySection = new Map<string, Record<string, unknown>[]>();
    for (const s of model.statements ?? []) {
      const data = plain(await deliveredFields(s.data, refs, view.validator)) as Record<string, unknown>;
      if (s.scope === "block") {
        blocks.push({ start: s.anchor.start - bodyLine + 1, end: s.anchor.end - bodyLine + 1, status: s.status, data });
        continue;
      }
      const section = model.sections.find(
        (x) => x.line !== null && x.line >= s.anchor.start && x.line <= s.anchor.end,
      );
      if (section === undefined) continue;
      const list = bySection.get(section.slug) ?? [];
      list.push(data);
      bySection.set(section.slug, list);
    }

    const language = languageOf(graph, page.doc);
    const record = (start: number, end: number): Omit<ProvenanceRecord, "node"> => ({
      page: page.path,
      lines: `${String(start)}-${String(end)}`,
      commit: git.commit,
      worktree,
      pins: summarize(pins.get(page.path) ?? [], start, end),
      dates: dates.get(page.path) ?? noDates(model.frontmatter),
      evals: evals?.get(page.path) ?? null,
      statements: blocks
        .filter((b) => b.start >= start && b.end <= end)
        .map((b) => ({ lines: `${String(b.start)}-${String(b.end)}`, status: b.status, data: b.data })),
    });

    for (const passage of passagesOf(graph, page, model, bodyLine, language, metadata, bySection)) {
      const vector = vectors?.byId.get(passage.id);
      rows.push({
        id: passage.id,
        graph: graphDigest,
        page: passage.page,
        lines: `${String(passage.start)}-${String(passage.end)}`,
        language: passage.language,
        title: passage.title,
        text: passage.text,
        ...(vector === undefined ? {} : { vector }),
        metadata: passage.metadata,
        provenance: { node: passage.id, ...record(passage.start, passage.end) },
      });
    }
  }
  rows.sort((a, b) => byCodeUnit(a.id, b.id));

  // The trust floor, at export (decision 8): what it names leaves the rows.
  const withhold = config.retrieve.withhold;
  const withheld: ChunksManifest["withheld"] = [];
  const kept: ChunkRow[] = [];
  for (const row of rows) {
    const because = withhold.filter((reason) => withholds(row.provenance, reason));
    if (because.length === 0) kept.push(row);
    else withheld.push({ id: row.id, page: row.page, because });
  }
  if (withheld.length > 0) {
    const reasons = withhold.filter((r) => withheld.some((w) => w.because.includes(r)));
    const n = withheld.length;
    notices.push(
      `${String(n)} ${n === 1 ? "chunk" : "chunks"} withheld by graph.retrieve.withhold (${reasons.join(", ")}); ${CHUNKS_MANIFEST} lists them.`,
    );
  }

  mkdirSync(opts.outDir, { recursive: true });
  const languages: ChunksManifest["languages"] = {};
  const byLanguage = new Map<string, ChunkRow[]>();
  for (const row of kept) {
    const list = byLanguage.get(row.language) ?? [];
    list.push(row);
    byLanguage.set(row.language, list);
  }
  for (const [language, list] of byLanguage) {
    // The tag becomes a filename, as it does for the search index.
    if (!isLanguageTag(language)) {
      throw new GraphError(
        `Cannot write an index for language "${language}": not a BCP-47 tag. ` +
          `Fix the \`lang\`/\`language\` frontmatter, or the route's \`language\`, ` +
          `and rebuild — \`manni graph check\` reports which document carries it.`,
      );
    }
    const file = chunksFilename(language);
    writeFileSync(join(opts.outDir, file), list.map((row) => `${canonicalJson(row)}\n`).join(""), "utf8");
    languages[language] = { file, rows: list.length };
  }

  const manifest: ChunksManifest = {
    format: "manni-graph-chunks",
    version: 1,
    graph: graphDigest,
    graphFile: basename(opts.graphPath).replace(/\.[^.]*$/, "") + ".jsonld",
    searchIndex: LOCALIZATIONS_FILENAME,
    commit: git.commit,
    worktree,
    model: vectors?.model ?? null,
    retrieve: { ...config.retrieve },
    evals: opts.evals === undefined || evals === undefined ? null : { report: opts.evals.label, digest: evals.digest },
    languages,
    pages: pageMetadata,
    withheld,
  };
  const manifestPath = join(opts.outDir, CHUNKS_MANIFEST);
  writeFileSync(manifestPath, `${canonicalJson(manifest, 2)}\n`, "utf8");
  const files = [manifestPath, ...Object.values(languages).map((l) => join(opts.outDir, l.file))];
  return { manifestPath, rows: kept.length, withheld: withheld.length, warnings, notices, files };
}

function languageOf(graph: GraphIndex, doc: string): string {
  const tag = graph.literal(doc, LANGUAGE);
  return tag === undefined ? UNDETERMINED : canonicalLanguageTag(tag);
}

/** A document's passage, then each section's, in document order. */
function passagesOf(
  graph: GraphIndex,
  page: { doc: string; path: string; content: string },
  model: DocModel,
  bodyLine: number,
  language: string,
  metadata: Record<string, unknown>,
  bySection: ReadonlyMap<string, Record<string, unknown>[]>,
): Passage[] {
  const out: Passage[] = [];
  const fileLines = page.content.split(/\r?\n/);
  const body = fileLines.slice(bodyLine - 1).join("\n").trimEnd();
  if (body.trim() !== "") {
    out.push({
      id: page.doc,
      page: page.path,
      start: 1,
      end: body.split("\n").length,
      title: graph.literal(page.doc, TITLE) ?? page.path,
      text: body,
      language,
      metadata,
    });
  }

  const sections = documentSectionOrder(graph, page.doc);
  const spans = new Map<string, { start: number; end: number }>();
  const format = formatOf(page.path, model.format);
  if (isTreeFormat(format)) {
    // A tree section's own span, widened over the sections nested in it: the
    // ones after it of a deeper level, up to the next of its own or higher.
    const own = new Map(sectionSpans(graph, page.doc, page.path, page.content, sections).map((s) => [s.iri, s.span]));
    const levels = sections.map((iri) => Number.parseInt(graph.literal(iri, LEVEL) ?? "", 10));
    for (const [i, iri] of sections.entries()) {
      const span = own.get(iri);
      if (span === undefined) continue;
      let end = span.end;
      for (let j = i + 1; j < sections.length; j++) {
        const level = levels[j] ?? Number.NaN;
        if (!(level > (levels[i] ?? Number.NaN))) break;
        end = Math.max(end, own.get(sections[j] ?? "")?.end ?? end);
      }
      spans.set(iri, { start: span.start, end });
    }
  } else {
    const occurrences = sectionOccurrences(graph, page.doc);
    for (const iri of sections) {
      const title = graph.literal(iri, TITLE);
      if (title === undefined) continue;
      const level = Number.parseInt(graph.literal(iri, LEVEL) ?? "", 10);
      const span = sectionLines(page.content, title, Number.isNaN(level) ? undefined : level, occurrences.get(iri) ?? 0);
      if (span !== undefined) spans.set(iri, span);
    }
  }

  const slugs = new Map(model.sections.map((s) => [s.slug, s]));
  for (const iri of sections) {
    const span = spans.get(iri);
    if (span === undefined || span.start < bodyLine) continue;
    const text = fileLines.slice(span.start - 1, span.end).join("\n").trimEnd();
    if (text === "") continue;
    // The page's fields, then each heading statement from the outermost
    // section down to this one: the nearest wins, field by field.
    const chain: Record<string, unknown>[] = [];
    let slug: string | null = iri.slice(iri.indexOf("#") + 1);
    const seen = new Set<string>();
    while (slug !== null && !seen.has(slug)) {
      seen.add(slug);
      chain.unshift(...(bySection.get(slug) ?? []));
      slug = slugs.get(slug)?.parentSlug ?? null;
    }
    out.push({
      id: iri,
      page: page.path,
      start: span.start - bodyLine + 1,
      end: span.start - bodyLine + text.split("\n").length,
      title: graph.literal(iri, TITLE) ?? iri,
      text,
      language,
      metadata: Object.assign({}, metadata, ...chain) as Record<string, unknown>,
    });
  }
  return out;
}

// ---- git ---------------------------------------------------------------------

/** HEAD, the pages that differ from it, or why git could not answer. */
async function gitState(
  dir: string,
  paths: readonly string[],
): Promise<{ commit: string | null; dirty: Set<string>; reason?: string }> {
  let commit: string;
  let prefix: string;
  try {
    commit = (await run("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    prefix = (await run("git", ["rev-parse", "--show-prefix"], { cwd: dir })).stdout.trim();
  } catch (e) {
    const stderr = (e as { stderr?: unknown }).stderr;
    const said = typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim().split(/\r?\n/)[0] ?? "" : errorMessage(e);
    return { commit: null, dirty: new Set(), reason: said.replace(/^fatal:\s*/, "") };
  }
  const wanted = new Set(paths);
  const dirty = new Set<string>();
  const { stdout } = await run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."], {
    cwd: dir,
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries = stdout.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    if (entry.length < 4) continue;
    // A rename names its source in the next field, which is not a page now.
    if (entry[0] === "R" || entry[0] === "C") i++;
    const fromRoot = entry.slice(3);
    if (!fromRoot.startsWith(prefix)) continue;
    const path = fromRoot.slice(prefix.length);
    if (wanted.has(path)) dirty.add(path);
  }
  return { commit, dirty };
}

// ---- pins --------------------------------------------------------------------

interface Pin {
  start: number;
  end: number;
  item: PinItem;
}

/** cite's own check over the pages, read into pins with their current claim lines. */
async function pinsByPage(
  opts: ChunksOptions,
  sources: string,
  paths: readonly string[],
  metadata: ReadonlyMap<string, Record<string, unknown>>,
): Promise<Map<string, Pin[]>> {
  const out = new Map<string, Pin[]>();
  if (paths.length === 0) return out;
  let reports: PageCitationReport[];
  try {
    reports = (
      await runCheck({
        inputs: [...paths],
        cwd: sources,
        ...(opts.source.configPath === undefined ? {} : { configPath: resolve(opts.cwd, opts.source.configPath) }),
        ...(opts.source.noConfig === undefined ? {} : { noConfig: opts.source.noConfig }),
      })
    ).pages;
  } catch (e) {
    throw new GraphError(errorMessage(e));
  }
  for (const report of reports) {
    const content = readFileSync(resolve(sources, report.file), "utf8");
    const { bodyLine } = bodyOf(content, formatOf(report.file));
    const list: Pin[] = [];
    for (const result of report.citations) {
      const claim = claimLines(result, bodyLine);
      if (claim === undefined) continue;
      // cite reads the entry's pin fields; its verification fields are read
      // from the merged page, where the entry sits at the same index.
      const entries = metadata.get(report.file)?.["citations"];
      const raw: unknown = Array.isArray(entries) ? entries[result.origin.index] : undefined;
      const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      const findings = report.findings
        .filter((f) => f.index === result.origin.index)
        .map((f) => ({ rule: f.rule, severity: f.severity }));
      list.push({
        ...claim,
        item: {
          id: result.citation.id ?? null,
          claim: claim.start === claim.end ? String(claim.start) : `${String(claim.start)}-${String(claim.end)}`,
          source: result.source.src,
          commit: result.citation.source["commit-sha"] ?? null,
          findings,
          lastVerified: asWritten(entry["last-verified"]),
          verifiedBy: entriesOf(entry["verified-by"]),
        },
      });
    }
    out.set(report.file, list);
  }
  return out;
}

/** The body lines a claim occupies now: where it moved to, else where it is recorded. */
function claimLines(result: CitationResult, bodyLine: number): { start: number; end: number } | undefined {
  const claim = result.claim;
  if (claim === null) return undefined;
  const body = claim.status === "moved" && claim.newLines !== undefined ? claim.newLines : claim.lines;
  if (body !== undefined) return range(body);
  if (claim.fileLines === undefined) return undefined;
  const file = range(claim.fileLines);
  return file && { start: file.start - bodyLine + 1, end: file.end - bodyLine + 1 };
}

function range(spec: string): { start: number; end: number } | undefined {
  const m = /^(\d+)(?:-(\d+))?$/.exec(spec.trim());
  if (m?.[1] === undefined) return undefined;
  const start = Number(m[1]);
  return { start, end: m[2] === undefined ? start : Number(m[2]) };
}

const RANK = { notice: 1, warning: 2, error: 3 } as const;

/** The pins whose claim overlaps `start`-`end`, each counted once at its worst finding. */
function summarize(pins: readonly Pin[], start: number, end: number): PinSummary {
  const summary: PinSummary = { total: 0, current: 0, notice: 0, warning: 0, error: 0, items: [] };
  for (const pin of pins) {
    if (pin.end < start || pin.start > end) continue;
    summary.total += 1;
    summary.items.push(pin.item);
    const worst = pin.item.findings.reduce<PinItem["findings"][number]["severity"] | undefined>(
      (w, f) => (w === undefined || RANK[f.severity] > RANK[w] ? f.severity : w),
      undefined,
    );
    if (worst === undefined) summary.current += 1;
    else summary[worst] += 1;
  }
  return summary;
}

// ---- dates -------------------------------------------------------------------

/** What `manni meta derive` would stamp for `created` and `last-updated`, compared with each page. */
async function datesByPage(
  opts: ChunksOptions,
  sources: string,
  paths: readonly string[],
  inGit: boolean,
): Promise<Map<string, ProvenanceRecord["dates"]>> {
  const out = new Map<string, ProvenanceRecord["dates"]>();
  if (paths.length === 0 || !inGit) return out;
  let derived;
  try {
    derived = await runDerive({
      inputs: [...paths],
      cwd: sources,
      fields: ["created", "last-updated"],
      sources: ["git"],
      // `check` judges and writes nothing, and offers no relocation.
      check: true,
      // Never read: an uncommitted change's day is dropped below.
      now: () => new Date(0),
      ...(opts.source.configPath === undefined ? {} : { configPath: resolve(opts.cwd, opts.source.configPath) }),
      ...(opts.source.noConfig === undefined ? {} : { noConfig: opts.source.noConfig }),
    });
  } catch (e) {
    throw new GraphError(errorMessage(e));
  }
  for (const result of derived.results) {
    const content = readFileSync(resolve(sources, result.file), "utf8");
    const page = analyzeDoc(content, result.file, new Set([result.file])).frontmatter;
    const date = (field: "created" | "last-updated"): DerivedDate => {
      const f = result.fields.find((x) => x.field === field);
      const asserted = f?.asserted ?? page[field];
      const day = f === undefined || f.evidence === "uncommitted body change" ? null : asWritten(f.derived);
      // No derived day, nothing to compare the page against: no stamp either.
      if (day === null) return { day, stamp: null };
      const stamp: DerivedDate["stamp"] =
        asserted === undefined || asserted === null ? "absent" : f?.status === "current" ? "current" : "stale";
      return { day, stamp };
    };
    out.set(result.file, {
      created: date("created"),
      lastUpdated: date("last-updated"),
      lastVerified: asWritten(page["last-verified"]),
      verifiedBy: entriesOf(page["verified-by"]),
    });
  }
  return out;
}

/** Outside git, or for a page derive did not read: no days, so no stamps, and the page's own verification. */
function noDates(page: Record<string, unknown>): ProvenanceRecord["dates"] {
  return {
    created: { day: null, stamp: null },
    lastUpdated: { day: null, stamp: null },
    lastVerified: asWritten(page["last-verified"]),
    verifiedBy: entriesOf(page["verified-by"]),
  };
}

// ---- evals -------------------------------------------------------------------

interface ReportResult {
  evalName: string;
  suite?: string;
  grader: string;
  file: string;
  outcome: EvalItem["outcome"];
  integrity?: string;
  consensus?: { meanConfidence?: number };
}

/** Each page's verdicts from the report, keyed by page, plus the report's digest. */
function readEvals(
  opts: ChunksOptions,
  sources: string,
  pages: readonly { path: string; content: string }[],
  warnings: string[],
): (Map<string, ProvenanceEvals> & { digest: string }) | undefined {
  if (opts.evals === undefined) return undefined;
  const { label, path } = opts.evals;
  if (!existsSync(path)) throw new GraphError(`graph.export.chunks.evals names ${label}, which does not exist.`);
  const bytes = readFileSync(path);
  const notReport = new GraphError(`${label} is not a docevals JSON report; write one with manni docevals run -f json.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw notReport;
  }
  const results = (parsed as { evalResults?: unknown } | null)?.evalResults;
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(results) || typeof (parsed as { pages?: unknown }).pages !== "number") {
    throw notReport;
  }
  const digest = integrityOf(bytes);
  // A result's `file` is relative to where docevals ran: the config's
  // directory, where a bare run starts, and the graph's labels resolve too.
  const reportBase = opts.config.configSource === null ? opts.cwd : opts.config.configDir;
  const byPage = new Map<string, ReportResult[]>();
  const known = new Map(pages.map((p) => [resolve(sources, p.path), p.path]));
  const strangers = new Set<string>();
  let anyIntegrity = false;
  for (const raw of results) {
    if (typeof raw !== "object" || raw === null) throw notReport;
    const r = raw as ReportResult;
    if (typeof r.file !== "string" || typeof r.evalName !== "string" || typeof r.outcome !== "string") throw notReport;
    if (r.integrity !== undefined) anyIntegrity = true;
    const page = known.get(resolve(reportBase, r.file));
    if (page === undefined) {
      strangers.add(r.file);
      continue;
    }
    const list = byPage.get(page) ?? [];
    list.push(r);
    byPage.set(page, list);
  }
  if (results.length > 0 && !anyIntegrity) {
    warnings.push(`${label} records no page integrity, so every verdict reads stale; write it again with manni docevals run -f json.`);
  }
  const out = new Map<string, ProvenanceEvals>() as Map<string, ProvenanceEvals> & { digest: string };
  out.digest = digest;
  let changed = 0;
  for (const page of pages) {
    const list = byPage.get(page.path) ?? [];
    const now = integrityOf(Buffer.from(page.content, "utf8"));
    const current = list.every((r) => r.integrity === now);
    if (!current && anyIntegrity && list.some((r) => r.integrity !== undefined)) changed += 1;
    const count = (outcome: EvalItem["outcome"]): number => list.filter((r) => r.outcome === outcome).length;
    out.set(page.path, {
      report: digest,
      current,
      pass: count("pass"),
      fail: count("fail"),
      needsReview: count("needs-review"),
      skipped: count("skipped"),
      error: count("error"),
      items: list
        .map((r): EvalItem => ({
          name: r.evalName,
          suite: r.suite ?? "",
          grader: r.grader,
          outcome: r.outcome,
          ...(typeof r.consensus?.meanConfidence === "number" ? { confidence: r.consensus.meanConfidence } : {}),
        }))
        .sort((a, b) => byCodeUnit(a.suite, b.suite) || byCodeUnit(a.name, b.name)),
    });
  }
  if (changed > 0) {
    warnings.push(
      `${String(changed)} ${changed === 1 ? "page" : "pages"} changed since ${label} was written, so their verdicts read stale.`,
    );
  }
  if (strangers.size > 0) {
    const n = strangers.size;
    warnings.push(
      `${String(n)} ${n === 1 ? "page" : "pages"} in ${label} ${n === 1 ? "is" : "are"} not in the graph, so their verdicts are left out.`,
    );
  }
  return out;
}

// ---- vectors -----------------------------------------------------------------

/** Every node's vector from the sidecars the search manifest names, or `undefined` when there are none. */
function readVectors(
  dir: string,
): { model: { id: string; dimensions: number }; byId: Map<string, number[]> } | undefined {
  const manifestPath = join(dir, LOCALIZATIONS_FILENAME);
  if (!existsSync(manifestPath)) return undefined;
  const doc = parseLocalizations(readFileSync(manifestPath, "utf8"));
  if (doc === undefined) return undefined;
  const byId = new Map<string, number[]>();
  let model: { id: string; dimensions: number } | undefined;
  for (const entry of doc.languages) {
    if (entry.vectors === undefined) continue;
    const file = resolve(dir, entry.vectors.path);
    if (!existsSync(file)) continue;
    const { header, vectors } = decodeVectorIndex(readFileSync(file));
    model ??= { id: header.model, dimensions: header.dims };
    for (const [i, id] of header.ids.entries()) {
      byId.set(id, Array.from(vectors.subarray(i * header.dims, (i + 1) * header.dims)));
    }
  }
  return model === undefined ? undefined : { model, byId };
}

// ---- values ------------------------------------------------------------------

/** A value as the page wrote it: a parsed date back to its text, else a string, else `null`. */
function asWritten(value: unknown): string | null {
  if (value instanceof Date) return dateText(value);
  if (typeof value === "string") return value;
  return null;
}

function dateText(d: Date): string {
  const iso = d.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/** A list field's entries, or `[]`. */
function entriesOf(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(plain);
}

/** JSON-ready: dates as written, everything else as it is. */
function plain(value: unknown): unknown {
  if (value instanceof Date) return dateText(value);
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

/** JSON with every object's keys sorted, so equal values give equal bytes. */
export function canonicalJson(value: unknown, indent?: number): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (typeof v === "object" && v !== null) {
      return Object.fromEntries(
        Object.keys(v)
          .sort(byCodeUnit)
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent);
}
