/**
 * `manni kg search` — text query → ranked seed nodes (ADR 01019).
 *
 * A thin Node wrapper over the browser-native lexical entry stage: it loads the
 * `search.json` artifact and runs the same `findEntry` a browser would. This is
 * the stage before `traverse`; Phase 9's `retrieve` chains the two.
 *
 * The trace is always in the JSON output — retrieval provenance is part of the
 * contract, not an opt-in (ADR 01018).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../core/config.js";
import { compactIri } from "../core/load.js";
import { type SearchIndexDoc } from "../core/search-index.js";
import {
  LOCALIZATIONS_FILENAME,
  parseLocalizations,
  type LocalizationEntry,
} from "../core/localizations.js";
import { VectorIndexError } from "../core/vector-index.js";
import { DockgError } from "../types.js";
import { programName } from "../../shared/program-name.js";
import { findEntry } from "../runtime/entry.js";
import { createLexicalIndex } from "../runtime/lexical.js";
import {
  createVectorIndex,
  VectorMismatchError,
  type VectorIndex,
} from "../runtime/vector.js";
import {
  createLocalEmbedder,
  EmbedderUnavailableError,
} from "../embed/local.js";
import { createMockEmbedder } from "../embed/mock.js";
import type { Embedder } from "../embed/types.js";
import type { QueryTrace } from "../runtime/trace.js";

export interface SearchOptions {
  config?: string;
  /** Graph .ttl path (default: config `out`) — locates the sibling index. */
  graph?: string;
  /** Directory holding the indexes and manifest (default: beside the graph). */
  index?: string;
  /**
   * Which localization to search (ADR 01038). Optional when the corpus has one;
   * required when it has more, because picking for the user is how a query gets
   * answered out of the wrong language.
   */
  lang?: string;
  query: string;
  limit?: number;
  /** Vector sidecar path (default: config `embed.out` when it exists). */
  vectors?: string;
  /**
   * Which legs to run. "lexical" is always available; "vector"/"hybrid" need an
   * embedder and a sidecar. Default "hybrid" when both are present, else
   * "lexical" — additive, never a new failure mode.
   */
  mode?: "lexical" | "vector" | "hybrid";
  /** Injection seam for tests: bypasses the embedder factory. */
  embedder?: Embedder;
  cwd?: string;
}

export interface SearchHit {
  iri: string;
  score: number;
  via: string;
  type?: string;
  title?: string;
}

export interface SearchReport {
  query: string;
  /** Which legs actually ran. */
  mode: "lexical" | "vector" | "hybrid";
  /** The fused ranking (or the single leg's, when only one ran). */
  results: SearchHit[];
  /** The lexical leg's own ranking. */
  lexical: SearchHit[];
  /** The vector leg's own ranking; empty when it did not run. */
  vector: SearchHit[];
  trace: QueryTrace;
}

/**
 * Read and shape-check the artifact. A truncated write, or `-i` pointed at the
 * wrong file, is an operational error (exit 2) like an unparseable graph — not
 * a raw stack trace, and not a confident "0 results".
 *
 * The digest travels with the document: it is what the vector sidecar records
 * as its `source`, and comparing them is how a stale sidecar is refused rather
 * than ranked against (ADR 01020).
 */
function loadSearchIndex(indexPath: string): {
  doc: SearchIndexDoc;
  source: string;
} {
  const raw = readFileSync(indexPath, "utf8");
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
      `Not a dockg search index: ${indexPath} — expected an \`entries\` array; re-run \`manni kg export --format search\`.`,
    );
  }
  return {
    doc: parsed as SearchIndexDoc,
    // Same recipe `manni kg embed` uses, so the two digests are comparable.
    source: `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`,
  };
}

/**
 * Pick the localization to search from the manifest (ADR 01038).
 *
 * With one language the choice is unambiguous and made silently. With more, an
 * unspecified `--lang` is a **refusal**, not a default: answering a German
 * question out of the English index is the failure the fan-out exists to
 * prevent, and guessing would hide it behind a confident result.
 */
function resolveLocalization(
  indexDir: string,
  lang: string | undefined,
): LocalizationEntry {
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
  const available = manifest.languages.map((l) => l.language);
  if (lang !== undefined) {
    const hit = manifest.languages.find((l) => l.language === lang);
    if (!hit) {
      throw new DockgError(
        `No index for language "${lang}" — this corpus has ${available.join(", ") || "none"}.`,
      );
    }
    return hit;
  }
  const only = manifest.languages[0];
  if (!only) {
    throw new DockgError(
      `The localization manifest lists no languages: ${manifestPath} — re-run \`manni kg export --format search\`.`,
    );
  }
  if (manifest.languages.length > 1) {
    throw new DockgError(
      `This corpus has more than one localization (${available.join(", ")}) — pass --lang to choose one.`,
    );
  }
  return only;
}

