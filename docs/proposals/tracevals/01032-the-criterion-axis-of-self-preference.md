---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# The criterion axis of self-preference, and reading `eval-provenance` back

## Context and Problem Statement

ADR 01028 established one self-preference check: the judge model equals `Trace.model`, so a model
is grading whether its own session followed the rules. `EvalResult.selfPreference` was typed
`{ axis: "session" | "criterion"; model: string }`, but nothing ever set `"criterion"`. The
union member was aspiration written into a type. A reader of the JSON output would reasonably
conclude the tool checks something it does not.

The second axis is real and the data for it is already on disk. `fill` writes
`metadata.eval-provenance` with a `generated-by` model and the eval ids it proposed. Nothing read
that block back. So a model can propose an assertion, and later grade sessions against it, with
no part of the pipeline noticing. Unlike the session axis, this bias is about the *yardstick*
rather than the behavior under test.

## Decision Drivers

- A declared-but-unset union member is worse than an absent one: it advertises a check nobody runs.
- The provenance data already exists, is already written, and costs nothing to read.
- The two axes have **different remedies**, so collapsing them into one flag would be useless.
- Absent provenance must stay silent. Hand-written evals have no author on record, and "unknown"
  is not evidence of bias.

## Considered Options

- Delete `"criterion"` from the union and check only the session axis.
- Set `"criterion"` from `eval-provenance`, alongside the session axis.
- One boolean `selfPreference`, with no axis at all.

## Decision Outcome

The chosen option is to **set it from `eval-provenance`**. `extractEvals` returns
`proposedBy: Map<string, string[]>`, mapping an eval id to the models that proposed it. `EvalPlan`
carries the entry for its own id, and the judge sets `axis: "criterion"` when the effective judge
model appears in that list.

A list rather than a string, because a re-fill by a second model *extends* the provenance block
rather than replacing it. One id legitimately has two authors, and either one judging it is the
same bias.

**When both axes apply, the session axis is reported.** One field carries the report, and the
remedies differ in strength. For the session axis, judge with a different model. For the criterion
axis, have a *human* confirm the assertion, because another model would still grade the same
wording. Reporting the weaker remedy while the stronger one applies
would be the wrong advice.

Reading provenance is deliberately tolerant of shapes the schema did not constrain. The block has
already validated; ignoring a malformed entry costs at most one missing warning, while throwing
costs a run that will not start.

### Consequences

- Good, because a union member that described nothing now describes something.
- Good, because it costs no inference and no configuration. The data was already being written.
- Good, because `fill`-generated suites, which are exactly the ones at risk, are the ones it
  covers.
- Bad, because provenance is only as honest as whoever wrote it. A hand-edited block can claim
  any author. The check is a prompt to look, not a proof.
- Neutral, because absent provenance stays silent rather than warning about an unknown author,
  matching how an absent `Trace.model` is handled on the session axis.

### Confirmation

`test/unit/self-preference.test.ts` pins the flag when the judge proposed the assertion, and its
absence when another model did. It pins its absence when nothing recorded an author, and the
session axis winning when both apply. `test/unit/evals.test.ts` pins the round trip out of frontmatter,
including one id claimed by two `generated-by` entries.

## Pros and Cons of the Options

### Delete `"criterion"`

- Good, because the type would then describe the behavior exactly.
- Bad, because it discards a check whose input is already written to every filled artifact.

### Set it from `eval-provenance`

- Good, because it closes the gap between the declared type and the behavior.
- Good, because the axis distinction carries the remedy, which is the actionable part.
- Bad, because it adds a read path for a block that was previously write-only.

### One boolean, no axis

- Good, because it is the simplest shape.
- Bad, because "there is bias here" without saying which kind leaves the reader unable to act.
  The two fixes are different, and one of them is not "use another model".
