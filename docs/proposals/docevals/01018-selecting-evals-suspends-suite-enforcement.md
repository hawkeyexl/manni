---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Selecting a subset of evals suspends suite enforcement

## Context and Problem Statement

`RunOptions` (`src/core/engine.ts:57`) narrows a run two ways: by file glob, and by
grader class, meaning `--deterministic-only` and `--ai-only` (`src/cli.ts:124`, `:125`).
There is no third. A contributor whose pull request went red on one eval cannot
re-run *that eval*; they re-run the corpus and read past everything that passed.

That contributor is the reader `cuj-fix-red-check` exists for, and the content
strategy calls it the highest-traffic journey on the site
(`docs/content-strategy/journeys/cuj-fix-red-check.md`). Theo arrives cold from a
CI annotation and expects to stop learning about moose-docevals four minutes
later. The journey's own narrative warns that a blocked contributor who cannot
self-serve escalates, and that enough of that gets the check removed. Being unable
to re-run the single eval that is red is the sharpest edge on that path
([ADR 01003](01003-cuj-first-docs-site-and-content-strategy.md)).

Adding `--eval <name...>` and `--suite <name>` is easy. The hazard is what they do
to the exit code.

`summarizeSuites` (`src/core/engine.ts:137`) computes a suite's pass rate over the
results *present in the run*: `graded = passed + failed + errored` at `:155`,
`passRate = graded > 0 ? passed / graded : 1` at `:156`, and
`meetsTarget: passRate >= targetPassRate` at `:168`. `hasFailure` at `:447` then
includes `suites.some((s) => !s.meetsTarget)`. So a run filtered to one passing
eval out of a suite of twelve computes `1/1 = 100%`, clears the default target of
`1.0` (`src/core/config.ts:369`), and exits 0. The suite's other eleven evals were
never run. **A filtered run would be able to report that a quality gate was met on
evidence it never gathered.**

That is the same failure shape this repository already spends effort on elsewhere.
`discoverPages` throws a `DocevalsError` rather than returning an empty list when
no page matches (`src/core/discover.ts:124`). A typo'd glob is exit 2, not a
green run over nothing. `ci.yml` carries a step named "Assert every inline
doc-detective step is valid" (line 356). A page whose steps all fail to
parse makes doc-detective report no tests and exit 0, which is green with nothing
executed. [ADR 01020](01020-unreadable-tool-output-is-a-finding-not-a-pass.md)
applied the same rule to an adapter that could not read its tool's output. The
rule has been applied to discovery, to the corpus, and to the graders. A selection
flag is simply the next place it can be broken.

## Decision Drivers

- **A suite target is a claim about a body of checks**, not about whichever subset
  of them happened to run. Reporting on that claim from a subset is not a weaker
  measurement of the same thing. It is a measurement of a different thing wearing
  the same label.
- **The direction the error runs decides how bad it is.** A filtered run that
  under-reports is an annoyance. One that over-reports produces false confidence,
  and false confidence is what gets a gate deleted rather than fixed.
- **A filtered run is a debugging aid, not a gate.** Nothing about `--eval` is
  meant to be a CI invocation, and the design should make that structural instead
  of documentary.
- **An empty selection must not be green.** `discoverPages` already settled this
  question for the input set. A selection filter is the same question one stage
  later.
- **Resolution problems must still surface.** A filter must not hide the
  `error`-level problems that `resolvePages` (`src/core/resolve.ts:356`) attaches
  to a plan and that reach `hasFailure` independently at `src/core/engine.ts:450`.
- **A truncated run says so.** [ADR 01019](01019-a-turn-budget-replaces-the-cost-budget.md)
  set the precedent when a turn budget cuts a run short. The report names the
  reduced coverage rather than leaving a reader to infer it from a number that is
  quietly missing.

## Considered Options

1. **Filter, and suspend suite enforcement while a filter is active.**
2. **Filter, and enforce suite targets over whatever ran.**
3. **Filter, and score against the suite's full declared membership**, counting
   unrun evals as failures.
