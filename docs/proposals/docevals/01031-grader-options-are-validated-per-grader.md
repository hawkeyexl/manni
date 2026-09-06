---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# Grader options are validated per grader

## Context and Problem Statement

`evalDef.additionalProperties` is `false`, so a typo in an eval's own keys was loud. `options` was
not: it is `{"type": "object"}` in both the config schema and the published frontmatter schema, and
every grader read it with a bare cast, as in `const opts = ev.options as FreshnessOptions`. So
`max-age-day: 30` fell straight through to the default of 365, and the eval quietly checked
something its author never wrote, forever.

docmeta's own vocabulary describes `options` as *"grader-specific options; validated by the grader
at run time"*. The openness is deliberate. A grader's options evolve on the grader's schedule, and
a closed schema would version on every one. The half that was missing is the validation.

## Decision Drivers

- This is conformance to a contract we already claim to implement, not an extension of it.
- The failure is silent, which makes it the worst kind: the eval keeps passing and keeps meaning
  nothing.
- moose-tracevals already solved it, and the family convention is to port from whichever sibling
  solved a problem first, as `src/core/baseline.ts` was ported from docmeta.

## Considered Options

- Close `options` in the schema, per grader.
- A JSON Schema per grader, compiled with the Ajv instance already in the process.
- Port moose-tracevals' combinator library and give `Grader` a `validateOptions`.

## Decision Outcome

The chosen option is to **port the combinators**. `Grader` gains an optional `validateOptions(options)`, and
`src/graders/options.ts` carries `knownKeys`, `requiredString`, `optionalString`, `optionalEnum`,
`optionalNumber`, `optionalBoolean`, `optionalStringArray` and `firstError`. Every built-in grader
implements it; the pre-run feasibility pass (ADR 01028) calls it.

### Consequences

- Good, because a misspelled key now names itself *and* lists what the grader does accept. A
  message that says only "unknown option" leaves the author guessing between two plausible
  spellings.
- Good, because combinators express what JSON Schema states badly: ordered bounds, and option sets
  that can never pass. moose-tracevals' `tool-usage` rejects `expect: not-used` with `min >= 1`
  under the comment *"A criterion that can never pass is as useless as one that can never fail"*.
  That idea comes across with the port.
- Good, because it leaves `options` open in the published vocabulary. A third-party grader is
  still possible, and a new option still needs no schema version.
- Bad, because validation now lives beside each grader rather than in one schema file, so adding a
  grader means remembering to add its checks. `test/unit/feasibility.test.ts` and the registry test
  make the omission visible rather than silent.

### Confirmation

`test/unit/feasibility.test.ts` pins that a misspelled option is an error naming the key and the
accepted set. It pins that an out-of-range value is rejected, and that `tool:docmeta` without
`schemas` fails (ADR 01013). The two new graders (ADR 01029) ship `validateOptions` from birth.
