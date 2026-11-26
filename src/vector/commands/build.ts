/**
 * `manni vector build` (proposal 0128): read the pages, write the search
 * index and one vector sidecar per language, in one step.
 *
 * It runs graph's build in memory and graph's search index over that graph,
 * so the same pages and the same `graph:` settings give the same IRIs and
 * the same indexed text, byte for byte, that `graph export search` writes. No
 * `graph.ttl` is written. Then it embeds the text of each index (ADR 01020),
 * with that language's model (ADR 01038): a German corpus under an
 * English-only model returns confident, meaningless vectors and fails nothing.
 *
 * `graph publish` runs `embedIndex` alone, over the index it has just exported.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { buildGraph, type BuildOptions as GraphBuildOptions } from "../../graph/commands/build.js";
import { writeSearchIndex } from "../../graph/commands/export.js";
import { loadRunConfig } from "../../graph/core/config.js";
import { documentBase, parseContexts } from "../../graph/core/discover.js";
import { STDIN_PATH } from "../../graph/core/iri.js";
import { parseGraph } from "../../graph/core/load.js";
import {
  canonicalLanguageTag,
  emitLocalizations,
  LOCALIZATIONS_FILENAME,
  parseLocalizations,
  vectorIndexFilename,
  type LocalizationEntry,
} from "../../graph/core/localizations.js";
import type { SearchEntry, SearchIndexDoc } from "../../graph/core/search-index.js";
import { encodeVectorIndex } from "../../graph/core/vector-index.js";
import { createLocalEmbedder, EmbedderUnavailableError } from "../../graph/embed/local.js";
import { createMockEmbedder } from "../../graph/embed/mock.js";
import type { Embedder } from "../../graph/embed/types.js";
import { errorMessage } from "../../shared/errors.js";
import { loadVectorConfig, type VectorConfig } from "../core/config.js";
import { VectorError } from "../types.js";

export interface BuildOptions extends Omit<GraphBuildOptions, "out"> {
  /** `-o`: the directory for every file (default: the directory holding `graph.out`). */
  out?: string;
  /** `--embedding-model`: over `vector.byLanguage` and `vector.model`. */
  model?: string;
  /** `--dtype`: over `vector.byLanguage` and `vector.dtype`. */
  dtype?: string;
  /** `--no-cache`: embed every text, and cache none. */
  noCache?: boolean;
  /** Injection seam for tests: bypasses the embedder factory. */
  embedder?: Embedder;
}

/** One language's index and sidecar, as this run wrote them. */
export interface LanguageReport {
  language: string;
  searchPath: string;
  /** Entries in the language's search index. */
  entries: number;
  outPath: string;
  /** The model this language was embedded with, after the per-language override. */
  model: string;
  dims: number;
  /** Entries embedded this run (cache misses). */
  embedded: number;
  /** Entries served from cache. */
  cached: number;
  /** Vectors in the sidecar: every entry with text. */
  total: number;
}

export interface BuildReport {
  /** The manifest, every path relative to the working directory. */
  manifestPath: string;
  /** Pages the build read. */
  documents: number;
  /** Entries across every language's index. */
  entries: number;
  languages: LanguageReport[];
  embedded: number;
  cached: number;
  total: number;
  /** The build's warnings, for stderr. Not part of the printed report. */
  warnings: string[];
}

