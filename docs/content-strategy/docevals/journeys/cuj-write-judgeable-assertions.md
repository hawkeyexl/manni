---
id: cuj-write-judgeable-assertions
type: cuj
title: Write assertions the judge can actually decide
personas: [persona-standard-owner, persona-corpus-owner]
trigger: "An eval keeps flipping between pass and fail, or fails pages that are obviously fine"
entry_point: docs/src/content/docs/docevals/evals/write-good-assertions.mdx
success_criteria: >
  An assertion that two humans reading the same page agree on, that the judge agrees with, and whose
  failure tells the author which sentence to change.
steps:
  - { stage: "See why an assertion is unjudgeable", doc: docs/src/content/docs/docevals/evals/write-good-assertions.mdx, exists: true }
  - { stage: "Scope what the judge looks at", doc: docs/src/content/docs/docevals/evals/write-good-assertions.mdx, exists: true }
  - { stage: "Pin the boundary with a passing and a failing example", doc: docs/src/content/docs/docevals/evals/write-good-assertions.mdx, exists: true }
  - { stage: "Decide whether it guards behavior or measures reach", doc: docs/src/content/docs/docevals/evals/regression-vs-capability.mdx, exists: true }
  - { stage: "Ask whether it should be an ai eval at all", doc: docs/src/content/docs/docevals/evals/deterministic-checks.mdx, exists: true }
  - { stage: "Check the wording against how it is judged", doc: docs/src/content/docs/docevals/judge/index.mdx, exists: true }
  - { stage: "Look up every field an eval can carry", doc: docs/src/content/docs/docevals/reference/frontmatter.mdx, exists: true }
---

# CUJ: Write assertions the judge can actually decide

**Scope:** assertion craft, meaning the wording of a single eval. Organizing many of them is
[`cuj-eval-library`](cuj-eval-library.md); proving the judge agrees with you at corpus scale is
[`cuj-trust-the-judge`](cuj-trust-the-judge.md).

**Trigger.** An eval is behaving badly. It lands in human review constantly, or it fails pages the
team considers fine. The reader's first hypothesis is that the grader is broken.

**Narrative.** It usually is not. **A flaky eval is almost always a vague assertion**, and that
diagnosis is the most valuable thing this journey delivers. "The page is well-written" cannot be
adjudicated by a model, by a human, or by anything else. Two reviewers will not agree on it either.
"The page states its prerequisites before the first command" can be decided by anyone, consistently,
including a model. The gap between those two sentences is the entire skill, and it is
[Sara's](../personas/sara-standard-owner.md) core competence to develop.

Three fields close that gap and they are taught as one mechanism rather than as three optional
properties:

- **`assertion`** states a claim about the page that is true or false, not a quality aspiration.
- **`evidence`** scopes what the judge should look at, which stops it reasoning from parts of the page
  the assertion was never about.
- **`examples.pass` / `examples.fail`** pin the boundary. They matter more than they look: they are
  where a borderline case gets decided once, in writing, instead of differently on every run.

The test to teach is simple and portable. **Would two reviewers reading the same page reach the same
verdict?** If not, no grader will be consistent either, and tuning the model is the wrong repair.

Two adjacent decisions belong in this journey because they change the wording. Whether an eval is a
**regression** or a **capability** changes how strictly it should be phrased. A regression guards
behavior that must keep working and targets ~100%; a capability measures reach and targets ~70%.
`regression` is the default because most evals guard something. And the standing question
**"should this be an ai eval at all?"** belongs here rather than only in
[`cuj-cheapen-evals`](cuj-cheapen-evals.md). The cheapest time to notice an assertion is really a
grep is while writing it.

The reader should also understand, at least in outline, **how their words get judged**. That means
the ensemble, consensus where `partial` counts as fail, and the confidence zones. Those mechanics
explain why a marginal assertion produces human-review verdicts rather than random ones.

**Status.** All 7 steps are served by written pages (5 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
