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
- [x] `retrieve-prototype-links.ts` maps repository page paths and graph IRI
  fragments to published routes; `test/docs/retrieve-prototype-links.test.ts`
  covers the mapping used by passage, citation and model-source links.
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
npx vitest run test/docs test/graph/integration/runtime-bundle.test.ts test/graph/integration/retrieve.test.ts test/graph/integration/retrieve-cli.test.ts
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

Dogfood the published site in a browser. Run all four calls and follow a
passage's node. Inspect a refusal and an invalid metadata condition. Check both
themes and a narrow viewport. Follow passage, citation and model-source links to confirm
that they resolve to published pages and the intended heading fragments. Without WebGPU, enabling answers must report the missing
capability while retrieval continues working. A normal lookup must request no
model assets.

A mock does not validate WebLLM. In a browser with a real WebGPU adapter, enable
the model, then cancel and retry its load. Ask a question about the returned
counts and another whose answer occurs in a returned passage. Inspect the
exact prompt and its numbered sources alongside the answer. Check interruption
and unloading. Small-model answers are experimental: a successful download and
nonempty output alone do not establish that an answer follows the evidence.

The model adapter regressions exercise the actual adapter with an injected worker
and SDK, so root tests need no model download or docs-only dependency. They cover
cancellation during reset, stream startup and streaming, plus incomplete output.
The evaluation fixture validator rejects empty prompts, missing evidence and
cases without a fact, count or abstention criterion before downloading models.
These review fixes do not change the frozen comparison inputs, answers or scores;
the audit fingerprints identify the implementation used for that comparison.

## Approved model-selection plan (2026-10-24)

The first real-model check showed that Llama 3.2 1B could answer a returned-count
question while still giving unreliable prose and command answers. Downloading a
model and producing text therefore does not decide the default. The user
approved a comparison on the playground's actual grounded-answer task before
changing it. This section records that plan before any default change.

Maya starts with this repository's published site artifact, runs `lookup` for a
docs question, and inspects its passages and proof. The evaluator freezes twenty
questions with their exact evidence messages, including questions the evidence
cannot answer. She runs every candidate over those same messages and compares the
answers with the returned values. She chooses a model only if it meets the
quality gates below. This separates the generator's behavior from retrieval.

### Candidate models and inference settings

All four candidates use WebLLM's `q4f32_1` artifact, a 4096-token context window,
384 maximum output tokens, streaming output with usage, and seed 42. Each
question is a fresh request without earlier chat history. Model loading is
sequential, with its worker terminated between candidates.

| Role | Exact WebLLM model ID | Configured VRAM (MB) |
|---|---|---|
| Instruction-following candidate | `Qwen3-1.7B-q4f32_1-MLC` | 2635.44 |
| Newer 2B candidate | `Qwen3.5-2B-q4f32_1-MLC` | 2591.55 |
| Smaller download candidate | `Qwen3.5-0.8B-q4f32_1-MLC` | 1894.19 |
| Existing baseline | `Llama-3.2-1B-Instruct-q4f32_1-MLC` | 1128.82 |

These VRAM figures are WebLLM configuration estimates, not measured peak GPU
memory or download sizes. A model's marketed parameter count is not its browser
working-memory requirement.

| Candidate | Temperature | Top-p | Presence penalty | Frequency penalty | Repetition penalty | Thinking |
|---|---|---|---|---|---|---|
| Qwen3 1.7B | 0.7 | 0.8 | 0 | 0 | 1 | `extra_body.enable_thinking: false` |
| Both Qwen3.5 sizes | 1 | 1 | 2 | 0 | 1 | Default non-thinking mode |
| Llama baseline | 0 | 1 | 0 | 0 | 1 | Direct answer |

The sampler uses the supported request fields appropriate to each family.
WebLLM's request interface does not expose upstream `top_k` or `min_p`, so this
is not a claim to reproduce the complete vendor benchmark sampler. The explicit
`extra_body.enable_thinking` switch applies to Qwen3; the evaluator does not
assume that the same SDK switch controls Qwen3.5. The report records the actual
settings used for each candidate.

### Frozen evidence and grading

The committed fixture,
`test/fixtures/retrieve-prototype/model-evaluation.json`, contains exactly twenty
cases captured from this repository's published graph through the playground's
current `buildAnswerInput`. Each case records its question, exact system/user
messages, source IDs and expected checks. Freeze those inputs before running the
first candidate; record the fixture and message hashes in the report. Do not
tailor prompts or expectations after seeing a candidate's outputs. Real graph
refusals remain blocked before generation; the missing-information cases below
supply readable passages that lack the requested fact.

