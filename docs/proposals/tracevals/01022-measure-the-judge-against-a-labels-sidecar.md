---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
consulted: []
informed: []
---

# Measure the judge against a labels sidecar, and sweep the knobs for free

## Context and Problem Statement

The tool could report what it decided. It could not report whether it was **right**.

That gap sat under a primary journey. [`cuj-calibrate-judge`](../docs/content_strategy/journeys/cuj-calibrate-judge.md)
is Sam's decision about whether a judged verdict is evidence. The README's whole trust argument
rests on ensemble consensus and confidence zones.
[judge/calibrate.mdx](../docs/src/content/docs/judge/calibrate.mdx) answered it with a manual
procedure: collect a dozen sessions you have judged by hand, run them, and *count three things*.
Every part of that is mechanical, and every part of it was left to the reader. The counting was the
part most likely to be skipped. So the numbers that decide whether to trust the tool were the
numbers nobody had.

ADR 01015 made each verdict correct enough to be worth measuring, and ADR 01018 made many traces one
run. What was missing was somewhere to put a human's answers, and an arithmetic that compares them
to the tool's. Also missing was a way to ask "what would a different threshold have done?" without
paying for the corpus again.

## Decision Drivers

- **Ground truth cannot go in the eval entry.** `schemas/artifact-evals-1.0.0-proposal.1.json` is
  docmeta's, vendored byte-identical, and `inlineEval` is `additionalProperties: false` (ADR 01010).
  An `expected:` member would be a fork of someone else's vocabulary.
- Independently of the schema, a label is a property of **a corpus and a reviewer**, not of an
  artifact. Two teams calibrating the same skill against different sessions hold different answers,
  and neither belongs in the `SKILL.md`.
- A sweep that costs one model call per grid cell is a sweep nobody runs twice. That makes it
  useless for the one workflow it exists for: move a knob, recount, move it back.
- A calibration run that exits 1 on disagreement is a measurement that fails the first time it is
  honest. Disagreement is the *finding*.
- A label that quietly matches nothing deflates every count on the report, and the report reads
  cleaner than the corpus is. That is the silent-nothing failure the empty-selector rule already
  refuses (ADR 01018).
- A skipped eval is not evidence. Folding one into an agreement rate is the same false pass
  ADR 01015 spent a phase removing, wearing a different hat.
- Two runs over one corpus have to be comparable, on both CI legs, or "agreement went up" means
  nothing.

## Considered Options

Where ground truth lives:

- A **sidecar labels file**, keyed by `(trace, artifact, eval)`
- An `expected:` member on the eval entry
- Inside grader `options`, which the schema leaves open

How a sweep is computed:

- **Re-score the cached per-run verdicts** with `computeConsensus` / `zoneFor`
- Re-run the corpus once per grid cell
- Re-run the corpus once per cell but rely on the judge cache to make it free

What a sweep varies:

- **One axis at a time**, every other knob at its configured value
- The full cross-product of the three axes

Exit code:

- **0 unless a threshold flag was asked for and missed**
- 1 on any disagreement
- Always 0

## Decision Outcome

The chosen option has three parts. **A sidecar labels file. A `calibrate` command that joins it
against a Phase 4 batch. A `--sweep` that re-scores cached verdicts one axis at a time, exiting 0
unless a threshold was asked for.**

### The labels file is its own small schema

[src/calibrate/labels-schema.json](../src/calibrate/labels-schema.json), validated with Ajv exactly
as the config section is:

```yaml
version: 1
labels:
  - trace: ../../traces/claude-session.jsonl
    artifact: fix-bug
    eval: forbidden-tool
    expected: pass
    note: The only in-window Bash call was a read-only `git status`.
```

`trace` resolves against **the labels file's own directory**, not the working directory. That is the
same rule `plugins` follows against the config file that names them (ADR 01017). A labels file
travels with its corpus, so it has to mean the same thing from any cwd.

`expected` accepts `needs-review` as well as `pass` and `fail`. The manual procedure always asked
for "at least two you found genuinely ambiguous". Without a third label value those sessions
could only be recorded as a lie in one direction or the other.

`type` is optional and joins only when present. That is needed for the one case where a name is not
unique: a skill and an agent may both be called `reviewer`.

Four things are refused rather than tolerated. All four are the same refusal, of a labels file that
silently means less than it says:

| Refused | Because |
|---|---|
| An unknown member (`reason:` for `note:`) | The schema is closed, so a typo is a dropped label |
| An empty `labels` list | It measures nothing while looking like a measurement |
| Two labels for one `(trace, artifact, eval)` | Whichever won would silently decide the number |
| A `trace` outside the corpus | Checked *before* the batch runs, so a misspelling does not cost a corpus |

A label that survives all four and still matches no result is exit 2 **after** the run. The message
names what that trace did evaluate for that artifact. It cannot be checked earlier, because eval
ids are only knowable once artifacts are resolved. It cannot be a warning either. A typo'd id
contributes to no count, and the report would look like a cleaner corpus than it is.

### The three numbers, and the three more they need to be honest

