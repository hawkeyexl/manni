---
status: accepted
date: 2026-07-25
decision-makers: [manuel.r.b.silva]
superseded-by: 01025 (section 1, "One implementation on both sides", only)
---

# Vector entry with local-only embeddings

> **Section 1 is superseded by
> [ADR 01025](01025-embedder-cross-platform-reality.md).** The bit-identity
> argument below was reasoned from the WebAssembly spec and never measured. It is
> false in practice. transformers.js accepts *different* `device` values in Node
> and the browser, so WASM cannot be forced on both sides. The two backends
> agree to cosine 0.999914 rather than exactly. What dockg guarantees instead is
> decisive ordering within a bounded noise floor. The two places below that
> restate the superseded claim are struck through in place rather than deleted,
> so the record shows what was believed. Every other section of this ADR
> stands.

## Context and Problem Statement

Phase 8 gave dockg lexical entry, so a text query reaches nodes by keyword. It
cannot reach content that means the same thing in different words. Phase 8b adds
the semantic leg, and makes each retrieval stage callable on its own rather than
only as a step inside traversal.

**Hard constraint set by the maintainer: embeddings are computed by local /
in-browser models. No API calls to any embedding service, ever.** This is the
premise, not a preference. It deletes the provider, key and cost machinery
`fill` needs. It also makes the model the design's central engineering problem.
The *browser* must embed the user's query, using a function that agrees with the
one that embedded the corpus at build time.

## Decision Drivers

- **Local-only**, non-negotiable.
- **Build-side and query-side must compute the same function**, or cosine
  compares incomparable vectors.
- Determinism is the product contract; it must survive into retrieval.
- The browser runtime is ~23 KB gzipped and must not absorb a model runtime.
- Retrieval *quality* is the point of adding this leg at all.

## Decision Outcome

### 1. One implementation on both sides: WASM everywhere

