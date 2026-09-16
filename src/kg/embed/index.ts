/**
 * `dockg/embed` — local, in-browser-capable embeddings (ADR 01020).
 *
 * A separate entry point from `dockg/runtime` on purpose: this module reaches
 * `@huggingface/transformers`, which hard-depends on both ONNX runtimes plus
 * native `sharp`. Keeping it here means the ~24 KB runtime never grows a model
 * stack, and a consumer who never imports `dockg/embed` never resolves the
 * optional peer at all.
 *
 * ```js
 * import { createLocalEmbedder } from "dockg/embed";
 * import { createVectorIndex, findEntry } from "dockg/runtime";
 *
 * const embedder = await createLocalEmbedder({ role: "query" });
 * const vectors = createVectorIndex(new Uint8Array(await (await fetch("/kg/vectors.bin")).arrayBuffer()));
 * const entry = await findEntry(question, {
 *   lexical, vectors, embedder,
 * });
 * // entry.lexical / entry.vector / entry.candidates
 * ```
 *
 * Pass the `embedder` itself, not `embedQuery: (q) => embedder.embed(q)`. A bare
 * function carries no model or dtype, so `findEntry` cannot check it against the
 * sidecar and will happily rank a query against vectors from a different model.
 * The object form gets that refusal (ADR 01020).
 */
export {
  createLocalEmbedder,
  EmbedderUnavailableError,
  type LocalEmbedderOptions,
} from "./local.js";
export { createMockEmbedder, type MockEmbedderOptions } from "./mock.js";
export {
  DEFAULT_MODEL,
  MODEL_PROFILES,
  profileFor,
  withPrefix,
  type EmbedRole,
  type Embedder,
  type ModelProfile,
} from "./types.js";