export async function runSearch(opts: SearchOptions): Promise<SearchReport> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const graphPath = resolve(cwd, opts.graph ?? config.out);
  const indexDir = opts.index ? resolve(cwd, opts.index) : dirname(graphPath);
  const localization = resolveLocalization(indexDir, opts.lang);
  const indexPath = join(indexDir, localization.search.path);

  if (!existsSync(indexPath)) {
    throw new DockgError(
      `Search index not found: ${indexPath} — the manifest names it; re-run \`manni kg export --format search\`.`,
    );
  }

  const { doc, source } = loadSearchIndex(indexPath);
  const lexical = createLexicalIndex(doc);

  // The vector leg is opt-in by availability: a sidecar plus an embedder. Asked
  // for explicitly (`--mode vector|hybrid`) a missing piece is an error, since
  // silently answering lexically would look like the semantic leg ran.
  // "Asked for" means an explicit `--mode vector|hybrid` *or* an explicit
  // `--vectors <path>`. A typo'd path would otherwise fall through to the
  // default-path branch, find nothing, and return lexical results with exit 0 —
  // a confident answer to a question the user did not ask.
  //
  // One predicate for both decisions. Testing `!== undefined` here while the
  // path below tested truthiness meant `--vectors ""` demanded the vector leg
  // and then resolved the *default* sidecar — failing, or answering, about a
  // file the user never named.
  const explicitVectors =
    opts.vectors !== undefined && opts.vectors !== ""
      ? opts.vectors
      : undefined;
  const wantsVector =
    opts.mode === "vector" ||
    opts.mode === "hybrid" ||
    (explicitVectors !== undefined && opts.mode !== "lexical");
  // Default to the sidecar the manifest records for *this* language, so the
  // pair can never be crossed. An entry with no `vectors` block simply has no
  // sidecar yet, and the leg stays unavailable.
  //
  // Resolved against the manifest's own directory, because that is what
  // `vectors.path` is relative to. Resolving it against `config.embed.out`
  // instead made the vector leg silently vanish for any layout where the two
  // differ — a lexical answer to a question that asked for both.
  const vectorsPath = explicitVectors
    ? resolve(cwd, explicitVectors)
    : localization.vectors
      ? resolve(indexDir, localization.vectors.path)
      : undefined;
  let vectors: VectorIndex | undefined;
  if (
    opts.mode !== "lexical" &&
    vectorsPath !== undefined &&
    existsSync(vectorsPath)
  ) {
    try {
      vectors = createVectorIndex(readFileSync(vectorsPath));
    } catch (e) {
      // A truncated write or `--vectors` pointed at the wrong file is an
      // operational error (exit 2), exactly as for the search index above —
      // not a raw VectorIndexError stack trace out of an async action.
      if (e instanceof VectorIndexError) {
        throw new DockgError(
          `${e.message} (${vectorsPath}) — re-run \`manni kg embed\`, or use \`--mode lexical\`.`,
        );
      }
      throw e;
    }
    // Refuse rather than rank: vectors built from a different corpus point at
    // IRIs that may no longer exist and miss everything added since
    // (ADR 01020, "Mismatch is refused, not ranked").
    //
    // But only refuse when the vector leg was *asked for*. A plain `dockg
    // search` that merely happens to find a stale sidecar beside the graph
    // should degrade to lexical, not fail — the leg is additive, and turning a
    // working lexical search into exit 2 is the new failure mode ADR 01009
    // forbids. Warned about rather than silently dropped, so a user who
    // expected semantic results learns why they did not get them.
    const stale = vectors.check({ source });
    if (stale && wantsVector) throw new DockgError(stale.detail);
    if (stale) {
      process.stderr.write(
        `${programName()}: ${stale.detail} Falling back to lexical.\n`,
      );
      vectors = undefined;
    }
  } else if (wantsVector) {
    // Named by the manifest when there is one to name, and by the language
    // otherwise: "no sidecar for de" is actionable, an undefined path is not.
    const named =
      vectorsPath ?? `no sidecar recorded for "${localization.language}"`;
    throw new DockgError(
      `Vector index not found: ${named} — run \`manni kg embed\` first, or use \`--mode lexical\`.`,
    );
  }

  let embedder: Embedder | undefined;
  if (vectors) {
    // Only an explicit `--mode vector|hybrid` makes a missing embedder fatal.
    // Naming a sidecar says which file to use, not that the optional
    // transformers peer must be installed — threading `wantsVector` here turned
    // `--vectors ./v.bin` on a machine without the peer from "degrade to
    // lexical, exit 0" into exit 2.
    const requireEmbedder = opts.mode === "vector" || opts.mode === "hybrid";
    embedder = await resolveEmbedder(opts, vectors, requireEmbedder);
  }

  const entry = await findEntry(opts.query, {
    lexical,
    // Pass the embedder, not a bare function: findEntry then verifies it
    // against the index itself rather than trusting the CLI to have done so.
    ...(embedder && vectors ? { vectors, embedder } : {}),
    limit: opts.limit,
  }).catch((e: unknown) => {
    // `resolveEmbedder` has already checked model and dtype, so reaching here
    // means a dimension disagreement the header did not predict — a real
    // operational error (exit 2), not a stack trace out of an async action.
    if (e instanceof VectorMismatchError) {
      throw new DockgError(`${e.message} Re-run \`manni kg embed\`.`);
    }
    throw e;
  });

  const decorate = (c: {
    iri: string;
    score: number;
    via: string;
  }): SearchHit => {
    const found = lexical.entry(c.iri);
    return {
      iri: c.iri,
      score: c.score,
      via: c.via,
      ...(found?.type === undefined ? {} : { type: found.type }),
      ...(found?.title === undefined ? {} : { title: found.title }),
    };
  };

  // Which legs *ran*, not which produced hits: a vector leg that matched
  // nothing (blank query, everything below `minScore`) still ran, and reporting
  // "lexical" for an explicit `--mode vector` would deny it ever happened. An
  // explicit mode is authoritative — the guards above already errored if it
  // could not be honored.
  const mode = opts.mode ?? (embedder && vectors ? "hybrid" : "lexical");

  // `--mode vector` reports the vector leg alone rather than the fusion.
  const results = opts.mode === "vector" ? entry.vector : entry.candidates;
  if (opts.mode === "vector") {
    // The trace is the answer to "why did these come back" (ADR 01018), so it
    // must describe the ranking actually returned, not the fusion that seeded
    // nothing in this mode.
    entry.trace.entry.length = 0;
    entry.trace.entry.push(...entry.vector);
  }

  return {
    query: opts.query,
    mode,
    results: results.map(decorate),
    lexical: entry.lexical.map(decorate),
    vector: entry.vector.map(decorate),
    trace: entry.trace,
  };
}

