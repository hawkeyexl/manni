---
status: "accepted"
date: 2026-08-31
decision-makers: [hawkeyexl]
---

# Grader isolation is per eval group, and the engine owns the partition

## Context and Problem Statement

The engine grouped deterministic targets by grader **kind** and wrapped one
`try`/`catch` around the whole `grader.grade({...})` call
(`src/core/engine.ts`). Its comment said the right thing:

> Error its own targets and carry on, the way a failed script generation
> already does above.

But "its own targets" was implemented as *every target of the grader kind*.

That would be harmless if a grader's `grade()` were atomic. It is not. Batch
and corpus graders loop `groupTargetsByEval(ctx.targets)` **inside** `grade()`
and accumulate findings across the groups. Those are
`src/graders/tools/markdownlint.ts`, `src/graders/tools/docmeta.ts`,
`src/graders/tools/vale.ts`, and `src/graders/native/differentiation.ts`. A throw
while processing group 2 unwinds the entire function, and group 1's
already-computed findings go with it.

Reproduced with two `tool:docmeta` evals on one corpus, one pointing at a
builtin schema and one at a schema file that does not exist:

- both evals reported the **bad** eval's error message;
- the good eval's 26 genuine findings vanished;
- run alone, the good eval worked perfectly.

So one broken eval erased every sibling eval of the same kind, and then
misattributed its own failure to each of them. The name on the result and the
name in the message disagreed, and a reader chasing the failure was sent to the
wrong eval.

This is a silent-green in the same family as
[ADR 01022](01022-a-grader-that-reached-no-verdict-fails-the-eval.md) and
[ADR 01023](01023-the-diagnostic-invariant-is-enforced-by-enumeration.md). One
difference makes it worse. The erased evals are not recorded as
skipped or errored *for their own reason*. They are recorded as having failed
for someone else's.

## Decision Drivers

- **A failure must be attributable.** A result carrying another eval's error
  message is worse than no result. It sends the reader to fix a working eval.
- **Blast radius should match the unit of configuration.** Two evals are two
  independent questions about a page. One being unanswerable says nothing about
  the other.
- **The boundary must not be something a grader has to remember.** ADR 01023's
  finding was precisely that per-adapter invariants get forgotten. Two rounds
  of checking adapters by inspection both reported them clean while instances
  remained. An invariant enforced in one place is worth more than one asserted
  in nine.
- **Batch invocation is the point of a batch grader.** `tool:markdownlint`
  spawns one subprocess for every page sharing an eval configuration.
  A per-target boundary would isolate perfectly and cost a subprocess per page.
- **A corpus grader's input set is its subject** ([ADR 01040](01040-since-scopes-a-run-and-exempts-corpus-graders.md)).
  Any regrouping must leave `tool:differentiation` seeing every page carrying
  its eval, or the check quietly becomes a pass.

## Considered Options

1. **The engine partitions by eval group and calls `grade()` once per group**,
   wrapping each call.
2. **Push per-group isolation into each grader**, so every adapter wraps its own
   inner loop.
3. **Change the `Grader` contract to return per-target results** rather than a
   flat `Finding[]`, so a partial failure is expressible.
4. **Isolate per target**, the finest possible boundary.
5. **Leave it**; document that a broken eval takes its kind down with it.

## Decision Outcome

**Option 1 wins.** The engine drives `groupTargetsByEval` and invokes
`grade()` once per group, with the `try`/`catch` around each invocation.

**1. The unit of isolation is the eval *configuration*, not the eval name.**
`groupTargetsByEval` already keys on name, options, timeout, severity and
severity map, so two pages overriding one eval's options differently are two
groups. That is the correct granularity for isolation as well as for
invocation. A failure caused by page A's bad option should not reach page B,
even though both name the same eval. One partition function serves both purposes,
so there is nothing to keep in agreement.

**2. Invocation shape is unchanged.** A batch adapter already ran one external
invocation per group. The engine calling it once per group produces exactly the
same number of subprocesses, in the same order, with the same targets. This is
a change to where the boundary sits, not to what runs.

**3. The adapters keep their internal `groupTargetsByEval` loops.** They are now
partitioning an already-homogeneous set, which yields itself. The function is a
pure partition and idempotent, so the second call costs a map lookup and
changes nothing. They are kept deliberately:

- each grader stays correct when called directly, which is how the unit tests
  in `test/unit/graders.test.ts`, `test/unit/docmeta-grader.test.ts` and
  `test/unit/no-verdict.test.ts` exercise them;
- a grader registered through `registerGrader` by a future caller that does not
  go through the engine is not silently wrong;
- and removing them would make the engine's partition load-bearing for
  *correctness of attribution inside adapters* rather than just for isolation.
  That is a heavier coupling than this change needs.

The engine's partition is what makes isolation unforgettable; the adapters'
keeps them independently correct. Neither is redundant with the other in the
way that matters.

**4. The error message names the eval.** `grader <kind> failed for eval
"<name>": <reason>`. Every target in a group shares one eval, so the name is
unambiguous. It is now the name of the eval that actually failed, rather than
whichever one the adapter happened to be processing.

