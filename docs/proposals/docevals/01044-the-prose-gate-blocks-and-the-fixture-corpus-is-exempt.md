---
status: "accepted"
date: 2026-09-04
decision-makers: [hawkeyexl]
---

# The prose gate blocks on the whole corpus, and the vendored fixtures are exempt

## Context and Problem Statement

`.github/workflows/vale.yml` ran the Moose house voice over every Markdown and
MDX file in the repo and then discarded the result. `filter_mode: added`
annotated only the lines a pull request introduced, and `fail_on_error: false`
meant an alert never failed the check. Its own comment said so, and said to flip
it "once the existing corpus is worked down".

That backlog was 1,948 alerts across `README.md`, `CLAUDE.md`, `adrs/`,
`docs/content-strategy/`, `docs/src/content/docs/**`, and the vendored fixture
pages. It has now been worked down, so the two questions the comment deferred
are answerable. What should the gate do, and which files should it hold?

## Decision Drivers

- An advisory gate is a gate people learn to scroll past. This repo has already
  recorded that failure mode twice, in [ADR 01023](01023-the-diagnostic-invariant-is-enforced-by-enumeration.md)
  and [ADR 01024](01024-remark-lints-mdx-where-markdownlint-cannot.md).
- Diff-scoped filtering hides an alert that a rename or a reflow moves onto a
  line the pull request did not touch. At a non-zero backlog that is the only
  workable mode. At zero it is a hole.
- `test/fixtures/pages/` is not this repo's prose. CI asserts specific eval
  outcomes against it. It is deliberately kept close to the doc-detective docs
  it mirrors, so it can be re-synced.
- Nothing else in the repo is somebody else's copy, so the exemption must be one
  path and not a policy.

## Considered Options

1. **Blocking, whole-corpus.** `fail_on_error: true` with `filter_mode: nofilter`.
2. **Blocking, changed files only.** `fail_on_error: true` with `filter_mode: file`.
3. **Leave it advisory** and rely on the backlog staying at zero by habit.

## Decision Outcome

**Option 1 wins.** The gate blocks, and it reports every alert in the checkout
rather than only the ones a diff touches.

`test/fixtures/pages/**` is exempted in `.vale.ini` with an empty
`BasedOnStyles`, which is the only spelling that works. `BasedOnStyles = NONE`
fails at load with `E100 style 'NONE' does not exist`.

Two verbatim quotations are fenced with `<!-- vale off -->` rather than
rewritten, because their bytes are somebody else's. They are the docmeta
proposal 0023 line in [ADR 01009](01009-implement-the-docmeta-evals-vocabulary.md)
and the open-question line in [ADR 01010](01010-kebab-case-is-the-file-vocabulary.md).
Rewriting a quotation to satisfy a style rule misquotes the source.

### Consequences

- Good, because a regression now fails a check instead of appearing as an
  annotation nobody has to clear.
- Good, because `nofilter` catches the alert a reflow moves onto an untouched
  line. Under `added` or `file` that alert stays invisible until someone edits
  the paragraph again.
- Good, because the fixture corpus can be re-synced from upstream freely. The
  gate does not object to prose this repo did not write and must not edit.
- Bad, because `nofilter` will annotate a file the pull request never touched if
  the corpus ever leaves zero. That is the intent, and it is also the reason the
  flip had to wait for zero rather than being shipped alongside the rule set.
- Bad, because the exemption is a path glob, so a second vendored corpus needs a
  second entry rather than inheriting a rule. One entry with a comment is
  clearer than a policy nobody can enumerate.
- Neutral, because `MinAlertLevel` stays `suggestion`. Every Moose rule is
  authored at error level, so the level is not what makes the gate blocking.

### Confirmation

The gate is its own confirmation. Any alert in a linted file fails the `Vale`
check on a pull request that touches `**.md`, `**.mdx`, or `.vale.ini`.

The exemption is confirmed by the fixture corpus reporting zero while still
carrying the prose it always had. A regression that drops the
`[test/fixtures/pages/**]` section shows up as several hundred alerts on the
next pull request that touches a Markdown file.

## Pros and Cons of the Options

### Option 1, blocking and whole-corpus

- Good, because the check answers "is the corpus clean" rather than "is this
  diff clean", which is the property worth having at zero.
- Good, because it needs no per-pull-request reasoning about which lines count.
- Bad, because a single stale alert anywhere blocks every prose pull request
  until someone fixes it.

### Option 2, blocking on changed files only

- Good, because blame stays local to the pull request that caused it.
- Bad, because a file nobody edits can carry an alert forever, which is a
  backlog re-accumulating under a green check.
- Bad, because "changed file" is a weaker claim than it reads as. A one-word
  edit pulls the whole file into scope, so the mode is neither local nor total.

### Option 3, leave it advisory

- Good, because it is no work.
- Bad, because the backlog it was waiting on is gone, so the reason recorded in
  the workflow's own comment no longer holds.
- Bad, because an advisory prose check is the thing that produced a 1,948-alert
  backlog in the first place.
