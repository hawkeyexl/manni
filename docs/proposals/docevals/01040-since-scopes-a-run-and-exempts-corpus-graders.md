---
status: "accepted"
date: 2026-08-31
decision-makers: [hawkeyexl]
---

# `--since <ref>` scopes a run to changed pages, and exempts corpus graders

## Context and Problem Statement

Every `moose-docevals run` grades the whole corpus. On the fixture corpus that is
13 pages and costs nothing; on the docs site it is 34. On the corpus this tool is
built for it is hundreds, and the AI judge is priced per page per ensemble run.
That corpus is Priya's, in `docs/content-strategy/personas/persona-corpus-owner.md`. A pull
request that edits one page pays for all of them, on every push.

The judge response cache already absorbs part of that. An unchanged page whose
prompt and `PROMPT_VERSION` are unchanged replays a cached verdict instead of
paying for a new one. It does not absorb the rest. A cache hit is still a cache
*lookup* per eval per run, and the deterministic graders still shell out.
`tool:markdownlint`, `tool:vale` and `tool:doc-detective` are subprocesses, and
`tool:doc-detective` drives a browser. A cold cache on a fresh CI runner is
the normal case, not the exception. The cache makes an unchanged page *cheap*;
it does not make it *free*, and it does nothing about wall-clock.

`--eval` and `--suite` ([ADR 01018](01018-selecting-evals-suspends-suite-enforcement.md))
narrow a run by *what is checked*. Nothing narrows it by *what changed*.

The obvious implementation is to ask git which files differ and evaluate only
those. It has three ways to be wrong that do not announce themselves.

## Decision Drivers

- **A CI job must not be made to lie.** The failure mode of every shortcut in
  this repo is the same one: something reports green having checked less than it
  claims. `discoverPages` throws rather than returning an empty list. ADR 01018
  suspends suite targets on a filtered run, and ADR 01022 fails an eval whose
  grader reached no verdict. A scoping flag is the next place that rule can be broken.
- **A corpus grader's input *is* its subject.** Narrowing what a cross-page check
  sees does not narrow the check; it changes what the check means.
- **"Nothing changed" is a correct answer.** The flag exists for the branch that
  touched only source. If that case is an error, the flag is unusable in CI.
- **The most common report against this feature is predictable.**
  `actions/checkout` defaults to `fetch-depth: 1`, where `origin/main` does not
  exist locally. Whatever message that produces will be read by more people than
  any other part of this change.
- **Path reconciliation is a silent failure, not a loud one.** Comparing the
  wrong two path spaces matches nothing and throws nothing.

## Considered Options

1. **Filter pages after resolution, exempting corpus graders**, via `--since <ref>`.
2. **Filter at discovery**, so unchanged pages are never read.
3. **Scope everything, corpus graders included.**
4. **Do not add scoping**; rely on the judge cache and on narrowing by glob.
5. **A `since:` config key** as well as the flag.

## Decision Outcome

**Option 1 wins.** `--since <ref>` on `run`, applied after resolution and
selection, with `mode: "corpus"` graders exempt.

**1. It filters what is *evaluated*, not what is *loaded*.** `discoverPages` still
reads the whole corpus and `resolvePages` still resolves it; the scope is applied
after `applySelection` in `src/core/engine.ts`. Three reasons, each of which rules
out filtering at discovery on its own:

- `discoverPages` throws `DocevalsError` on an empty pattern match
  (`src/core/discover.ts`), so filtering the input set would make a clean tree
  **exit 2**. That is the wrong answer for the job this flag exists for.
- Resolution problems must surface for every page. That covers an unrecognized
  `eval-*` key, an unknown grader, and a shorthand colliding with a defined eval
  id. This is ADR 01018's driver applied one flag later: a scope must narrow what
  is *graded*, never what is *diagnosed*.
- `PageFile.absPath` only exists after discovery, and the absolute path is what
  the comparison needs (see 3).

**2. `ref...HEAD`, `-z`, and two invocations.** `src/core/since.ts` runs
`git rev-parse --show-toplevel`, which doubles as the is-this-a-repository check
and supplies the anchor. It then runs
`git --no-pager diff --name-only -z <ref>...HEAD`.

Three dots, not two: `ref...HEAD` diffs against the merge base, which is what a
pull request means by "changed". Commits that landed on the base branch after
this one forked are not this branch's changes. A two-dot diff would drag them
in. The consequence worth stating out loud is that **uncommitted working-tree
edits are not included**. That is correct in CI, and surprising locally.

`-z` is not a stylistic preference. Without it, `core.quotePath` (on by default)
C-escapes any path containing a non-ASCII byte, quotes included, as in
`"docs/caf\303\251.md"`. The escaped string then matches no discovered page.
Nothing errors; the page is simply never evaluated. The parser splits on NUL and drops the trailing
empty entry the terminator leaves behind.