`falsePass` (labelled fail, judged pass) and `falseFail` (labelled pass, judged fail) are the two the
docs already named. `reviewVolume` is the third, deliberately counted over **every** eval in the
corpus, labelled or not. "too many and nobody reads them" is a question about operational load,
not about accuracy.

Three more exist because the (expected × actual) grid is bigger than three cells, and collapsing it
would hide the interesting parts:

- `review`, labelled pass or fail, routed to a human instead. The tool deferred rather than being
  wrong, and calling that a false anything would punish the behavior zones exist to produce.
- `missedReview`, labelled ambiguous, decided anyway. The inverse, and the one a reader tuning
  `autoPass` upward is looking for.
- `skipped`, labelled, but the eval never armed. Kept **out of the `agreement` denominator**
  entirely, for the reason `passRate` excludes skips (ADR 01018): a check that produced no evidence
  is not evidence.

An `error` outcome counts as a disagreement and never as agreement, which is the errored-runs-count-
against-consensus invariant applied one level up.

### A sweep re-scores; it does not re-ask

This is the decision that makes calibration practical, and it fell out of machinery that already
existed. `ConsensusResult` carries the whole `JudgeRun[]` it was built from, and it survives into
`EvalResult.consensus` and therefore into every report. Zone thresholds were never part of the cache
key. They are applied *after* consensus, and never sent to the model. So a different `autoPass` is a
fresh `zoneFor` call over runs already on disk.

`ensembleRuns` **is** in the key (`r${runs}`), so it needed one more idea. Judge the corpus once at
the **largest** ensemble the grid asks for. Score each smaller cell from the first *k* of those
runs. Say plainly what that is. It is a sub-sample of the ensemble that was drawn, not a fresh
*k*-run ensemble. At temperature 0 the runs are independent samples of one prompt, so it is an
honest estimate. The alternative is a bill proportional to the grid.

Two consequences follow and both are stated in the docs. A sweep's *first* run costs
`max(sweep.ensembleRuns)` runs per judged eval rather than the configured count. With the default
grid, that is 5 instead of 3. And every sweep after it costs nothing at all, because the cache key
is a function of the grid rather than of the cell.

The report shows the arithmetic **of the cell it scored**, not of the deeper run behind it. A
5-run vote tally printed beside a 3-run verdict does not add up for anyone checking it.

### One axis at a time, not a cross-product

The default grid is `ensembleRuns [1, 3, 5]`, with `autoPass` and `autoFail` at
`[0.5, 0.6, 0.7, 0.8, 0.9, 0.95]`. That is sixteen rows swept per-axis and one hundred and eight as
a cross-product. Per-axis is not merely shorter. It is the shape that lets a row be read as *the
effect of that knob*. That is what "move one knob, re-run, recount" has always meant. The grid
lives in the config rather than behind a flag. The useful range is a property of a corpus, and a
corpus outlives an invocation.

### Disagreement is exit 0

A calibration run is a measurement. The first honest calibration of a real corpus finds
disagreement, which is the entire point of running it. A command that exits 1 on its own findings
is one people stop running, or start running with `|| true`, which is worse.

Exit 1 is reserved for two things a *reader* would want red:

- A threshold that was asked for and missed: `--max-false-pass`, `--max-false-fail`, `--max-review`,
  or their config equivalents. Unset by default; `0` is a meaningful limit, so it cannot double as
  "unset", and each is left absent rather than defaulted to a number.
- A trace in the corpus that could not be evaluated. The measurement is then incomplete, and an
  incomplete number presented as a clean one is worse than no number.

Exit 2 stays operational. That covers no labels file, an invalid one, a label off the corpus, a
label matching nothing, and a selector matching nothing.

### `calibrate` is a command, not a flag on `run`

It shares `run`'s flags because it *is* a run, and the batch loop is reused verbatim. But the report
answers a different question and carries a different shape. So a consumer must be able to tell which
shape it is asking for from argv, before anything runs. That is the same rule ADR 01018 set for
`RunReport` versus `BatchReport`. `--history` is deliberately **not** offered. Calibration
measures a corpus, not a point in one session's timeline. An accepted flag that quietly does
nothing is worse than an absent one.

Calibration is read-only throughout. Labels, traces, and artifacts are never written; `fill` remains
the only write path (ADR 01005).

### Consequences

- Good, because `cuj-calibrate-judge` now has tooling: the three numbers the docs asked people to
  count are computed, and the disagreements are named rather than tallied.
- Good, because the sweep answers "what would `autoPass: 0.9` have done?" over a real corpus in
  milliseconds. That is the difference between a knob table and a decision.
- Good, because the vendored schema is untouched. No upstream proposal was needed, and none was
  faked with an open `options` bag either. A label is not a grader option.
- Good, because deterministic and `human`-graded evals are calibrated too. A blunt `tool-usage`
  option produces a false fail exactly as a hesitant judge does, and the fixture corpus contains one.
- Bad, because a sweep's first run is more expensive than a plain run, at
  `max(sweep.ensembleRuns)` runs per judged eval. Mitigated by the grid being config, and by every
  later sweep being free.
