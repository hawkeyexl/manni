/**
 * Sample questions as findability checks (proposals 0086 §7 and 0087), the
 * half of `manni graph check` no shape can express.
 *
 * Questions are read from each page's source, not from the graph: an item's
 * answer pins and review state are test data, and never reach the graph. A
 * question is asked through the retrieval `graph search` uses by default:
 * `findEntry` over the lexical index, fused with the vector leg when a sidecar
 * and an embedder are present beside the graph. The lexical index is built in
 * memory from the graph, so no `export search` run is needed, and a question
 * is asked in its page's language's index.
 *
 * An unpinned question must find its page, or a section of it. A pinned
 * answer must find the node whose own text holds its lines. Each pin is first
 * compared with the page as it is now, under cite's hashing rule: an answer
 * that moved is checked at its new lines, and one that changed is not asked.
 *
 * A golden-set file (`graph.questionFiles`) holds questions that span pages
 * or that the docs don't answer. Each of its answers names its page, and is
 * asked as a page's pin is. Across both homes, a question asked twice and a
 * question that repeats its answer's words are reported, and the whole set's
 * health is summed up for `check` to print and gate on.
 *
 * It measures finding, not answering. Nothing here reaches a model beyond the
 * embedder `search` would use, and the same inputs give the same findings.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Store } from "n3";
import { locateFrontmatter } from "../../meta/index.js";
import {
  bodyLineOf,
  findWindows,
  pinOfLines,
  spellLines,
  splitLines,
  toFileLines,
  type PageLines,
} from "../../shared/pin.js";
import type { Severity } from "../../shared/severity.js";
import { warn } from "../../shared/warn.js";
import {
  formatOf,
  type DocFormat,
  isTreeFormat,
  metadataOf,
  mintTreeSections,
  parseTree,
} from "../core/analyze.js";
import type { GraphConfig } from "../core/config.js";
import { mergePage, openMetaView, type MetaViewSource } from "../core/external.js";
import { STDIN_PATH } from "../core/iri.js";
import { compactIri, storeToQuads } from "../core/load.js";
import {
  canonicalLanguageTag,
  LOCALIZATIONS_FILENAME,
  parseLocalizations,
  UNDETERMINED,
  type LocalizationEntry,
} from "../core/localizations.js";
import {
  COPIED_SHARE,
  copiedPairs,
  questionKey,
  readQuestionFile,
  readSampleQuestions,
  type AnswerPin,
  type SampleQuestion,
} from "../core/questions.js";
import {
  buildSearchIndex,
  emitSearchIndex,
  partitionByLanguage,
  type SearchIndexDoc,
} from "../core/search-index.js";
import type { CheckFinding } from "../core/shacl.js";
import { byCodeUnit } from "../core/sort.js";
import { VectorIndexError } from "../core/vector-index.js";
import { NS, PREFIXES } from "../core/vocab.js";
import type { Embedder } from "../embed/types.js";
import { findEntry } from "../runtime/entry.js";
import { GraphIndex } from "../runtime/graph.js";
import { createLexicalIndex, type LexicalIndex } from "../runtime/lexical.js";
import { sectionOccurrences, sectionOwnLines } from "../runtime/resolve.js";
import {
  createVectorIndex,
  VectorMismatchError,
  type VectorIndex,
} from "../runtime/vector.js";
import type { Position } from "../../lint/types.js";
import { GraphError } from "../types.js";
import { resolveEmbedder } from "./search.js";

const DOCUMENT = `${NS.graph}Document`;
const SECTION = `${NS.graph}Section`;
const PATH = `${NS.graph}path`;
const LEVEL = `${NS.graph}level`;
const TITLE = `${NS.dcterms}title`;
const LANGUAGE = `${NS.dcterms}language`;
export const SAMPLE_QUESTION = `${NS.graph}sampleQuestion`;
const DOCUMENT_TYPE = compactIri(DOCUMENT);
const SECTION_TYPE = compactIri(SECTION);

/** One language's retrieval: the lexical leg, and the vector leg when present. */
interface Retriever {
  lexical: LexicalIndex;
  vectors?: VectorIndex;
  embedder?: Embedder;
}

