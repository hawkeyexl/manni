---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# Validate grader options up front, not only while grading

## Context and Problem Statement

Every deterministic grader parsed its own `options` inline inside `grade()`, using ad-hoc `typeof` checks. Required keys were caught, but enum-valued keys were not. `expect: "usd"` on `tool-usage` matched no branch and fell through to `return pass`, so a typo produced a silently passing eval rather than an error. Separately, criteria authoring (`moose-tracevals fill`, ADR 01005) needs to know whether a proposed criterion's options are usable *before* a trace exists. There was no way to ask.

## Decision Drivers

- A criterion that cannot fail is worse than a missing criterion: it reads as coverage while asserting nothing.
- Option rules must have exactly one source of truth; a validator that drifts from the grader is a new defect class.
- `TraceGrader` and `registerGrader` are public API, so consumer-registered graders must keep compiling.
- Proposal-time validation must not require a `Trace`, since `fill` runs statically against artifacts.

## Considered Options

- **`validateOptions()` on the grader contract**: an optional method each grader implements; `grade()` calls it first, and authoring calls it directly.
- **A validation table inside `fill`**: leaves graders untouched, but restates every option rule in a second place.
- **Per-kind JSON sub-schemas** in `schemas/artifact-evals-*.json`, through `if`/`then` on `grader`. This catches bad options at frontmatter-validation time for every consumer. It also moves the rules away from the code that consumes them, and enlarges the published contract.

## Decision Outcome

Chosen option: "`validateOptions()` on the grader contract", because it puts the rules next to the code that reads them and serves both callers from one implementation.

- Signature is `validateOptions?(options: Record<string, unknown>): string | undefined`, returning a message when invalid and `undefined` when usable.
- **Optional, not required.** A required member would be a breaking change to a published interface. A consumer grader without it keeps working, and `fill` treats "not implemented" as "cannot ground-check, so do not propose this kind."
- Every built-in implements it, and `grade()` calls it first, returning the existing `optionsError(kind, message)` shape. A table-driven test asserts every *registered* kind implements it, so a new built-in cannot skip it.
- Shared checks (`requiredString`, `optionalEnum`, `optionalNumber`, `optionalBoolean`, `orderedBounds`, `requireOneOf`, `firstError`) live in `src/graders/util.ts` so each grader reads as a flat list of constraints.
- The published schema keeps `options` free-form. Per-kind sub-schemas were rejected here but not forever. If they land later, they should be generated from the graders, not hand-maintained beside them.

Two behavior changes follow, and are intended:

1. Unknown enum values (`expect`, `on`, `op`) now yield outcome `error` instead of a silent `pass`.
2. `turn-count` and `cost` with no bound configured at all (`{}`) now yield `error`. Such a criterion can never fail, which is the same defect in a different shape.

### Consequences

- Good, because a whole class of silently-passing criteria becomes a loud error naming the offending key.
- Good, because `fill` can reject a proposed criterion before it is ever written to a file.
- Bad, because a repo with an existing typo'd or unbounded criterion flips from `pass` to `error` on upgrade. That surfaces a latent defect, but is still a change in a previously green run.
- Neutral, because the grader contract grows one optional member.

### Confirmation

`test/unit/graders/validate-options.test.ts` pins it. A table-driven case asserts every kind in `listGraderKinds()` implements `validateOptions`, accepts that kind's minimal valid options, and rejects `{}`. Per-kind cases cover each enum, bound, and type rule. A final case grades a plan carrying `expect: "typo"` and asserts outcome `error` with no findings, proving `grade()` enforces the validator rather than merely exposing it.

## Pros and Cons of the Options

### `validateOptions()` on the grader contract

- Good, because one implementation serves grading and authoring.
- Good, because it is additive and optional, so no consumer breaks.
- Bad, because nothing forces a *consumer-registered* grader to implement it.

### A validation table inside `fill`

- Good, because the grader contract is untouched.
- Bad, because option rules would live in two places and drift silently.
- Bad, because it does nothing for the silent-pass defect in `run`.

### Per-kind JSON sub-schemas

- Good, because bad options would be caught at frontmatter-validation time with a line number, for every consumer.
- Bad, because the rules move away from the graders that consume them.
- Bad, because it enlarges a published schema whose `options` field is deliberately open for consumer-registered kinds.
