---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# A pre-run feasibility pass

## Context and Problem Statement

An eval that cannot reach a verdict as configured was discovered at grade time. ADRs 01020 and
01022 make that outcome honest, in that no verdict is a failure and never a pass. For an `ai` eval
it becomes honest *after the judge has been paid*. Much of what makes an eval unreachable is
knowable from the resolved config and page alone, before anything is dispatched.

## Decision Drivers

- An infeasible eval reads as "the tool found nothing", not "you configured this wrong".
- Anything reported here must not become a second answer to a question something else already
  answers. Two messages for one mistake is worse than one.
- The exit-code contract (ADR 01007, and `0`/`1`/`2`) should not change.

## Considered Options

- Leave it at grade time.
- Check everything that could conceivably fail, up front.
- Check only what *configuration* makes impossible, and only where nothing already answers it.

## Decision Outcome

The chosen option is **the narrow pass**. `checkFeasibility` runs in `runEvals` before any target
is dispatched. It reports invalid grader options, and `tool:docmeta` with no `schemas` (ADR 01013).
It also reports a page-declared command eval that may not run and cannot be generated either. Its findings are
error-level `RunProblem`s, which already drive exit 1 and already reach every reporter, so the
exit-code contract is untouched.

### Consequences

- Good, because a misspelled grader option now costs nothing rather than a judge call.
- Good, because "this eval can only ever be skipped" is stated once, up front. It is no longer
  inferred from a skip reason buried in a long report.
- Good, because the scope is small enough to stay correct as the grader set grows. Most of it is
  `validateOptions` (ADR 01031) rather than bespoke logic here.
- Neutral, because three checks were deliberately left out. Tool availability on `PATH` is a
  runtime fact ADR 01020 covers. An unknown grader kind is already an errored result in the engine.
  An `ai` eval with no assertion is already rejected by *both* schemas at parse time as a usage
  error (exit 2). The message there is better than this pass could produce. Each was written, found
  redundant, and removed rather than shipped as a duplicate.

### Confirmation

`test/unit/feasibility.test.ts` covers each reported case. It also pins the omissions, which
matters. One test asserts that an assertion-less `ai` eval still throws from the config schema.
The duplicate check is then not helpfully re-added by someone reading only the feasibility module.

## Pros and Cons of the Options

### Leave it at grade time

- Good, because it is where the information is most complete.
- Bad, because for judged evals the information arrives after the money is spent.

### Check everything up front

- Good, because nothing surprises you later.
- Bad, because it means duplicating checks that already exist elsewhere, and duplicated checks
  drift apart. That is how a tool ends up with two different messages for one mistake.

### The narrow pass

- Good, because every check here is the only answer to its question.
- Bad, because the boundary needs judgment and has to be restated whenever a check is added.
