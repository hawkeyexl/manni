---
id: cuj-fix-red-check
type: cuj
title: Fix a failing eval fast
personas: [persona-contributor]
trigger: "A pull request is red because of a manni docevals check the author did not write"
entry_point: docs/src/content/docs/docevals/fix/index.mdx
success_criteria: >
  The author identifies which check failed, makes the smallest correct change or escalates
  correctly, confirms locally, and pushes — in a few minutes, having read one page.
steps:
  - { stage: "Work out which kind of failure this is", doc: docs/src/content/docs/docevals/fix/index.mdx, exists: true }
  - { stage: "Fix a deterministic finding pinned to a line", doc: docs/src/content/docs/docevals/fix/index.mdx, exists: true }
  - { stage: "Act on a judge rationale with no line number", doc: docs/src/content/docs/docevals/fix/index.mdx, exists: true }
  - { stage: "Recognize a failure that is not yours to fix", doc: docs/src/content/docs/docevals/fix/faq.mdx, exists: true }
  - { stage: "Reproduce it locally without a provider key", doc: docs/src/content/docs/docevals/fix/index.mdx, exists: true }
  - { stage: "Answer the recurring questions", doc: docs/src/content/docs/docevals/fix/faq.mdx, exists: true }
---

# CUJ: Fix a failing eval fast

**Scope:** one contributor, one red check, one page. This journey ends when the pull request is green
or correctly escalated. It never expands into configuring, authoring, or operating manni docevals. Those
belong to journeys this reader will not take.

**Trigger.** [Theo](../personas/theo-contributor.md) pushed a change and a check he did not configure
went red. He learns about manni docevals from a CI annotation and expects to stop learning about it four
minutes later.

**Narrative.** By page views this is the **highest-traffic journey on the site**, and by depth the
shallowest. Every contributor who ever trips a check arrives here, most of them once. Serving them
well is also how the gate survives its first month. A blocked contributor who cannot self-serve
escalates to the docs team, and enough of that gets the check removed.

**Triage is the first screen and nothing else works until it is solved.** manni docevals produces at least
five failures that look alike in a CI log and have unrelated remedies:

| What he sees | What it actually is | What he does |
|---|---|---|
| A finding with a file and line | A deterministic tool or command eval | Fix the line |
| A rationale, no line | An AI verdict | Read the assertion and its `examples.fail`, then edit |
| "needs review" | A split ensemble, awaiting a person | Escalate; he cannot resolve it |
| A stale-hash message | The assertion changed; the generated script did not | Escalate or regenerate |
| Exit 2 | Operational, such as a missing key or bad config | Not his fault; tell the platform team |

The second problem is that **a rationale is not a remediation.** "The page promises unreleased
functionality" names the defect without pointing at the sentence. The repair is to teach him to read
the *assertion* and its `examples.fail` next to the rationale. The assertion says what was required,
and the failing example shows what violating it looks like. Between them the offending sentence is
usually obvious. That move is the single most valuable thing his page teaches.

Third, **reproducing locally is not obvious.** CI had a provider key and a warm cache; his laptop has
neither. A naive local run either fails on a missing credential or costs him money. `manni docevals run
--deterministic-only <one file>` is nearly always the right local check, and he will never guess it.

This journey enforces the site's one hard structural constraint: **`fix/index.mdx` has no subject
dependencies.** It must be reachable cold from an annotation link and fully useful to someone who has
read nothing else. Every term is defined inline or linked. Any change that gives that page a
prerequisite is a defect.

**Status.** All 6 steps are served by written pages (2 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
