/**
 * Sample questions as findability checks (proposal 0085 §7), the half of
 * `manni graph check` no shape can express.
 *
 * Each `graph:sampleQuestion` is asked through the retrieval `graph search`
 * uses by default: `findEntry` over the lexical index, fused with the vector
 * leg when a sidecar and an embedder are present beside the graph. The lexical
 * index is built in memory from the graph, so no `export search` run is needed,
 * and a question is asked in its own language's index.
 *
 * It measures finding, not answering. Nothing here reaches a model beyond the
 * embedder `search` would use, and the same inputs give the same findings.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Store } from "n3";
import type { GraphConfig } from "../core/config.js";
import { compactIri, storeToQuads } from "../core/load.js";
import {
  canonicalLanguageTag,
  LOCALIZATIONS_FILENAME,
  parseLocalizations,
  UNDETERMINED,
  type LocalizationEntry,
} from "../core/localizations.js";
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
import {
  createVectorIndex,
  VectorMismatchError,
  type VectorIndex,
} from "../runtime/vector.js";
import { warn } from "../../shared/warn.js";
import { GraphError } from "../types.js";
import { resolveEmbedder } from "./search.js";

const DOCUMENT = `${NS.graph}Document`;
const PATH = `${NS.graph}path`;
export const SAMPLE_QUESTION = `${NS.graph}sampleQuestion`;
const DOCUMENT_TYPE = compactIri(DOCUMENT);
const SECTION_TYPE = compactIri(`${NS.graph}Section`);

/** One language's retrieval: the lexical leg, and the vector leg when present. */
interface Retriever {
  lexical: LexicalIndex;
  vectors?: VectorIndex;
  embedder?: Embedder;
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

/**
 * The pages a question finds, best first. A section hit counts for the page
 * that holds it, and a concept hit belongs to no page.
 */
async function rankPages(question: string, r: Retriever): Promise<string[]> {
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
  const pages = new Set<string>();
  for (const c of entry.candidates) {
    const type = r.lexical.entry(c.iri)?.type;
    if (type === DOCUMENT_TYPE) pages.add(c.iri);
    else if (type === SECTION_TYPE) pages.add(c.iri.slice(0, c.iri.indexOf("#")));
  }
  return [...pages];
}

/**
 * A finding for each sample question whose own page is not in its top
 * results. `sources` is where each page's `graph:path` resolves from, and
 * `indexDir` is where a vector sidecar's manifest sits.
 */
export async function askSampleQuestions(
  store: Store,
  settings: GraphConfig["check"]["questions"],
  sources: string,
  indexDir: string,
): Promise<CheckFinding[]> {
  const severity = settings.severity;
  if (severity === "off") return [];
  const graph = GraphIndex.fromQuads(storeToQuads(store), Object.fromEntries(PREFIXES));
  const asked = graph.instancesOf(DOCUMENT).flatMap((doc) =>
    graph
      .values(doc, SAMPLE_QUESTION)
      .flatMap((v) => (v.kind === "literal" ? [{ doc, value: v.value, tag: v.language }] : [])),
  );
  if (asked.length === 0) return [];

  const warnings: string[] = [];
  const byLanguage = partitionByLanguage(graph, buildSearchIndex(graph, sources, { warnings }));
  for (const w of warnings) warn(w);
  const manifest = readManifest(indexDir);
  const retrievers = new Map<string, Retriever>();

  const findings: CheckFinding[] = [];
  for (const { doc, value, tag } of asked) {
    const language = tag === undefined ? UNDETERMINED : canonicalLanguageTag(tag);
    let retriever = retrievers.get(language);
    if (!retriever) {
      retriever = await openRetriever(
        byLanguage.get(language) ?? { version: 1, entries: [] },
        manifest.find((l) => canonicalLanguageTag(l.language) === language),
        indexDir,
      );
      retrievers.set(language, retriever);
    }
    const pages = await rankPages(value, retriever);
    const rank = pages.indexOf(doc) + 1;
    if (rank >= 1 && rank <= settings.top) continue;
    const first = pages[0];
    const where = [
      rank === 0 ? "it is not found" : `it ranks ${String(rank)}`,
      ...(first === undefined ? [] : [`first is ${graph.literal(first, PATH) ?? first}`]),
    ].join("; ");
    const path = graph.literal(doc, PATH);
    findings.push({
      severity,
      message: `"${value}" does not find this page in the top ${String(settings.top)} (${where})`,
      focusNode: doc,
      path: SAMPLE_QUESTION,
      docs: path === undefined ? [] : [path],
    });
  }
  return findings;
}
