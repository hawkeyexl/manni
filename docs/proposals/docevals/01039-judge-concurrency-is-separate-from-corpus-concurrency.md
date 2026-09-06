---
status: "accepted"
date: 2026-08-31
decision-makers: [hawkeyexl]
---

# Judge concurrency is configured separately from corpus concurrency

## Context and Problem Statement

`defaults.concurrency` bounded everything a run does in parallel: deterministic graders and the judge stage alike. That was fine while every judge was a remote API, where four concurrent requests are four connections and the server does the work.

It stops being fine with a local model. `llama-cpp` runs inference **in-process**, against one set of loaded weights and one GPU. Judging this repo's docs corpus at the corpus-wide default of 4 produced `A context size of 24 is too large for the available VRAM` on every single run, in roughly a millisecond each. That left 65 of 68 evals unusable. The same corpus at one judge at a time works.

So one number was being asked to express two different constraints. One is how many *files* it is sensible to process at once. The other is how many *inference contexts* the machine can physically hold.

## Decision Drivers

- The right parallelism for shelling out to markdownlint has nothing to do with the right parallelism for a GPU-resident model.
- Throttling the whole run to fix the judge slows the deterministic graders in CI forever, for a reason that does not apply to them. `verify-docs` runs `tool:doc-detective` per file across 34 pages, and that is the slow part.
- The failure is loud but its *cause* is not. The error text names VRAM, not concurrency, and it appears identically on every eval.
- Existing configs must not change behavior.

## Considered Options

- **Lower `defaults.concurrency` for corpora that judge locally.**
- **Add `judge.concurrency`**, defaulting to `defaults.concurrency`.
- **Serialize inside the provider**, having `llama-cpp` hold a mutex over its own calls.
- Detect the provider and clamp concurrency automatically.

## Decision Outcome

The chosen option is to **add `judge.concurrency`, defaulting to `defaults.concurrency`.**

An unset value resolves to the corpus-wide number, so nothing changes for anyone who does not set it. `src/judge/judge.ts` reads `config.judge.concurrency` where it previously read `config.defaults.concurrency`. The docs corpus sets it to `1`, with the VRAM error quoted in a comment. The next person to wonder why it is throttled does not have to rediscover this.

**The better fix is upstream and this does not replace it.** `LlamaCppProvider` shares one model handle process-wide, so it is the only thing positioned to serialize access to it. A mutex there would make the provider correct under any caller's concurrency, rather than making every caller responsible for knowing. That belongs in `@hawkeyexl/inference`, per the standing rule that provider behavior is not reimplemented here. This knob is worth having regardless. Judging is the expensive stage. A user with an API key and a rate limit wants to bound it independently of how fast their linters run.

Automatic clamping by provider name was rejected. A config value that silently means something different depending on another config value is the kind of invisible behavior this repo avoids. It would also paper over the upstream bug so thoroughly that nobody would fix it.

### Consequences

- Good, because a corpus can judge serially while still linting in parallel, which is exactly what a local model needs.
- Good, because CI's deterministic path keeps its parallelism, so `verify-docs` does not get slower.
- Good, because the setting is greppable and commented at the place it is set. The VRAM failure is then diagnosable from the config rather than from a stack trace.
- Bad, because it is a second concurrency number, and someone tuning performance now has two places to look.
- Bad, because it puts the burden on the *user* of a local model to know they must set it. Until the provider serializes itself, a first-time local run at the default will fail loudly and confusingly. The error message is at least unambiguous once seen, and the `llama-cpp` documentation says so.

### Confirmation

`test/unit/config.test.ts` pins all three behaviors. Unset follows `defaults.concurrency`, including when that is itself overridden. An explicit `judge.concurrency` is independent of it, and a value below 1 is a config error. The read site is a single line in `src/judge/judge.ts`.

## Pros and Cons of the Options

### Lower `defaults.concurrency`

- Good, because it needs no code at all.
- Bad, because it throttles deterministic graders that have no such limit, permanently and in CI.
- Bad, because it conflates two constraints in one number, so nobody reading it later knows which one it was set for.

### Add `judge.concurrency`

- Good, because it separates two genuinely independent constraints.
- Good, because it is useful beyond local models. API rate limits want the same knob.
- Bad, because it is another setting, and the default must be a fallback rather than a constant to avoid changing existing behavior.

### Serialize inside the provider

- Good, because it makes the provider correct for every consumer, with no configuration.
- Good, because the provider is the only thing that knows it shares one model handle.
- Bad, because it lives in another repository and cannot land here. It remains the recommended upstream fix.

### Detect and clamp automatically

- Good, because it would just work.
- Bad, because one config key would silently mean different things depending on another, which is invisible at the point of reading.
- Bad, because it hides an upstream defect well enough that it never gets fixed.
