---
id: cuj-bootstrap-corpus
type: cuj
title: Propose evals for a whole corpus with fill
personas: [persona-solo-owner, persona-retrofitter]
trigger: "Two hundred pages, ten minutes to write a good eval, and no appetite for the arithmetic"
entry_point: docs/src/content/docs/docevals/adopt/index.mdx
success_criteria: >
  Every page in a directory carries evals nobody hand-wrote, the reader knew how much the pass would
  do before it ran, and they have reviewed what landed rather than assuming it is right.
steps:
  - { stage: "See what fill would propose, and what it spends doing so", doc: docs/src/content/docs/docevals/adopt/index.mdx, exists: true }
  - { stage: "Understand the confidence gate", doc: docs/src/content/docs/docevals/adopt/index.mdx, exists: true }
  - { stage: "Re-gate at a different threshold for free", doc: docs/src/content/docs/docevals/ci/cost-and-caching.mdx, exists: true }
  - { stage: "Cap the inference calls before writing anything", doc: docs/src/content/docs/docevals/reference/cli.mdx, exists: true }
  - { stage: "Write the proposals into frontmatter", doc: docs/src/content/docs/docevals/adopt/index.mdx, exists: true }
  - { stage: "Review what landed", doc: docs/src/content/docs/docevals/evals/write-good-assertions.mdx, exists: true }
  - { stage: "Make the good ones cheap", doc: docs/src/content/docs/docevals/adopt/promote-to-deterministic.mdx, exists: true }
---

# CUJ: Propose evals for a whole corpus with fill

**Scope:** using `fill` to bootstrap coverage without hand-authoring. It covers proposing, gating,
bounding, and reviewing. Doing this against a corpus that must not go red on day one is the harder
variant, [`cuj-retrofit-corpus`](cuj-retrofit-corpus.md); making the results deterministic afterwards
is [`cuj-cheapen-evals`](cuj-cheapen-evals.md).

**Trigger.** The reader is convinced the eval model is right and has done the multiplication. Ten
minutes per assertion across two hundred pages is not a project anyone starts voluntarily.

**Narrative.** For [Nate](../personas/nate-solo-owner.md) this journey *is* the product. Without it he
has a tool whose value he accepts and whose entry cost he cannot pay, and he does not adopt. For
[Iris](../personas/iris-retrofitter.md) it is the first half of a longer, more careful path.

The sequence is deliberately `--dry-run` before write, and the docs must not reorder it for
convenience. Two reasons, and only one is obvious. The reader gets to see the proposals before they
touch the repo. The non-obvious one is that **the dry run is where the inference calls are actually
spent**. The write pass that follows it is a cache hit and spends none. Looking first is therefore
free in the only unit the tool counts. The size of the whole pass is also knowable before any of it
runs, because `fill` spends exactly one inference call per uncached page. `--max-turns` is how the
reader caps that number before the first call rather than discovering it after. For a reader paying
out of pocket, that ordering and that arithmetic are the difference between trying it and not.

The single most under-communicated fact in this journey is that **raw proposals are cached before the
confidence gate is applied.** Re-running at a different `--confidence` therefore costs nothing. A
reader who does not know this treats the threshold as a one-shot irreversible decision, agonizes over
it, picks wrong, and pays twice. It belongs in the first screen, not in a caching reference.

The journey's honest ending is a review step, not a green run. `fill` proposes; it does not decide.
Proposals are ai-graded with explicit `examples` by construction, existing evals are never modified,
and name collisions against the page's resolved plan are dropped. All of that makes it safe to run,
and none of it makes its output automatically good. A page implying the corpus is now covered sets
the reader up to be wrong later.

**Status.** All 7 steps are served by written pages (5 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
