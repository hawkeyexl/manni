import { defineConfig } from "vitest/config";

/**
 * The kg tool's real-model suite, `npm run test:kg:real`.
 *
 * `test/kg/real/**` is the other half of kg ADR 01025 and ADR 01031: where a
 * mock stands in for a third party, the real one has to be exercised
 * *somewhere*. A hardcoded `device: "wasm"` threw on every real Node call and
 * the mocks certified it for a whole release, which is why these exist.
 *
 * They are a **separate config on purpose**, not a flag on the default one.
 * `vitest.config.ts` excludes `test/kg/real/**` so `npm test` stays hermetic —
 * no network, no model weights — and that exclusion is the invariant. This file
 * is how the suite is run deliberately, by a person who wants it, and it is
 * wired into no CI job: one run downloads ~53 MB of ONNX weights and the other
 * needs an OpenAI-compatible server listening.
 *
 * What each needs:
 *
 * - `node-embedder.test.ts` — the optional peer `@huggingface/transformers`
 *   (`npm install @huggingface/transformers`) and network access to the
 *   Hugging Face CDN on a cold cache.
 * - `fill-openai.test.ts` — a server at `OLLAMA_BASE_URL` (default
 *   `http://localhost:11434/v1`) serving `OLLAMA_MODEL` (default
 *   `llama3.2:1b`), with `OLLAMA_API_KEY` set if it wants one.
 *
 * `INFERENCE_NO_AUTO_INSTALL` is deliberately *not* set here. The default suite
 * sets it so a stray local-provider construction cannot reach the network; this
 * suite is the one place where reaching it is the point.
 */
export default defineConfig({
  test: {
    include: ["test/kg/real/**/*.test.ts"],
    environment: "node",
    // Model download plus ONNX session init, once, in a `beforeAll`. The
    // default 5s/10s pair is not in the right order of magnitude for either.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
