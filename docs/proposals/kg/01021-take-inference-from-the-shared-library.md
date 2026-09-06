---
status: "accepted"
date: 2026-08-03
decision-makers: [hawkeyexl]
---

# Take the inference layer from `@hawkeyexl/inference`

## Context and Problem Statement

`src/llm/` was a fork. Its header said so outright: "Provider abstraction for the AI fill feature
(ported from docevals)". docevals and agentevals carried the same code. Three copies then
drifted independently, and each ended up holding a fix the others lacked:

- dockg's `claude-cli` provider passed the prompt as an argv element, so any document large enough
  to push the command line past Windows' ~32K limit failed. docevals had already fixed this by
  piping through stdin.
- dockg's `FillCache.set` threw on a write failure, so a read-only workspace aborted a run whose
  proposals had already been generated and paid for. The other two warned once and continued.
- dockg's `openai-compat` had `toStrictSchema`, null-stripping, and the opaque-`HTTP 400` fallback;
  the other two did not.
- Three price tables, only one of which knew `claude-sonnet-4-6`.

Nothing about SKOS field extraction is specific to any of that. Where should the shared layer live?

## Decision Drivers

- A provider fix should land once, not three times, and not silently only where someone noticed.
- `dockg fill` is structured extraction, not judging, so it must not drag in eval machinery.
- The exec seam is used by `core/git.ts` as well as the providers, so it cannot simply be deleted.

## Considered Options

- Depend on `@hawkeyexl/inference`
- Keep the fork and hand-port fixes between the three repos
- Extract into docevals and depend on that

## Decision Outcome

The chosen option is to **depend on `@hawkeyexl/inference`**. `src/llm/{cache,cost,exec,types}.ts`
and all of `src/llm/providers/` are deleted. What remains in `src/llm/` is what only dockg can
decide: the SKOS prompt and proposal schema, the cache-key composition, and the config →
`ProviderSpec` mapping.

`core/git.ts` takes `realExec` and `ExecFn` from the library too, so the toolchain has one exec
implementation. `@anthropic-ai/sdk` and `cross-spawn` are no longer direct dependencies; they
arrive transitively.

Two consequences worth naming:

1. **`fill` now retries once.** It previously threw on the first schema-invalid response, failing
   the document. Losing a document's work to one malformed completion is the worse failure mode, so
   the library's retry-once semantics are adopted as-is. The **validation** stays deliberately
   lenient, though. The request schema is narrowed to the document's missing fields, while
   validation uses the wider configured-field schema. A provider that volunteers extra
   fields is tolerated and narrowed afterwards rather than failed. The library's `validate` option
   is what makes that separation expressible.
2. **`proposalSchema` is memoized** on the sorted field set. It builds a fresh object per call,
   which would defeat the library's identity-keyed validator cache and recompile Ajv once per
   document.

This also required one upstream change. The library's `ExecOptions.env` was typed
`Record<string, string>`. ADR 01005 has dockg clearing inherited `GIT_*` variables by mapping
them to `undefined`, and empty string is not the same as unset to git. The library's `realExec`
already supported it, since Node omits undefined-valued keys when building the child environment.
Only the type was wrong. Widened upstream in `@hawkeyexl/inference@0.1.0`.

### Consequences

- Good, because dockg silently gains the Windows stdin fix and the non-throwing cache, neither of
  which anyone here would have thought to look for.
- Good, because `fill` no longer loses a document to a single malformed response.
- Good, because two direct dependencies go away.
- Bad, because fill behavior now moves when the library releases. Mitigated by a semver range and
  by the library's own suite covering the mechanics dockg used to own.
- Bad, because a retried request under-reports cost. `InferenceRun` carries only the successful
  attempt's usage, so a failed first attempt's input tokens are not billed against the budget. The
  error is bounded by one request per retry, and only on the failure path.

### Confirmation

The determinism gate is the real check for `core/git.ts`: two `dockg build` runs over
`test/fixtures/corpus` must be byte-identical and must match `test/fixtures/golden/graph.ttl`. Both
hold. `test/unit/fill.test.ts` pins the new retry on both a schema-invalid first response and a
transient provider error. The pre-existing cycle-rejection test pins that lenient validation
survived, and fails if the request schema is used for validation.

## Pros and Cons of the Options

### Depend on `@hawkeyexl/inference`

- Good, because the shared layer has one home, one test suite, and one release.
- Good, because `ProviderSpec` is a flat library-owned shape, so dockg's `fill.*` config keys stay
  dockg's business.
- Bad, because it is another first-party dependency to keep current.

### Keep the fork

- Good, because dockg controls its own timeline.
- Bad, because this is precisely what produced the four divergent fixes above. The Windows argv bug
  sat in this repo unnoticed while the fix existed one directory over.

### Extract into docevals

- Bad, because docevals is a tool, not a library, and is not published. agentevals tried exactly
  this and ended up with an unpublishable `file:` dependency for its trouble.
