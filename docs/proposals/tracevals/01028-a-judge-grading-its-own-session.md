---
status: "accepted (signature superseded by 01031)"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# A judge grading its own session is reported

## Context and Problem Statement

moose-tracevals asks a model whether a session adhered to the instructions it was given. Nothing
stopped that model being **the model that ran the session**. `Trace.model` was already parsed and
already reported in the run summary; it was simply never compared against the judge.

This is the sharpest form of self-preference bias in either moose tool. The sibling, moose-docevals,
asks a model whether a document it may have drafted is any good. Here the question is
whether the model's *own conduct* followed the rules, which is not a question a neutral party is
being asked.

## Decision Drivers

- The comparand was already on disk. The check cost nothing but the wiring.
- A biased verdict that looks identical to an unbiased one in every report is the failure worth
  preventing.
- An absent `Trace.model` must not read as "not the same model". Some adapters do not record one.

## Considered Options

- Refuse to judge when the models match.
- Report it on the result and leave the verdict standing.
- Warn on stderr.

## Decision Outcome

The chosen option is to **report it on the result**. `EvalResult.selfPreference` carries
`{ axis: "session", model }`, set when the effective judge model for that eval equals
`Trace.model`. The judge signature gained a `sessionModel` parameter rather than the whole trace,
so the comparison is explicit at the call site.

The comparison uses the model that **actually judged that eval**, since tracevals already resolves
per-eval provider overrides. An eval naming its own model is precisely the case a
run-wide comparison would miss.

### Consequences

- Good, because a verdict formed by the session's own model is now visibly so, wherever the run is
  read.
- Good, because it is free: no extra call, no extra parsing.
- Neutral, because it stays a **report, not a failure**. Bias skews a verdict; it does not stop one
  forming. Failing here would also punish the common single-model setup, where there is no second
  provider to reach for. The useful response is to judge with a different model, and the report is
  what tells you to.
- Bad, because a missing `Trace.model` yields no check at all, and silence there is
  indistinguishable from a clean result. Unknown is unknown. Treating it as "different models"
  would be a silent all-clear, so the tests pin that it produces no flag rather than a pass.

### Confirmation

`test/unit/self-preference.test.ts` pins the flag when the models match, and its absence when they
differ. It also pins its absence when the trace records no model, deliberately and with the
reasoning.
