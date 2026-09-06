---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# Calibration requires both expected classes

## Context and Problem Statement

`calibrate` measures judge agreement against a human-verified golden set and certifies the judge
above 70%. It computed that rate over every judged case regardless of the case's `expected` value.
A golden set containing only `expected: pass` cases therefore certified a judge that answers "pass"
unconditionally, at agreement 100%, false negatives 0, threshold met. The instrument could bless
itself, and the report said nothing was wrong.

## Decision Drivers

- `calibrate`'s entire output is a trust claim. A vacuous claim is worse than no claim, because it
  is acted on.
- ADR 01018 already settled the shape for this class of problem. The verdict stays a statement
  about agreement, and statements about coverage sit beside it rather than being folded in.
- `claude plugin eval`'s authoring interview treats "at least one should-NOT-fire case stays in the
  suite" as a floor its author may not remove. This is the measured form of the same rule.

## Considered Options

- Fold class balance into `meetsThreshold`.
- Report balance as its own field and gate the CLI on it.
- Warn in the renderer and certify anyway.

## Decision Outcome

The chosen option is to **report it separately and gate on it**. `CalibrationReport` gains `expectedPass`,
`expectedFail` and `balanced`; `meetsThreshold` is untouched; the CLI exits 0 only when
`meetsThreshold && unjudged === 0 && balanced`.

### Consequences

- Good, because the agreement rate stays honest. 100% agreement over one class genuinely *is* 100%
  agreement. Making `meetsThreshold` false there would quietly redefine what the number means, and
  ADR 01018 already rejected that once.
- Good, because the renderer can say exactly what is wrong. It names which class is missing, and
  that a judge answering the other one every time would have scored perfectly here.
- Good, because a consumer reading the JSON gets three separable facts rather than one overloaded
  boolean.
- Bad, because an existing single-class golden set stops certifying until a counter-example is
  added. That is the intent, not a side effect.

### Confirmation

`test/unit/calibrate-golden.test.ts` pins that an all-pass set reports `meetsThreshold: true` and
`balanced: false`, and does not certify. It pins that adding one `expected: fail` case both balances
the set and exposes the always-pass judge's false negative.

## Pros and Cons of the Options

### Fold into `meetsThreshold`

- Good, because the CLI needs no change.
- Bad, because it makes one boolean mean two things, the exact mistake ADR 01018 records.
  Overloading it made the renderer print "refine your assertions" at 100% agreement.

### Separate field, gated

- Good, because each field answers one question.
- Bad, because a consumer reading `meetsThreshold` alone still gets an incomplete picture. That
  is why the field is documented as needing to be read alongside `unjudged` and `balanced`.

### Warn only

- Good, because nothing breaks.
- Bad, because the whole point is that this run must not certify, and a warning certifies.
