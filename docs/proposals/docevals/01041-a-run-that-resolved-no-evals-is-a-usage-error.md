---
status: "accepted"
date: 2026-08-31
decision-makers: [hawkeyexl]
---

# A run that resolved no evals is a usage error; a run that graded none of them is a warning

## Context and Problem Statement

`moose-docevals run` against a foreign corpus, docmeta's docs at 26 pages with
none of them carrying eval frontmatter, produced this:

```text

Suites
```

Seventeen bytes, and **exit 0**. `--format markdown` and `--format github` were
equally empty. Only `--format json` said anything at all, and only to a reader
who knew to look: `"pages": 26, "evalResults": []`.

Nothing was misconfigured in a way the tool could not see. `init` scaffolds
`defaults.suite: null` (`src/commands/init.ts`) beside a suite it names
`default`, so nothing selects that suite. A corpus whose pages carry no
frontmatter therefore resolves zero evals, and that is **every corpus on day
one**. The run then reported success for having checked nothing.

What makes this a defect rather than a preference is that the tool already
guards the identical condition when it arrives by a different route.
`--eval does-not-exist` exits **2** with a careful sentence:
`Nothing would have been checked — the name may be wrong, or every page carrying it may be skipped`
([ADR 01018](01018-selecting-evals-suspends-suite-enforcement.md)).
Reached by flag it is a usage error; reached by configuration it was silence
and success. `moose-docevals list` gets it right and always did, printing
`26 pages, 0 evals resolved`.

The engine had no term for it. `exitCode: hasFailure ? 1 : 0`
(`src/core/engine.ts`) is computed from failures, suite misses, and resolution
problems, and an empty result set contributes to none of them. `report.pages`
is carried in the report and read by no reporter: `renderHuman`,
`renderMarkdown` and `renderGithub` all ignore it.

## Decision Drivers

- **This repository's recurring failure mode is a green check earned by
  checking nothing.** Nearly every guard it carries exists to close one
  instance of it. `discoverPages` throws rather than returning an empty list.
  ADR 01018 refuses to report a suite target as met from a filtered sample.
  [ADR 01022](01022-a-grader-that-reached-no-verdict-fails-the-eval.md) fails
  an eval whose grader reached no verdict.
  [ADR 01023](01023-the-diagnostic-invariant-is-enforced-by-enumeration.md)
  enumerates the paths rather than trusting inspection. `ci.yml` carries a step
  asserting that inline doc-detective steps parse, because a page whose steps
  all fail to parse reports no tests and exits 0. **This is the same bug at the
  top of the pipeline**, and it is the first one a new user meets.
- **Consistency between the two routes to one state.** "Nothing would have been
  checked" cannot be exit 2 when a flag causes it and exit 0 when a config file
  does. Whichever answer is right, it has to be the same answer.
- **Not every empty run is wrong.** A corpus where every page is deliberately
  `eval-skip`ped is a real state a user chose, and so is
  `--deterministic-only` over an ai-graded corpus. Treating those as errors
  breaks features that work.
- **`--since` already answered a neighbouring question the other way.**
  [ADR 01040](01040-since-scopes-a-run-and-exempts-corpus-graders.md) makes an
  empty scope exit 0 with a sentence, because "no documentation changed" is a
  correct answer. Any rule adopted here has to reconcile with that rather than
  contradict it.
- **A message with one population deserves to name the fix.** Everyone who ever
  sees this error has a config that attaches nothing, so the message can be
  specific instead of generic.

## Considered Options

1. **Two tiers.** Nothing *resolved* is exit 2; everything resolved but nothing
   *graded* is exit 0 with a warning.
2. **Exit 2 whenever nothing was graded**, skips included.
3. **Exit 0 with a loud warning in both cases**, changing no exit code.
4. **Exit 1**, treating "nothing ran" as a corpus failure.
5. **Fix `STARTER_CONFIG` only**, and leave the engine alone.

## Decision Outcome

**Option 1 wins.** Two tiers, split on whether an eval ever attached to a
page.

### 1. Zero evals resolved across the pages the run would check is a `DocevalsError`, exit 2

