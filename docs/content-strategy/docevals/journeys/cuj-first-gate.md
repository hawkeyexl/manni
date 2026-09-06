---
id: cuj-first-gate
type: cuj
title: Stand up your first eval gate
backbone: true
personas: [persona-corpus-owner, persona-solo-owner]
trigger: "Docs quality is slipping and manual review is the only thing catching it"
entry_point: docs/src/content/docs/docevals/index.mdx
success_criteria: >
  A pull request in the reader's own repo goes red because a page stopped meeting a named,
  written-down assertion — and the author can see which one and why.
steps:
  - { stage: "Decide whether this fits", doc: docs/src/content/docs/docevals/index.mdx, exists: true }
  - { stage: "Install and run one eval end to end", doc: docs/src/content/docs/docevals/get-started/index.mdx, exists: true }
  - { stage: "Understand eval, grader, verdict", doc: docs/src/content/docs/docevals/get-started/how-manni docevals-works.mdx, exists: true }
  - { stage: "Declare evals in page frontmatter", doc: docs/src/content/docs/docevals/evals/index.mdx, exists: true }
  - { stage: "Write an assertion the judge can decide", doc: docs/src/content/docs/docevals/evals/write-good-assertions.mdx, exists: true }
  - { stage: "Add a deterministic check so not everything is judged", doc: docs/src/content/docs/docevals/evals/deterministic-checks.mdx, exists: true }
  - { stage: "Read the run output and its exit code", doc: docs/src/content/docs/docevals/reference/output-and-exit-codes.mdx, exists: true }
  - { stage: "Land the CI step", doc: docs/src/content/docs/docevals/ci/index.mdx, exists: true }
---

# CUJ: Stand up your first eval gate

**Scope:** the backbone journey, from zero to a working gate in the reader's own repo. It covers one page,
one assertion, one run, one CI step. Growing that into a shared library is
[`cuj-eval-library`](cuj-eval-library.md); doing it across a corpus that already exists is
[`cuj-retrofit-corpus`](cuj-retrofit-corpus.md); operating it afterwards is
[`cuj-ci-wire`](cuj-ci-wire.md).

**Trigger.** A docs team or owner has a written quality bar and no way to enforce it. Something
slipped, whether a page promised an unshipped feature or a procedure went stale, and review did not
catch it. They are looking for the docs equivalent of a failing test.

**Narrative.** This is the journey the entire site is organized around, because it is the only one
that crosses every layer. That means the frontmatter contract, the grader hierarchy, the judge, the
output format, and CI. Every other journey either specializes a step of it or picks up after it ends.

Two personas walk it at different speeds and the pages must serve both. [Priya](../personas/priya-corpus-owner.md)
walks it deliberately, once, and expects to understand the model before she commits her team to it.
[Nate](../personas/nate-solo-owner.md) wants a real finding on a real page inside ten minutes and will
abandon the journey if the first screen is conceptual. The resolution is sequencing, not compromise.
`get-started/index.mdx` gets Nate to a finding with the minimum vocabulary.
`get-started/how-manni docevals-works.mdx` sits immediately after it for the reader who needs the model
before proceeding. Putting the concepts first loses Nate; omitting them loses Priya.

The step that decides adoption is **"add a deterministic check so not everything is judged."** A
reader who leaves this journey believing manni docevals means "an LLM grades my docs" has learned the wrong
thing. They will lose the cost and explicability arguments internally. The grader hierarchy is code
first, judge second, human last, and it has to be experienced in the first run, not merely described.

**Status.** All 8 steps are served by written pages (8 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