| Case ID | Returned result | Grading focus |
|---|---|---|
| `lookup-match-count` | lookup | Exact match count |
| `lookup-context-count` | lookup | Exact context count |
| `lookup-dependent-count` | lookup | Exact dependent count |
| `lookup-rotate-command` | lookup | Exact rotation command and supporting citation |
| `lookup-environment-precedence` | lookup | Environment precedence and supporting citation |
| `lookup-key-config-scope` | lookup | Key configuration scope |
| `lookup-missing-runtime` | lookup | Abstention on an unavailable runtime fact |
| `lookup-missing-release` | lookup | Abstention on an unavailable release fact |
| `traverse-bare-key-exit` | traverse | Bare key command behavior |
| `traverse-set-command` | traverse | Exact set command and supporting citation |
| `traverse-command-distinction` | traverse | Keep different key commands distinct |
| `traverse-generated-key-length` | traverse | Generated-key length from the evidence |
| `traverse-pin-proof` | traverse | Describe returned pin proof accurately |
| `traverse-missing-evals` | traverse | Distinguish absent eval evidence from a verdict |
| `retrieve-unknown-variant` | retrieve | Scope fact from returned evidence |
| `retrieve-language-scope` | retrieve | Language scope from returned evidence |
| `retrieve-dependent-count` | retrieve | Exact dependent count |
| `impact-dependent-count` | impact | Exact dependent count |
| `impact-passage-roles` | impact | Returned passage roles |
| `impact-proof-distinction` | impact | Distinguish the returned proof records |

The fixture holds the exact wording, expected values and valid citation IDs;
the table names the fixed inventory without restating the evidence. The pure
grader is `scripts/lib/graph-playground-evaluation.mjs`, with its type declaration
in `scripts/lib/graph-playground-evaluation.d.mts` and unit tests in
`test/docs/graph-playground-evaluation.test.ts`.

Grade these behaviors separately, retaining the full answer for review:

- **Counts:** the answer agrees with the returned role, passage and proof
  counters, including the distinction between the full result and supplied
  evidence.
- **Commands:** commands and arguments come from the supplied passages, with
  exact expected forms checked. A plausible command absent from the evidence
  is a failure.
- **Citations:** source IDs exist in the supplied evidence and support the
  associated claim. Merely producing a bracketed number is not success.
- **Missing information:** the model says that the evidence does not answer the
  question, rather than filling the gap from prior knowledge.
- **Proof:** pins, errors, dates and eval verdicts are described as returned,
  including stale verdicts and the difference between a record and a guarantee.

Automated checks pin exact facts and source IDs. Review the retained answers
against their evidence as well. A valid source ID does not prove that the source
supports a claim. An exact command match does not excuse extra invented
commands. Fabricated commands or citations reject a candidate regardless of its
aggregate score. A candidate that cannot load, errors, or exhausts its output before an
answer is complete does not count as passing that case. Prefer a candidate that
passes the grounding gates and improves the relevant categories over the
baseline. If none qualifies, report that result rather than declaring a winner.
A single seeded twenty-case run is a focused local comparison, not a universal
model ranking or a guarantee of production answer quality.

### Manual browser runner and measurements

From the repository root after installing dependencies:

```sh
node scripts/evaluate-graph-playground.mjs
```

For a recovery run or one candidate, provide one comma-separated model list:

```sh
node scripts/evaluate-graph-playground.mjs --models Qwen3-1.7B-q4f32_1-MLC
```

Every runner option is optional:

| Option | Type | Default | Purpose |
|---|---|---|---|
| `--models <list>` | Comma-separated model IDs | The four candidates above | Run all candidates or a recovery subset. |
| `--fixture <path>` | Repository-relative path | `test/fixtures/retrieve-prototype/model-evaluation.json` | Read the frozen cases. |
| `--out <path>` | Repository-relative path | `.tmp/graph-playground-model-evaluation.json` | Save JSON; Markdown uses the same basename plus `-summary.md`. |
| `--profile <path>` | Repository-relative path | `.tmp/graph-playground-evaluation-browser` | Retain the browser's model cache between runs. |
| `--channel <name>` | Browser channel name | `msedge` | Choose an installed WebGPU-capable browser. |
| `--port <number>` | Port number | `4338` | Serve the local SDK test page on a stable cache origin. |
| `--case-timeout-ms <ms>` | Milliseconds | `120000` | Limit one case's execution time. |
| `--load-timeout-ms <ms>` | Milliseconds | `300000` | Limit one model load. |
| `-h`, `--help` | Boolean | `false` | Print usage and exit without loading a model. |

The complete invocation with explicit defaults is:

```sh
node scripts/evaluate-graph-playground.mjs --models Qwen3-1.7B-q4f32_1-MLC,Qwen3.5-2B-q4f32_1-MLC,Qwen3.5-0.8B-q4f32_1-MLC,Llama-3.2-1B-Instruct-q4f32_1-MLC --fixture test/fixtures/retrieve-prototype/model-evaluation.json --out .tmp/graph-playground-model-evaluation.json --profile .tmp/graph-playground-evaluation-browser --channel msedge --port 4338 --case-timeout-ms 120000 --load-timeout-ms 300000
```