Raised in `runEvals` when no plan carries an eval. The message names how many
pages resolved nothing, the two frontmatter keys and the one config key that
would attach an eval, and `moose-docevals list`. The entire population
of this error is a corpus that is not wired up yet, and `list` is the command
that shows what did resolve.

**The count is over the pages the author did not skip**, and that distinction is
not a nicety. A page carrying `eval-skip: true` against a config with no
`defaults.suite` resolves *zero* evals rather than evals that are subsequently
skipped. `plan.skip` and `plan.evals` are independent, and nothing populates
`evals` when no suite applies. Counting resolved evals over every page therefore
converted a deliberate, documented skip into a usage error.
`test/fixtures/pages/index.mdx` is exactly that page, and
`docs/src/content/docs/evals/index.mdx` runs it as a worked example expecting
exit 0. That regression is how the first draft of this rule was found to be too
wide.

The claim being made is "nothing is configured to check the pages you asked
about". A page the author skipped is not one of those pages. A corpus where
*every* page is skipped therefore falls to the warning tier below. That is the
case that would otherwise be treated as an error despite being entirely
deliberate.

Exit 2 rather than 1, for the reason
[ADR 01007](01007-validate-format-centrally-as-a-usage-error.md) gives and
ADR 01018 follows. The corpus has no findings to report, because nothing looked
at it. The defect is in the invocation, and here in the configuration behind it,
not in the documentation. That is what exit 2 means in this tool.

### 2. The check reads the *resolved* plan, before every narrowing

This is the load-bearing detail, and it is what reconciles this decision with
ADR 01040. The check sits after `resolvePages` and **before** `applySelection`
and `applySinceScope`, so it asks one question only: *did resolution attach an
eval to any page?*

Each narrowing flag then keeps its own answer to its own question, and they are
genuinely different questions:

| Empty thing | Meaning | Answer | Owner |
|---|---|---|---|
| The resolved plan | Nothing is configured to be checked | exit 2 | this ADR |
| An `--eval` / `--suite` selection | The name asked for does not exist | exit 2 | ADR 01018 |
| A `--since` scope | No documentation changed | exit 0 + a sentence | ADR 01040 |

ADR 01040's clean tree is not an exception carved out of this rule; it is a
different fact. The plan is full, with every page still carrying its evals, and
the *scope* is empty. Putting the check before scoping makes that structural
rather than a special case anyone has to remember. Adding a fourth narrowing
flag later therefore cannot silently convert its empty case into exit 2.

### 3. The check yields to a resolution error

Suppressed when any page carries an `error`-level resolution problem. A page
with a typo'd `eval-suit:` key resolves zero evals *and* an error naming the
key; the run exits 1 and reports it. Raising the empty-plan error in front of
that would replace a message naming the bad key. The replacement would tell the
reader to configure a suite they already configured. That is the opposite of a
diagnosis. This is ADR 01018's "resolution problems must still surface" driver,
applied one stage earlier.

### 4. A run where nothing reached a verdict is a *warning*, exit 0

This is the case deliberately **not** treated as an error, and the reasoning
matters more than the rule.

It is not silent. A skipped eval produces a result, so the report lists every
one of them with `skip` and its reason, and the suite line counts them. The
seventeen-byte report cannot happen here. What was missing was anyone saying
that a report full of `skip` therefore established nothing. That sentence is
now added, as a `warning`-level entry in `problems`, and the exit code is
untouched.

Making it an error would break three things that work:

- `eval-skip` is a documented feature. A corpus mid-onboarding is a state the
  tool offers and a user chose. So is one whose pages are all skipped while a
  standard is being adopted.
- `--deterministic-only` over an ai-graded corpus grades nothing, and it is the
  standard invocation on a runner with no API key.
- `--ai-only` over a deterministic corpus is the mirror image.

The precedent is exact. [ADR 01019](01019-a-turn-budget-replaces-the-cost-budget.md)
faced the same shape when a turn budget cuts a run short. That is reduced
coverage, asked for by the user, wrong to fail and wrong to hide. It answered
with a `warning` problem saying the run covered less than it was asked to. This is the
same answer to the same question, and it deliberately reuses the same mechanism
rather than inventing a second one.

