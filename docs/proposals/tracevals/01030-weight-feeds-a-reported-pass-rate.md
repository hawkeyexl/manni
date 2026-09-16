---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# `weight` feeds a reported pass rate, not a gate

## Context and Problem Statement

`docmeta:artifact-evals:1.0.0-proposal.2` added `weight` so an eval can contribute more or less
than its neighbours to an aggregate. moose-tracevals had no aggregate for it to feed:
`RunSummary` carried counts (`pass`, `fail`, `error`, `needsReview`, `skipped`) and no rate, and
there are no suites to attach a target to.

So the field could be written and would mean nothing. That is the worst outcome, because a schema
that accepts a value it ignores teaches authors that the schema is decoration.

## Decision Drivers

- The sibling repo consumes `weight` through a suite's pass rate compared against
  `target-pass-rate`. Neither concept exists here.
- Adding suites to get a home for one field would be a large change justified by a small one.
- A number nobody can act on is close to decoration too, so whatever ships has to be *readable*
  in the place people already look.

## Considered Options

- Accept `weight` and ignore it, documenting that it is page-side only.
- Add suites and per-suite targets, mirroring the page side.
- Add a run-level weighted `passRate`, reported and not gated.

## Decision Outcome

The chosen option is **a run-level weighted `passRate` on `RunSummary`**, reported and never gated.

It is the weighted share of the **graded** set, meaning `pass + fail + error`. That is exactly the
membership the counts already use, so `needs-review` and `skipped` stay out of both halves.
A session awaiting review neither helps nor hurts. The exit code is untouched: it still derives from
outcomes and `failOnNeedsReview`.

### Consequences

- Good, because `weight` now does something observable, and a secondary check can report without
  dominating the number.
- Good, because it is inert by default. With every weight at 1 the rate is plain pass-over-graded,
  which is what the counts already imply. The human reporter prints it **only** when some weight
  differs from 1, so the common run gains no second way to read the same number.
- Good, because counts stay unweighted. "1 failed" answers how many evals failed; the rate answers
  how much that mattered. Weighting both would make each answer the other's question.
- Good, because the weight is stamped onto each `EvalResult`. A `--format json` consumer can
  see *why* a rate moved rather than having to re-derive it from the config.
- Neutral, because there is deliberately no target to miss. Inventing an exit-code rule around a
  number nobody configured would be a gate no one asked for. The page side's
  `target-pass-rate` is a *suite* property, which is the concept this repo does not have.
- Bad, because a rate with no threshold is easy to ignore. That is the honest cost of not
  inventing suites, and the decision is revisable the day suites arrive.

### Confirmation

`test/unit/engine.test.ts` pins that every result carries a weight defaulting to 1, and that the
rate reduces to plain pass-over-graded at that default. It also pins that `needs-review` and
`skipped` are in neither half, and that changing an eval's contribution never changes its own
outcome or the counts.