The runner uses real WebGPU and external model downloads. It is a manual opt-in
utility and is excluded from hermetic `npm test`. It serves its local test page on
port 4338 and keeps a browser profile under
`.tmp/graph-playground-evaluation-browser`. It writes the full result to
`.tmp/graph-playground-model-evaluation.json` and a compact table to
`.tmp/graph-playground-model-evaluation-summary.md`.

| Exit | Meaning |
|---|---|
| 0 | Every selected model completed every case and the report was saved. Quality failures remain visible in the report. |
| 1 | The report was saved with model or case execution failures; the comparison is incomplete. |
| 2 | A usage, fixture, browser or server setup failure prevented the run. |

The completion line is `Model evaluation complete: <completed>/<selected> models; report <report path>`.
Fatal diagnostics go to stderr as `graph-playground-evaluation: <reason>`.
Per-model load messages and per-case PASS/FAIL lines are progress information.
The JSON report groups its fields under `fixture`, `environment`,
`configuration`, `models` and `summary`, with `schemaVersion`, `startedAt` and
`completedAt` identifying the report format and run. Each model record includes
its sampler, thinking mode, artifact record, cache state, load measurements,
download measurements, case outputs and grades, summary and any execution error.

The report retains exact outputs and grades, settings, fixture/message hashes,
first nonempty streamed-token latency, total answer time and token usage. Check
`hasModelInCache` before loading: cached weights are a warm tensor-cache load;
missing weights are a cold load. A partial or failed load may have a mixed or
unknown state. Record load time separately from answer latency, and disclose
whether runtime or tokenizer assets were already cached. Neither a warm tensor
cache nor a single load measures a fully cold end-user download.

Record observed response-body bytes and WebLLM's cumulative fetched-MB progress
separately from the configured VRAM estimate. Cache hits, response compression,
retries and runtime assets can make those byte counts differ. Do not present
configured VRAM as transferred bytes or as a measured peak.

### Recorded selection and limitations

The completed run evaluated all eighty answers: twenty frozen cases for each of
the four candidates. The fixture SHA-256 is
`db960718ff2a885115f37cbfa387a4baf49c50ecea3e2056117fae6a3fd39784`.
The selected default is **`Qwen3-1.7B-q4f32_1-MLC`**, using the recorded
non-thinking settings. It was the best observed candidate for this POC, with
18 of 20 answers judged correct versus 7 of 20 for the previous Llama baseline.
There was no predeclared numeric pass threshold. This choice does not establish
production grounding quality or a general ranking of the model families.

Deterministic screening and semantic review are different measurements. The
review was an **agent answer-by-answer review**, not a human review; the primary
agent also inspected all twenty answers from the selected model. The committed
[audit](graph-playground-model-review.json) preserves all eighty full raw and
visible answers, exact question/input hashes, and original and current machine
grades. It also retains per-case reviewed verdicts and reasons, sampler settings
and measurements.
The input messages and expectations remain in the committed fixture. Full
network-event detail remains in the local raw report named above.

| Model artifact | Machine pass | Machine critical flags | Agent-reviewed correct | Actual nonempty reasoning / truncated cases |
|---|---|---|---|---|
| `Qwen3-1.7B-q4f32_1-MLC` | 12/20 | 1 | 18/20 | 0 / 0 |
| `Qwen3.5-2B-q4f32_1-MLC` | 9/20 | 3 | 8/20 | 2 / 2 |
| `Qwen3.5-0.8B-q4f32_1-MLC` | 0/20 | 5 | 1/20 | 17 / 17 |
| `Llama-3.2-1B-Instruct-q4f32_1-MLC` | 7/20 | 0 | 7/20 | 0 / 0 |

The selected model's one machine critical flag was a parser false positive on
ordinary “manni version” prose. Other machine misses included faithful
paraphrases or standalone counts that the matcher did not recognize. Preserve
those grades rather than silently treating a regex result as semantic truth.
Conversely, a machine pass does not establish correctness: the review checks the
whole answer, including unsupported assertions after an otherwise correct start.

The two genuine selected-model failures remain visible in the audit. It
incorrectly gave the configuration key precedence over `MANNI_ENCRYPTION_KEY`,
and confused a 256-bit key with its 64 hexadecimal characters. Both failures
used valid source IDs. No fabricated command or nonexistent source ID was
confirmed for this candidate, but valid citations did not prevent those factual
errors. The Qwen3.5 2B run invented a numbered citation and a source URL and had
two actual reasoning/truncation failures. The 0.8B run had seventeen such
protocol failures and also invented source URLs. These observations describe
this integration, evidence and output budget; they are not claims that those
models cannot work under other settings.

