---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# Per-eval `runs`, and the judge context that carries them

## Context and Problem Statement

The ensemble count was a single run-wide number (`options.runs ?? 3`). Every eval bought the same
amount of agreement. A high-stakes adherence claim and a cheap one cost the same, and were
trusted the same. `docmeta:artifact-evals:1.0.0-proposal.2` added a per-eval `runs` (and `model`,
beside the `provider` override this repo already had).

Wiring `runs` was small. What needed deciding was how the judge gets the rest of what it now
needs. `target` selection (ADR 01029) wants the parsed `Trace`, and the self-preference check
(ADR 01028) had just taken a `sessionModel` string as a third positional parameter.

## Decision Drivers

- Precedence has to match the sibling repo's, or two tools in one family disagree about what a
  flag means.
- The judge's signature had already grown one positional parameter this week; growing it again per
  need is how a signature becomes unreadable.
- A judge invoked without a parsed trace must still work; the tests do exactly that.

## Considered Options

- Keep adding positional parameters (`sessionModel`, then `trace`, then `projectRoot`).
- Pass the whole engine options object.
- One small named context object.

## Decision Outcome

**Precedence is CLI > eval > default**, for `runs` as for `model`. The flag is an explicit
operator act ("run cheap right now"), so it outranks an eval asking for more agreement. The
eval outranks the run default, which is the point of having it.

**The third parameter becomes `TraceJudgeContext`**, shaped `{ trace?, projectRoot? }`, replacing
the `sessionModel` string. The model is read from `trace.model`, so the caller stops pulling one field
out to pass it separately.

This **supersedes the signature decision in ADR 01028**, which chose a `sessionModel` string as a
third positional parameter rather than the whole trace. That reasoning was sound on its own
evidence. The check needed one field, and handing the judge a whole trace to read one string is
over-supply. It stopped being sound one ADR later, when `target` needed the trace anyway. ADR
01028 is otherwise unchanged and still governs *what* the self-preference check reports; only its
parameter shape is replaced here.

### Consequences

- Good, because a flaky or high-stakes eval can buy more agreement than a cheap one, which a
  run-wide setting cannot express.
- Good, because the effective count is part of the cache key already, so two counts cannot share a
  verdict.
- Good, because the context object absorbs the next thing the judge needs without another
  positional parameter. It made the self-preference wiring simpler rather than more complex, with
  one field replaced by the object it was extracted from.
- Neutral, because `trace` stays optional. Without it the judge serves `transcript` and `artifact`
  targets, and reports plainly that the others need the parsed session. It does not quietly grade
  the transcript in their place. It does not treat an unknown session model as "different
  model", which would be a silent all-clear on the self-preference check.
- Bad, because it is a breaking signature change for any consumer holding a `TraceJudge`. The
  package is unpublished, so the cost is limited to this repo's own tests.

### Confirmation

`test/unit/weight-target-runs.test.ts` pins the default of three, a smaller per-eval count, and an
explicit `--runs` overriding the eval. `test/unit/self-preference.test.ts` now builds its session
through the context object, which is also what proves the model still reaches the check.
`test/unit/weight-target-runs.test.ts` pins that a per-eval `model` actually builds a
provider at that model, and that naming the running model builds nothing. It pins that an
explicit `--model` outranks the eval, asserting the precedence above rather than
describing it.
