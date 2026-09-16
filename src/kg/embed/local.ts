/**
 * The local embedder ([ADR 01020](../../adrs/01020-local-embeddings.md), corrected
 * by [ADR 01025](../../adrs/01025-embedder-cross-platform-reality.md)).
 *
 * Node and the browser **do not** run the same implementation, and cannot be made
 * to. transformers.js v4 takes disjoint `device` vocabularies per platform — Node
 * accepts `dml | webgpu | cpu`, the browser accepts `webgpu | wasm` — so no single
 * value selects one backend everywhere. An earlier version of this file forced
 * `device: "wasm"`, which threw on every real Node run; see ADR 01025 for the
 * measurements.
 *
 * What that costs, measured on granite q8: Node native vs browser WASM agree to
 * cosine 0.999914 (max component diff 2.2e-3). dockg's guarantee is therefore
 * **ranking agreement**, gated by `test/real/cross-platform.mjs`, not float
 * equality.
 *
 * Three disciplines are real and pinned here:
 *
 *   1. `numThreads = 1` — binds on the WASM side, where the default follows
 *      `hardwareConcurrency` and would vary reduction splits per machine. Inert
 *      on the Node side, whose env object does not carry it.
 *   2. `dtype: "q8"` — int8 GEMM accumulates in int32, and integer addition is
 *      associative.
 *   3. One text per call — a batched vector depends on what it was batched with,
 *      so adding a document would perturb its neighbours.
 *
 * `device` is deliberately **not** passed: transformers.js then picks its platform
 * default, which in Node is bit-identical to an explicit `cpu` (measured) and in
 * the browser is WASM. A caller wanting `webgpu` can pass it.
 *
 * `@huggingface/transformers` is an **optional peer dependency**, imported
 * dynamically: it hard-depends on both ONNX runtimes plus native `sharp`, and
 * most dockg users never enable embeddings. Behind this subpath, a consumer who
 * never imports `dockg/embed` never resolves it.
 */
import {
  profileFor,
  withPrefix,
  type EmbedRole,
  type Embedder,
  type ModelProfile,
} from "./types.js";
import { DEFAULT_MODEL } from "./types.js";

export interface LocalEmbedderOptions {
  /** Hugging Face model id. Any id is accepted; the tested set is documented. */
  model?: string;
  /** Weight quantization. Default `q8` — see discipline 2 above. */
  dtype?: string;
  /**
   * ONNX execution provider. **Omitted by default on purpose** — the accepted
   * values differ by platform (Node: `dml | webgpu | cpu`; browser: `webgpu |
   * wasm`), so any hardcoded value throws somewhere. Pass one only if you know
   * which platform this embedder runs on.
   */
  device?: string;
  /**
   * What these embeddings are for. Decides which prefix convention applies for
   * models that need one. Default "passage" (indexing); the query side passes
   * "query".
   */
  role?: EmbedRole;
  /**
   * Inject the transformers.js module (tests, or a host that already imported
   * it). Absent, it is imported dynamically.
   */
  transformers?: any;
}

/** Thrown when the optional peer is not installed, with the fix in the message. */
export class EmbedderUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `Local embeddings need @huggingface/transformers, which is an optional peer dependency.\n` +
        `  Install it:  npm install @huggingface/transformers\n` +
        `  (${detail})`,
    );
    this.name = "EmbedderUnavailableError";
  }
}

// transformers.js is an optional peer, so it is untyped at this boundary
// (importing its types would make it a hard dependency). The surface used
// here is small and pinned: `env`, `pipeline`, and the returned tensor. The
// `any` this needs is allowed for src/kg in eslint.config.js.

async function loadTransformers(injected?: any): Promise<any> {
  if (injected) return injected;
  try {
    // A literal specifier, so a consumer's bundler can resolve and chunk it
    // normally when they *have* opted in. Nothing is lost by leaving it
    // untyped: this boundary is untyped by design (see the note above), and
    // the missing-package path is what the catch handles.
    //
    // `@ts-ignore`, not `@ts-expect-error`, precisely because whether this
    // line errors depends on whether the optional peer happens to be
    // installed. `@ts-expect-error` fails with TS2578 ("unused directive") the
    // moment someone follows the README and installs it — which is exactly
    // what the `embed-real` CI job does, and how this was caught.
    // @ts-ignore optional peer dependency, may or may not be installed
    return await import("@huggingface/transformers");
  } catch (e) {
    throw new EmbedderUnavailableError(
      e instanceof Error ? e.message : "import failed",
    );
  }
}

/**
 * Create an embedder backed by a local model.
 *
 * **Constructing it is the expensive step**: `pipeline()` fetches the model's
 * config and weights (tens of megabytes on a cold cache) and builds the ONNX
 * session before returning, so callers that may not need to embed anything —
 * `manni kg embed` on an all-cache-hit run — should construct it lazily.
 */
export async function createLocalEmbedder(
  options: LocalEmbedderOptions = {},
): Promise<Embedder> {
  const model = options.model ?? DEFAULT_MODEL;
  const dtype = options.dtype ?? "q8";
  const role: EmbedRole = options.role ?? "passage";
  const profile: ModelProfile = profileFor(model);

  const transformers = await loadTransformers(options.transformers);

  // Discipline 1, set before the pipeline is built. Optional-chained because
  // the Node build's `env.backends.onnx.wasm` may be absent or a stub — this
  // pins the browser side, and asserting it pinned both is the mistake ADR
  // 01025 documents.
  if (transformers.env?.backends?.onnx?.wasm) {
    transformers.env.backends.onnx.wasm.numThreads = 1;
  }

  const extractor = await transformers.pipeline("feature-extraction", model, {
    // No `device`: its accepted values are disjoint across platforms, so any
    // hardcoded choice throws on one of them (ADR 01025).
    ...(options.device === undefined ? {} : { device: options.device }),
    dtype,
  });

  let dims = 0;

  return {
    model,
    dtype,
    get dims() {
      return dims;
    },
    async embed(text: string): Promise<Float32Array> {
      // Discipline 3: one text per call, never a batch.
      const output = await extractor(withPrefix(profile, role, text), {
        pooling: "mean",
        normalize: true,
      });
      const data = Float32Array.from(output.data as ArrayLike<number>);
      dims = data.length;
      return data;
    },
  };
}

 