The condition is *no result reached a verdict*. Every result is `skipped`, or
there are no results at all. Both spellings have to be covered, because the two
routes to "nothing ran" produce different report shapes. A skipped *eval* leaves
a `skipped` result behind, while a skipped *page* with no suite, or a page
scoped out by `--since`, leaves nothing at all. Warning only on the first would
have left the emptiest report of the three silent, which is the wrong way round.

`needs-review` results are excluded: a human-graded eval is work the run
produced, not silence, and the reporters already tell the reader to run
`review`.

**`--since` is not carved out**, even though ADR 01040 already narrates an empty
scope in every reporter. A scoped clean tree now prints both lines, the specific
one immediately after the general one. Two sentences where one would do is a
better trade than an exception. An invariant with no exceptions is one nobody
has to remember, and a carve-out is how this class of bug returns.

The problem is anchored on `config.configPath` rather than a page. No
single page is at fault, and the config is the run-level file a reader can act
on.

### 5. `STARTER_CONFIG` points `defaults.suite` at the suite it defines

`init` scaffolded the broken state directly: a suite named `default` that
nothing selected. A freshly-`init`ed project now checks its pages on the first
run instead of reporting success over nothing. Failing that, it hits the exit
2 above, which is a considerably better first experience than a green build.

`test/unit/init.test.ts` guards the scaffold by loading it back rather than
matching its text, and that is extended rather than weakened. The new cases
resolve a page carrying **no** eval frontmatter through `runList`, and run the
scaffolded corpus end to end through `runEvals`.

### The case knowingly left open

A suite that graded zero evals still renders `0/0 passed — 100% vs target 100%
ok`. `summarizeSuites` computes `passRate = graded > 0 ? passed / graded : 1`,
so an empty suite meets any target. Under `--deterministic-only` the fixture
corpus prints exactly that for its `tutorial` suite today.

That is the same family of defect and it is **not** fixed here. Reusing
ADR 01018's `partial` flag for it is the obvious remedy, and it is a *third*
decision rather than a corollary of this one. `partial` currently means "a filter
was active" and renders as "filtered run, target not evaluated". Generalizing it
changes a public JSON field's meaning, the wording of two reporters, and the
output of every `--deterministic-only` run in existence. It deserves its own
ADR and its own blast-radius analysis. Until then the condition is at least no
longer silent, because the warning added above prints directly beside that line
and contradicts it.

### Consequences

- **A corpus that is not wired up cannot report success.** The first run after
  `init` either checks something or stops with a message naming the fix.
- **Exit 2 is a new outcome for an existing invocation.** A repository whose
  config genuinely selects nothing, and which was relying on `run` exiting 0,
  now fails. That is the entire point, but it is a breaking change to observed
  behavior for anyone in that state.
- **The two routes to "nothing would have been checked" now agree**, which is
  what makes the contract explainable rather than a list of cases.
- Good, because the diagnosis is placed where the evidence is: the config path
  in the message is the file the reader must edit.
- Bad, because a corpus split across several configs, where one legitimately
  covers pages that carry nothing, now needs `eval-skip` or a narrower
  `files.include` to say so explicitly. Requiring the intent to be written down
  is the trade, and it is the same trade `discoverPages` already makes.
- Neutral, because `eval-skip` acquires a second job: besides suppressing a
  page's evals it is now also how an author says "checking nothing here is
  intended". That is the meaning it already carried; this decision is the first
  thing to read it.
- Neutral, because `problems` gains an entry in the all-skipped case, which
  `--format json` serializes. It is additive and warning-level.

### Confirmation

`test/unit/nothing-ran.test.ts` pins several things separately. A corpus
resolving nothing rejects with a `DocevalsError`. The message names the page
count, both frontmatter keys, the config key and `moose-docevals list`. One page
resolving one eval is enough to suppress it, and a resolution error takes
precedence over it. **An empty `--since` scope still exits 0**, which is the
ordering guard and the regression that would silently contradict ADR 01040.
`--eval` keeps its own message. The warning fires for a page-level `eval-skip`,
for `--deterministic-only`, for a wholly skipped corpus with no results at all,
and for an empty `--since` scope. It does **not** fire when something reached a
verdict, nor when the only results need human review.

