---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Exercising the LLM providers without a paid key

## Context and Problem Statement

[ADR 01026](01026-exercise-every-third-party.md) named the four LLM providers as its largest
outstanding exception. `MockProvider` stands in for all of them, and none has been driven against
anything real. `fill` is the one dockg command that talks to an external service, and it is the one
with no real-path coverage at all.

The work came with a constraint. **No paid API keys, and no Claude Code credentials in the test
path.** Whatever covers these providers has to be free and local.

## Decision Drivers

- A test that runs green while the mechanism under test is ignored is worse than no test. It
  reports coverage that does not exist.
- The two providers use *different* structured-output mechanisms, so "does a local server accept
  the request" is not the question. The question is whether it honors the constraint.
- dockg's chain from config to provider is synchronous, and `makeProvider` is re-exported from
  `src/index.ts`. Making it async breaks dockg's own API.
- The default suite must stay hermetic.

## Considered Options

1. **Ollama for the OpenAI path; the Anthropic path stays a recorded exception.**
2. **Ollama for both**, since it exposes an Anthropic-compatible `/v1/messages`.
3. **A proxy** (LiteLLM or a shim) in front of Ollama to implement forced tool calls.
4. **Paid keys** for both, on a nightly with a cost cap.

## Decision Outcome

**Option 1 was chosen**, on measured behavior rather than what the compatibility tables claim.

### The OpenAI path is genuinely exercisable

`OpenAICompatProvider` asks for structured output with
`response_format: {type: "json_schema", strict: true}`. Ollama's OpenAI layer maps that onto its
native `format` field, which llama-server compiles to a **GBNF grammar**. That is real constrained
decoding, not an advisory hint. The library's strict-mode rewrite (which emits `["string","null"]`
type unions) survives the grammar conversion, because llama.cpp's schema-to-grammar handles array
types explicitly. Both branches of the provider are reachable. An unconvertible schema returns an
error message matching the provider's fallback regex, so the `json_object` path fires as designed.

So `test/real/fill-openai.test.ts` runs the whole of `dockg fill` against a real server, free, in a
`fill-live` job. That covers prompt, schema, grammar, validated retry, cache, and frontmatter
write.

### The Anthropic path would be green and hollow

`AnthropicProvider` uses a **forced tool call**: `tools` plus
`tool_choice: {type: "tool", name: "record_result"}`, and it throws if the response carries no
`tool_use` block. Ollama's Anthropic-compatible endpoint has `ToolChoice` in its request struct, so
the request parses and returns 200. It **never reads it**, and nothing constrains the output.

A test there would prove the model *felt like* calling a tool on that run, not that the forcing
mechanism works. Worse, when the model declines, the provider throws, so the test would fail
intermittently in a way that looks like a library bug. **An accepted-and-ignored directive is the
exact failure mode ADR 01026 exists to eliminate.** Adding a test for it would import that
failure rather than remove it.

The Anthropic path therefore stays an exception, now with a measured reason rather than "not done
yet". Note the mechanism is *library* code: dockg's own surface is the config → `ProviderSpec`
mapping, and that is covered hermetically in `test/unit/provider.test.ts`. What is uncovered is
whether the library forms a correct Anthropic request, and that belongs upstream.

Option 3 was rejected as a dependency, whether a Python proxy or an unvetted third-party shim.
Its own correctness would then be load-bearing for dockg's test. Option 4 was ruled out by the
constraint.

### The local provider

Upgrading to `@hawkeyexl/inference@^0.3.1` adds `llama-cpp`, an in-process model with no key, no
network and no spend. Not 0.2.0 or 0.3.0. There the local provider's `completeJSON` failed on
*every* call against real weights until a GBNF open-brace bug was fixed. The bump also deduplicates
a second copy that `docmeta` was pulling in, so dockg and docmeta now drive the same code.

**dockg requires an explicit `fill.model` for it.** The library's default is the selector `auto`,
which resolves against the machine's memory and so cannot be resolved synchronously; the sync
factory throws. Rather than surface a message about a selector the user never typed, dockg refuses
with what to do instead. Supporting `auto` would mean `makeProviderAsync`, and therefore an async
`makeProvider`. That is a breaking change to dockg's public API for a convenience. Recorded as a
later decision.

### Consequences

- `fill.provider` gains a fifth value, across all seven places the enum is mirrored.
- **`INFERENCE_NO_AUTO_INSTALL` is set for the whole default suite.** The library installs
  `node-llama-cpp` on demand into `~/.hawkeyexl-inference/runtime`; without the guard, a test that
  reached the local provider by accident would download from the network. That is the one thing
  `npm test` must never do.
- There is a type trap the compiler cannot catch. Since 0.2.0 the library's
  `ProviderSpec["provider"]` is `ProviderSelector | undefined`, so the old cast silently admitted
  `undefined` and `"auto"`, both of which the sync factory throws on. The cast now goes through dockg's narrower `ProviderName`.
- `fill-live` is a separate job with a model cache. A cold pull of `llama3.2:1b` is 8–12 minutes and
  a cache restore is well under one, so the cache is not optional.
- Assertions are about shape and mechanism, never content. A 1B model under grammar constraint
  emits schema-valid JSON whose *values* may be nonsense. Asserting on values would make the job
  flaky for a reason unrelated to dockg.

### Confirmation

- `test/real/fill-openai.test.ts` makes a real structured-output call that writes frontmatter. It
  verifies the unpriceable-budget path from [ADR 01027](01027-unenforceable-cost-caps.md) against
  a real provider rather than a mock. It also proves the cache makes no HTTP call on a second
  identical run.
- `test/unit/provider.test.ts` covers the config to spec mapping, including the local provider's
  missing-model refusal in dockg's own words.
- The default suite stays hermetic, at 624 tests with no network.

## Pros and Cons of the Options

### 1. Ollama for OpenAI; Anthropic recorded

- Good, because every test that exists proves something, and the gap that remains is named with the
  measurement behind it.
- Good, because it costs nothing and needs no credentials.
- Bad, because dockg's default provider is `anthropic`, so the most-used path stays uncovered.

### 2. Ollama for both

- Good, because it would look complete.
- Bad, because it would be false. `tool_choice` is accepted and discarded. The test would assert
  a mechanism that is not running, and fail intermittently when the model declined the tool call.

### 3. A proxy in front of Ollama

- Good, because it could genuinely implement forcing.
- Bad, because dockg's provider coverage would then rest on an unvetted third-party shim, or on
  adding Python to CI.

### 4. Paid keys

- Good, because it is the only way to exercise the real services.
- Bad, because it was excluded by the constraint. It also puts a spend dependency in CI, for a
  project whose whole posture is that nothing costs money unless you ask for it.
