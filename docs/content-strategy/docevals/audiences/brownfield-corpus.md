---
id: aud-brownfield-corpus
type: audience
segment: A large existing corpus with no evals on it
maturity: cross-cutting
docs_owner: Varies; this lens overlaps three other segments
cross_cutting: true
overlaps: [aud-docs-platform-team, aud-solo-docs-owner, aud-quality-standard-owner]
firmographics: [1000-plus-pages, years-of-accumulation, mixed-authorship, partial-ownership]
relationship_stages: [prospect, customer]
personas: [persona-retrofitter]
features_emphasized:
  [fill, confidence-threshold, severity-warning, capability-suites, target-pass-rate, skip,
   promote, generate, max-turns]
evidence_basis: [doc-detective-user-base, docs-as-tests-manuscript, docevals-surface]
---

# Audience: Brownfield corpus *(cross-cutting lens)*

**Scope:** a lens, not a segment. It is defined by the **state of the corpus** rather than by who owns
the docs. That state is thousands of pages accumulated over years, written by people who have left,
with no evals on any of them. It cuts across [`aud-docs-platform-team`](docs-platform-team.md),
[`aud-solo-docs-owner`](solo-docs-owner.md), and
[`aud-quality-standard-owner`](quality-standard-owner.md), and it is listed separately because the
adoption problem it creates is genuinely different from theirs.

## Why this is its own lens

Every other audience file describes a **steady state**: evals exist, the gate runs, someone maintains
it. This lens describes the **transition into** that state, which fails for its own reasons.

The failure is arithmetic. Turn an honest quality bar on a corpus that has never been measured and
essentially everything fails at once. That result is simultaneously accurate and useless. It cannot be
triaged, it cannot be merged, and it teaches the team that the tool is wrong rather than that the docs
are. Adoption dies at the first run. Every product decision aimed at this lens exists to make that
first run survivable. That covers `fill`'s confidence threshold, `severity: warning`, capability
suites with a target pass rate below 1.0, and page-level `skip`.

The overlap is real and should not be papered over. A docs platform team retrofitting 3,000 pages is
in both this lens and its home segment, and needs both sets of pages. The lens exists so the
transition gets designed for explicitly instead of being assumed away.

## Who they are

Whoever is handed the retrofit. That may be a staff writer on a quarter-long initiative, a contractor,
or a new docs hire told to "get quality under control." It may be the solo owner on a weekend.
Frequently *not* the person who wrote the content, and often without authority to delete any of it.

## What they're trying to do

Get a corpus that has never been measured under continuous evaluation, on a ratchet where each step
is small, mergeable, and leaves the build green. Do it without a day-one wall of red and without
hand-authoring thousands of assertions.

## Defining pains

- **The wall of red.** The single defining pain. The first honest run is unmergeable, and the instinct
  it produces, weakening the assertions until the build is green, permanently destroys the standard.
  The correct move is the opposite. Keep the assertions honest, start at `severity: warning`, and
  ratchet severity up as pages are fixed. That inversion is unintuitive and must be taught directly.
- **Hand-authoring does not scale to the corpus size.** `fill` is the only viable entry point. Its confidence gate, its caching, and its turn budget are
  adoption-critical here in a way they are not for a greenfield corpus.
- **Machine-proposed evals need triage, and that is a new job.** A proposal above the threshold is not
  automatically a good assertion. Reviewing a few hundred proposed evals is real work that has to be
  planned for. The docs should say so rather than implying `fill` finishes the job.
- **Cost is front-loaded and lumpy.** The initial pass over the whole corpus is by far the largest
  spend the team will ever see. It arrives before any value has been demonstrated. Batching by
  directory and capping each batch with `--max-turns` are what keep it defensible. So does knowing
  that the raw proposal cache makes both re-gating and the subsequent write pass free.
- **Not every page is worth evaluating.** Deprecated sections, generated reference, and archives
  should be excluded rather than fixed. `files.exclude` and page-level `skip` are triage tools, and
  triage has to be presented as a legitimate first step, not as giving up.

## Buying constraints

- Must be adoptable **incrementally by directory**. Nobody can review a 3,000-page pull request.
- Must produce a demonstrable win early. One section under a real gate beats partial coverage
  everywhere, because the initiative needs a result before its budget is questioned.
- The size of the initial pass must be estimable in advance, and it is. `fill` spends
  one inference call per uncached page, so the page count *is* the estimate, and `--max-turns` caps
  it before the first call. That arithmetic needs to be the first thing this lens is shown.

## Qualified reader (for docs targeting)

- **Prerequisites they bring.** Whatever their home segment brings. This lens does not change
  technical proficiency, only the situation.
- **Prerequisites they do not bring.** Familiarity with the corpus itself. They often did not write
  it, cannot vouch for it, and may not know which sections are still true.
- **Subject dependencies.** The eval model and `fill` must both be understood before the retrofit
  path makes sense. That is why `adopt/retrofit-a-legacy-corpus.mdx` sits after `adopt/index.mdx`
  rather than opening the section.