4. **Do not add selection**; tell people to narrow by file glob.

## Decision Outcome

**Option 1 wins.** Filter, and suspend suite enforcement for the filtered run.

**1. `--eval <name...>` and `--suite <name>` on `run` and `list`.** `--eval` is
variadic and matches an eval by name. `--suite` matches every eval whose stamped
suite is the named one. [ADR 01014](01014-sarif-and-junit-reporters.md) already
put that suite on each result, so nothing new has to be derived. Both land on
`list` (`src/cli.ts:90`) as well as `run`. The first question after "why
did this fail" is "what would that have run", and answering it should not cost a
grading pass.

Filtering happens **after `resolvePages` and before grading**. Resolution is where
an unrecognized `eval-*` key, an unknown grader, or a shorthand that collides with
a defined eval id is caught. Those problems must not become invisible because
the offending page's evals were filtered out of the run.

**2. A filter that matches nothing is a usage error, exit 2.** It is never a green run
over zero evals. This is `discoverPages`' contract at `src/core/discover.ts:124`
moved one stage downstream. It is exit 2 rather than exit 1 for the reason
[ADR 01007](01007-validate-format-centrally-as-a-usage-error.md) gives. The user
asked for something that does not exist, which is a defect in the invocation and
not in the corpus. The message names what was asked for, because the whole
population of this error is a typo or a renamed eval.

**3. While a selection filter is active, suite targets are not enforced.** Suite
summaries are still computed and still reported, because a filtered run should not
go blind. Each one carries `partial: true`, and the reporters render it as such
instead of a pass/fail verdict. `hasFailure` drops the
`suites.some((s) => !s.meetsTarget)` term entirely. The run's exit code then
reflects only the evals that actually ran. A `fail` or an `error` among them still
exits 1, and an `error`-level problem from resolution still exits 1.

The reasoning worth spelling out is why this is suspension rather than adjustment.
A suite target is a statement about a population. Running a sample and then
reporting on the population's target is not a less precise answer to the same
question. It answers a question nobody asked, and it errs toward the answer that
is expensive to be wrong about. **Making a filtered run structurally incapable of
reporting a met target is better than documenting that it should not be trusted
to.** Documentation is not load-bearing against a green check mark.

`meetsTarget` is forced to `false` in a partial summary rather than being
computed over what ran. `partial` sits next to it because the two say different
things: `partial` means "no verdict was reached", `meetsTarget: false` is what a
consumer that has never heard of `partial` sees. Erring that consumer toward red
is the safe direction; the alternative errs it toward a green it did not earn.

**4. `--suite` filters; it does not redefine.** It selects which evals run. It does
not change which suite an eval reports under, and it does not alter
`targetPassRate`. Nor does it bring a suite into existence that the config has
not declared.

### Consequences

- `moose-docevals run --eval fresh-enough` is now the answer to "my PR went red on
  one eval". It **cannot quietly become the CI invocation**, because it never
  reports a suite as meeting target. Someone who wires it into CI anyway loses the
  suite gate visibly, in the report, rather than keeping a gate that always passes.
- **The `SuiteSummary` shape gains a field** (`src/types.ts:81`), which is a change
  to `--format json`. `renderJson` serializes the whole `EngineReport`
  (`src/reporters/json.ts`), so every consumer sees it.
- **A consumer that ignores `partial` reads a false red, not a false green.**
  Adding `partial` rather than making `meetsTarget` nullable keeps the existing
  type. A script reading `meetsTarget` alone out of a filtered run still gets a
  boolean. It is always `false`, including for a suite that passed everything
  it measured. That is the deliberate direction. The failure this decision exists
  to prevent is a filtered run claiming a target was met. Forcing the field
  false makes that structurally impossible rather than documentary. The cost is
  that such a consumer cannot distinguish "this suite failed" from "this suite was
  not judged" without reading `partial`. That is why every reporter renders the
  two differently.
