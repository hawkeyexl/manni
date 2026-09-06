---
id: cuj-trust-the-judge
type: cuj
title: Prove the judge is trustworthy enough to gate a build
personas: [persona-standard-owner]
trigger: "Someone senior asked why a build should be allowed to fail because a model said so"
entry_point: docs/src/content/docs/docevals/judge/index.mdx
success_criteria: >
  A calibration report showing agreement above the threshold and a false-positive rate below the
  alert level, which the reader can hand to a skeptic and be believed.
steps:
  - { stage: "Understand what makes a verdict reproducible", doc: docs/src/content/docs/docevals/judge/index.mdx, exists: true }
  - { stage: "See how several runs become one verdict", doc: docs/src/content/docs/docevals/judge/index.mdx, exists: true }
  - { stage: "Learn where auto-pass ends and human review begins", doc: docs/src/content/docs/docevals/judge/index.mdx, exists: true }
  - { stage: "Build a golden set of human-verified cases", doc: docs/src/content/docs/docevals/judge/calibrate.mdx, exists: true }
  - { stage: "Measure agreement", doc: docs/src/content/docs/docevals/judge/calibrate.mdx, exists: true }
  - { stage: "Watch the false-positive rate", doc: docs/src/content/docs/docevals/judge/calibrate.mdx, exists: true }
  - { stage: "Choose a provider and pin a model", doc: docs/src/content/docs/docevals/judge/choose-a-provider.mdx, exists: true }
---

# CUJ: Prove the judge is trustworthy

**Scope:** establishing and defending confidence in the judge. Wording an individual assertion is
[`cuj-write-judgeable-assertions`](cuj-write-judgeable-assertions.md); handling the individual
verdicts that land in the review zone is [`cuj-resolve-review`](cuj-resolve-review.md).

**Trigger.** The gate is real enough that someone senior has noticed, and the question is not
technical. It is: *why should a model be allowed to block our pipeline?*

**Narrative.** This journey produces an artifact, not an understanding. [Sara](../personas/sara-standard-owner.md)
does not need to feel confident. She needs a number she can put in front of a skeptic. Everything
here serves that.

The mechanics come first because they are the answer to the sharpest form of the objection,
*"nondeterminism has no place in CI."* Temperature 0, pinned models, structured JSON verdicts, and
content-addressed caching mean the same page and the same assertion produce the same verdict. An
N-run ensemble with consensus absorbs what variance remains. Two details are counterintuitive and
must be stated rather than implied. A `partial` verdict **counts as a fail**, and an **errored run
counts against consensus**. Both can only push an eval toward human review, never toward a silent
pass. That asymmetry is the design's safety property and it is exactly what a skeptic is probing for.

Then the confidence zones, which reframe the whole thing. The judge is not being asked to be right,
it is being asked to **know when it is unsure**. Auto-pass, auto-fail, and a human-review band between
them. Presented this way, the human-review zone stops looking like an admission of failure. It starts
looking like what makes a binary verdict acceptable at all.

Calibration is the proof. Twenty to fifty human-verified cases in `.manni/docevals/golden/`, `manni docevals
calibrate`, an agreement rate, and a false-positive rate. The threshold behavior carries a lesson
worth stating plainly. **Below 70% agreement the command exits 1, and the correct response is to
refine the assertions, not the grader.** Low agreement is nearly always evidence that the assertions
are ambiguous. That routes the reader back to
[`cuj-write-judgeable-assertions`](cuj-write-judgeable-assertions.md) rather than into model tuning,
where they would waste a week.

False positives get their own step because they matter more than raw accuracy. A check that fails good
pages is disabled within a week; one that misses a few bad pages survives. `judge.false-positive-alert`
encodes that asymmetry.

The provider step closes a loop opened in [`cuj-ci-wire`](cuj-ci-wire.md) and answers the security
question the lead audience will face. An OpenAI-compatible `base-url` reaches a self-hosted endpoint,
and `claude-cli` needs no API key at all.

**Status.** All 7 steps are served by written pages (3 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