/** A page whose source is on disk, with the questions it declares. */
interface Page {
  doc: string;
  path: string;
  language: string;
  /** File line of body line 1, as cite counts it. */
  bodyLine: number;
  /** The body's lines, normalized as cite hashes them. */
  body: string[];
  /** Each section node in the graph, with the file lines its own text spans. */
  sections: { iri: string; span: PageLines }[];
  questions: SampleQuestion[];
}

/** The manifest `export search` and `embed` write beside the graph, if any. */
function readManifest(indexDir: string): LocalizationEntry[] {
  const path = join(indexDir, LOCALIZATIONS_FILENAME);
  if (!existsSync(path)) return [];
  const manifest = parseLocalizations(readFileSync(path, "utf8"));
  if (!manifest) {
    throw new GraphError(
      `Not a manni graph localization manifest: ${path} — re-run \`manni graph export search\`.`,
    );
  }
  return manifest.languages;
}

/**
 * The lexical index, plus the vector leg when the manifest records a sidecar
 * for this language and an embedder loads. Every missing piece degrades to
 * lexical, as a plain `graph search` does. A sidecar built from another index
 * is refused with a warning, because its IRIs describe a different corpus.
 */
async function openRetriever(
  doc: SearchIndexDoc,
  entry: LocalizationEntry | undefined,
  indexDir: string,
): Promise<Retriever> {
  const lexical = createLexicalIndex(doc);
  if (!entry?.vectors) return { lexical };
  const path = resolve(indexDir, entry.vectors.path);
  if (!existsSync(path)) return { lexical };
  let vectors: VectorIndex;
  try {
    vectors = createVectorIndex(readFileSync(path));
  } catch (e) {
    if (e instanceof VectorIndexError) {
      throw new GraphError(`${e.message} (${path}) — re-run \`manni graph embed\`.`);
    }
    throw e;
  }
  // The digest `export search` would record for this index, so a sidecar
  // embedded from the bytes it wrote is recognized as current.
  const source = `sha256:${createHash("sha256").update(emitSearchIndex(doc), "utf8").digest("hex")}`;
  const stale = vectors.check({ source });
  if (stale) {
    warn(`${stale.detail} Falling back to lexical.`);
    return { lexical };
  }
  const embedder = await resolveEmbedder(undefined, vectors, false);
  return embedder ? { lexical, vectors, embedder } : { lexical };
}

/** The documents and sections a question finds, best first. Concepts belong to no page. */
async function rankNodes(question: string, r: Retriever): Promise<string[]> {
  const entry = await findEntry(question, {
    lexical: r.lexical,
    ...(r.vectors && r.embedder ? { vectors: r.vectors, embedder: r.embedder } : {}),
    limit: r.lexical.size(),
  }).catch((e: unknown) => {
    if (e instanceof VectorMismatchError) {
      throw new GraphError(`${e.message} Re-run \`manni graph embed\`.`);
    }
    throw e;
  });
  return entry.candidates.flatMap((c) => {
    const type = r.lexical.entry(c.iri)?.type;
    return type === DOCUMENT_TYPE || type === SECTION_TYPE ? [c.iri] : [];
  });
}

/** The page a document or section node belongs to. */
function pageOf(iri: string): string {
  const hash = iri.indexOf("#");
  return hash < 0 ? iri : iri.slice(0, hash);
}

/** A node's last line: a half-open span that ends at column 1 ends on the line before. */
function lastLine(position: Position): number {
  const { start, end } = position;
  return end.column <= 1 && end.line > start.line ? end.line - 1 : end.line;
}

/**
 * Each graph section of a page, with the file lines its own text spans: its
 * heading down to the next heading of any rank, as the search index slices it.
 */
