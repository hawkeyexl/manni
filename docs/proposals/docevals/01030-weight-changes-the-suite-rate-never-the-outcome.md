---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# `weight` changes a suite's rate, never an eval's outcome

## Context and Problem Statement

Every eval counted the same. A spec-literal check lifted from a style rule moved a suite's pass
rate as much as the assertion the page exists to satisfy. There was no way to
say otherwise. `severity` was the only dial, and it answers a different question: whether a
failure fails the run, not how much it counts.

## Decision Drivers

- The authoring guidance wants a way to mark a check *secondary* without silencing it.
  `severity: warning` says "this does not fail the run", which is a different claim.
- `claude plugin eval` scores a weighted pass fraction, and its interview tells authors to put a
  spec literal in at `weight: 0.5` paired with a primary outcome grader.
- SARIF, JUnit and the findings baseline all consume the *binary* per-eval outcome. A score leaking
  into that would change all three at once.

## Considered Options

- Keep severity as the only dial.
- A numeric score per eval, replacing the binary outcome.
- `weight` that feeds only the aggregate, leaving the outcome binary.

## Decision Outcome

Chosen option: **`weight` feeds only the aggregate**. It is a positive number defaulting to 1, on
both the config eval definition and the page vocabulary (`docmeta:evals:1.0.0-proposal.2`). A
suite's `passRate` becomes the weighted share of the graded set that passed; the per-eval outcome
is untouched, and so are the counts.

Zero is excluded (`exclusiveMinimum: 0`) deliberately: a weightless eval is a silent disable, and
`skip` already means that, loudly.

### Consequences

- Good, because it is inert until used. With every weight at 1 the rate is arithmetically
  identical to the one computed before, so no existing corpus moves.
- Good, because the graded set is unchanged (pass + fail + error). `needs-review` and `skipped`
  stay out of both halves, so a page awaiting review still neither helps nor hurts.
- Good, because counts stay unweighted. "1 failed" answers how many evals failed; the rate answers
  how much that mattered. Weighting the counts would have made both answers wrong.
- Bad, because a reader seeing three passes out of four and a rate of 0.6 needs to know a weight is
  in play. The human, markdown and HTML reporters show a weight when it is not 1.
- Neutral, because `target-pass-rate` needs no new meaning: it compares against the weighted rate,
  and against the unweighted one when nothing declares a weight.

### Confirmation

`test/unit/weight.test.ts` pins the arithmetic in both directions, with a heavier failure and a
heavier pass, plus a fractional weight for a secondary check. The important one is that a 100×
weight difference leaves every eval's outcome and the suite's counts identical. The fixture corpus
carries a `weight: 0.5` eval, and `.github/workflows/ci.yml` asserts the weight reaches the JSON
output.
