/**
 * `createLocalEmbedder`'s wiring, hermetically (ADR 01025).
 *
 * These assert what dockg *passes* transformers.js — which `test/real/` cannot
 * do cheaply, and which the real suite would only catch by crashing. The real
 * suite asserts the complementary half: that what transformers.js does with
 * those arguments is what we think.
 *
 * `LocalEmbedderOptions.transformers` is the seam. It existed throughout the
 * `device: "wasm"` incident and went unused, which is precisely why the bug
 * survived — a fake module here would have caught nothing about ONNX, but it
 * catches every regression in the argument shape, for free and offline.
 */
import { describe, expect, it } from "vitest";
import { createLocalEmbedder } from "../../../src/kg/embed/local.js";
import { DEFAULT_MODEL } from "../../../src/kg/embed/types.js";

interface PipelineCall {
  task: string;
  model: string;
  options: Record<string, unknown>;
}

interface ExtractorCall {
  text: string;
  options: Record<string, unknown>;
}

/** A stand-in for the transformers.js module, recording what it was handed. */
function fakeTransformers(opts: { wasmEnv?: boolean; dims?: number } = {}) {
  const pipelineCalls: PipelineCall[] = [];
  const extractorCalls: ExtractorCall[] = [];
  const wasm: Record<string, unknown> = {};
  return {
    pipelineCalls,
    extractorCalls,
    wasm,
    module: {
      // `wasmEnv: false` models the Node build, whose env does not carry a
      // usable `wasm` object — the shape that made the old unconditional
      // assignment a silent no-op.
      env: opts.wasmEnv === false ? {} : { backends: { onnx: { wasm } } },
      pipeline: (
        task: string,
        model: string,
        options: Record<string, unknown>,
      ) => {
        pipelineCalls.push({ task, model, options });
        return Promise.resolve(
          (text: string, options: Record<string, unknown>) => {
            extractorCalls.push({ text, options });
            return Promise.resolve({
              data: new Float32Array(opts.dims ?? 384).fill(0.5),
            });
          },
        );
      },
    },
  };
}

describe("createLocalEmbedder wiring", () => {
  it("passes no `device` at all by default", async () => {
    // The regression this file exists for. transformers.js v4 accepts disjoint
    // device values per platform (Node: dml|webgpu|cpu, browser: webgpu|wasm),
    // so *any* hardcoded value throws on one of them. Omitting the key lets it
    // choose. Asserted as key-absence, not `undefined`: passing the key with an
    // undefined value is a different thing to the library.
    const fake = fakeTransformers();
    await createLocalEmbedder({ transformers: fake.module });
    expect(fake.pipelineCalls).toHaveLength(1);
    expect("device" in fake.pipelineCalls[0]!.options).toBe(false);
  });

  it("forwards an explicit device when the caller knows its platform", async () => {
    const fake = fakeTransformers();
    await createLocalEmbedder({
      transformers: fake.module,
      device: "webgpu",
    });
    expect(fake.pipelineCalls[0]!.options.device).toBe("webgpu");
  });

  it("pins numThreads when the env exposes a wasm backend", async () => {
    const fake = fakeTransformers();
    await createLocalEmbedder({ transformers: fake.module });
    expect(fake.wasm.numThreads).toBe(1);
  });

  it("does not throw when the env has no wasm backend", async () => {
    // The Node build's shape. An unguarded assignment here is a TypeError, and
    // the old code only survived it because that env happened to expose a stub.
    const fake = fakeTransformers({ wasmEnv: false });
    await expect(
      createLocalEmbedder({ transformers: fake.module }),
    ).resolves.toBeDefined();
  });

  it("defaults to the documented model and q8 weights", async () => {
    const fake = fakeTransformers();
    const embedder = await createLocalEmbedder({ transformers: fake.module });
    expect(fake.pipelineCalls[0]!.task).toBe("feature-extraction");
    expect(fake.pipelineCalls[0]!.model).toBe(DEFAULT_MODEL);
    expect(fake.pipelineCalls[0]!.options.dtype).toBe("q8");
    expect(embedder.model).toBe(DEFAULT_MODEL);
    expect(embedder.dtype).toBe("q8");
  });

  it("honors a model and dtype override", async () => {
    const fake = fakeTransformers();
    const embedder = await createLocalEmbedder({
      transformers: fake.module,
      model: "Xenova/gte-small",
      dtype: "fp32",
    });
    expect(fake.pipelineCalls[0]!.model).toBe("Xenova/gte-small");
    expect(fake.pipelineCalls[0]!.options.dtype).toBe("fp32");
    expect(embedder.dtype).toBe("fp32");
  });

  it("asks for mean pooling and normalization on every call", async () => {
    // Wrong option names would still return a vector — an unnormalized one,
    // silently breaking the dot-product-is-cosine assumption the index rests on.
    const fake = fakeTransformers();
    const embedder = await createLocalEmbedder({ transformers: fake.module });
    await embedder.embed("hello");
    expect(fake.extractorCalls[0]!.options).toEqual({
      pooling: "mean",
      normalize: true,
    });
  });

  it("embeds one text per call, never a batch", async () => {
    // Discipline 3: a batched vector depends on what it was batched with, so
    // adding a document would perturb its neighbours' vectors.
    const fake = fakeTransformers();
    const embedder = await createLocalEmbedder({ transformers: fake.module });
    await embedder.embed("one");
    await embedder.embed("two");
    expect(fake.extractorCalls.map((c) => c.text)).toEqual(["one", "two"]);
    expect(fake.extractorCalls.every((c) => typeof c.text === "string")).toBe(
      true,
    );
  });

  it("applies the model's prefix convention, per role", async () => {
    // bge needs a query-side prefix and degrades silently without it, so the
    // prefix must follow the role rather than the caller remembering.
    const fake = fakeTransformers();
    const query = await createLocalEmbedder({
      transformers: fake.module,
      model: "Xenova/bge-small-en-v1.5",
      role: "query",
    });
    await query.embed("how do I install");
    expect(fake.extractorCalls[0]!.text).not.toBe("how do I install");
    expect(fake.extractorCalls[0]!.text).toContain("how do I install");

    const passage = await createLocalEmbedder({
      transformers: fake.module,
      model: "Xenova/bge-small-en-v1.5",
      role: "passage",
    });
    await passage.embed("how do I install");
    expect(fake.extractorCalls[1]!.text).toBe("how do I install");
  });

  it("passes granite's text through unprefixed", async () => {
    const fake = fakeTransformers();
    const embedder = await createLocalEmbedder({
      transformers: fake.module,
      role: "query",
    });
    await embedder.embed("plain text");
    expect(fake.extractorCalls[0]!.text).toBe("plain text");
  });

  it("reports dims from the model's output rather than a constant", async () => {
    // Nothing in src may hardcode 384 — a different model is a config change,
    // not a code change (ADR 01020).
    const fake = fakeTransformers({ dims: 768 });
    const embedder = await createLocalEmbedder({ transformers: fake.module });
    expect(embedder.dims).toBe(0);
    const v = await embedder.embed("hello");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(768);
    expect(embedder.dims).toBe(768);
  });
});
