---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# Adopt `docmeta:artifact-evals:1.0.0-proposal.2`

## Context and Problem Statement

The vendored vocabulary moved to `1.0.0-proposal.2` upstream, carrying `weight`, `target`, `runs`
and `model`, an encoded `eval-` prefix guard inside `metadata`, and one correction that matters
here: **`assertion` is no longer flatly required**.

That correction is the reason this ADR exists. `artifact-evals` required `id` *and* `assertion`,
while the page-side `evals` required only `id` and demanded an assertion **conditionally**, for
`ai`, for `human`, and for a bare entry (which defaults to `ai`). So a `tool-usage` criterion, whose
`options` say everything there is to say, had to carry a sentence no grader ever read. It was the
one place two vocabularies described as "sharing the entry shape" disagreed about the same
question.

## Decision Drivers

- A required field nothing reads teaches authors that the schema is decoration.
- Anything that genuinely needs an assertion must still be made to have one. Relaxing the rule
  must not let an `ai` criterion through without the text its judge reads.
- The vendored copy must stay byte-identical to docmeta's; divergence is how two schemas drift.

## Considered Options

- Keep `assertion` required and accept the empty sentences.
- Drop `assertion` from `required` and accept that an `ai` eval might lack one.
- Port the page side's conditional block.

## Decision Outcome

The chosen option is to **port the conditional block**. `required` becomes `["id"]`, and `allOf` now demands
`assertion` for `grader: ai`, for `grader: human`, and for an entry with no `grader` at all; a
`command` entry needs either an assertion or a command.

In code, `assertion` becomes optional on `EvalEntry`, `EvalPlan` and the write path. The command
grader gained a guard. A `generated-assertion-hash` with no assertion is now an explicit error.
The hash exists to detect that the assertion changed, and there is nothing to check it against.
Hashing the empty string and passing would be the silent version.

### Consequences

- Good, because a deterministic criterion says what it means in `options` and nothing else.
- Good, because the two eval vocabularies now answer the same question the same way.
- Good, because the guard on the orphaned hash closes a hole the relaxation would otherwise have
  opened.
- Bad, because `assertion` is now optional in a type that most code paths read. Each site had to
  decide what absence means rather than assuming a string.

### Confirmation

`test/unit/schema.test.ts` pins the vocabulary id and the shipped path, and
`test/unit/graders/validate-options.test.ts` covers the new grader's options. The upstream
ladder (`docs/proposals/0023/ladders/artifact-evals-examples.cjs`) asserts that `ai`, `human` and
bare entries still fail without an assertion while `tool-usage` passes without one.