**3. Reconciliation happens in absolute space.** git prints paths relative to the
repository top level. `PageFile.file` is relative to the *discovery* root. Those
are the same string only when the config sits at the repository root. They differ
the moment it does not, as in this repo's own docs site (`docs/`). Comparing
them anyway does not throw. It matches nothing, so every page reads as unchanged
and the run exits 0 having evaluated nothing. `changedKey` resolves both sides to
an absolute path and lowercases on win32. git reports the case in its index,
fast-glob reports the case on disk, and the two can also disagree about the
drive letter.

**4. Corpus graders are exempt. This is the subtle half of the decision.**
`GraderContext` (`src/graders/types.ts`) carries `targets`, not a page list. A
`mode: "corpus"` grader therefore builds its comparison population out of exactly
what it is handed. `gradeGroup` in `src/graders/native/differentiation.ts` opens with
`if (scoped.length < 2) return []`. The engine records an eval with no findings
as a **pass**. So narrowing a corpus grader's input does not narrow the check.
**It silently converts the check into a pass**, by default, in CI, on every scoped
run. That is precisely the shape ADR 01020 and ADR 01022 exist to prevent, and it
would have been introduced here as the default behavior.

`tool:differentiation` is the only corpus grader, it costs no subprocess and no
tokens, so it keeps the whole corpus. `applySinceScope` keeps an unchanged page's
corpus evals and drops the rest.

The consequence is accepted rather than worked around: **a scoped run can report a
finding on a page that did not change.** The finding's message already names the
other page, so the reader can see why. The alternative is a check that quietly
stops checking.

**5. A clean tree is exit 0, not exit 2, which is the opposite of an empty `--eval`.**
These look like the same situation and are not. `--eval no-such-eval` matching
nothing means the *invocation* is wrong. That is a typo or a renamed eval, a
defect in what was asked for, which ADR 01007 makes exit 2. `--since origin/main`
matching nothing means the *answer* is "no documentation changed". That is
correct, common, and exactly what a branch that touched only source should
produce. Making it an
error would make the flag unusable for the job it exists for.

What replaces the error is a **statement**. The reporters say `No pages changed
since <ref> — nothing was evaluated.`, in yellow in the human reporter, as a
blockquote in markdown, and as a `::notice::` annotation in the GitHub reporter.
Without that line a clean-tree run is an indistinguishable green: same exit code,
same empty body, nothing saying that nothing ran. The report also carries a
machine-readable `since: { ref, pagesSelected, pagesTotal }` block. `pages` stays
the size of the whole corpus, so the two numbers can be compared.

**6. `--since` suspends suite enforcement, by reusing ADR 01018's mechanism.** A
scoped run measures a sample of the corpus, which is the same claim-from-a-sample
problem `--eval` has. A run scoped to one passing page would otherwise compute
1/1 = 100% against a target of 1.0 and report the gate as met. `summarizeSuites`
is passed `filtered || scope !== null`, so a scoped run's summaries carry
`partial: true` and `meetsTarget: false` exactly as a filtered run's do. One
mechanism, one behavior, one thing to remember.

**7. `--write-baseline` refuses `--since`**, as it already refuses `--eval` and
`--suite`, and for the same reason. A re-record rebuilds the file from this run's
findings, so recording from a scoped run would drop every fingerprint the scope
excluded. The guard sits **before** the git call, so a usage error never spawns a
subprocess. Reading a baseline is unaffected. `applyBaseline` counts `stale` only
over files the run actually graded. Unscoped pages are therefore not reported as
"no longer occur", which is the sentence that invites the destructive re-record.

**8. Failure triage is three distinct messages, in order:** `spawnError` (git could
not be run, so install it or drop the flag), `timedOut`, then a non-zero exit. The
non-zero exits differ by invocation. `rev-parse` failing means this is not a git
repository; the `diff` failing means the ref would not resolve. **That message
names the ref and mentions shallow clones**, because `actions/checkout` defaults to
`fetch-depth: 1` and `--since origin/main` fails there until someone sets
`fetch-depth: 0`. Collapsing the spawn failure into "not a git repository" would
send the reader to fix the wrong thing.

**9. No config key, and not on `list`.** `--eval` and `--suite` have no config
field either, and for the same reason: this is per-invocation selection, not
policy. "Which ref am I comparing against" is a property of the job, not of the
repository. A config key would be wrong for every invocation but one. `list` does
not get the flag in this change, because `runList` is synchronous and exported
from `src/index.ts`. Making it async to await git is a breaking API change that
belongs in its own commit.

### Consequences

- Good, because a CI job can evaluate a pull request's changed pages without
  re-judging an unchanged corpus. That is what makes the judge affordable on a
  large one.
