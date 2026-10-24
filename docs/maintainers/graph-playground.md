# Graph playground

The proof of concept on `graph/retrieve-from-a-script/` is docs-site code. It
hosts the public retriever; WebLLM is an optional answer generator in a separate
worker. The package runtime's exports and result shapes are unchanged.

## Run it locally

From the repository root:

```sh
npm ci
npm run build
npm --prefix docs ci
node dist/cli.js graph publish --collection site
npm --prefix docs run check
npm --prefix docs run dev
```

Open `/manni/graph/retrieve-from-a-script/#try-it-on-this-site` on the URL Astro
prints. The artifact and its chunks must come from the same publish. After a
check that publishes a subset of the docs, publish `--collection site` again.

## Review checklist

- [x] `docs/src/components/RetrievePrototype.astro` exposes `lookup`, `retrieve`,
  `traverse` and `impact`, including a passage's **Use this node** action.
- [x] `lookup` uses the published options. The other calls expose scope, depth,
  character budget, metadata conditions and withholding. Walks expose a node
  limit; `traverse` also exposes comma-separated predicates and reverse edges.
- [x] Results retain passage text, proof, citations, trace and complete JSON.
  The JavaScript example reflects the call made. Long passage lists expand on
  demand so the local-answer controls remain reachable.
- [x] `retrieve-prototype-data.ts` constructs a bounded evidence selection from
  the displayed result, with source IDs, roles and proof counters. The exact
  model input and omitted count are visible. Refusals and missing text block
  generation. No new retrieval occurs when asking a follow-up question.
- [x] `retrieve-prototype-model.ts` and `retrieve-prototype.worker.ts` load
  WebLLM only after **Enable local answers**. Download cancellation, retry,
  answer interruption and model unloading are supported. Questions and
  passages are supplied to the local worker, with no inference backend.
- [x] `docs/package.json` and its lockfile include WebLLM and an Astro checker;
  `npm --prefix docs run check` checks the browser code as well as components.
- [x] The retrieval guide, library API reference, their managed provenance
  sidecars, and the existing information-architecture entry describe the POC.
- [x] `test/docs/retrieve-prototype-data.test.ts` and the dedicated
  `test/fixtures/retrieve-prototype/{passages.json,key-command-window.md}` cover result normalization,
  proof, refusals, source IDs, Unicode budgets and question-relevant excerpts.

## Verification

Run the helper and runtime tests after building the package:

```sh
npx vitest run test/docs/retrieve-prototype-data.test.ts test/graph/integration/runtime-bundle.test.ts test/graph/integration/retrieve.test.ts test/graph/integration/retrieve-cli.test.ts
npm run typecheck
npm run lint
npm --prefix docs run check
npm --prefix docs run build
npm run docs:check-links
node dist/cli.js meta validate
node dist/cli.js term check
node dist/cli.js cite check
npm run docs:check-graph
```

Dogfood the published site in a browser: run all four calls, follow a passage's
node, inspect a refusal and an invalid metadata condition, and check both themes
and a narrow viewport. Without WebGPU, enabling answers must report the missing
capability while retrieval continues working. A normal lookup must request no
model assets.

A mock does not validate WebLLM. In a browser with a real WebGPU adapter, enable
the model, cancel and retry its load, then ask both a question about the returned
counts and a question whose answer occurs in a returned passage. Inspect the
exact prompt and its numbered sources alongside the answer. Check interruption
and unloading. Small-model answers are experimental: a successful download and
nonempty output alone do not establish that an answer follows the evidence.