- **The human and markdown reporters change for filtered runs.**
  `src/reporters/human.ts` renders `meetsTarget` as `ok` / `below target`, and
  `src/reporters/markdown.ts` as ✅ / ❌. A partial summary renders as neither,
  showing `partial — filtered run, target not evaluated` and `➖ partial`
  respectively. Saying that the target was not enforced is the point. A blank
  where a verdict used to be reads as a rendering bug, and the reader fills it in
  with the optimistic guess.
- **A CI job that filters is telling you less than an unfiltered one, by
  construction.** That is the intent, and the reporters say so rather than leaving
  it to be inferred from a number that is quietly absent.
- `list` gains the same two flags, so "what would `--eval X` actually select" is
  answerable without spending a run.

### Confirmation

Tests in `test/unit/selection.test.ts` assert several things. `--eval` naming
nothing exits 2, and a matching `--eval` runs only that eval and no other.
**A filtered run whose selected evals all pass does not report its suite as
meeting target. It does not exit 0 on the strength of it.** That is the
regression this ADR exists to prevent. A filtered run containing a failing eval
still exits 1, and `--suite` restricts to that suite's members. An unfiltered
run's suite enforcement is unchanged. That is the guard against fixing the
filtered case by weakening the normal one.

## Pros and Cons of the Options

### Option 1, filter, and suspend suite enforcement

- Good, because a filtered run cannot report a gate as met on evidence it never
  gathered. The property is structural. There is no code path from a partial
  summary to a green suite verdict.
- Good, because it serves `cuj-fix-red-check` directly, with one eval, one
  command, and seconds instead of a corpus pass.
- Good, because an empty selection is exit 2, consistent with `discoverPages` and
  with the CI guards this repo already pays for.
- Neutral, because a filtered run's exit code means less than an unfiltered one's.
  That is already true of `--deterministic-only` and nobody is misled by it,
  because the flag says what it did.
- Bad, because it adds a field to a public JSON contract. A consumer
  reading `meetsTarget` without `partial` sees a filtered run's clean suite as
  failed. That is the safe direction to be wrong in, but it is still wrong.

### Option 2, filter, and enforce suite targets over whatever ran

- Good, because it is the least code. `summarizeSuites` needs no change at all.
- Bad, because it is precisely the false green described above: `1/1 = 100%`
  against a target of `1.0`, exit 0, eleven evals unrun. **This is worse than not
  shipping the feature.** It manufactures a green check that a reviewer has
  no way to distinguish from a real one.
- Bad, because the failure is silent and durable. Nothing in the report says the
  number came from a sample, so nobody discovers it until a regression ships behind
  it.

### Option 3, score against full declared membership, counting unrun evals as failures

- Good, because it never over-reports, which is the right direction to err.
- Bad, because it makes **every** filtered run red, so the flag is useless for the
  debugging it exists for. A contributor re-running one eval to confirm a fix sees
  a red run and cannot tell whether the fix worked.
- Bad, because "failed" would be a lie about an eval that never ran. The report
  already separates `skipped` from `failed` for exactly this reason, and
  `src/core/engine.ts:155` excludes skips from `graded`. Collapsing that
  distinction to make an arithmetic identity work trades one dishonest number for
  another.

### Option 4, no selection; narrow by file glob

- Good, because it is zero new surface. The glob argument already exists on `run`
  and `list`.
- Bad, because a contributor knows *which eval* is red, since the CI annotation
  names it, and does not always know which file. Making them work backwards from eval to
  file is the step the journey says they will not take.
- Bad, because a corpus-wide eval has no single file to narrow to.
  `tool:differentiation` (`src/graders/native/differentiation.ts:92`) compares
  related pages against each other. Narrowing to one file changes what it checks
  rather than reducing what runs.
- Bad, because a glob narrowed to a single page still runs every eval on it. For
  an AI-graded page that means paying for verdicts the contributor did not ask for.