- Good, because the one check that a naive implementation would have broken,
  `tool:differentiation`, keeps working. It keeps working *by construction*
  rather than by a note in the docs.
- Good, because a clean tree produces a sentence rather than a silence.
- **Bad, because a scoped run can report a finding on a page the author did not
  touch.** That is the price of the corpus exemption, and it is the right way
  round: a confusing true finding beats a silent false pass.
- **Bad, because `ref...HEAD` ignores uncommitted work.** Locally, editing a page
  and running `--since main` evaluates nothing until the edit is committed. The
  CLI reference says so; nothing enforces it.
- Neutral, because `EngineReport` gains an optional `since` block, which
  `--format json` serializes. It is additive.
- Neutral, because `--since` and the judge cache are **complements, not
  substitutes**. `--since` avoids *dispatching* work on pages that did not change;
  the cache avoids *paying* for a changed page whose prompt turns out to be
  identical. Neither subsumes the other: the cache cannot skip a subprocess, and
  `--since` cannot help a page that genuinely changed.

### Confirmation

`test/unit/since.test.ts` pins a long list. It pins the exact argv of both
invocations, so `...` and `-z` cannot be dropped silently, and NUL splitting
including the trailing empty entry. It pins anchoring on the git top level rather
than the discovery root. That case puts the config in a subdirectory, and it
fails the moment anyone compares against `page.file`. It pins each of the four
failure messages separately. The unresolvable-ref one names the ref and mentions
shallow clones. It pins a clean tree exiting 0 with no results. It pins a changed
page running and still exiting 1 on a failure, and a changed page the config
excludes running nothing. It pins suite suspension, and `--write-baseline`
refused with **zero** git invocations recorded. It pins a baseline read not
marking unscoped files stale, and resolution problems on unchanged pages still
surfacing. Last comes the red test for the exemption. **A changed page is still
compared against its unchanged siblings, with the scoped verdicts equal to the
unscoped ones.**

`.github/workflows/ci.yml` runs the built CLI: `--since HEAD` in a clean checkout
exits 0 and says nothing was evaluated, a bogus ref exits 2, and
`--since HEAD --write-baseline` exits 2.

## Pros and Cons of the Options

### Option 1, filter after resolution, exempt corpus graders

- Good, because the corpus-grader hazard is closed structurally: there is no code
  path from a scoped run to a narrowed comparison population.
- Good, because resolution problems and the empty-input contract are both
  untouched, so nothing that already guards against a silent green is weakened.
- Good, because it reuses ADR 01018's `partial` mechanism instead of inventing a
  second suspension with its own behavior.
- Bad, because the whole corpus is still read and resolved, so the saving is in
  grading and judging rather than in I/O. That is the smaller half of the cost,
  but it is the half that is nearly free to skip.
- Bad, because a finding can now appear on a page outside the scope, which will be
  surprising the first time.

### Option 2, filter at discovery

- Good, because it is the cheapest possible implementation and the one most people
  would reach for. Fewer files are read, and fewer parsed.
- Bad, because `discoverPages` throws on an empty result, so **a clean tree would
  exit 2**. Special-casing that guard is worse than not filtering there, because
  the guard is what makes a typo'd glob loud.
- Bad, because a page filtered out of discovery is never resolved, so a broken
  `eval-*` key on it stops being reported. That is the exact hiding ADR 01018 refused.
- Bad, because `absPath` does not exist yet. The comparison would have to be
  rebuilt against raw glob output in a second path-space, doubling the surface for
  the reconciliation bug.

### Option 3, scope everything, corpus graders included

- Good, because it is the simplest rule to describe. "Only changed pages are
  evaluated", with no exception to remember.
- Bad, because `tool:differentiation` would silently pass on any scoped run
  touching fewer than two of its pages. Not fail, but **pass**. The check would be
  gone and the report would look identical.
- Bad, because it is not even a coherent narrowing. A cross-page check's *input
  set is its subject*, so restricting the input changes the question rather than
  reducing the work.

### Option 4, no scoping; rely on the cache and on globs

- Good, because it is zero new surface. The cache already removes the largest
  single cost.
- Bad, because the cache is per-eval and cold on a fresh runner; deterministic
  graders shell out regardless; and `tool:doc-detective` drives a browser per page.
- Bad, because narrowing by glob requires the author to know which pages they
  changed and to type them. That is a worse spelling of a question git already
  answers exactly.

### Option 5, add a `since:` config key as well

- Good, because it would match the "every knob flows through the config" pattern
  in CLAUDE.md.
- Bad, because that pattern is about *policy*, and a comparison ref is not policy.
  It is a property of one invocation, different for a pull request, a nightly run
  and a local check. `--eval` and `--suite` have no config field for the same
  reason, and this decision follows the precedent rather than splitting it.
