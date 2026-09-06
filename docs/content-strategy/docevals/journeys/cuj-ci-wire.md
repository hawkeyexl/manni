---
id: cuj-ci-wire
type: cuj
title: Wire the gate into CI
personas: [persona-pipeline-owner, persona-corpus-owner]
trigger: "A docs team asked for a step, and it has to work the same way in every repo"
entry_point: docs/src/content/docs/docevals/ci/index.mdx
success_criteria: >
  One parameterized job, identical across repos, that blocks a pull request on findings, annotates
  the offending lines inline, and routes operational failures somewhere other than the author.
steps:
  - { stage: "Add the job on the reader's platform", doc: docs/src/content/docs/docevals/ci/index.mdx, exists: true }
  - { stage: "Get the same recipe for the other platforms", doc: docs/src/content/docs/docevals/ci/recipes.mdx, exists: true }
  - { stage: "Route on the exit code", doc: docs/src/content/docs/docevals/ci/exit-codes-and-annotations.mdx, exists: true }
  - { stage: "Annotate the offending lines in the pull request", doc: docs/src/content/docs/docevals/ci/exit-codes-and-annotations.mdx, exists: true }
  - { stage: "Supply the provider credential", doc: docs/src/content/docs/docevals/judge/choose-a-provider.mdx, exists: true }
  - { stage: "Persist the response cache between runs", doc: docs/src/content/docs/docevals/ci/cost-and-caching.mdx, exists: true }
  - { stage: "Feed results into existing tooling", doc: docs/src/content/docs/docevals/ci/consume-results.mdx, exists: true }
---

# CUJ: Wire the gate into CI

**Scope:** installing and operating the gate. Bounding what it can spend and what it can execute is
the companion journey, [`cuj-bound-cost-and-risk`](cuj-bound-cost-and-risk.md). It is split out
because it has a different failure mode, a security incident or a surprise bill rather than a broken
build. A reader can get this one right and that one badly wrong.

**Trigger.** The evals exist and work locally. Now they have to run somewhere nobody is watching.

**Narrative.** [Devin](../personas/devin-pipeline-owner.md) is the primary reader and he authors no
evals. Every page in this journey must be usable without knowing what a capability suite is. He
arrives with a strong prior. Any check which is slow, flaky, or expensive will be disabled by the
first team it inconveniences. He is looking for evidence that this one is none of those.

**The exit-code contract is the load-bearing part**, because the three codes route to different
humans. `0` passes. `1` means findings. That is the author's problem and should block the pull
request. `2` means operational: a missing credential, an unreachable provider, a malformed config.
That is the platform team's problem. Blaming the author for it is how a check earns a reputation
for flakiness it does not deserve. A recipe that treats any non-zero exit as "docs are bad" is wrong.
The docs have to be explicit enough that nobody writes one.

**`--format github` is the difference between a usable check and an annoying one.** A failure that
annotates the exact line in the pull request is fixed in minutes. The same failure reported only in a
job log gets ignored until someone asks. This is the step that most directly serves
[Theo](../personas/theo-contributor.md), who never reads this journey. That is worth stating,
because Devin will not otherwise weigh a formatting flag as an adoption decision.

**Cache persistence is a correctness concern, not an optimization.** The economics assume unchanged
pages never re-judge. A CI job that starts with a cold cache every time re-judges the whole corpus on
every push. The resulting bill is what gets the check removed. A cold cache also spends
turns a warm one does not. That is the difference between a run that fits inside `judge.max-turns`
and one that quietly skips every page past the cap. Where the cache lives and what belongs in the
cache key are therefore first-class reference material.

The credential step is where the fork problem first appears. It is *raised* here and *resolved* in
[`cuj-bound-cost-and-risk`](cuj-bound-cost-and-risk.md); this journey must hand off rather than
half-answer it.

**Status.** All 7 steps are served by written pages (6 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
