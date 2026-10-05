---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# `skill-invoked` alone is not an adherence suite

## Context and Problem Statement

`skill-invoked` checks that a skill fired during the session. It is a useful signal and a natural
first eval to write, which is the problem. An artifact whose *only* eval is `skill-invoked`
reports a green adherence run while asserting nothing about whether the session followed the skill.
It measures the trigger, not the behaviour.

## Decision Drivers

- "The skill fired" and "the session adhered to the skill" are different claims, and this tool
  exists to make the second one.
- `claude plugin eval` designed around exactly this. It treats the trigger check as display-only,
  and excludes it from the score in **both** arms so it can never move the result. Its authoring
  interview refuses to let it stand as a case's only grader.
- A suite that cannot fail is worse than no suite, because it is reported as coverage.

## Considered Options

- Exclude `skill-invoked` from scoring entirely, as `claude plugin eval` does.
- Warn when an artifact's only evals are `skill-invoked`.
- Leave it; document the hazard.

## Decision Outcome

The chosen option is to **warn**. When every non-implicit eval on an artifact is `skill-invoked`, the run
emits a warning naming the artifact and saying what is missing.

Excluding it from scoring was rejected. `claude plugin eval` can do that because it has two arms
and a Δ, so a display-only grader still has somewhere to be displayed. Here a criterion is either
scored or absent, and silently not scoring one an author wrote would be its own surprise.

### Consequences

- Good, because the failure mode is named where it happens, in the run the author is looking at.
- Good, because it stays a warning. It is a statement about how much the suite is worth, not about
  whether this run is valid, and the run's verdict is unaffected.
- Bad, because a warning can be ignored, and this one deserves attention. That is the cost of not
  breaking a run over an authoring judgment.
- Neutral, because implicit evals are excluded from the check. They are not the author's choice.

### Confirmation

The warning is assembled in `runEvals` alongside the trace and resolution warnings, so it reaches
every reporter that shows warnings rather than only the terminal.