export function sectionSpans(
  graph: GraphIndex,
  doc: string,
  path: string,
  content: string,
  sections: readonly string[],
): { iri: string; span: PageLines }[] {
  const format = formatOf(path);
  const out: { iri: string; span: PageLines }[] = [];
  if (isTreeFormat(format)) {
    const known = new Set(sections);
    const minted = mintTreeSections(parseTree(content, path, format).sections);
    for (const [n, section] of minted.sections.entries()) {
      const iri = `${doc}#${section.slug}`;
      const node = minted.nodes[n];
      if (!known.has(iri) || node === undefined) continue;
      const head = node.titlePosition ?? node.position;
      const end = Math.max(
        lastLine(head),
        ...(minted.owned[n] ?? []).map((c) => lastLine(c.position)),
      );
      out.push({ iri, span: { start: head.start.line, end } });
    }
    return out;
  }
  const occurrences = sectionOccurrences(graph, doc);
  for (const iri of sections) {
    const title = graph.literal(iri, TITLE);
    if (title === undefined) continue;
    const level = Number.parseInt(graph.literal(iri, LEVEL) ?? "", 10);
    const span = sectionOwnLines(
      content,
      title,
      Number.isNaN(level) ? undefined : level,
      occurrences.get(iri) ?? 0,
    );
    if (span) out.push({ iri, span });
  }
  return out;
}

/**
 * A page's body as answer pins count it: the file line of body line 1, and
 * the body's lines, normalized as cite hashes them. HTML and XML carry their
 * metadata inside the body, so body line 1 is file line 1, as cite counts it.
 */
export function bodyOf(content: string, format: DocFormat): { bodyLine: number; body: string[] } {
  const bodyLine =
    format === "html" || format === "xml"
      ? 1
      : bodyLineOf(content, locateFrontmatter(content)?.closeEnd ?? 0);
  return { bodyLine, body: splitLines(content).slice(bodyLine - 1) };
}

/** Where a pin's lines are now, judged against the page as it reads today. */
export type Freshness =
  | { state: "current" | "moved" | "ambiguous"; ranges: PageLines[] }
  | { state: "changed" };

export function freshness(body: readonly string[], pin: AnswerPin): Freshness {
  const { lines, integrity } = pin;
  if (integrity === undefined) {
    return lines.end <= body.length ? { state: "current", ranges: [lines] } : { state: "changed" };
  }
  if (pinOfLines(body, lines) === integrity) return { state: "current", ranges: [lines] };
  const length = lines.end - lines.start + 1;
  const { starts } = findWindows(body, length, integrity, undefined, { around: lines.start });
  const ranges = starts.map((start) => ({ start, end: start + length - 1 }));
  if (ranges.length === 0) return { state: "changed" };
  return { state: ranges.length === 1 ? "moved" : "ambiguous", ranges };
}

/** `lines 4 and 8 both match`, or `lines 4, 8 and 12 all match`. */
export function matchList(ranges: readonly PageLines[]): string {
  const spelled = ranges.map(spellLines);
  const head = spelled.slice(0, -1);
  const last = spelled[spelled.length - 1] ?? "";
  const both = head.length === 1 ? "both" : "all";
  return `lines ${head.join(", ")} and ${last} ${both} match`;
}

/**
 * The pages of the graph that are on disk. `pages` holds each one that
 * declares a question; `pageAt` builds the record of any other, by its
 * absolute path, for a golden-set answer that points at it.
 */
