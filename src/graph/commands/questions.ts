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
import { readSampleQuestions, type AnswerPin, type SampleQuestion } from "../core/questions.js";
import {
  buildSearchIndex,
  emitSearchIndex,
  partitionByLanguage,
  type SearchIndexDoc,
} from "../core/search-index.js";
import type { CheckFinding } from "../core/shacl.js";
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
function sectionSpans(
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

/** Where a pin's lines are now, judged against the page as it reads today. */
type Freshness =
  | { state: "current" | "moved" | "ambiguous"; ranges: PageLines[] }
  | { state: "changed" };

function freshness(body: readonly string[], pin: AnswerPin): Freshness {
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
function matchList(ranges: readonly PageLines[]): string {
  const spelled = ranges.map(spellLines);
  const last = spelled.pop() ?? "";
  const both = spelled.length === 1 ? "both" : "all";
  return `lines ${spelled.join(", ")} and ${last} ${both} match`;
}

/** Reads each page's questions, and the source a page's pins are counted in. */
async function readPages(
  graph: GraphIndex,
  sources: string,
  view: { source: MetaViewSource; cwd: string },
): Promise<{ pages: Page[]; contents: Map<string, string> }> {
  const contents = new Map<string, string>();
  const onDisk: { doc: string; path: string }[] = [];
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
    if (questions.length === 0) continue;
    // HTML and XML carry their metadata inside the body, so body line 1 is
    // file line 1, as cite counts it.
    const bodyLine =
      format === "html" || format === "xml"
        ? 1
        : bodyLineOf(content, locateFrontmatter(content)?.closeEnd ?? 0);
    const tag = graph.literal(doc, LANGUAGE);
    pages.push({
      doc,
      path,
      language: tag === undefined ? UNDETERMINED : canonicalLanguageTag(tag),
      bodyLine,
      body: splitLines(content).slice(bodyLine - 1),
      sections: sectionSpans(graph, doc, path, content, sectionsOf.get(doc) ?? []),
      questions,
    });
  }
  return { pages, contents };
}

/**
 * The findings for every page's sample questions. `sources` is where each
 * page's `graph:path` resolves from, `indexDir` is where a vector sidecar's
 * manifest sits, and `view` is the config meta's merge reads.
 */
export async function askSampleQuestions(
  store: Store,
  settings: GraphConfig["check"]["questions"],
  sources: string,
  indexDir: string,
  view: { source: MetaViewSource; cwd: string },
): Promise<CheckFinding[]> {
  const knob = settings.severity;
  const top = settings.top;
  const graph = GraphIndex.fromQuads(storeToQuads(store), Object.fromEntries(PREFIXES));
  const { pages, contents } = await readPages(graph, sources, view);
  if (pages.length === 0) return [];

  // Built on first use: a run at severity off asks nothing.
  let byLanguage: Map<string, SearchIndexDoc> | undefined;
  let manifest: LocalizationEntry[] = [];
  const retrievers = new Map<string, Retriever>();
  const ranked = new Map<string, string[]>();
  const rank = async (page: Page, question: string): Promise<string[]> => {
    const key = JSON.stringify([page.language, question]);
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
    let retriever = retrievers.get(page.language);
    if (!retriever) {
      retriever = await openRetriever(
        byLanguage.get(page.language) ?? { version: 1, entries: [] },
        manifest.find((l) => canonicalLanguageTag(l.language) === page.language),
        indexDir,
      );
      retrievers.set(page.language, retriever);
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
  for (const page of pages) {
    /**
     * A finding on this page. `knob` findings take `questions.severity` and
     * vanish at `off`. A draft reports at notice, said so at the end.
     */
    const report = (
      kind: "knob" | Severity,
      message: string,
      draft?: "question" | "pin",
    ): void => {
      const level = kind === "knob" ? knob : kind;
      if (level === "off") return;
      const severity: Severity = draft ? "notice" : level;
      const suffix =
        draft === "question" ? " (drafted, not reviewed)" : draft === "pin" ? " (answer not reviewed)" : "";
      findings.push({
        severity,
        message: `${message}${suffix}`,
        focusNode: page.doc,
        path: SAMPLE_QUESTION,
        docs: [page.path],
      });
    };

    /** The nodes whose own text holds any of `lines`, in file lines. */
    const holders = (lines: PageLines): string[] => {
      const out = page.sections
        .filter(({ span }) => span.start <= lines.end && lines.start <= span.end)
        .map(({ iri }) => iri);
      for (let line = lines.start; line <= lines.end; line++) {
        if (!page.sections.some(({ span }) => span.start <= line && line <= span.end)) {
          return [page.doc, ...out];
        }
      }
      return out;
    };

    for (const q of page.questions) {
      const drafted = q.reviewed ? undefined : ("question" as const);
      // 0086's test: an unpinned question, or a confirmed one whose every
      // pin is still a draft, must find the page itself.
      const pageTest =
        q.answers.length === 0 || (q.reviewed && q.answers.every((a) => !a.reviewed));
      if (pageTest && knob !== "off") {
        const nodes = await rank(page, q.question);
        const pagesFound = [...new Set(nodes.map(pageOf))];
        const position = pagesFound.indexOf(page.doc) + 1;
        if (position < 1 || position > top) {
          const first = pagesFound[0];
          report(
            "knob",
            `"${q.question}" does not find this page in the top ${String(top)} (${where(position, first)})`,
            drafted,
          );
        }
      }

      for (const pin of q.answers) {
        const draft = drafted ?? (pin.reviewed ? undefined : "pin");
        const fresh = freshness(page.body, pin);
        if (fresh.state === "changed") {
          report(
            "knob",
            `lines ${spellLines(pin.lines)} no longer hold the answer to "${q.question}" as pinned, so re-pin it and review it.`,
            draft,
          );
          continue;
        }
        const [moved] = fresh.ranges;
        if (fresh.state === "moved" && moved) {
          report(
            "notice",
            `the answer to "${q.question}" moved from lines ${spellLines(pin.lines)} to ${spellLines(moved)}, so update its lines.`,
            draft,
          );
        } else if (fresh.state === "ambiguous") {
          report(
            "warning",
            `the answer to "${q.question}" moved, and ${matchList(fresh.ranges)}, so pin one of them by hand.`,
            draft,
          );
        }
        if (knob === "off") continue;

        const nodes = await rank(page, q.question);
        const answering = fresh.ranges.flatMap((r) => holders(toFileLines(r, page.bodyLine)));
        const positions = answering.map((iri) => nodes.indexOf(iri) + 1);
        if (positions.some((p) => p >= 1 && p <= top)) continue;
        // Name the best-ranked node that holds the answer, else the one
        // holding its first line.
        const best = positions.reduce(
          (b, p, i) => (p >= 1 && (b.p === 0 || p < b.p) ? { p, i } : b),
          { p: 0, i: 0 },
        );
        const holder = answering[best.i];
        if (holder === undefined) continue;
        const title = holder.includes("#") ? graph.literal(holder, TITLE) : undefined;
        const target =
          title === undefined
            ? "does not find this page, whose own text answers it,"
            : `does not find the section that answers it, § ${title},`;
        report(
          "knob",
          `"${q.question}" ${target} in the top ${String(top)} (${where(best.p, nodes[0])})`,
          draft,
        );
      }
    }
  }
  return findings;
}