- Bad, because a smaller-`ensembleRuns` row is a sub-sample rather than a re-execution. Stated
  wherever the number appears rather than smoothed over.
- Bad, because labelling an eval declared with the string shorthand means labelling a *positional*
  generated id (`eval-1`, `eval-5`), which reordering silently re-targets. The docs say so and point
  at declaring an `id`.
- Neutral, because `BatchCommandResult` gained an `outcomes` field. Additive: `reports` drops an
  entry when a trace errors, so its indices stop lining up with the corpus, and a label join needs
  the pairing.

### Confirmation

- [test/unit/calibrate-labels.test.ts](../test/unit/calibrate-labels.test.ts) covers every refusal
  above, plus resolution against the labels file's own directory.
- [test/unit/calibrate-score.test.ts](../test/unit/calibrate-score.test.ts) covers `classify` over
  the full (expected × actual) grid, including the two rows that must never read as agreement. It
  also covers `rescore` moving a verdict by zone, by ensemble depth, and refusing to score an
  ensemble the cache cannot supply.
- [test/unit/calibrate.test.ts](../test/unit/calibrate.test.ts) covers the three numbers over the
  committed corpus, the exit-code contract in both directions, and both refusals. It also covers
  **the claim the feature rests on**, which is a `MockProvider`'s `requests` array counted across
  two sweeps. The first makes exactly 15 calls, which is 3 judged evals times the grid's deepest
  ensemble, once rather than once per cell. A second sweep through a fresh judge over the same cache
  directory makes zero.
- [test/unit/reporters.test.ts](../test/unit/reporters.test.ts) covers all three formats, pipe
  escaping, and the sweep's "no further model calls" line.
- [test/integration/cli.test.ts](../test/integration/cli.test.ts) covers the command surface through
  the built binary. The report shape is distinguishable from a verdict report, and
  `--max-false-pass 0` flips the exit code. `--sweep` finds the setting that removes the false pass,
  and a label off the corpus exits 2 with the corpus listed.
- [ci.yml](../.github/workflows/ci.yml)'s calibration dogfood runs all of it on both OS legs. The
  labels file is [labels.yaml](../test/fixtures/project/tracevals/labels.yaml), in the fixture
  project. That corpus deliberately carries one false pass, one false fail, one missed review, and two labels
  whose evals never armed.

## Pros and Cons of the Options

### A sidecar labels file (chosen)

- Good, because it matches what a label *is*: per-corpus and per-reviewer, not per-artifact.
- Good, because two teams can hold different ground truth for one skill without either editing the
  other's `SKILL.md`.
- Good, because it can label an eval it does not own, such as a plugin skill or a vendored agent
  definition.
- Bad, because it is a second file to keep in sync with the artifacts. Nothing but the run-time
  join notices when an eval is renamed. The join is exit 2 rather than a warning for that reason.

### An `expected:` member on the eval entry

- Good, because there would be one file instead of two.
- Bad, because `inlineEval` is `additionalProperties: false` in a byte-identical vendored copy of
  docmeta's draft. This is an upstream proposal, not a local change (ADR 01010).
- Bad, because it can hold exactly one answer per eval, which makes ground truth global and
  per-artifact when it is neither.
- Bad, because it cannot be trace-specific, and the same eval legitimately has different correct
  answers on different sessions. That is the whole reason a corpus has more than one trace in it.

### Inside grader `options`

- Good, because `options` is open by schema decree and Phase 3 already used that freedom.
- Bad, because `options` is validated by the grader at run time, and a label is not something a
  grader has any business knowing about. It would pass validation only by every grader agreeing to
  ignore it.
- Bad, because it inherits both defects above anyway: still per-artifact, still one answer.

### Re-running the corpus per grid cell

- Good, because each cell would be a true *k*-run ensemble rather than a sub-sample.
- Bad, because the default grid is sixteen cells. At one corpus per cell, calibration costs sixteen
  corpora, and the "move one knob and recount" loop the docs describe becomes unaffordable.
- Bad, because the judge cache would only rescue the zone axes. `ensembleRuns` is in the key, so
  those cells would bill in full every time.

### Re-running per cell and trusting the cache

- Good, because it needs no new code at all.
- Bad, because it is only free for the axes that were already free, and it hides that fact. Two of
  the three axes would silently cost money while the third did not.

### Exit 1 on any disagreement

- Good, because a corpus that has stopped agreeing would be impossible to ignore.
- Bad, because the first honest calibration of a real corpus disagrees somewhere, so the command
  fails on the day it is most useful. A command that always fails gets `|| true`, which disables
  the gate it was supposed to be.
- Bad, because it conflates a measurement with a policy. What counts as too many false passes is a
  decision the thresholds let a team make explicitly.

### A full cross-product sweep

- Good, because it could find an interaction between two knobs that per-axis rows cannot.
- Bad, because 108 rows is not a report a person reads, and the interaction is weak by
  construction: `autoPass` and `autoFail` govern disjoint outcomes.
- Neutral, because the per-axis grid is config, so anyone who wants a cell can name it directly.