async function readPages(
  graph: GraphIndex,
  sources: string,
  view: { source: MetaViewSource; cwd: string },
): Promise<{
  pages: Page[];
  contents: Map<string, string>;
  pageAt: (abs: string) => Page | undefined;
}> {
  const contents = new Map<string, string>();
  const onDisk: { doc: string; path: string }[] = [];
  const byAbs = new Map<string, { doc: string; path: string }>();
  let missing = 0;
  for (const doc of graph.instancesOf(DOCUMENT)) {
    const path = graph.literal(doc, PATH);
    if (path === undefined || path === STDIN_PATH) continue;
    const abs = resolve(sources, path);
    if (!existsSync(abs)) {
      missing += 1;
      continue;
    }
    contents.set(path, readFileSync(abs, "utf8"));
    onDisk.push({ doc, path });
    byAbs.set(abs, { doc, path });
  }
  if (missing > 0) {
    warn(
      missing === 1
        ? "1 page in the graph is not on disk, so its questions were not checked; run manni graph build."
        : `${String(missing)} pages in the graph are not on disk, so their questions were not checked; run manni graph build.`,
    );
  }

  const sectionsOf = new Map<string, string[]>();
  for (const section of graph.instancesOf(SECTION)) {
    const doc = pageOf(section);
    const siblings = sectionsOf.get(doc);
    if (siblings) siblings.push(section);
    else sectionsOf.set(doc, [section]);
  }

  const records = new Map<string, Page>();
  const record = (doc: string, path: string, questions: SampleQuestion[]): Page => {
    const known = records.get(doc);
    if (known) return known;
    const content = contents.get(path) ?? "";
    const { bodyLine, body } = bodyOf(content, formatOf(path));
    const tag = graph.literal(doc, LANGUAGE);
    const page: Page = {
      doc,
      path,
      language: tag === undefined ? UNDETERMINED : canonicalLanguageTag(tag),
      bodyLine,
      body,
      sections: sectionSpans(graph, doc, path, content, sectionsOf.get(doc) ?? []),
      questions,
    };
    records.set(doc, page);
    return page;
  };

  // The metadata `build` derives from: the page's own, merged with every key
  // a manifest of its collections owns.
  const meta = await openMetaView(view.source, view.cwd, onDisk.map((p) => p.path), sources);
  const pages: Page[] = [];
  for (const { doc, path } of onDisk) {
    const content = contents.get(path) ?? "";
    const format = formatOf(path);
    const own = metadataOf(content, path, format);
    const { data } = await mergePage(meta, path, own.data, own.present, format);
    const questions = readSampleQuestions(data["sample-questions"]);
    if (questions.length > 0) pages.push(record(doc, path, questions));
  }
  pages.sort((a, b) => byCodeUnit(a.path, b.path));
  return {
    pages,
    contents,
    pageAt: (abs) => {
      const hit = byAbs.get(abs);
      return hit && record(hit.doc, hit.path, []);
    },
  };
}

/** The nodes of `page` whose own text holds any of `lines`, in file lines. */
function holdersOf(page: Page, lines: PageLines): string[] {
  const out = page.sections
    .filter(({ span }) => span.start <= lines.end && lines.start <= span.end)
    .map(({ iri }) => iri);
  for (let line = lines.start; line <= lines.end; line++) {
    if (!page.sections.some(({ span }) => span.start <= line && line <= span.end)) {
      return [page.doc, ...out];
    }
  }
  return out;
}

/** How many of a kind of question are found, and how many first. */
export interface FoundCount {
  inTop: number;
  first: number;
  /** The questions with a test: a page, or at least one pin. */
  of: number;
}

/**
 * The health of the whole question set (proposal 0087 § 7b): what `check`
 * prints after its findings, and the `questions` key of its JSON report.
 */
export interface QuestionSummary {
  /** Every question, on pages and in golden-set files. */
  total: number;
  reviewed: number;
  drafted: number;
  /** Pages that declare at least one question. */
  pages: number;
  /** The golden-set files, as `graph.questionFiles` names them. */
  files: string[];
  top: number;
  found: { reviewed: FoundCount; drafted: FoundCount };
  answers: {
    pinned: number;
    /** Pins on a drafted question, or marked `reviewed: false` themselves. */
    unreviewed: number;
    current: number;
    /** Moved to one place or, ambiguously, to several. */
    moved: number;
    /** Changed, or on a page that does not exist. */
    changed: number;
    /** Page questions with no pin, which must find the page itself. */
    unpinned: number;
  };
  /** Golden-set questions with no answers: questions the docs don't answer. */
  gaps: number;
}

