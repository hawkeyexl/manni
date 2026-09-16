/**
 * `manni kg embed` — compute vectors for the search index (ADR 01020).
 *
 * Embeds the text already in `kg/search.<lang>.json` rather than re-reading
 * markdown: vectors then cover exactly what the lexical index covers, with the
 * Phase 8 granularity rule already applied, so both ranking legs score the same
 * units.
 *
 * One sidecar per language, driven by the localization manifest and embedded
 * with that language's model (ADR 01038) — a German corpus under an
 * English-only model returns confident, meaningless vectors and fails nothing.
 *
 * This is the one dockg command that needs a model. It is local — no API, no
 * key, no spend — but the weights are a download, so unlike every other
 * artifact the sidecars cannot be regenerated in CI from a real model.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadConfig } from "../core/config.js";
import { type SearchEntry, type SearchIndexDoc } from "../core/search-index.js";
import {
  emitLocalizations,
  LOCALIZATIONS_FILENAME,
  parseLocalizations,
  vectorIndexFilename,
  type LocalizationEntry,
} from "../core/localizations.js";
import { encodeVectorIndex } from "../core/vector-index.js";
import { DockgError } from "../types.js";
import {
  createLocalEmbedder,
  EmbedderUnavailableError,
} from "../embed/local.js";
import { createMockEmbedder } from "../embed/mock.js";
import type { Embedder } from "../embed/types.js";

export interface EmbedOptions {
  config?: string;
  /** Graph .ttl path (default: config `out`) — locates the sibling index. */
  graph?: string;
  /** Directory holding the indexes and manifest (default: beside the graph). */
  index?: string;
  /** Directory to write the sidecars into (default: the index directory). */
  out?: string;
  model?: string;
  dtype?: string;
  /** Skip the vector cache. */
  noCache?: boolean;
  /** Injection seam for tests: bypasses the embedder factory. */
  embedder?: Embedder;
  cwd?: string;
}

/** One language's sidecar, as this run produced it. */
export interface EmbedLanguageReport {
  language: string;
  outPath: string;
  /** The model this language was embedded with, after the per-language override. */
  model: string;
  dims: number;
  /** Entries embedded this run (cache misses). */
  embedded: number;
  /** Entries served from cache. */
  cached: number;
  total: number;
}

export interface EmbedReport {
  /** The manifest, rewritten with each language's `vectors` block. */
  manifestPath: string;
  /** One entry per language in the manifest, in its order. */
  languages: EmbedLanguageReport[];
  /** Totals across every language. */
  embedded: number;
  cached: number;
  total: number;
}

/** The text an entry contributes to its vector — same fields the lexical index scores. */
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