transformers.js presents one API but **not one implementation**. Its docs are
explicit that Node uses `onnxruntime-node` (native, CPUID-dispatched across
AVX/AVX512/NEON) and the browser uses `onnxruntime-web` (WASM). They measurably
disagree. [transformers.js#1046](https://github.com/huggingface/transformers.js/issues/1046)
reports an embedding component moving from ≈ −0.0021 (Node) to ≈ −0.0165
(browser) for the same model and input.

That is not primarily a determinism issue. Build-side vectors are
cosine-compared against browser-side query vectors, so a split implementation
compares the outputs of **two different functions**. Retrieval quietly degrades
and nothing errors. **Correctness first, reproducibility second.**

So `onnxruntime-web` is forced on *both* sides, since it runs in Node. The
WebAssembly core spec mandates round-to-nearest ties-to-even. It also **forbids
implementations from contracting or fusing operations to elide intermediate
rounding**. A fixed `.wasm` binary therefore computes bit-identical floats
across x86 and ARM, across operating systems, and between Node and every
conforming browser. No native runtime offers a comparable guarantee.

Four disciplines are pinned in code, each closing a specific hole:

| Setting | Hole it closes |
|---|---|
| `device: "wasm"` on both sides | Native CPUID dispatch; the Node/browser split above |
| `env.wasm.numThreads = 1` | Default is derived from `hardwareConcurrency`, so reduction splits vary per machine |
| `dtype: "q8"` | int8 GEMM accumulates in int32, and integer addition *is* associative |
| **Batch size 1, fixed padding** | Float non-associativity makes a vector depend on what it was batched with, so adding one document would otherwise perturb its neighbours' vectors |

**Watch item.** If ORT-web adopts relaxed SIMD
([onnxruntime#22533](https://github.com/microsoft/onnxruntime/issues/22533),
open), cross-CPU WASM determinism ends silently. Relaxed SIMD deliberately
permits FMA to be single- or double-rounded depending on hardware.

### 2. Store L2-normalized float32, not int8

An earlier draft of this plan specified int8 quantization as "effectively
lossless." **That was wrong, and the correction is worth recording.**
HuggingFace's [embedding quantization benchmarks](https://huggingface.co/blog/embedding-quantization)
show int8 retaining only **90.79%** of float32 retrieval performance at **384
dimensions**, the worst row in their table. The 97–100% figures usually quoted
are all 1024-dimension models, which carry enough redundancy to absorb the
quantization error. Their method also uses per-dimension *calibrated* buckets.
The per-vector scale originally proposed here is coarser still, so 90.79% is an
optimistic bound for what was specified.

At dockg's scale the trade is plainly bad. int8 would shrink a once-fetched,
browser-cached artifact from ~1.5 MB to ~0.4 MB per 1000 sections. That costs
roughly 9% of the retrieval quality this phase exists to add.

Instead vectors are **L2-normalized at build time**, which makes cosine collapse
to a bare dot product. That is a ~3× query-time win for zero bytes. It is larger
than the 1.8–4× WASM SIMD delivers, and costs nothing in quality.

### 3. No vector-search library

Checked before writing any code, and the field is genuinely empty rather than
merely unfamiliar:

- The dedicated libraries are **abandoned**: `voy-search` (last publish Sep
  2023), `hnswlib-wasm` (Jul 2023), `client-vector-search` (Nov 2023). The
  2025–26 entrants (`veclite`, `altor-vec`, `flux-vector`) have 2–61 weekly
  downloads, so adopting one means becoming its primary user.
- **No maintained micro-package does cosine + top-k over typed arrays.** The
  popular `compute-cosine-similarity` (671k weekly) validates its input with
  `Array.isArray`, which is `false` for `Float32Array`. It throws on exactly
  the input type used here.
- **Orama was evaluated seriously and rejected on evidence.** It runs
  `Date.now()` at module load and returns an `elapsed` field, colliding with
  dockg's "no wall clock anywhere" invariant. Its hybrid sort has **no
  tie-break**, falling back to Map insertion order, though vector-only mode does
  tie-break. And `hybridWeights` guards on truthiness, so `{text: 1, vector: 0}`
  silently reverts to 50/50. It is also exact brute-force internally, the same
  loop dockg would write, at +18.6 KB gzipped.
- **Performance is not the constraint.** Plain JS scores 1000 × 384 in ~0.3–1 ms,
  and search is roughly 10× cheaper than embedding the query. Optimizing it
  would be optimizing the wrong stage.

The implementation is ~40 lines and measures well under 1 KB gzipped. Owning it
buys explicit tie-breaking, freedom in the storage encoding, and no dependency
that is three years stale.

### 4. The model is configuration

`embed.model` is an open string, defaulting to
`granite-embedding-small-english-r2` (384-d, q8 ≈ 52.5 MB, no prefix convention,
8192-token context so no section is ever truncated). Nothing hardcodes that
model and **nothing hardcodes 384 dimensions**. Dims come from the model at
embed time and from the sidecar header at query time.

The README documents a tested set with their failure modes, because the cheapest
options fail *quietly*. `all-MiniLM-L6-v2` truncates at 256 wordpieces (≈190
words), and `bge-small-en-v1.5` requires a `query: `-style prefix that silently
degrades retrieval if omitted. Prefix conventions live in the embedder's model
table and are applied on both sides so a user cannot get them wrong.

Swapping models is safe by construction. The sidecar header records model,
dtype, and dims. The runtime **refuses** on mismatch rather than ranking against
vectors from a different function, and the embed cache key includes model and
dtype.

That refusal is enforced in `findEntry` itself, not only in the CLI. The browser
is the surface it matters on, and a host that wires the documented path gets the
guarantee without having to know it exists. Callers pass an `embedder`, an object
carrying `model` and `dtype`, and a mismatch throws `VectorMismatchError`
*before* the query is embedded. A bare `embedQuery` function remains accepted as
an escape hatch for a host running its own model. It carries no identity, so only
the dimension check applies, documented as unverified rather than pretending
otherwise.

Corpus staleness is the other half. It is checked whichever way the query is
embedded, because it is a property of the corpus rather than the embedder. The
runtime cannot derive the digest itself, since it never sees the raw
`search.json` bytes. So the caller passes `source`, computed with the exported
`searchIndexDigest` helper, so the recipe cannot drift from the one
`dockg embed` records. Omitted, that half simply does not run. The README says so
rather than promising a check the code has no way to perform.

### 5. `dockg/embed` is an opt-in subpath, never a dependency

`@huggingface/transformers` is an **optional `peerDependency`**. It hard-depends
on both ONNX runtimes plus native `sharp`, which one measurement put at ~476 MB
in `node_modules`. Making every dockg user carry that for a feature most will
not enable is indefensible. `dockg embed` without it exits 2 naming the install
command. Behind its own subpath entry, a consumer who never imports
`dockg/embed` never resolves it. That sidesteps the unresolved
[vite#6007](https://github.com/vitejs/vite/issues/6007) class of build breakage,
where an uninstalled optional dependency fails a consumer's build.

The **runtime's bundle-purity gate is unchanged**: allow-list stays exactly
`minisearch`, and gains an explicit assertion that `@huggingface/transformers`
never reaches `dist/runtime.js`.

### 6. Every stage is callable, and entry results travel with graph results

`vectors.search(queryVector)` is a standalone function, giving semantic search
without touching the graph. `findEntry` returns each leg *and* the fusion
(`{candidates, lexical, vector, trace}`), and the retrieval bundle carries an
`entry: {lexical, vector, merged}` block **alongside** `nodes`/`context`/
`citations`. A consumer can render "text matches", "semantic matches", and
"graph-connected results" as distinct things rather than inferring them from a
trace.

`rrfMerge` (Phase 8, previously an identity ranking over one list) becomes
load-bearing. Keeping fusion in dockg's own code is what makes it deterministic
and inspectable, precisely what Orama's untie-broken hybrid could not offer.

### Consequences

- Good. Semantic retrieval that is fully local, with no key, no spend, and no
  service dependency. A browser can answer without a backend.
- Good. Build and query vectors come from the same *model*, and rank the same.
  ~~Provably the same function~~, per the note above. The two backends agree to
  cosine 0.999914, not exactly, and the guarantee ADR 01025 substitutes is
  decisive ordering within a bounded noise floor.
- Good. Each retrieval stage is independently usable, so hosts can build search
  UIs that are not "ask the graph and hope".
- Neutral. ~40 lines of vector code owned in-tree, gated by tests.
- Bad. Embedding is slow by construction (WASM, single-threaded, batch 1). The
  content-hash cache makes incremental runs cheap; a first run is not.
- Bad. **The vector artifact cannot be regenerated in CI.** CI must not touch
  the network, and model weights are a download. It is gitignored, built in the
  consumer's deploy pipeline, and its determinism is gated with a deterministic
  mock embedder rather than the real model.

### Confirmation

Unit tests cover the artifact, with a round-trip, byte-identical rebuilds,
corrupt input reaching `DockgError`, and L2 normalization. They cover standalone
vector search, with ranking, IRI tie-break, and refusals on model, dims or
digest mismatch. They cover `findEntry` returning both legs and degrading to
lexical-only with no embedder, and the bundle carrying `entry`. A `vectors.bin`
golden generated by the mock embedder comes with a double-build gate. The bundle
gate proves the embedder stayed out of the runtime.
A real-model gate verifies Node and browser produce the same *ordering* for any
pair separated by more than twice the measured score noise. That is the claim
the whole design rests on. ~~Matching top-k~~ overstates it, and the smoke test is no
longer non-automated: `test/real/cross-platform.mjs` runs it in CI's
`embed-real` job (ADR 01025).

## Pros and Cons of the Options

### Local models (chosen, and mandated)

- Good. No key, no spend, no service, works offline after first load; the browser
  is self-sufficient.
- Bad. Tens of MB of weights on first use; slow embedding under the reproducible
  configuration.

### Hosted embedding APIs (excluded by the constraint)

- Good. Fast, no client weight, better models.
- Bad. A key and a bill for every consumer, a network dependency in the
  retrieval path, and corpus text leaving the machine. It was ruled out up front.

### int8 / binary quantized vectors (rejected for now)

- Good. 4× (int8) or 32× (binary) smaller artifacts.
- Bad. Int8 costs ~9% of retrieval at 384 dimensions. Revisit only if corpus
  size makes the artifact a real problem. At that point *binary* deserves a look
  first, since it scored higher than int8 for small-dimension models in the same
  benchmark.