/**
 * Build an embedder for the query side, matching the sidecar. A mismatch is
 * refused rather than ranked against: comparing vectors from two different
 * models compares outputs of two different functions (ADR 01020).
 *
 * Both the model *and* the dtype come from the sidecar header rather than from
 * config: `embed.*` is a build-time knob, and q8 weights are a different
 * function from fp32 ones, so following config here would silently compare
 * query vectors against corpus vectors produced by different weights.
 */
async function resolveEmbedder(
  opts: SearchOptions,
  vectors: VectorIndex,
  required: boolean,
): Promise<Embedder | undefined> {
  const { model, dtype } = vectors;
  try {
    const embedder =
      opts.embedder ??
      (model === "mock"
        ? createMockEmbedder({ dtype })
        : await createLocalEmbedder({ model, dtype, role: "query" }));
    const mismatch = vectors.check({
      model: embedder.model,
      dtype: embedder.dtype,
      // Defense in depth: a future model that changes output size without
      // changing its id would otherwise only surface deep inside search().
      ...(embedder.dims > 0 ? { dims: embedder.dims } : {}),
    });
    if (mismatch) throw new DockgError(mismatch.detail);
    return embedder;
  } catch (e) {
    if (e instanceof DockgError) throw e;
    if (e instanceof EmbedderUnavailableError) {
      // Only fatal when the vector leg was asked for; otherwise degrade to
      // lexical rather than failing a search that can still be answered.
      if (required) throw new DockgError(e.message);
      return undefined;
    }
    // A model that will not load (bad id, 404, corrupt weights) is fatal either
    // way — but as an operational error with a message, not a stack trace.
    throw new DockgError(
      `Failed to load embedding model ${model}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function renderSearch(
  report: SearchReport,
  format: "pretty" | "json",
): string {
  if (format === "json") return JSON.stringify(report, null, 2);

  const lines: string[] = [];
  for (const r of report.results) {
    const label = r.title ? ` — ${r.title}` : "";
    const type = r.type ? ` [${r.type}]` : "";
    lines.push(`${r.score.toFixed(4)}  ${compactIri(r.iri)}${type}${label}`);
  }
  if (report.results.length === 0) {
    lines.push("(no matches)");
  }
  lines.push("");
  lines.push(
    `${report.results.length} result${report.results.length === 1 ? "" : "s"} (${report.mode})`,
  );
  return lines.join("\n");
}
