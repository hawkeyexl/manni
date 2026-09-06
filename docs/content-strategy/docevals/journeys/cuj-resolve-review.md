---
id: cuj-resolve-review
type: cuj
title: Resolve an eval that landed in human review
personas: [persona-standard-owner, persona-corpus-owner]
trigger: "An eval came back needs-review and the pull request is waiting on a person"
entry_point: docs/src/content/docs/docevals/judge/human-review.mdx
success_criteria: >
  A recorded verdict with an author and a rationale that unblocks the pull request, persists for
  future runs, and self-invalidates when the page changes.
steps:
  - { stage: "See which evals are waiting on a person", doc: docs/src/content/docs/docevals/judge/human-review.mdx, exists: true }
  - { stage: "Understand why this one landed here", doc: docs/src/content/docs/docevals/judge/index.mdx, exists: true }
  - { stage: "Record a verdict", doc: docs/src/content/docs/docevals/judge/human-review.mdx, exists: true }
  - { stage: "Know when the verdict expires", doc: docs/src/content/docs/docevals/judge/human-review.mdx, exists: true }
  - { stage: "Decide whether review should block the build", doc: docs/src/content/docs/docevals/ci/exit-codes-and-annotations.mdx, exists: true }
  - { stage: "Fix the cause if it keeps happening", doc: docs/src/content/docs/docevals/evals/write-good-assertions.mdx, exists: true }
  - { stage: "Look up where verdicts are stored", doc: docs/src/content/docs/docevals/reference/files-and-state.mdx, exists: true }
---

# CUJ: Resolve an eval that landed in human review

**Scope:** the recurring operational loop of clearing the review queue. Establishing confidence in the
judge as a whole is [`cuj-trust-the-judge`](cuj-trust-the-judge.md), a periodic, project-shaped
activity. This one is a Tuesday.

**Trigger.** A pull request is blocked, or a report shows evals in the needs-review zone, and a human
has to decide.

**Narrative.** This is a small journey with an outsized effect on whether the tool survives. It is
where the **human-review zone stops being an elegant design idea and becomes someone's inbox.**
A queue nobody knows how to clear silently becomes a queue nobody clears, and the team's response is
to turn the zone off.

Three facts do most of the work. **`manni docevals review` with no arguments lists what is waiting.**
Readers assume they need to hunt through a report, and they do not. **A recorded verdict persists**, so
this is not a per-run tax; unchanged pages stay resolved. And **verdicts self-invalidate when the page
changes**, which is the property that makes persistence safe rather than a way to accumulate stale
approvals. That last one must be stated explicitly, because a reader who does not know it will either
distrust persistence or over-trust it.

`--fail-on-review` is a genuine policy fork and the docs should present it as one rather than
recommending a default. Blocking on review means the queue is never ignored and pull requests
sometimes wait on a person. Not blocking keeps the pipeline moving and lets the queue rot. Which is
right depends on whether the team has someone who owns the queue. Naming that as the deciding
question is more useful than a recommendation.

The last step is the important one and is easy to omit: **a repeat offender is a diagnosis, not a
chore.** An eval that lands in review every single run is telling you its assertion is ambiguous. The repair
is in [`cuj-write-judgeable-assertions`](cuj-write-judgeable-assertions.md), not in
answering it faster forever.

Shared between [Sara](../personas/sara-standard-owner.md), who owns the standard and usually the
queue, and [Priya](../personas/priya-corpus-owner.md), who owns whether the queue is anyone's job.
Note that [Theo](../personas/theo-contributor.md) *encounters* this zone in
[`cuj-fix-red-check`](cuj-fix-red-check.md) and cannot resolve it. Being told to escalate, and to
whom, is his correct outcome.

**Status.** All 7 steps are served by written pages (5 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
