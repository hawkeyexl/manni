/**
 * A deterministic offline embedder (ADR 01020) — the counterpart to
 * `MockProvider` for the LLM seam.
 *
 * CI must stay hermetic: real embedding downloads tens of megabytes of model
 * weights, which the no-network rule forbids. This produces vectors from a hash
 * of the text, so they are stable across runs, machines, and platforms — which
 * makes the `vectors.bin` golden and the double-build determinism gate possible
 * without a model.
 *
 * The vectors carry no semantics. They are useful for testing plumbing,
 * ordering, and refusal paths — never for judging retrieval quality.
 *
 * Platform-neutral: no `node:` imports, no dependencies.
 */
import type { Embedder } from "./types.js";

/** FNV-1a, 32-bit. Small, fast, and identical everywhere. */
function fnv1a(text: string, seed: number): number {
  let hash = (0x81_1c_9d_c5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash ^ text.charCodeAt(i)) >>> 0;
    // hash *= 16777619, via shifts to stay in 32-bit integer range.
    hash =
      (hash +
        ((hash << 1) +
          (hash << 4) +
          (hash << 7) +
          (hash << 8) +
          (hash << 24))) >>>
      0;
  }
  return hash >>> 0;
}

export interface MockEmbedderOptions {
  /** Output dimensions. Default 8 — small keeps fixtures readable. */
  dims?: number;
  /** Reported model id. Default "mock". */
  model?: string;
  /** Reported dtype. Default "mock". */
  dtype?: string;
}

/**
 * Build a deterministic embedder. The same text always yields the same vector;
 * different texts yield different ones with high probability.
 */
export function createMockEmbedder(
  options: MockEmbedderOptions = {},
): Embedder {
  const dims = options.dims ?? 8;
  const model = options.model ?? "mock";
  const dtype = options.dtype ?? "mock";

  return {
    model,
    dtype,
    dims,
    embed(text: string): Promise<Float32Array> {
      const vector = new Float32Array(dims);
      for (let i = 0; i < dims; i++) {
        // Map each hash into [-1, 1) so vectors spread over the sphere rather
        // than crowding one orthant.
        vector[i] = (fnv1a(text, i) / 0x1_00_00_00_00) * 2 - 1;
      }
      return Promise.resolve(vector);
    },
  };
}
