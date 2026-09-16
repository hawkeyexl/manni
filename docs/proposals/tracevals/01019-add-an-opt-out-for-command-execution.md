---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
consulted: []
informed: []
---

# Add an opt-out for `command` execution, without reversing its default

## Context and Problem Statement

[ADR 01011](01011-execute-command-graded-evals.md) weighed default-on against opt-in for the
`command` grader and chose **default-on**. That reasoning stands, and is not revisited here. It
considered only those two shapes, so the risk it names in its own consequences has no lever for the
person taking it:

> `moose-tracevals run` over an untrusted trace can execute that project's code.

There is nothing to type, and nothing to put in a config,
that says "evaluate this trace but run none of its scripts." The one documented escape,
`--deterministic-only`, does the opposite of what is wanted. `command` is deterministic, so it runs
under that flag too, while every judged eval is dropped.

## Decision Drivers

- The risk is real, documented, and accepted. A documented risk with no mitigation available to
  the person exposed to it is just a warning label.
- Reversing 01011's default would break the vocabulary's own worked example out of the box, which is
  precisely what 01011 rejected. The default must not move.
- A check that did not run has not been satisfied. Whatever the disabled state reports, it cannot be
  `pass`.
- The knob belongs to the *evaluating* side, meaning the person running the tool, not to the
  artifact declaring the eval. An artifact cannot exempt itself from a lever pulled against it.
- Two audiences want it for different reasons. One is someone triaging an unfamiliar project's
  trace. The other is a CI job that wants to prove nothing in an evaluated repo can execute.

## Considered Options

- `--no-commands` plus `tracevals.graders.command.enabled`, reporting `skipped`
- `--no-commands` reporting the eval as `error`
- An allowlist of executables rather than an on/off switch
- Nothing, meaning keep documenting the risk and pointing at `--deterministic-only`

## Decision Outcome

The chosen option is **`--no-commands` plus `tracevals.graders.command.enabled`, reporting
`skipped` with a stated reason.** This **amends ADR 01011 rather than superseding it**. 01011's
decision (run by default) is unchanged, and this adds the third option it never considered.

The knob follows the repo's config↔CLI pattern exactly: `graders.command.enabled` in
`src/core/config-schema.json`, defaulted to `true` in `parseConfig()`, overlaid in
`src/commands/run.ts` with `options.commands ?? loaded.graders.command.enabled`, and read once in
`src/core/engine.ts`. `--no-commands` is commander's negated form, so the flag sets `false` and
absence leaves the config in charge.

The engine gates on the grader kind before the registry lookup, so the check is one branch and
nothing is spawned:

```text
outcome: "skipped"
skipReason: "command execution is disabled (--no-commands / graders.command.enabled: false)"
```

`skipped`, not `pass`, and not `error`. `pass` would be a lie about a check that never ran. It is the
same invariant that makes an errored judge run count against consensus and an empty grading window
skip rather than pass. `error` would be honest but would make the flag fail every run that used it,
which is not a usable opt-out.

### Consequences

- Good, because the person exposed to the execution surface finally has the lever. It sits in both
  the place a human types and the place a repo commits.
- Good, because it composes with `--deterministic-only`: together they are "read the trace, send
  nothing, run nothing."
- Good, because the disabled state is visible in the report rather than silent. A reader can see
  that a check was declared and not run.
- Bad, because a run with the flag proves less than a run without it, and a report that mixes the
  two is easy to misread. The stated skip reason is the mitigation, not a fix.
- Neutral, because `fill` is unaffected: it never proposes a command grader and never executes one.
- Neutral, because the opt-out still lives in the evaluating repo's config. 01011's objection to
  gating "the wrong side" applies to an opt-*in* that silently breaks declared evals. It does not
  apply to an opt-out someone deliberately reaches for.

### Confirmation

- `test/unit/config.test.ts` pins the default at `true`, the explicit opt-out, and rejection of
  unknown keys under `graders`.
- `test/unit/engine.test.ts` pins the three properties that matter. Commands run by default, a
  disabled command is `skipped` with the stated reason, and **nothing else about the run changes**.
  That means the same outcomes for every other eval, and the same exit code.
- `test/unit/run-command.test.ts` pins the overlay in both directions: the flag reaches the engine,
  and a flagless run honours a config that disables commands.
- [ci.yml](../.github/workflows/ci.yml) runs the fixture corpus with `--no-commands` and asserts
  `no-force-push` flips from `pass` to `skipped` while the run's exit code is unchanged.

## Pros and Cons of the Options

### `--no-commands` + config key, reporting `skipped`

- Good, because the default is untouched, so 01011 needs no revision.
- Good, because `skipped` is the outcome this codebase already uses for "declared but not run".
- Bad, because a skipped check can be overlooked in a large report.

### Reporting the eval as `error`

- Good, because it is impossible to overlook.
- Bad, because the flag would then fail every run that used it, so nobody could adopt it in CI.
  That is the main place it is wanted.

### An executable allowlist

- Good, because it is finer-grained: known-good check scripts keep running.
- Bad, because it is a security control that looks stronger than it is. The allowlisted script is
  still the evaluated repo's file, and its contents can change between runs.
- Bad, because it needs a matching, path-normalizing, cross-platform comparison to be worth
  anything. That is a lot of surface for a knob nobody has asked for yet. The on/off switch does
  not preclude adding one later.

### Nothing

- Good, because it is free.
- Bad, because "we documented the risk" is not an answer to "how do I not take it".