Agent-reviewed category scores retain the fixed fixture's categories:

| Model | Counts | Commands | Scope | Conflicting claims | Abstention | Proof | Roles |
|---|---|---|---|---|---|---|---|
| `Qwen3-1.7B-q4f32_1-MLC` | 5/6 | 3/3 | 3/4 | 1/1 | 2/2 | 3/3 | 1/1 |
| `Qwen3.5-2B-q4f32_1-MLC` | 3/6 | 1/3 | 1/4 | 1/1 | 1/2 | 1/3 | 0/1 |
| `Qwen3.5-0.8B-q4f32_1-MLC` | 0/6 | 0/3 | 0/4 | 0/1 | 0/2 | 1/3 | 0/1 |
| `Llama-3.2-1B-Instruct-q4f32_1-MLC` | 3/6 | 1/3 | 2/4 | 0/1 | 0/2 | 1/3 | 0/1 |

All four tensor-cache checks were cold. This run used Windows, Edge
156.0.4314.42, WebLLM 0.2.86 and an NVIDIA Lovelace adapter. Medians below are
across twenty cases on this machine. “First raw token” is the first nonempty
streamed content, which can include the empty SDK transport marker. It is not
necessarily the first visible answer token. Warm-load performance was not
measured. These are observed local measurements, not a promised user latency.

| Model artifact | Cold load | Median first raw token | Median total answer | Observed external response-body bytes | Configured VRAM (MB) |
|---|---|---|---|---|---|
| `Qwen3-1.7B-q4f32_1-MLC` | 58.24 s | 298.05 ms | 575.00 ms | 986,301,189 | 2635.44 |
| `Qwen3.5-2B-q4f32_1-MLC` | 62.17 s | 714.95 ms | 1544.95 ms | 1,079,850,425 | 2591.55 |
| `Qwen3.5-0.8B-q4f32_1-MLC` | 26.79 s | 558.85 ms | 5424.75 ms | 444,067,003 | 1894.19 |
| `Llama-3.2-1B-Instruct-q4f32_1-MLC` | 40.09 s | 205.55 ms | 290.95 ms | 704,100,646 | 1128.82 |

The selected run observed 986,301,189 external response-body bytes, about 0.99 GB,
with 58.24 seconds of cold loading. Its configured VRAM estimate is 2635.44 MB,
about 2.6 GB; that is separate from both network transfer and measured peak GPU
memory. SDK cumulative fetched-MB progress is retained separately in the audit.

The real run also exposed an SDK transport detail: direct-answer output can
start with an empty `<think></think>` block. The tested
`retrieve-prototype-answer.ts` formatter removes only that empty block and its
partial streaming prefix. Actual nonempty reasoning and output truncation still
fail the non-thinking protocol. Raw and normalized answers and original grades
are retained. A numeric-only grading correction and this transport correction
were applied consistently to the saved outputs. The frozen prompts,
expectations, model settings and generated answers were not tuned after the
results. `test/docs/retrieve-prototype-answer.test.ts` covers the formatter.

### Interface and acceptance checklist

The playground keeps its current retrieval controls, graph calls, result shapes,
exact-prompt preview and source list. This selection adds no user CLI option,
repository config key or public package export. The selected model ID, ready
status label and download description must agree with the measured winner.
Loading, cancellation, retry, stop and unload behavior stays the same; local
answers remain explicitly optional and experimental.

- [x] `test/fixtures/retrieve-prototype/model-evaluation.json` contains the
  fixed twenty cases and expected checks.
- [x] `scripts/lib/graph-playground-evaluation.mjs`, its `.d.mts` declaration
  and `test/docs/graph-playground-evaluation.test.ts` cover correct answers,
  wrong counts, invented commands/citations, abstention and proof errors.
- [x] `scripts/evaluate-graph-playground.mjs` evaluates all four exact artifacts with the
  recorded budgets and per-family settings, and saves reviewable reports.
- [x] The result table separates category quality, hard rejections, cold/warm
  load conditions, answer latency, configured VRAM and observed download bytes.
- [x] Any changed default, visible model label and guide description agree with
  the selected artifact and preserve the existing controls and API.
- [x] `retrieve-prototype-answer.ts` and its tests handle only the empty SDK
  transport marker; the audit keeps raw output and actual reasoning failures.
- [x] The helper tests, browser type check and relevant docs checks pass; managed
  provenance is refreshed after the final user-guide edit.
- [x] Passage, citation and model-source links resolve to the actual published
  pages and headings, using the tested `retrieve-prototype-links.ts` mapping.
- [x] Dogfooding on the published site demonstrates a grounded command answer,
  correct counts, valid sources and missing-answer abstention. It also demonstrates
  cancellation, retry, answer interruption and unloading with the selected real model.