/**
 * A percentage, rounded down so a rate under a threshold never prints as it.
 * None of none is 0%: the summary reads as health, and nothing found is not
 * full marks. The rate gate guards an empty set on its own.
 */
function percent(part: number, of: number): number {
  return of === 0 ? 0 : Math.floor((part / of) * 100);
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? "" : "s"}`;
}

/** `a`, `a and b`, or `a, b and c`. */
function listOf(items: readonly string[]): string {
  const head = items.slice(0, -1);
  const last = items[items.length - 1] ?? "";
  return head.length === 0 ? last : `${head.join(", ")} and ${last}`;
}

/** The health summary as `check` prints it, one line per row. */
export function renderQuestionSummary(s: QuestionSummary): string[] {
  const homes = [
    ...(s.pages > 0 ? [`on ${plural(s.pages, "page")}`] : []),
    ...(s.files.length > 0 ? [`in ${listOf(s.files)}`] : []),
  ];
  const { reviewed, drafted } = s.found;
  const a = s.answers;
  return [
    `questions  ${String(s.total)}: ${String(s.reviewed)} reviewed, ${String(s.drafted)} drafted${homes.length > 0 ? `, ${homes.join(" and ")}` : ""}`,
    `  found    ${String(reviewed.inTop)} of ${String(reviewed.of)} reviewed in the top ${String(s.top)} (${String(percent(reviewed.inTop, reviewed.of))}%), ${String(reviewed.first)} first (${String(percent(reviewed.first, reviewed.of))}%)`,
    ...(drafted.of > 0
      ? [`  drafted  ${String(drafted.inTop)} of ${String(drafted.of)} in the top ${String(s.top)}, not counted until reviewed`]
      : []),
    `  answers  ${String(a.pinned)} pinned, ${String(a.unreviewed)} not reviewed: ${String(a.current)} current, ${String(a.moved)} moved, ${String(a.changed)} changed; ${String(a.unpinned)} not pinned`,
    ...(s.gaps > 0 ? [`  gaps     ${plural(s.gaps, "question")} the docs don't answer`] : []),
  ];
}

/** Where a question's findings go. */
interface Target {
  focusNode: string;
  path?: string;
  docs: string[];
}

/** A finding on one question: `knob` takes `questions.severity`, and a draft reports at notice. */
type Report = (kind: "knob" | Severity, message: string, draft?: "question" | "pin") => void;

/**
 * The findings for every page's sample questions and every golden-set file's
 * questions, with the health summary of the whole set. `sources` is where
 * each page's `graph:path` resolves from, `indexDir` is where a vector
 * sidecar's manifest sits, and `view` is the config meta's merge reads.
 * `questionFiles` are the golden-set files, and they and their answers'
 * `file`s resolve from `configDir`. The summary is absent when no question
 * exists.
 */
