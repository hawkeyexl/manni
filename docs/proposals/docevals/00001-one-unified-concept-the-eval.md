---
status: "accepted"
date: 2026-08-31
decision-makers: [hawkeyexl]
---

# One unified concept, the eval, with the grader as the only axis of difference

**Backfill.** This records a decision made before the ADR rule existed; until now it lived only as a bullet in [CLAUDE.md](../CLAUDE.md#design-decisions). The date is when the record was written, not when the decision was taken.

## Context and Problem Statement

An early design for this tool had two top-level concepts. **Runners** wrapped deterministic tools such as markdownlint, Vale and docmeta. **Evals** were natural-language assertions handed to an LLM. A page's frontmatter would configure both, separately, with separate vocabulary and separate CLI surface.

The question this forced on every user was: *is the thing I want to check a runner or an eval?* And the honest answer was that it depended on an implementation detail they had no reason to care about.

## Decision Drivers

- **The user's mental model is "a thing I want to be true about this page."** That is one concept, not two.
- The split leaks an implementation detail, *how* a check is decided, into the primary interface.
- Two concepts means two config shapes, two result shapes, two reporters' worth of special-casing, and two places for every future feature to land.
- A check should be able to *move* between mechanisms without the user rewriting it. Today's LLM assertion is tomorrow's generated script.

## Considered Options

- **Runners and evals as separate concepts**, each with its own frontmatter key and CLI surface.
- **One concept, the eval, with a `grader` field** naming what decides it.
- One concept, with the grader *inferred* from which other fields are present.

## Decision Outcome

The chosen option is **one concept, the eval, with an explicit `grader` field.**

Every quality check on a page is an eval. It is a named, testable assertion plus a grader that returns pass or fail. `GraderKind` in [src/types.ts](../src/types.ts) is `"ai" | "command" | "human" | \`tool:${string}\``, and that union is the *entire* axis of variation. The pipeline in [src/core/engine.ts](../src/core/engine.ts) runs graders cheapest-first, deterministic before the AI judge. That is an ordering optimization inside one concept, not a type distinction.

`grader` defaults to `ai`. An assertion someone typed in prose with no further ceremony is the common case, and the one that should need the least configuration.

### Consequences

- Good, because a check can be **promoted** down the grader hierarchy without being rewritten. `moose-docevals promote` moves an `ai` eval to a generated `command` while keeping its name, its assertion, and its history. That is only coherent because they were the same kind of object all along.
- Good, because one result shape (`EvalResult`) means reporters, the baseline, suites, and selection each have one thing to handle. SARIF, JUnit, and the GitHub reporter did not each need a runner branch.
- Good, because suites mix graders freely. `docs-page-full` in the docs config lists `tool:doc-detective`, `tool:docmeta`, `tool:markdownlint`, `tool:reading-level`, and two `ai` evals as peers.
- Bad, because "eval" now covers things with genuinely different cost and latency profiles, and users must learn that a grader choice is a cost choice. The docs carry that weight instead of the type system.
- Neutral, because the word "runner" survives nowhere, in code, config, or docs, so there is no migration to describe.

### Confirmation

The union in `src/types.ts` is the enforcement: adding a check mechanism means adding a `GraderKind`, and there is no second concept to add it to. `src/graders/registry.ts` is a flat map keyed by that kind. A reviewer seeing a proposal for a parallel top-level concept should read this ADR before accepting it.

## Pros and Cons of the Options

### Runners and evals as separate concepts

- Good, because each could have config precisely shaped to its mechanism, with no unused fields.
- Bad, because it asks the user to classify their intent by our implementation.
- Bad, because moving a check between the two is a rewrite. That makes the cheapening path, the whole point of `promote`, expensive enough that nobody walks it.

### One concept with an explicit `grader`

- Good, because the primary interface matches how people describe what they want.
- Good, because it makes the grader hierarchy visible and therefore teachable.
- Neutral, because some fields apply to only some graders (`command`, `success-exit-codes`, `options`), which the published schema handles with conditional subschemas.

### One concept with an inferred grader

- Good, because it is the least to type.
- Bad, because inference from field presence is invisible and fails silently: adding a field would silently change which mechanism decides a check. The reserved `eval-` prefix and the loud-typo property exist precisely to avoid that class of surprise.