**5. `mode: "corpus"` is unaffected.** A corpus grader's population was already
"every target of this eval configuration", which is what `gradeGroup` in
`src/graders/native/differentiation.ts` receives today. The engine handing it
one group hands it the same set. ADR 01040's exemption is untouched, and a test
pins it directly.

### Consequences

- **A failing eval errors its own targets and nothing else.** Its siblings of
  the same kind report their own findings and pass or fail on their own evidence.
  A corpus with one misconfigured eval keeps its other checks.
- **The reported message now identifies the eval to fix**, which is the
  difference between a diagnosis and a wild goose chase.
- Good, because the boundary lives in one place and a new adapter inherits it,
  in the spirit of ADR 01022 and ADR 01023.
- Neutral, because the number of subprocesses, their arguments, and the
  findings a healthy run produces are all unchanged.
- Bad, because `durationMs` is now divided across a group rather than across
  every target of the kind. Per-result timings therefore shift on a corpus with
  several evals of one kind. They were always an even division of a batch's total
  and remain an approximation; the new one is closer.
- Bad, because a failure *within* a group still errors that whole group. A
  batch adapter that throws on page 7 of 12 loses the first six pages' findings
  for that eval. Going finer would cost the batching, and this is where the
  economics stop being worth it. Option 3 is the exit if that ever bites.

### Confirmation

`test/unit/grader-isolation.test.ts` drives a fake grader through the real
engine, so the pin is on the engine's boundary rather than on any one adapter.
It asserts that a sibling eval's findings survive a throw, and that exactly one
eval is errored. It asserts that the error message names the eval that failed.
The thrown message deliberately does **not** contain the name, so only the engine
adding it can satisfy the assertion. The failing group coming first changes
nothing, and every group throwing still errors everything and exits 1.

Three further cases pin the mechanism rather than the outcome. The outcomes
above could also be produced by a per-target boundary that destroyed
batching. `grade()` is invoked once per eval group and not once per kind. Two
pages carrying one eval still reach the grader in a **single** call. A
`mode: "corpus"` grader receives every page carrying its eval at once.

`.github/workflows/ci.yml` runs the built CLI against a scratch corpus carrying
two `tool:docmeta` evals, one of them pointing at a schema file that does not
exist. It asserts the good eval passes while only the bad one errors. That is the original
reproduction, end to end.

## Pros and Cons of the Options

### Option 1, the engine partitions and isolates per group

- Good, because no adapter can forget the boundary, and none has to implement
  it.
- Good, because it reuses the partition function the adapters already use, so
  isolation and invocation cannot disagree about what a group is.
- Good, because it leaves batch invocation and the corpus-grader population
  exactly as they were.
- Bad, because the engine now knows about eval groups, a concept that used to
  live entirely inside `src/graders/`. That is a real coupling; it is one
  imported function, and the alternative was nine copies of the same `try`.
- Bad, because a throw part-way through a group still discards that group's
  earlier findings.

### Option 2, push isolation into each grader

- Good, because the engine keeps its current, simpler contract and the graders
  keep sole ownership of grouping.
- Bad, because it is the same `try`/`catch` duplicated into every adapter, and
  the one that forgets is invisible. The failure mode is a *missing* error, not
  a wrong one. ADR 01023 exists because exactly this class of per-adapter
  invariant was checked by inspection twice and found clean twice while
  instances remained.
- Bad, because it does not protect a grader registered by a third party through
  `registerGrader`.

### Option 3, a per-target result contract

- Good, because it is the only option that expresses partial failure honestly.
  A grader could report findings for pages 1–6 and an error for page 7.
- Good, because it would let a batch adapter survive a mid-batch failure, which
  is the residual weakness of the chosen option.
- Bad, because it rewrites the `Grader` interface, every one of the nine
  adapters, and their tests. The bug it fixes has a reported instance that is
  cross-*eval* rather than cross-*page*.
- Bad, because it moves the ADR 01022 diagnostic rule into a shape where each
  adapter decides what a target's outcome is. That rule is currently one check in
  the engine over a flat `Finding[]`, and moving it gives up the centralization
  ADR 01023 spent effort establishing.

### Option 4, isolate per target

- Good, because it is the finest boundary and no failure can reach a page it
  did not concern.
- Bad, because it destroys batching. `tool:markdownlint` and `tool:vale` would
  spawn one process per page instead of one per eval group, which is the cost
  the batch mode exists to avoid.
- Bad, because a `mode: "corpus"` grader cannot be called per target at all.
  `tool:differentiation` returns `[]` below two targets, so per-target
  invocation would silently convert it into a pass. That is the precise hazard
  ADR 01040 was written to prevent.

### Option 5, leave it, and document it

- Good, because it costs nothing and the workaround (`--eval` the working one)
  exists.
- Bad, because the misattribution is not a limitation a reader can work around.
  It actively points at the wrong eval, and there is no signal telling them
  the message is not about the result it is attached to.
- Bad, because the loss is silent in the direction that matters. 26 real
  findings became zero, and the eval that produced them reported an unrelated
  error rather than nothing at all.
