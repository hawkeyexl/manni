---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# A local `llama-cpp` judge provider

## Context and Problem Statement

Every judge provider needed either an API key (`anthropic`, `openai`) or an authenticated CLI
(`claude-cli`). That has a concrete cost this repo pays. `docs/.moose-docevals-cache/` exists so
the `verify-docs` job can replay judged verdicts **without** `ANTHROPIC_API_KEY`, and its README
says so. The directory is empty, because populating it requires a contributor who has a key.
The docs corpus's `ai` evals are skipped on every run, in CI and locally.

## Decision Drivers

- A contributor without provider credentials should be able to regenerate the committed cache.
- `@hawkeyexl/inference` gained an in-process `llama-cpp` provider over GGUF weights (0.2.0+). It
  reaches `node-llama-cpp` as an **optional** peer through a dynamic import, so consumers that do
  not ask for local models pay no install cost.
- The tool already routes every provider through `providerSpecFor`, so a fourth is a case arm.

## Considered Options

- Stay on hosted providers; leave the cache empty.
- Point `openai` at a local OpenAI-compatible server (llama.cpp's server mode, Ollama).
- Add `llama-cpp` as a first-class provider.

## Decision Outcome

The chosen option is to **add `llama-cpp` as a first-class provider**, and upgrade
`@hawkeyexl/inference` to `^0.3.1` to get it.

```yaml
docevals:
  provider:
    default: llama-cpp
    llama-cpp:
      model: balanced          # auto | fast | balanced | quality, or a pinned ref
      thought-tokens: 0
```

The default model is the named tier `balanced` rather than `auto`. Both are resolved against the
machine, but a named one means two contributors reading the config see the same intent.
`thought-tokens` defaults to 0 because a grammar constrains generation from the first token, so an
unbudgeted thinking model starts reasoning and is cut off mid-thought.

### Consequences

- Good, because judged evals become reachable with no API key and no network at judge time once the
  weights are on disk. That is exactly what the committed docs cache was designed around.
- Good, because it needs no separate server process, unlike pointing `openai` at a local endpoint.
- Good, because the library resolves a tier to a *concrete* model before any cache key is built.
  Two machines never share a verdict under one tier name.
- Bad, because it owns weights: gigabytes downloaded on first use and held in RAM once loaded.
- Bad, because `node-llama-cpp` is a native module. It stays an optional peer dependency reached by
  dynamic import, so nobody who does not select this provider pays for it.
- Neutral, because verdict quality is a local model's quality. `calibrate` is the instrument for
  deciding whether a given model is trustworthy on a given corpus. ADR 01027 now stops it
  certifying on a one-sided golden set, which matters more, not less, with a smaller judge.

### Confirmation

`test/unit/config.test.ts` pins the defaults, that `llama-cpp` is accepted as
`provider.default`, and that an unknown key inside the section is rejected. `providerSpecFor` maps
the config to the library's `ProviderSpec`; no provider is reimplemented here, per the standing
rule that the library owns providers, ensembles, caching and pricing.