export async function askSampleQuestions(
  store: Store,
  settings: GraphConfig["check"]["questions"],
  sources: string,
  indexDir: string,
  view: { source: MetaViewSource; cwd: string },
  questionFiles: readonly string[],
  configDir: string,
): Promise<{ findings: CheckFinding[]; summary?: QuestionSummary }> {
  const knob = settings.severity;
  const top = settings.top;
  // A golden-set file that cannot be read is an operational error, said
  // before any page is read.
  const sets = questionFiles.map((label) => ({
    label,
    questions: readQuestionFile(resolve(configDir, label), label),
  }));
  const graph = GraphIndex.fromQuads(storeToQuads(store), Object.fromEntries(PREFIXES));
  const { pages, contents, pageAt } = await readPages(graph, sources, view);
  const total =
    pages.reduce((n, p) => n + p.questions.length, 0) +
    sets.reduce((n, f) => n + f.questions.length, 0);
  if (total === 0) return { findings: [] };

  // Built on first use: a set of nothing but gaps asks nothing.
  let byLanguage: Map<string, SearchIndexDoc> | undefined;
  let manifest: LocalizationEntry[] = [];
  const retrievers = new Map<string, Retriever>();
  const ranked = new Map<string, string[]>();
  const rank = async (language: string, question: string): Promise<string[]> => {
    const key = JSON.stringify([language, question]);
    const cached = ranked.get(key);
    if (cached) return cached;
    if (byLanguage === undefined) {
      // Missing pages were said once already, so the index's own warnings go.
      byLanguage = partitionByLanguage(
        graph,
        buildSearchIndex(graph, sources, { readDoc: (p) => contents.get(p) }),
      );
      manifest = readManifest(indexDir);
    }
    let retriever = retrievers.get(language);
    if (!retriever) {
      retriever = await openRetriever(
        byLanguage.get(language) ?? { version: 1, entries: [] },
        manifest.find((l) => canonicalLanguageTag(l.language) === language),
        indexDir,
      );
      retrievers.set(language, retriever);
    }
    const nodes = await rankNodes(question, retriever);
    ranked.set(key, nodes);
    return nodes;
  };

  const describe = (iri: string): string => {
    const path = graph.literal(pageOf(iri), PATH) ?? pageOf(iri);
    const title = iri.includes("#") ? graph.literal(iri, TITLE) : undefined;
    return title === undefined ? path : `${path} § ${title}`;
  };
  const where = (position: number, first: string | undefined): string =>
    [
      position === 0 ? "it is not found" : `it ranks ${String(position)}`,
      ...(first === undefined ? [] : [`first is ${describe(first)}`]),
    ].join("; ");

  const findings: CheckFinding[] = [];
  const reporter =
    (target: Target): Report =>
    (kind, message, draft) => {
      const level = kind === "knob" ? knob : kind;
      if (level === "off") return;
      const suffix =
        draft === "question" ? " (drafted, not reviewed)" : draft === "pin" ? " (answer not reviewed)" : "";
      findings.push({
        severity: draft ? "notice" : level,
        message: `${message}${suffix}`,
        focusNode: target.focusNode,
        ...(target.path === undefined ? {} : { path: target.path }),
        docs: target.docs,
      });
    };

  const empty = (): FoundCount => ({ inTop: 0, first: 0, of: 0 });
  const summary: QuestionSummary = {
    total,
    reviewed: 0,
    drafted: 0,
    pages: pages.length,
    files: [...questionFiles],
    top,
    found: { reviewed: empty(), drafted: empty() },
    answers: { pinned: 0, unreviewed: 0, current: 0, moved: 0, changed: 0, unpinned: 0 },
    gaps: 0,
  };
  /** Counts one question's outcome: `tests` holds each counted test's position, 0 when missed. */
  const tally = (reviewed: boolean, tests: readonly number[]): void => {
    if (tests.length === 0) return;
    const count = reviewed ? summary.found.reviewed : summary.found.drafted;
    count.of += 1;
    if (tests.every((p) => p >= 1 && p <= top)) count.inTop += 1;
    if (tests.every((p) => p === 1)) count.first += 1;
  };

  /**
   * One pin on `page`: its freshness first, then whether the top `top` holds
   * a node whose own text holds its lines. `file` is the page as a golden-set
   * item names it, absent for a page's own question. Returns the best
   * position, 0 when the answer changed or is not found, and the answer's
   * text as it reads now.
   */
  const askPin = async (
    page: Page,
    pin: AnswerPin,
    question: string,
    language: string,
    report: Report,
    draft: "question" | "pin" | undefined,
    file?: string,
  ): Promise<{ position: number; text?: string }> => {
    const fresh = freshness(page.body, pin);
    if (fresh.state === "changed") {
      summary.answers.changed += 1;
      // `fill` re-pairs a page's own question. A golden-set file's is a
      // person's to re-pin, because fill only moves its lines.
      const of = file === undefined ? "" : ` of ${file}`;
      const fix =
        file === undefined
          ? "re-pair it with manni graph fill --fields sample-questions and review it"
          : "re-pin it and review it";
      report(
        "knob",
        `lines ${spellLines(pin.lines)}${of} no longer hold the answer to "${question}" as pinned, so ${fix}.`,
        draft,
      );
      return { position: 0 };
    }
    const [range] = fresh.ranges;
    const inFile = file === undefined ? "" : ` in ${file}`;
    if (fresh.state === "current") summary.answers.current += 1;
    else summary.answers.moved += 1;
    if (fresh.state === "moved" && range) {
      report(
        "notice",
        `the answer to "${question}"${inFile} moved from lines ${spellLines(pin.lines)} to ${spellLines(range)}, so manni graph fill --fields sample-questions re-pins it.`,
        draft,
      );
    } else if (fresh.state === "ambiguous") {
      report(
        "warning",
        `the answer to "${question}"${inFile} moved, and ${matchList(fresh.ranges)}, so pin one of them by hand.`,
        draft,
      );
    }
    const text = range ? page.body.slice(range.start - 1, range.end).join("\n") : undefined;
    const nodes = await rank(language, question);
    const answering = fresh.ranges.flatMap((r) => holdersOf(page, toFileLines(r, page.bodyLine)));
    const positions = answering.map((iri) => nodes.indexOf(iri) + 1);
    // The best-ranked node that holds the answer, else the one holding its
    // first line.
    const best = positions.reduce(
      (b, p, i) => (p >= 1 && (b.p === 0 || p < b.p) ? { p, i } : b),
      { p: 0, i: 0 },
    );
    if (best.p >= 1 && best.p <= top) return { position: best.p, ...(text === undefined ? {} : { text }) };
    const holder = answering[best.i];
    if (holder !== undefined) {
      const title = holder.includes("#") ? graph.literal(holder, TITLE) : undefined;
      const target =
        file !== undefined
          ? `does not find ${describe(holder)}`
          : title === undefined
            ? "does not find this page, whose own text answers it,"
            : `does not find the section that answers it, § ${title},`;
      report("knob", `"${question}" ${target} in the top ${String(top)} (${where(best.p, nodes[0])})`, draft);
    }
    return { position: best.p, ...(text === undefined ? {} : { text }) };
  };

  /** A question that repeats over half its answer's word pairs tests matching more than finding. */
  const copies = (question: string, said: string[], report: Report, draft: "question" | undefined): void => {
    const m = said.length === 0 ? undefined : copiedPairs(question, ...said);
    if (m && m.copied / m.of > COPIED_SHARE) {
      report(
        "notice",
        `"${question}" repeats ${String(m.copied)} of its ${String(m.of)} word pairs from its answer, so it tests matching words more than finding.`,
        draft,
      );
    }
  };

  /** Every copy of every question, for duplicates: where it is asked, and its finding's home. */
  const asked: { key: string; where: string; order: number; text: string; report: Report; draft?: "question" }[] = [];

  for (const page of pages) {
    const report = reporter({ focusNode: page.doc, path: SAMPLE_QUESTION, docs: [page.path] });
    for (const [n, q] of page.questions.entries()) {
      const drafted = q.reviewed ? undefined : ("question" as const);
      if (q.reviewed) summary.reviewed += 1;
      else summary.drafted += 1;
      asked.push({ key: questionKey(q.question), where: page.path, order: n, text: q.question, report, ...(drafted ? { draft: drafted } : {}) });
      if (q.answers.length === 0) summary.answers.unpinned += 1;
      const tests: number[] = [];
      // 0086's test: an unpinned question, or a confirmed one whose every
      // pin is still a draft, must find the page itself. A drafted question
      // with any pin skips it and goes straight to the pin checks, which
      // report at notice through `drafted`.
      if (q.answers.length === 0 || (q.reviewed && q.answers.every((a) => !a.reviewed))) {
        const nodes = await rank(page.language, q.question);
        const pagesFound = [...new Set(nodes.map(pageOf))];
        const position = pagesFound.indexOf(page.doc) + 1;
        tests.push(position);
        if (position < 1 || position > top) {
          report(
            "knob",
            `"${q.question}" does not find this page in the top ${String(top)} (${where(position, pagesFound[0])})`,
            drafted,
          );
        }
      }
      const said: string[] = [];
      for (const pin of q.answers) {
        const draft = drafted ?? (pin.reviewed ? undefined : "pin");
        summary.answers.pinned += 1;
        if (draft) summary.answers.unreviewed += 1;
        const { position, text } = await askPin(page, pin, q.question, page.language, report, draft);
        if (text !== undefined) said.push(text);
        // A drafted pin on a confirmed question is reported, not counted.
        if (draft !== "pin") tests.push(position);
      }
      copies(q.question, said, report, drafted);
      tally(q.reviewed, tests);
    }
  }

  for (const set of sets) {
    for (const [n, q] of set.questions.entries()) {
      const report = reporter({ focusNode: `${set.label}:${String(q.line)}`, docs: [set.label] });
      const drafted = q.reviewed ? undefined : ("question" as const);
      if (q.reviewed) summary.reviewed += 1;
      else summary.drafted += 1;
      asked.push({ key: questionKey(q.question), where: set.label, order: n, text: q.question, report, ...(drafted ? { draft: drafted } : {}) });
      // A known gap: search has no score floor, so "finds nothing" is no test.
      if (q.answers.length === 0) {
        summary.gaps += 1;
        continue;
      }
      const [firstAnswer] = q.answers;
      const firstPage = firstAnswer && pageAt(resolve(configDir, firstAnswer.file));
      const language =
        q.language !== undefined ? canonicalLanguageTag(q.language) : (firstPage?.language ?? UNDETERMINED);
      const tests: number[] = [];
      const said: string[] = [];
      for (const pin of q.answers) {
        const draft = drafted ?? (pin.reviewed ? undefined : "pin");
        summary.answers.pinned += 1;
        if (draft) summary.answers.unreviewed += 1;
        const abs = resolve(configDir, pin.file);
        const page = pageAt(abs);
        if (page === undefined) {
          if (existsSync(abs)) {
            // On disk, but in no collection the graph was built from.
            const nodes = await rank(language, q.question);
            report("knob", `"${q.question}" does not find ${pin.file} in the top ${String(top)} (${where(0, nodes[0])})`, draft);
          } else {
            summary.answers.changed += 1;
            report(
              "knob",
              `${pin.file}, which holds the answer to "${q.question}", does not exist, so re-pin or remove the question.`,
              draft,
            );
          }
          if (draft !== "pin") tests.push(0);
          continue;
        }
        const { position, text } = await askPin(page, pin, q.question, language, report, draft, pin.file);
        if (text !== undefined) said.push(text);
        if (draft !== "pin") tests.push(position);
      }
      copies(q.question, said, report, drafted);
      tally(q.reviewed, tests);
    }
  }

  // Duplicates: each copy after the first, in path order, names the first.
  asked.sort((a, b) => byCodeUnit(a.where, b.where) || a.order - b.order);
  const firstAt = new Map<string, string>();
  for (const copy of asked) {
    if (copy.key === "") continue;
    const first = firstAt.get(copy.key);
    if (first === undefined) firstAt.set(copy.key, copy.where);
    else copy.report("knob", `"${copy.text}" is also asked on ${first}, so keep it where it is answered.`, copy.draft);
  }

  // The rate gate. questions.severity does not touch it.
  const threshold = settings.foundThreshold;
  const { inTop, of } = summary.found.reviewed;
  if (threshold !== null && of > 0 && (inTop / of) * 100 < threshold) {
    findings.push({
      severity: "error",
      message: `${String(inTop)} of ${String(of)} reviewed questions are found in the top ${String(top)} (${String(percent(inTop, of))}%), under the ${String(threshold)}% that graph.check.questions.foundThreshold asks for.`,
      focusNode: "questions",
      docs: [],
    });
  }
  return { findings, summary };
}
