---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# Self-preference is reported on the result, not warned to stderr

## Context and Problem Statement

A model judging its own output favours it. moose-docevals knew this: `judge.ts` carried a
"Safeguard layer 1" that compared a page's `generated-by` against the judge model and called
`console.warn`. Four things were wrong with it.

1. **stderr only.** The warning reached no reporter, not JSON, not SARIF, not JUnit, and not the HTML
   report. A verdict formed under self-preference looked identical to every other verdict in every
   consumable output.
2. **It compared against the run-wide model.** Once an eval can pin its own `model` (ADR 01035), an
   eval naming the generating model would bypass the check entirely.
3. **It deduped globally by model name**, so it named only the *first* affected page and stayed
   silent for every other page with the same problem.
4. **It only knew about the page's author.** `eval-provenance` already records which model
   *proposed* an assertion, and `fill` already writes it.

## Decision Drivers

- A bias marker that only reaches stderr is invisible to CI, to a PR comment, and to anyone reading
  a report later. That is everyone who matters.
- Self-preference has more than one axis, and the axes have different remedies.
- ADR 01022's "no verdict fails" rule is about verdicts that never formed. A biased verdict formed.

## Considered Options

- Keep the stderr warning, fix the model comparison.
- Mark the result and emit a run problem; keep it a warning.
- Fail the eval outright.

## Decision Outcome

The chosen option is to **mark the result and emit a run problem**, still a warning.
`EvalResult.selfPreference` carries `{ axis, model }`, and the engine turns each into a
warning-level `RunProblem`, so it reaches every reporter. Two axes, reported apart:

- **`content`.** The page's `generated-by` (`docmeta:ai-context`) is the judging model. The judge
  wrote the prose. Remedy: judge with a different model, or pin `model:` on the eval.
- **`criterion`.** `eval-provenance` records this model proposing *this* assertion. The judge
  wrote the question. Remedy: have a human confirm the assertion, which is what `calibrate`'s
  `reviewed` bit is for.

### Consequences

- Good, because a biased verdict is now visibly biased wherever the run is read.
- Good, because the comparison uses the **effective** model for that eval, so pinning a model
  cannot silently evade it.
- Good, because it reports per affected eval instead of naming one page and going quiet.
- Good, because the criterion axis is free: the data was already on disk and simply unused.
- Neutral, because it stays a **warning**. Bias skews a verdict; it does not prevent one forming,
  so ADR 01022 does not apply. Erroring would also punish the legitimate single-model corpus that
  has no second provider configured.

### Confirmation

`test/unit/self-preference.test.ts` pins both axes, and the absence of a flag when the models
differ or the page declares no author. It pins that provenance for a *different* eval on the same
page does not trigger it. It also pins the regression that motivated point 2. An eval pinning its
own model is compared against that model rather than the run default.