A dedicated block pins the skip carve-out in both directions. **A corpus where
every page is skipped is exit 0**, not a usage error. That was the regression the
first draft of this rule caused, and `docs/src/content/docs/evals/index.mdx`
would have caught it in `verify-docs`. Meanwhile **one page the author did not
skip, with nothing configured to check it, is still exit 2**. That is the guard
against fixing the first by widening past the skip.

`test/unit/init.test.ts` pins the scaffold by resolution rather than by text.
The suite it defines attaches to a page with no eval frontmatter, and a
scaffolded corpus grades something on its first run.

`.github/workflows/ci.yml` runs the built CLI over four cases. A corpus whose
config selects nothing exits 2 naming `defaults.suite`. The same corpus with the
suite attached exits 0 having graded. The pair matters, so the guard cannot
pass by the corpus being broken in some other way. An all-skipped corpus exits 0
and says it graded nothing. A single unskipped page with nothing to check is
exit 2 again. The scaffold is asserted in the `init` step against a page carrying
**no** eval frontmatter. The page already there carries an `evals:` key
of its own, and would pass whatever `defaults.suite` said.

## Pros and Cons of the Options

### Option 1, two tiers, split on whether an eval resolved

- Good, because it treats the two situations as what they are. An unconfigured
  corpus is a defect in the setup; a skipped corpus is a choice the user made.
- Good, because it puts the exit-2 case in exact agreement with ADR 01018,
  which already answered the same question for the flag-driven route.
- Good, because placing the check before every narrowing reconciles it with
  ADR 01040 structurally rather than by exception.
- Good, because the warning tier reuses ADR 01019's mechanism. It does not add
  a second way for a run to say "I covered less than you think".
- Bad, because it is two rules where one would be easier to remember. The
  line between them, *did an eval attach*, is not the line a user would
  guess. It is documented in `reference/output-and-exit-codes.mdx` for exactly
  that reason.
- Bad, because it is a breaking change for a repository currently exiting 0
  over an unconfigured corpus.

### Option 2, exit 2 whenever nothing was graded

- Good, because it is one rule with no boundary to explain.
- Bad, because it breaks `eval-skip`, `--deterministic-only` on a keyless
  runner, and `--ai-only` on a deterministic corpus. That is three working
  features broken to fix a fourth thing.
- Bad, because a skipped run is not silent. It produces a result per eval and
  the reporters print every one. The problem this ADR exists for is an *empty*
  report, and this option punishes a full one.

### Option 3, warn in both cases, change no exit code

- Good, because nothing breaks and no user in any current state is stopped.
- Bad, because a warning is not load-bearing against a green check mark, the
  sentence ADR 01018 already committed to. CI shows the exit code; the log
  scrolls. The whole reason `--eval no-such-eval` is exit 2 rather than a
  warning is that a warning does not stop a build.
- Bad, because it leaves the two routes to one condition disagreeing, which is
  the inconsistency that made this a defect rather than a preference.

### Option 4, exit 1

- Good, because it stops a build, which is most of what is wanted.
- Bad, because exit 1 means "the corpus has findings" everywhere else in this
  tool, and there are none, because nothing looked. A CI job that greps the
  report for what failed would find an empty list next to a failing exit code.
- Bad, because it contradicts ADR 01018 for the flag-driven case, which would
  then have to be changed to match or left inconsistent.

### Option 5, fix `STARTER_CONFIG` only

- Good, because it is a one-line change that removes the way most people would
  ever reach this state.
- Bad, because it fixes the instance and not the class. Any config that selects
  nothing reproduces it, and reproduces it as a green build. That covers a
  renamed suite, a `files.include` widened past the annotated pages, and a
  corpus adopted from elsewhere, which is exactly where this was found.
- Bad, because it leaves `run` and `--eval` giving different answers to the
  same question, which is the part that makes the behavior indefensible rather
  than merely unfortunate.
