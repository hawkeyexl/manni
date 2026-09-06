---
id: persona-retrofitter
type: persona
name: "Iris, Corpus Retrofitter"
audience: aud-brownfield-corpus
role: Handed a quarter-long initiative to get a large unmeasured corpus under continuous evaluation
cross_cutting_with: [aud-docs-platform-team, aud-solo-docs-owner, aud-quality-standard-owner]
proficiency: [yaml, globs, batch-editing, git, triage-at-scale, reviewing-machine-generated-output]
prerequisites: [the-eval-grader-verdict-model, what-fill-does]
goals:
  - Get thousands of unmeasured pages onto a ratchet, in mergeable increments
  - Keep every step green so the initiative is never blocked on a wall of red
  - Demonstrate a win on one section before the budget is questioned
  - Size the initial pass in model calls before spending it
pains:
  - The first honest run fails nearly everything, and that result is useless
  - The instinct it produces, weakening the assertions, destroys the standard permanently
  - Machine-proposed evals need triage, which is a new job nobody planned for
  - She often did not write the corpus and cannot vouch for what is still true
content_types: [staged-rollout-runbook, triage-guidance, pass-sizing-recipe]
journeys: [cuj-retrofit-corpus, cuj-bootstrap-corpus, cuj-cheapen-evals]
---

# Persona: Iris

**Scope:** the transition persona for the cross-cutting
[`aud-brownfield-corpus`](../audiences/brownfield-corpus.md) lens. Every other persona describes a
steady state in which evals exist and the gate runs. Iris describes **getting there**, which fails for
its own reasons.

Iris is whoever got handed the retrofit. She may be a staff writer on a quarter-long initiative, a
contractor, or a new docs hire told to get quality under control. She may also be
[Nate](nate-solo-owner.md) on a long weekend. Her technical proficiency is whatever her home segment
brings, and the lens does not change that. What changes is her situation. She is frequently **not the
author** of the corpus she is measuring and cannot vouch for what is still true. She usually has no
authority to delete any of it.

Her defining moment is the first run, and it goes badly by default. Turn an honest quality bar on
3,000 pages that have never been measured and essentially everything fails at once. The result is
accurate and worthless. It is unmergeable and untriageable, and it teaches her team that the tool is
wrong rather than that the docs are. The instinct this produces is to weaken the assertions until the
build goes green, which permanently destroys the standard she was hired to establish.

The correct move is the exact inversion. **Keep the assertions honest and lower the severity instead.**
Start at `severity: warning` so findings report without failing, and use capability suites with a
target pass rate below 1.0. Exclude what should not be evaluated at all, and ratchet severity upward
as pages get fixed. That inversion is unintuitive on first contact and is the single most important thing
[`cuj-retrofit-corpus`](../journeys/cuj-retrofit-corpus.md) has to teach. Getting it wrong is not a
slow start; it is a failed adoption.

Her second reality is that **`fill` does not finish the job**. It proposes; she triages. A few hundred
proposals above the confidence threshold is real review work that has to be planned for. Any page
implying the corpus is now covered sets her up to be wrong in a status meeting. Batching by directory
is how the review stays reviewable, because nobody can approve a 3,000-page pull request.

Her third is **front-loaded cost**. The initial pass is by far the largest spend her team will ever
see and it arrives before any value has been demonstrated. What makes the number defensible is that it
is now arithmetic rather than a projection. `fill` spends one inference call per uncached page, so the
page count of a batch *is* its size. `--max-turns` caps it before the first call. Raw proposals
are cached before gating, so re-gating at a different `--confidence`, and the write pass after a
`--dry-run`, both cost nothing. She converts calls to money against her provider's rates. The tool
will not do it for her, and a page that pretends otherwise gives her a figure she cannot defend.

Success for Iris is the end of a quarter with one section fully gated at error severity and the rest
reporting at warning. Add a burn-down that is visibly going the right way, and a standard nobody
weakened to get there.
