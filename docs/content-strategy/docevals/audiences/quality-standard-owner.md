---
id: aud-quality-standard-owner
type: audience
segment: Owns what "good" means, from the assertion library to the quality bar
maturity: enterprise
docs_owner: Owns the standard, not its enforcement
firmographics: [scaleup, enterprise, style-guide-owner, content-strategy-function, docs-lead]
relationship_stages: [prospect, customer]
personas: [persona-standard-owner]
features_emphasized:
  [assertion-evidence-examples, regression-vs-capability, target-pass-rate, calibrate, golden-set,
   confidence-zones, ensemble-runs, false-positive-alert, human-review, promote]
evidence_basis: [docs-as-tests-manuscript, docmeta-content-strategy, docevals-surface]
---

# Audience: Quality standard owner

**Scope:** the people who define correctness rather than enforce it, the manni docevals analog of a schema
author. They write the assertions, decide what is a regression versus a capability, set target pass
rates, and own whether the judge can be trusted. Enforcement and operation belong to
[`aud-docs-platform-team`](docs-platform-team.md) and [`aud-platform-ci`](platform-ci.md). In a small
org this is the same person wearing a third hat, and the docs should not assume otherwise.

## Who they are

A staff writer, content strategist, docs lead, or information architect who owns the style guide and
the page templates. Medium-to-high technical proficiency. They are fluent in YAML and Git, and
comfortable reasoning about precedence and inheritance. They are actively learning what an AI judge
can and cannot reliably decide.

They are the segment that read the methodology before they found the tool. They think in terms of a
quality bar that is *defensible*. They are the ones who will be asked, in a review, "why did this
fail?"

## What they're trying to do

Turn a prose quality standard into a library of assertions that a grader can adjudicate consistently.
Then prove, with numbers, that the adjudication agrees with human judgment often enough to gate a
build on.

## Defining pains

- **Writing an assertion the judge can actually decide is a skill nobody has yet.** "The page is
  well-written" is unjudgeable. "The page states the prerequisites before the first command" is
  judgeable. The gap between those two sentences is where this segment spends its effort, and it is
  the single most valuable thing the docs can teach. `evidence` and `examples.pass`/`examples.fail`
  exist to close it.
- **They cannot yet answer "is the judge right?"** Without a golden set and `calibrate`, the quality
  bar rests on trust. Trust is exactly what a skeptical engineering org will not extend to a
  model. The 70% agreement floor and the false-positive alert are the artifacts they take to that
  conversation.
- **False positives destroy adoption faster than false negatives.** A check that fails good pages gets
  disabled within a week. This segment feels that risk acutely, which is why
  `judge.false-positive-alert` matters more to them than raw accuracy.
- **Binary verdicts feel lossy until the model clicks.** "Pass or fail" on prose reads as crude. The
  insight that a *suite pass rate* carries the nuance is the reframe that makes the whole design make
  sense. Regression suites sit at ~100%, capability suites at ~70%. It has to be taught explicitly.
- **The expensive grader is the tempting one.** Left alone, everything becomes an ai eval, and cost
  and flakiness grow with the corpus. `promote` and `generate` are the discipline, and this segment
  owns applying it.

## Buying constraints

- The failure output must carry a rationale a human can review and disagree with. An opaque verdict is
  unusable in a PR conversation.
- Verdicts must be reproducible for a given page and assertion, hence temperature 0, pinned models,
  and content-addressed caching. A judge that answers differently on re-run cannot be a standard.
- Changing an assertion must not silently reuse a stale verdict, and changing a page must invalidate a
  recorded human review. Both must be visible, not implicit.
- There has to be an escape hatch for the genuinely ambiguous case. The human-review zone is that
  hatch, and its existence is what makes the binary verdict acceptable.

## Qualified reader (for docs targeting)

- **Prerequisites they bring.** Style-guide and information-architecture practice; YAML; precedence
  and inheritance reasoning. Also enough statistical literacy to read an agreement rate and a
  false-positive rate without a tutorial.
- **Prerequisites they do not bring.** Prompt engineering, model selection, or token accounting. They
  should never need to reason about a model's context window to write a good assertion.
- **Subject dependencies.** The grader hierarchy and the eval → verdict model come first, then
  assertion craft, then consensus, zones, and calibration. Calibration documented before assertion
  craft is unreadable, which fixes the order of the `judge/` section.
