---
status: accepted
date: 2026-08-29
decision-makers: hawkeyexl
---

# A malformed confidence score costs its field, not the whole proposal

## Context and Problem Statement

The `fill-live` job (ADR 01031) drove `dockg fill` against a real Ollama server for the first
time and failed on its first run. That is exactly the kind of thing the job exists to find:

```
status: error
error: Response failed schema validation: /confidence/label must be number
fields: []
```

The model had proposed a perfectly good `concepts: ["QuerySyntax", "Operators", "Filters"]`.
dockg threw all of it away because the *self-reported confidence* for a different field was a
string.

Reproduced locally against `llama3.2:1b`, the failure is **deterministic, not flaky**.
`fill.temperature` defaults to 0, so the same prompt returns the same malformed response every
time. `completeValidatedJSON`'s retry re-asks at the same temperature, producing the
identical response. Three runs, three identical failures. A stronger model (`qwen3:4b`) failed
one run in three the same way.

Two distinct defects sit underneath:

1. **Validation conflated content with commentary.** dockg validates the provider's response
   against the same schema it requested. A wrongly typed score in the metadata riding
   alongside the values then invalidates the values.

2. **An out-of-range score was trusted.** A separate probe caught `llama3.2:1b` answering
   `"confidence": {"label": 90.5}`, a percentage where a fraction was asked for. `numberMap`
   accepted it because it is a number, and 90.5 clears every threshold there is. The model's
   slip would be read as maximum certainty, which is the exact inversion of what the confidence
   gate (ADR 01015) is for. Nothing upstream can stop this: **GBNF cannot express `minimum` or
   `maximum`**, so the grammar Ollama compiles from `json_schema` constrains the type and not
   the range. It is `additionalProperties: false` and the property types that a grammar can
   carry, and dockg was relying on the part it cannot.

The stakes differ by field. A wrong `label` is a wrong statement in the graph, and the shapes and
the guardrail exist for that. A wrong `confidence.label` is the model being unreliable about
itself, which dockg already assumes.

## Decision Drivers

- **The values are the contract; the scores are commentary.** `numberMap` and `stringMap`
  already discard entries of the wrong type. The code has always treated the scores as
  untrusted. Only the validator disagreed.
- **Weak and local models are a first-class target.** ADR 01031 chose Ollama precisely so the
  local path is exercised, and ADR 01027 made cost-free local providers a supported mode. A
  contract only strong hosted models can satisfy defeats both.
- **Do not weaken what the model is asked for.** Guidance to send a number is worth keeping,
  and a grammar-capable provider should still be constrained by it.
- **Unscored is already a defined state.** ADR 01015 gates on confidence and drops a field the
  model did not score. Degrading a bad score to "unscored" reuses a path that exists, rather
  than inventing a third state.

## Considered Options

1. **Ask strictly, validate leniently.** Keep the typed request schema, and validate against a
   schema where the advisory sub-objects accept anything.
2. **Drop the confidence mechanism's typing entirely**, with one untyped schema for both.
3. **Coerce.** Parse `"0.9"` to `0.9`, divide 90.5 by 100, and carry on.
4. **Use a stronger model in CI** and change nothing in dockg.
5. **Retry at a higher temperature** when validation fails.

## Decision Outcome

**Option 1 was chosen**, plus a range check where the scores are read.

`proposalSchema(fields, { lenient: true })` returns the same schema with `{}` in place of the
value schema for every `confidence` and `reasoning` property, document-level and section-level
alike. `fill` requests with the strict schema and validates with the lenient one. The
`FIELD_SCHEMAS` values themselves are untouched and validated exactly as strictly as before.

`numberMap` now keeps a score only when it is a number **in 0..1**. Anything else leaves the field
unscored, whether a string, a null, or a percentage. The confidence gate then drops it the way it
already drops a field the model declined to score. The drop is reported in `lowConfidence`, so
it is visible rather than silent.

The lenient schema is memoized under its own cache key, preserving the object identity the
inference library's validator cache keys on (`test/unit/proposal-schema.test.ts`).

**No `PROMPT_VERSION` bump.** The request schema and the prompt text are byte-identical, so what
providers are asked for has not changed and existing fill caches stay valid.

### Consequences

- Good. `dockg fill` against `llama3.2:1b` now completes, verified 3/3 where it previously
  failed 3/3, with no change to the model, the prompt, or the request.
- Good. A percentage-shaped confidence can no longer masquerade as certainty. That failure was
  reachable on **any** provider, hosted included; it is not an Ollama quirk.
- Good. Partial proposals survive. A model that gets four fields right and one score wrong now
  contributes four fields instead of zero.
- Bad. A provider returning systematically malformed scores now silently produces
  `nothing-proposed` runs rather than a loud schema error. Every dropped field is
  listed in `lowConfidence` with its score, which `renderFill` prints. The information is in
  the report, just no longer fatal.
- Neutral. Dockg now tolerates a class of provider misbehavior it previously refused. This is
  a deliberate move down the strictness scale for metadata only.

### Confirmation

- `test/unit/fill.test.ts`: a proposal whose `confidence.label` is `"high"` still writes
  `concepts` and reports `label` as low-confidence; a `confidence.label` of `90.5` yields
  `nothing-proposed` with a reported confidence of 0, not a write.
- `test/unit/proposal-schema.test.ts`: the request schema types the scores, the lenient schema
  does not, the field values stay typed in both, and the two memoize separately.
- `test/real/fill-openai.test.ts` runs against a real Ollama serving `llama3.2:1b`, the case that
  produced this ADR.

## Pros and Cons of the Options

### 1. Ask strictly, validate leniently

- Good. Keeps the guidance and the grammar constraint that make good providers behave.
- Good. Reuses "unscored", a state the gate already defines, instead of adding one.
- Good. No change to the request, so no cache invalidation and no prompt churn.
- Bad. Two schemas to keep in step, though they are one builder and one flag.

### 2. One untyped schema for both

- Good. Simplest possible change.
- Bad. Throws away the grammar constraint that makes a capable provider emit numbers at all,
  degrading the good case to fix the bad one.

### 3. Coerce malformed scores

- Good. Salvages the model's evident intent, since `"0.9"` plainly means 0.9.
- Bad. Unknowable for the case that matters. `90.5` could be a percentage or a typo. Guessing
  invents a confidence the model never expressed, which is precisely what the provenance rules
  forbid dockg from writing.
- Bad. Coercion rules are their own contract, and would need documenting, versioning and
  testing for a value dockg already treats as untrusted.

### 4. Use a stronger model in CI

- Good. No product change.
- Bad. Pins CI green to one model's quirks and leaves every real user on a small local model
  hitting the bug. The job found a genuine defect; changing the job to stop seeing it is the
  wrong lesson.
- Bad. Contradicts ADR 01031's reason for choosing a small local model.

### 5. Retry at a higher temperature

- Good. Would work around a deterministic bad response.
- Bad. Belongs in `@hawkeyexl/inference`, not here (ADR 01021), because dockg must not
  reimplement the retry loop.
- Bad. Treats a symptom. The response was *usable*; the validator was wrong to reject it.
