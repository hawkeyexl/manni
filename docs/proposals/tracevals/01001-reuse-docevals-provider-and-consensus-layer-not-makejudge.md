---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# Reuse docevals' provider and consensus layer, not makeJudge

## Context and Problem Statement

docevals exports both a full ensemble judge (`makeJudge`) and the layers beneath it (`makeProvider`/`JudgeProvider`, `MockProvider`, `computeConsensus`, `zoneFor`). Which boundary should moose-tracevals build its trace-adherence judge on?

## Decision Drivers

- `makeJudge` is page-coupled end to end. It takes `GraderTarget[]` of `ResolvedPagePlan`s, reads page bodies and files, and loads page-keyed human reviews. Its prompt hardcodes "# Page content".
- docevals' `JudgeCache` and `verdict-schema.json` are not exported.
- The safety invariants worth inheriting live in `computeConsensus` and `zoneFor`, not in `makeJudge`. Those are that errored runs count against consensus and can never produce a silent pass. A tie is not a pass, and confidence-zone routing belongs there too.

## Considered Options

- Reuse `makeProvider` + `MockProvider` + `computeConsensus` + `zoneFor`; write a trace-specific ensemble wrapper
- Refactor docevals to generalize `makeJudge` over a content abstraction, then reuse it
- Fork the judge code into moose-tracevals

## Decision Outcome

Chosen option: "Reuse the provider and consensus layer". `src/judge/trace-judge.ts` implements the ensemble loop, mirroring docevals' `singleRun` behavior. That loop is N runs at temperature 0, a retry once on invalid JSON before recording an errored run, and a cost budget. It carries its own trace-adherence prompt (`PROMPT_VERSION`ed), its own verdict schema of identical shape (`claim`, `observed`, `match`, `confidence`, `reasoning`), and its own content-addressed cache. Consensus and zone routing are delegated to the imported docevals functions.

### Consequences

- Good, because the inherited invariants cannot drift from docevals' tested behavior.
- Good, because no docevals release is needed to ship moose-tracevals changes.
- Bad, because the ~150-line ensemble wrapper is structurally parallel to docevals' and fixes there must be considered here.

### Confirmation

`test/unit/` judge tests drive the wrapper through `MockProvider` ensembles (pass, fail, split, errored). They assert the consensus/zone outcomes match docevals semantics, including that an all-errored ensemble routes to human-review, never pass.

## Pros and Cons of the Options

### Reuse provider + consensus layer

- Good, because clean seam that exists today.
- Bad, because small amount of parallel orchestration code.

### Generalize makeJudge upstream

- Good, because one ensemble implementation.
- Bad, because blocks this work on a docevals refactor and release, and forces a premature content abstraction on a docs tool.

### Fork the judge code

- Good, because full control.
- Bad, because the invariants become copies that can silently diverge.
