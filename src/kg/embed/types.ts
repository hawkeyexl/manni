/**
 * The embedder seam (ADR 01020). Platform-neutral and dependency-free, so the
 * runtime and the CLI can both speak it without either pulling in a model.
 *
 * Everything that computes embeddings — the local transformers.js embedder, the
 * deterministic mock, or a host's own — implements `Embedder`.
 */

export interface Embedder {
  /** Stable identity of the model; recorded in the sidecar header. */
  readonly model: string;
  /** Weight quantization the vectors were produced under. */
  readonly dtype: string;
  /** Output dimensions. Never assumed by callers — always read from here. */
  readonly dims: number;
  /**
   * Embed one text. Single-text rather than batched **on purpose**: float
   * addition is not associative, so a batched vector depends on what it was
   * batched with, and adding one document would perturb its neighbours' vectors
   * (ADR 01020). Determinism is worth more here than throughput.
   */
  embed(text: string): Promise<Float32Array>;
}

/**
 * A model's quirks, applied on both the build and query sides so a user cannot
 * get them wrong. Some models require a prefix on queries and/or passages and
 * degrade *silently* without it.
 */
export interface ModelProfile {
  /** Hugging Face repo id. */
  id: string;
  /** Prepended when embedding a search query. */
  queryPrefix?: string;
  /** Prepended when embedding indexed content. */
  passagePrefix?: string;
  /** Human note surfaced in docs and `--help`. */
  note?: string;
}

/** What a text is being embedded *for* — decides which prefix applies. */
export type EmbedRole = "query" | "passage";

/**
 * Models dockg has been tested against. This is the *tested* set, not the
 * permitted set: `embed.model` accepts any id, and an unknown one is used
 * as-is with no prefixes.
 */
export const MODEL_PROFILES: readonly ModelProfile[] = [
  {
    id: "onnx-community/granite-embedding-small-english-r2-ONNX",
    note: "Default. 384-d, 8192-token context so sections are never truncated; no prefixes.",
  },
  {
    id: "Xenova/gte-small",
    note: "Lighter (~34 MB). 384-d, 512-token context; no prefixes.",
  },
  {
    id: "Xenova/bge-small-en-v1.5",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    note: "384-d. Needs a query prefix — applied automatically here, since omitting it degrades retrieval silently.",
  },
  {
    id: "Xenova/all-MiniLM-L6-v2",
    note: "Smallest (~23 MB) but truncates at 256 wordpieces (~190 words), so long sections lose their tail.",
  },
];

export const DEFAULT_MODEL = MODEL_PROFILES[0]!.id;

/** The profile for a model id, or a bare profile when it is not a tested one. */
export function profileFor(id: string): ModelProfile {
  return MODEL_PROFILES.find((p) => p.id === id) ?? { id };
}

/** Apply the model's prefix convention for the role, if it has one. */
export function withPrefix(
  profile: ModelProfile,
  role: EmbedRole,
  text: string,
): string {
  const prefix = role === "query" ? profile.queryPrefix : profile.passagePrefix;
  return prefix ? `${prefix}${text}` : text;
}
