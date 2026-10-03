---
status: "accepted"
date: 2026-08-03
decision-makers: [hawkeyexl]
---

# Take the inference layer from `@hawkeyexl/inference`

## Context and Problem Statement

`src/judge/providers/`, `src/judge/cache.ts`, and `src/judge/cost.ts` were the original of a layer
that had since been copied into dockg (`src/llm/`) and agentevals (`src/judge/`). The three copies
drifted, and each ended up holding a fix the others lacked. moose-docevals was missing the
OpenAI-strict-mode work that dockg had grown (`toStrictSchema`, null-stripping, the opaque
`HTTP 400` fallback), and the `claude-sonnet-4-6` price agentevals had added.

The copies also made moose-docevals an accidental library. agentevals depended on it via
`"docevals": "file:../docevals"` purely to reach `makeProvider`, `MockProvider`, `computeConsensus`,
and `zoneFor`. npm publishes such a spec verbatim, which blocked agentevals from publishing at all.
An eval tool should not be a peer tool's inference vendor.

## Decision Drivers

- A provider fix should land once, not three times.
- The exec seam is shared. `realExec` serves both the judge's subprocess provider and the
  command/tool graders, so it cannot simply follow the providers out of the repo.
- moose-docevals' judge stage is genuinely more than an ensemble. It adds concurrency, a budget, a
  self-judgment warning and human review, and that orchestration is not shareable.

## Considered Options

- Depend on `@hawkeyexl/inference`
- Keep the code and let the other two depend on moose-docevals
- Keep three copies and hand-port fixes

## Decision Outcome

The chosen option is to **depend on `@hawkeyexl/inference`**. `src/judge/providers/`, `src/judge/cache.ts`
(the class), `src/judge/cost.ts`, and `src/judge/types.ts` are deleted.

What stays in `src/judge/` is what only moose-docevals can decide:

- `prompt.ts` holds the prompts, `cleanBody`'s fence-aware MDX stripping, and `PROMPT_VERSION`.
- `verdict-schema.json` is structurally the library's canonical schema, but worded for pages.
  Passed as the library's `schema` override, because field descriptions are prompt surface.
- `cache.ts` is cache-key composition only. What invalidates an entry is moose-docevals' business; the
  storage is the library's `JsonCache`.
- `provider.ts` is the config → `ProviderSpec` mapping.
- `judge.ts` is the orchestration around `runEnsemble`: the bounded-concurrency pool across targets,
  the cost budget, the self-judgment warning, and human-review resolution.

**The exec seam is re-exported, not repointed.** `src/graders/exec.ts` now re-exports the library's
`realExec` and keeps only `outputTail`; `src/graders/types.ts` re-exports `ExecFn`/`ExecOptions`/
`ExecResult`. Every existing grader import keeps working unchanged, and the toolchain has one
cross-spawn wrapper. That matters because the tricky parts are all Windows-specific. They are npm
`.cmd` shim resolution without `shell: true` and stdin piping past the ~32K command-line limit.
They also include StringDecoder-backed output, so multi-byte UTF-8 survives chunk boundaries.

The judge vocabulary is re-exported from `src/types.ts` rather than defined twice. That covers
`Match`, `Zone`, `JudgeVerdict`, `JudgeRun` and `ConsensusResult`.

### Consequences

- Good, because moose-docevals gains the OpenAI strict-mode handling and the missing model price without
  anyone having to notice they were absent.
- Good, because agentevals could drop its `file:../docevals` dependency, which unblocked its
  publishing. moose-docevals is no longer anyone's accidental library.
- Good, because one exec implementation serves graders and providers alike.
- Bad, because judge behavior now moves when the library releases. Mitigated by a semver range and
  by the library's own suite covering the mechanics moose-docevals used to own.
- Neutral, because cache keys change: `buildCacheKey` length-prefixes its parts, so existing
  cached verdicts miss once. They are an optimization, not state.

### Confirmation

`test/unit/provider.test.ts` pins the config → `ProviderSpec` mapping, including the pricing
override and that the identity resolves without an API key. The pre-existing judge, engine, and
grader suites pin that the orchestration around `runEnsemble` is unchanged. The grader path is the
one worth checking by hand on Windows: `realExec(["npx", "--no", "tsc", "--version"])` must still
resolve the `.cmd` shim, which it does.

## Pros and Cons of the Options

### Depend on `@hawkeyexl/inference`

- Good, because the shared layer has one home, one suite, and one release.
- Good, because `ProviderSpec` is library-owned, so moose-docevals' config schema stays moose-docevals' own.
- Bad, because it is another first-party dependency to keep current.

### Let the others depend on moose-docevals

- Good, because no new package.
- Bad, because this is what was already happening. It produced an unpublishable `file:` spec in
  agentevals, plus a YAML round-trip through `parseConfig` to satisfy a factory signature. It also
  freezes moose-docevals' public API around other tools' needs.

### Keep three copies

- Bad, because the four divergent fixes above are the evidence against it. Each was written once
  and never propagated.