async function makeEmbedder(
  opts: EmbedOptions,
  model: string,
  dtype: string,
): Promise<Embedder> {
  if (opts.embedder) return opts.embedder;
  // `--model mock` keeps the CLI exercisable offline, mirroring `fill`'s mock
  // provider. It produces hash-derived vectors with no semantics.
  if (model === "mock") return createMockEmbedder({ dtype });
  try {
    return await createLocalEmbedder({ model, dtype, role: "passage" });
  } catch (e) {
    if (e instanceof EmbedderUnavailableError) {
      throw new DockgError(e.message);
    }
    // Everything else the model stack can fail on — an unknown id, a 404 on the
    // hub, corrupt weights — is operational (exit 2), not a raw stack trace.
    throw new DockgError(
      `Failed to load embedding model ${model}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function runEmbed(opts: EmbedOptions = {}): Promise<EmbedReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const graphPath = resolve(cwd, opts.graph ?? config.out);
  // The manifest is the work list: `export --format search` wrote one index per
  // language and named them all here, so embed never has to guess which files
  // exist or what language each holds (ADR 01038).
  const indexDir = opts.index ? resolve(cwd, opts.index) : dirname(graphPath);
  const manifestPath = join(indexDir, LOCALIZATIONS_FILENAME);

  if (!existsSync(manifestPath)) {
    throw new DockgError(
      `Localization manifest not found: ${manifestPath} — run \`manni kg export --format search\` first.`,
    );
  }
  const manifest = parseLocalizations(readFileSync(manifestPath, "utf8"));
  if (!manifest) {
    throw new DockgError(
      `Not a dockg localization manifest: ${manifestPath} — re-run \`manni kg export --format search\`.`,
    );
  }

  const outDir = opts.out ? resolve(cwd, opts.out) : indexDir;
  mkdirSync(outDir, { recursive: true });
  const cache = new VectorCache(
    resolve(cwd, config.embed.cacheDir),
    !opts.noCache,
  );

  // One embedder per (model, dtype), built on the first cache miss that needs
  // it: `pipeline()` downloads tens of megabytes of weights, and a run that is
  // entirely cache hits has no reason to pay for it — for any language.
  const embedders = new Map<string, Promise<Embedder>>();
  const getEmbedder = (model: string, dtype: string): Promise<Embedder> => {
    // JSON, not a joined string: no separator can collide, and no NUL byte
    // enters the source (CLAUDE.md's no-NUL invariant), which is the same
    // reason the vector cache key below is JSON.
    const key = JSON.stringify([model, dtype]);
    const existing = embedders.get(key);
    if (existing) return existing;
    const built = makeEmbedder(opts, model, dtype);
    embedders.set(key, built);
    return built;
  };

  const languages: EmbedLanguageReport[] = [];
  const updated: LocalizationEntry[] = [];

  for (const entry of manifest.languages) {
    const indexPath = join(indexDir, entry.search.path);
    if (!existsSync(indexPath)) {
      throw new DockgError(
        `Search index not found: ${indexPath} — the manifest names it; re-run \`manni kg export --format search\`.`,
      );
    }
    const raw = readFileSync(indexPath, "utf8");
    const source = `sha256:${sha256(raw)}`;
    // The manifest records the digest of the file it wrote. A mismatch means
    // the pair has drifted, and embedding it would produce a sidecar keyed to
    // bytes nobody has — the same refusal the runtime makes at query time.
    if (entry.search.digest !== source) {
      throw new DockgError(
        `Stale manifest: ${entry.search.path} does not match the digest recorded for "${entry.language}" — re-run \`manni kg export --format search\`.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new DockgError(
        `Failed to parse ${indexPath}: ${e instanceof Error ? e.message : "parse error"} — re-run \`manni kg export --format search\`.`,
      );
    }
    const entries = (parsed as SearchIndexDoc | null)?.entries;
    if (!Array.isArray(entries)) {
      throw new DockgError(
        `Not a dockg search index: ${indexPath} — expected an \`entries\` array.`,
      );
    }

    // Per-language model, then the flags, then the corpus-wide default. A
    // German corpus embedded with an English-only model returns confident,
    // meaningless vectors and fails nothing, so this override is the whole
    // reason the fan-out exists.
    const perLanguage = config.embed.byLanguage[entry.language];
    const model = opts.model ?? perLanguage?.model ?? config.embed.model;
    const dtype = opts.dtype ?? perLanguage?.dtype ?? config.embed.dtype;
    const identity = opts.embedder
      ? { model: opts.embedder.model, dtype: opts.embedder.dtype }
      : { model, dtype };

    const vectors: Array<{ id: string; vector: Float32Array }> = [];
    let embedded = 0;
    let cached = 0;

    for (const item of entries) {
      const text = embedText(item);
      if (text === "") continue;
      // JSON rather than a joined string: no separator can collide with
      // content, and no NUL byte enters the source (a NUL makes git classify
      // the file as binary — the no-NUL-bytes invariant in CLAUDE.md).
      const key = sha256(
        JSON.stringify([identity.model, identity.dtype, text]),
      );
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

    const filename = vectorIndexFilename(entry.language);
    const outPath = join(outDir, filename);
    // What the manifest records is relative to the manifest, not to wherever
    // `-o` happened to point — so a sidecar written outside the index
    // directory is still findable from the file that names it. Forward slashes
    // because this is a JSON artifact a browser resolves against a URL.
    const manifestRelative = relative(indexDir, outPath).split(sep).join("/");
    writeFileSync(
      outPath,
      encodeVectorIndex(vectors, {
        model: identity.model,
        dtype: identity.dtype,
        source,
        language: entry.language,
      }),
    );

    const dims = vectors[0]?.vector.length ?? 0;
    languages.push({
      language: entry.language,
      outPath,
      model: identity.model,
      dims,
      embedded,
      cached,
      total: vectors.length,
    });
    updated.push({
      ...entry,
      vectors: {
        path: manifestRelative,
        model: identity.model,
        dtype: identity.dtype,
        dims,
        count: vectors.length,
      },
    });
  }

  // Rewritten so the manifest describes what is actually on disk: an entry
  // without a `vectors` block means that language has no sidecar yet.
  writeFileSync(
    manifestPath,
    emitLocalizations({ version: 1, languages: updated }),
    "utf8",
  );

  return {
    manifestPath,
    languages,
    embedded: languages.reduce((n, l) => n + l.embedded, 0),
    cached: languages.reduce((n, l) => n + l.cached, 0),
    total: languages.reduce((n, l) => n + l.total, 0),
  };
}

export function renderEmbed(
  report: EmbedReport,
  format: "pretty" | "json",
): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines = report.languages.map(
    (l) =>
      `  ${l.language}: ${l.total} vector${l.total === 1 ? "" : "s"} (${l.dims}-d, ${l.model}) -> ${l.outPath}`,
  );
  if (lines.length === 0) lines.push("  (no languages in the manifest)");
  const n = report.languages.length;
  return [
    // Not "beside": `-o` may put the sidecars in a different directory from
    // the manifest, and each line below names the path it actually wrote.
    `Wrote ${n} sidecar${n === 1 ? "" : "s"}, recorded in ${report.manifestPath}`,
    ...lines,
    `  ${report.embedded} embedded, ${report.cached} from cache`,
  ].join("\n");
}
