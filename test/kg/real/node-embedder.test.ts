/**
 * The real embedder, against the real model (ADR 01025).
 *
 * **Not part of `npm test`.** This suite downloads model weights and is excluded
 * from the default config; it runs only in the `embed-real` CI job, via
 * `vitest.real.config.ts`. The repo's "no network in tests" invariant applies to
 * the default suite, which stays hermetic.
 *
 * It exists because mocks certified a `createLocalEmbedder` that threw on every
 * real call for an entire release. Every assertion here is one the mock could
 * not make: they are about what `@huggingface/transformers` actually does, not
 * about what dockg passes it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createLocalEmbedder } from "../../../src/kg/embed/local.js";
import { DEFAULT_MODEL } from "../../../src/kg/embed/types.js";
import type { Embedder } from "../../../src/kg/embed/types.js";

const TEXT = "The default cache directory is marmalade.";

let embedder: Embedder;

// Building the pipeline fetches ~53 MB on a cold cache and runs a full ONNX
// session init; the forward passes afterwards are fast by comparison.
describe(
  "createLocalEmbedder against the real model",
  { timeout: 600_000 },
  () => {
    beforeAll(async () => {
      embedder = await createLocalEmbedder({ role: "passage" });
    });

    it("builds a pipeline at all", () => {
      // The regression that motivates this whole suite: `device: "wasm"` threw
      // "Unsupported device" on every Node run, so this line never succeeded.
      expect(embedder.model).toBe(DEFAULT_MODEL);
      expect(embedder.dtype).toBe("q8");
    });

    it("returns a mean-pooled vector of the model's width, not tokens × dims", async () => {
      const v = await embedder.embed(TEXT);
      expect(v).toBeInstanceOf(Float32Array);
      // granite-embedding-small-english-r2 is 384-wide. Asserted as a concrete
      // number *here* only — nothing in src hardcodes it (ADR 01020 §2).
      expect(v.length).toBe(384);
      expect(embedder.dims).toBe(384);
    });

    it("returns an L2-normalized vector, proving `normalize: true` is honored", async () => {
      // If the option name were wrong the call would still succeed and return an
      // unnormalized vector — silently breaking the dot-product-is-cosine
      // assumption the whole index rests on.
      const v = await embedder.embed(TEXT);
      let norm = 0;
      for (const x of v) norm += x * x;
      expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
    });

    it("is bit-identical across repeat calls on one platform", async () => {
      const a = await embedder.embed(TEXT);
      const b = await embedder.embed(TEXT);
      expect([...a]).toEqual([...b]);
    });

    it("distinguishes texts that differ only past 512 tokens", async () => {
      // granite's 8192-token context is why it is the default over the smaller
      // models. If it silently truncated (all-MiniLM does, at 256 wordpieces),
      // these two would embed identically and every long section's tail would be
      // unsearchable — a failure with no error attached.
      const head = "alpha ".repeat(900);
      const a = await embedder.embed(`${head}TAILMARKER unique ending phrase`);
      const b = await embedder.embed(`${head}DIFFERENT unique closing words`);
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
      expect(dot).toBeLessThan(0.999);
    });

    it("ranks a relevant passage above an irrelevant one", async () => {
      // An end-to-end sanity check on the embedding *meaning*, not just its shape:
      // a wrong pooling strategy can still produce a normalized 384-vector.
      const query = await embedder.embed("how do I install the tool");
      const relevant = await embedder.embed(
        "Installation: run npm install to set up the CLI.",
      );
      const irrelevant = await embedder.embed(
        "The mating habits of the emperor penguin in winter.",
      );
      const cos = (a: Float32Array, b: Float32Array) => {
        let d = 0;
        for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
        return d;
      };
      expect(cos(query, relevant)).toBeGreaterThan(cos(query, irrelevant));
    });
  },
);
