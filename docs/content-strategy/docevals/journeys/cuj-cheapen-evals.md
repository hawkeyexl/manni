---
id: cuj-cheapen-evals
type: cuj
title: Move evals down the grader hierarchy
personas: [persona-standard-owner, persona-solo-owner, persona-retrofitter]
trigger: "Every eval is an ai eval, and the bill and the run time both grow with the corpus"
entry_point: docs/src/content/docs/docevals/adopt/promote-to-deterministic.mdx
success_criteria: >
  Evals that could always have been code are now command evals with committed, reviewable scripts,
  and the next run makes measurably fewer inference calls with no loss of coverage.
steps:
  - { stage: "Find which ai evals could be code", doc: docs/src/content/docs/docevals/adopt/promote-to-deterministic.mdx, exists: true }
  - { stage: "Convert them", doc: docs/src/content/docs/docevals/adopt/promote-to-deterministic.mdx, exists: true }
  - { stage: "Generate a script for a plain-language command eval", doc: docs/src/content/docs/docevals/evals/deterministic-checks.mdx, exists: true }
  - { stage: "Review the generated script like any other source", doc: docs/src/content/docs/docevals/adopt/review-generated-scripts.mdx, exists: true }
  - { stage: "Understand what invalidates a generated script", doc: docs/src/content/docs/docevals/reference/frontmatter.mdx, exists: true }
  - { stage: "Confirm the saving", doc: docs/src/content/docs/docevals/ci/cost-and-caching.mdx, exists: true }
---

# CUJ: Move evals down the grader hierarchy

**Scope:** converting judged evals into deterministic ones, and generating scripts for plain-language
deterministic assertions. Wrapping *existing* tools is
[`cuj-orchestrate-tools`](cuj-orchestrate-tools.md); this journey is about evals that started life as
ai evals and should not have stayed that way.

**Trigger.** A `fill` pass, or ordinary drift, has left a corpus where nearly every eval is judged.
Run time and cost now scale with the corpus, and both are trending the wrong way.

**Narrative.** The grader hierarchy is a claim about *preference*, and preferences decay without a
mechanism. Left alone every eval stays wherever it was born. Since `ai` is the default grader and
`fill` proposes ai-graded evals by construction, "left alone" means expensive. `promote` and
`generate` are that mechanism, and this journey is the discipline of applying them.

The saving is observable but not priced. A run reports how many evals it judged, how many of those
were cache hits, and the token total. It never reports a dollar figure (ADR 01019). A page here that
claims a percentage saved must derive it from those counts, or from the drop in inference calls. The
conversion to money is left to the reader's provider.

The rule is the manuscript's: **if you can express the eval criterion as code, do it.** `promote` asks
the model to apply exactly that test to the existing ai evals and reports which ones pass it.
Crucially it is **report-only by default**, and `--write` is a separate, deliberate act. Converting
an assertion changes what is being checked, and that deserves a human decision rather than
a flag someone set once.

The step readers underestimate is **reviewing the generated script**. Generated scripts are ordinary
version-controlled source, written to a file parallel to the doc and referenced from frontmatter as a
`command`. They are never embedded in the frontmatter itself. That design exists so they show up in pull
requests and can be edited by hand. It only pays off if someone actually reads them. A generated
script that passes for the wrong reason is worse than the ai eval it replaced, because it is now
silent and cheap.

`generated.assertion-hash` closes the loop. Edit the assertion and the hash no longer matches, so the
script is stale and regenerates rather than quietly checking the old thing. Readers meet this field
first as a confusing failure in [`cuj-fix-red-check`](cuj-fix-red-check.md). Explaining it here, where
it is created, is what makes that later encounter legible.

**Status.** All 6 steps are served by written pages (5 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
