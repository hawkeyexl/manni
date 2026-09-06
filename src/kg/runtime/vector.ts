/**
 * Vector search (ADR 01020) — semantic entry, and a standalone capability.
 *
 * `search()` is usable on its own: give it a query vector and it ranks nodes by
 * meaning, with no lexical index and no graph involved. `findEntry` composes it
 * with the lexical leg, but does not own it.
 *
 * Hand-written rather than taken from a library, on evidence: the dedicated
 * browser vector libraries are 3 years stale, no maintained micro-package does
 * cosine top-k over typed arrays (the popular one throws on `Float32Array`), and
 * the engines that do exist run this same brute-force loop internally. See ADR
 * 01020 for the full survey.
 *
 * Vectors are L2-normalized at build time, so cosine similarity **is** the dot
 * product — no norms, no division, at query time. The loop is indexed rather
 * than `.reduce()`, which measures ~13× slower on typed arrays.
 *
 * Platform-neutral: no `node:` imports, no dependencies.
 */
import { byCodeUnit } from "../core/sort.js";
import {
  decodeVectorIndex,
  normalize,
  type VectorIndexHeader,
} from "../core/vector-index.js";
import type { EntryCandidate } from "./trace.js";

export interface VectorSearchOptions {
  /** Maximum candidates to return. Default 10. */
  limit?: number;
  /**
   * Drop candidates scoring below this. Default 0 — every model has its own
   * useful range, so dockg does not impose a threshold the user did not choose.
   */
  minScore?: number;
}

/** Why a vector index cannot be used with the embedder or corpus at hand. */
export interface VectorMismatch {
  reason: "model" | "dtype" | "dims" | "stale-source";
  detail: string;
}

/**
 * Thrown when a query would be ranked against vectors it cannot be compared to.
 *
 * A distinct type so hosts can catch exactly this — and so it cannot be mistaken
 * for "no results". Ranking on regardless is the silent-wrong-answer failure
 * ADR 01020 exists to prevent, so this is loud by design.
 */
export class VectorMismatchError extends Error {
  readonly reason: VectorMismatch["reason"];
  constructor(mismatch: VectorMismatch) {
    super(mismatch.detail);
    this.name = "VectorMismatchError";
    this.reason = mismatch.reason;
  }
}

/**
 * The digest `manni kg embed` records as a sidecar's `source`, computed the same
 * way in a browser — SHA-256 over the **raw bytes of `search.json` exactly as
 * fetched**, hex, prefixed `sha256:`.
 *
 * Exists so a host can pass `source` to `findEntry` and get the staleness half
 * of the refusal (ADR 01020) without reconstructing the recipe. Re-serializing
 * the parsed JSON would change the bytes and so the digest — pass the response
 * text, not `JSON.stringify(doc)`.
 *
 * Uses Web Crypto, which is platform-neutral: browsers and Node 18+ both have
 * it on `globalThis`.
 */
export async function searchIndexDigest(raw: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "searchIndexDigest needs Web Crypto (globalThis.crypto.subtle), which is unavailable here — a page served over plain HTTP does not get it.",
    );
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

export interface VectorIndex {
  /**
   * Rank nodes against a query vector. The vector is normalized here, so
   * callers need not — an unnormalized query would otherwise scale every score.
   */
  search(query: Float32Array, options?: VectorSearchOptions): EntryCandidate[];
  /**
   * Check this index against the embedder and corpus in play. Returns the
   * mismatch, or undefined when they agree. Ranking against vectors from a
   * different model compares outputs of two different functions (ADR 01020), so
   * callers should refuse rather than proceed.
   */
  check(expected: {
    model?: string;
    dtype?: string;
    dims?: number;
    source?: string;
  }): VectorMismatch | undefined;
  readonly model: string;
  /**
   * Weight quantization the corpus vectors were produced under. The query side
   * must embed at the *same* dtype — q8 and fp32 weights are different
   * functions, so mixing them compares incomparable vectors (ADR 01020).
   */
  readonly dtype: string;
  readonly dims: number;
  readonly source: string;
  size(): number;
  /** The IRI at a payload row, for callers walking the index directly. */
  idAt(row: number): string | undefined;
}

/** Build a vector index from encoded sidecar bytes. */
export function createVectorIndex(bytes: Uint8Array): VectorIndex {
  const { header, vectors } = decodeVectorIndex(bytes);
  const { dims, ids } = header;

  return {
    model: header.model,
    dtype: header.dtype,
    dims,
    source: header.source,
    size: () => ids.length,
    idAt: (row) => ids[row],

    check(expected) {
      if (expected.model !== undefined && expected.model !== header.model) {
        return {
          reason: "model",
          detail: `Vector index was built with ${header.model}, but the embedder is ${expected.model}. Re-run \`manni kg embed\`.`,
        };
      }
      if (expected.dtype !== undefined && expected.dtype !== header.dtype) {
        return {
          reason: "dtype",
          detail: `Vector index was built at dtype ${header.dtype}, but the embedder is at ${expected.dtype} — different weights are a different function. Re-run \`manni kg embed\`.`,
        };
      }
      if (expected.dims !== undefined && expected.dims !== dims) {
        return {
          reason: "dims",
          detail: `Vector index has ${dims} dimensions, but the embedder produces ${expected.dims}.`,
        };
      }
      if (expected.source !== undefined && expected.source !== header.source) {
        return {
          reason: "stale-source",
          detail:
            "Vector index was built from a different search index — the corpus changed. Re-run `manni kg embed`.",
        };
      }
      return undefined;
    },

    search(query, options = {}) {
      if (dims === 0 || ids.length === 0) return [];
      if (query.length !== dims) {
        // A silent zero-fill or truncate here would return confident nonsense.
        // Typed like every other mismatch so a caller (and the CLI's exit-code
        // mapping) handles it the same way rather than seeing a raw stack.
        throw new VectorMismatchError({
          reason: "dims",
          detail: `Query vector has ${query.length} dimensions, but the index has ${dims}.`,
        });
      }
      const limit = normalizeLimit(options.limit);
      if (limit === 0) return [];
      const minScore = options.minScore ?? 0;

      // Copy before normalizing: the caller's vector is not ours to mutate.
      const q = normalize(Float32Array.from(query));

      const scored: EntryCandidate[] = [];
      for (let row = 0; row < ids.length; row++) {
        const base = row * dims;
        let score = 0;
        for (let i = 0; i < dims; i++) score += q[i]! * vectors[base + i]!;
        if (score >= minScore) {
          scored.push({ iri: ids[row]!, score, via: "vector" });
        }
      }

      scored.sort((a, b) =>
        a.score === b.score ? byCodeUnit(a.iri, b.iri) : b.score - a.score,
      );
      return scored.slice(0, limit);
    },
  };
}

/**
 * A limit that is not a non-negative integer falls back to the documented
 * default — `slice(0, NaN)` is empty, which would report a confident "no
 * results" for a query that does match.
 */
function normalizeLimit(limit: number | undefined): number {
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0
    ? limit
    : 10;
}

export type { VectorIndexHeader };