/** The text an entry contributes to its vector: the fields the lexical index scores. */
export function embedText(entry: SearchEntry): string {
  return [entry.title, entry.labels, entry.description, entry.text]
    .filter((part): part is string => part !== undefined && part !== "")
    .join("\n\n");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Per-text vector cache. Embedding is slow by construction (single-threaded
 * WASM, one text per call), so editing one section must not re-embed the corpus.
 * Keyed on text + model + dtype, so changing any of them re-embeds rather than
 * serving vectors from a different function.
 */
class VectorCache {
  constructor(
    private readonly dir: string,
    private readonly enabled: boolean,
  ) {}

  private path(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  get(key: string): Float32Array | undefined {
    if (!this.enabled) return undefined;
    const file = this.path(key);
    if (!existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as number[];
      return Array.isArray(parsed) ? Float32Array.from(parsed) : undefined;
    } catch {
      return undefined; // A corrupt entry is a miss, never a crash.
    }
  }

  set(key: string, vector: Float32Array): void {
    if (!this.enabled) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(key), JSON.stringify([...vector]), "utf8");
  }
}

async function makeEmbedder(override: Embedder | undefined, model: string, dtype: string): Promise<Embedder> {
  if (override) return override;
  // `mock` keeps the CLI exercisable offline. Hash-derived vectors, no semantics.
  if (model === "mock") return createMockEmbedder({ dtype });
  try {
    return await createLocalEmbedder({ model, dtype, role: "passage" });
  } catch (e) {
    if (e instanceof EmbedderUnavailableError) throw new VectorError(e.message);
    // An unknown id, a 404 on the hub, corrupt weights: operational, not a stack trace.
    throw new VectorError(`Failed to load embedding model ${model}: ${errorMessage(e)}`);
  }
}

export interface EmbedOptions {
  model?: string;
  dtype?: string;
  noCache?: boolean;
  embedder?: Embedder;
  cwd?: string;
}

/** What `embedIndex` wrote, every path absolute. */
export interface EmbedResult {
  manifestPath: string;
  languages: LanguageReport[];
}

/**
 * Embed every index `localizations.json` in `indexDir` names, write each
 * sidecar beside it, and rewrite the manifest with each language's `vectors`
 * block. The manifest is the work list, so this never guesses which files
 * exist or what language each holds (ADR 01038).
 */
export async function embedIndex(
  indexDir: string,
  settings: VectorConfig,
  opts: EmbedOptions = {},
): Promise<EmbedResult> {
  const cwd = opts.cwd ?? process.cwd();
  const manifestPath = join(indexDir, LOCALIZATIONS_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new VectorError(`Localization manifest not found: ${manifestPath} — run \`manni vector build\` first.`);
  }
  const manifest = parseLocalizations(readFileSync(manifestPath, "utf8"));
  if (!manifest) {
    throw new VectorError(`Not a manni graph localization manifest: ${manifestPath} — re-run \`manni vector build\`.`);
  }
  const cache = new VectorCache(resolve(cwd, settings.cacheDir), opts.noCache !== true);

  // One embedder per (model, dtype), built on the first cache miss that needs
  // it: `pipeline()` downloads tens of megabytes of weights, and a run that is
  // entirely cache hits has no reason to pay for it, for any language. JSON
  // keys, so no separator can collide and no NUL byte enters the source.
  const embedders = new Map<string, Promise<Embedder>>();
  const getEmbedder = (model: string, dtype: string): Promise<Embedder> => {
    const key = JSON.stringify([model, dtype]);
    const existing = embedders.get(key);
    if (existing) return existing;
    const built = makeEmbedder(opts.embedder, model, dtype);
    embedders.set(key, built);
    return built;
  };

  const languages: LanguageReport[] = [];
  const updated: LocalizationEntry[] = [];
  for (const entry of manifest.languages) {
    const indexPath = join(indexDir, entry.search.path);
    if (!existsSync(indexPath)) {
      throw new VectorError(`Search index not found: ${indexPath} — the manifest names it; re-run \`manni vector build\`.`);
    }
    const raw = readFileSync(indexPath, "utf8");
    const source = `sha256:${sha256(raw)}`;
    // A pair that has drifted would give a sidecar keyed to bytes nobody has:
    // the same refusal the runtime makes at query time.
    if (entry.search.digest !== source) {
      throw new VectorError(
        `Stale manifest: ${entry.search.path} does not match the digest recorded for "${entry.language}" — re-run \`manni vector build\`.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new VectorError(`Failed to parse ${indexPath}: ${errorMessage(e)} — re-run \`manni vector build\`.`);
    }
    const entries = (parsed as SearchIndexDoc | null)?.entries;
    if (!Array.isArray(entries)) {
      throw new VectorError(`Not a manni graph search index: ${indexPath} — expected an \`entries\` array.`);
    }

    // Per-language model, under the flags, over the corpus-wide default. Keys
    // match canonically, so `en-us:` configures the `en-US` index.
    const wanted = canonicalLanguageTag(entry.language);
    const perLanguage = Object.entries(settings.byLanguage).find(
      ([tag]) => canonicalLanguageTag(tag) === wanted,
    )?.[1];
    const model = opts.model ?? perLanguage?.model ?? settings.model;
    const dtype = opts.dtype ?? perLanguage?.dtype ?? settings.dtype;
    const identity = opts.embedder ? { model: opts.embedder.model, dtype: opts.embedder.dtype } : { model, dtype };

    const vectors: Array<{ id: string; vector: Float32Array }> = [];
    let embedded = 0;
    let cached = 0;
    for (const item of entries) {
      const text = embedText(item);
      if (text === "") continue;
      const key = sha256(JSON.stringify([identity.model, identity.dtype, text]));
      let vector = cache.get(key);
      if (vector) {
        cached += 1;
      } else {
        vector = await (await getEmbedder(model, dtype)).embed(text);
        cache.set(key, vector);
        embedded += 1;
      }
      vectors.push({ id: item.id, vector });
    }

    // Beside the manifest, so the path it records is the file name.
    const filename = vectorIndexFilename(entry.language);
    const outPath = join(indexDir, filename);
    writeFileSync(
      outPath,
      encodeVectorIndex(vectors, { model: identity.model, dtype: identity.dtype, source, language: entry.language }),
    );
    const dims = vectors[0]?.vector.length ?? 0;
    languages.push({
      language: entry.language,
      searchPath: indexPath,
      entries: entry.search.entries,
      outPath,
      model: identity.model,
      dims,
      embedded,
      cached,
      total: vectors.length,
    });
    updated.push({
      ...entry,
      vectors: { path: filename, model: identity.model, dtype: identity.dtype, dims, count: vectors.length },
    });
  }

  // Rewritten so the manifest describes what is on disk.
  writeFileSync(manifestPath, emitLocalizations({ version: 1, languages: updated }), "utf8");
  return { manifestPath, languages };
}

export async function runBuild(opts: BuildOptions = {}): Promise<BuildReport> {
  const cwd = opts.cwd ?? process.cwd();
  const { out, model, dtype, noCache, embedder, ...graphOptions } = opts;
  const source = {
    ...(opts.config === undefined ? {} : { configPath: opts.config }),
    ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
  };
  // Read before the build, so a bad `vector:` section costs no build.
  const settings = loadVectorConfig(source, cwd);
  const built = await buildGraph({ ...graphOptions, cwd });
  // The pages are read from where the build labelled them.
  const config = loadRunConfig(source, cwd);
  const base = documentBase(config, opts, cwd);
  const outDir = out === undefined ? dirname(built.outPath) : resolve(cwd, out);
  const index = await writeSearchIndex(parseGraph(built.turtle, "the built graph"), base, outDir, {
    context: parseContexts(config, base),
    readDoc: (path) => {
      if (path === STDIN_PATH) return opts.stdinContent;
      const abs = resolve(base, path);
      return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
    },
  });
  const embedded = await embedIndex(outDir, settings, {
    ...(model === undefined ? {} : { model }),
    ...(dtype === undefined ? {} : { dtype }),
    ...(noCache === undefined ? {} : { noCache }),
    ...(embedder === undefined ? {} : { embedder }),
    cwd,
  });

  // Relative to the working directory, and absolute when `-o` points outside it.
  const shown = (path: string): string => {
    const rel = relative(cwd, path);
    return rel.startsWith("..") || isAbsolute(rel) ? path : rel.split("\\").join("/");
  };
  const languages = embedded.languages.map((l) => ({ ...l, searchPath: shown(l.searchPath), outPath: shown(l.outPath) }));
  return {
    manifestPath: shown(embedded.manifestPath),
    documents: built.docs,
    // What the indexes hold: concepts are filed in every language (ADR 01038).
    entries: languages.reduce((n, l) => n + l.entries, 0),
    languages,
    embedded: languages.reduce((n, l) => n + l.embedded, 0),
    cached: languages.reduce((n, l) => n + l.cached, 0),
    total: languages.reduce((n, l) => n + l.total, 0),
    warnings: [...built.warnings, ...index.warnings],
  };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${String(n)} ${n === 1 ? one : many}`;

export function renderBuild(report: BuildReport, format: "pretty" | "json"): string {
  const { warnings: _warnings, ...printed } = report;
  if (format === "json") return JSON.stringify(printed, null, 2);
  const lines = report.languages.map(
    (l) => `  ${l.language}: ${plural(l.total, "vector")} (${String(l.dims)}-d, ${l.model}) -> ${l.outPath}`,
  );
  return [
    `Indexed ${plural(report.documents, "page")}: ${plural(report.entries, "entry", "entries")} in ${plural(report.languages.length, "language")}`,
    `Wrote ${plural(report.languages.length, "sidecar")}, recorded in ${report.manifestPath}`,
    ...lines,
    `  ${String(report.embedded)} embedded, ${String(report.cached)} from cache`,
  ].join("\n");
}
