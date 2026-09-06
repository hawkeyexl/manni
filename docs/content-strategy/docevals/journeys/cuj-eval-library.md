---
id: cuj-eval-library
type: cuj
title: Build a shared eval and suite library
personas: [persona-corpus-owner, persona-standard-owner]
trigger: "The same assertion has been pasted into a dozen pages and one copy has already drifted"
entry_point: docs/src/content/docs/docevals/evals/named-evals-and-suites.mdx
success_criteria: >
  Page frontmatter names a suite and a few eval names; the assertions themselves live in
  manni.config.yaml, and changing one changes every page that uses it.
steps:
  - { stage: "Move a repeated assertion into a named eval", doc: docs/src/content/docs/docevals/evals/named-evals-and-suites.mdx, exists: true }
  - { stage: "Group evals into a suite per page type", doc: docs/src/content/docs/docevals/evals/named-evals-and-suites.mdx, exists: true }
  - { stage: "Understand what wins when a page and the config collide", doc: docs/src/content/docs/docevals/reference/frontmatter.mdx, exists: true }
  - { stage: "Decide regression versus capability per eval", doc: docs/src/content/docs/docevals/evals/regression-vs-capability.mdx, exists: true }
  - { stage: "Set a target pass rate the suite is measured against", doc: docs/src/content/docs/docevals/reference/configuration.mdx, exists: true }
  - { stage: "Confirm the resolved plan per page before running", doc: docs/src/content/docs/docevals/reference/cli.mdx, exists: true }
---

# CUJ: Build a shared eval and suite library

**Scope:** turning ad-hoc per-page assertions into a maintained library. Picks up where
[`cuj-first-gate`](cuj-first-gate.md) ends. It covers *organizing* assertions; writing good ones is
[`cuj-write-judgeable-assertions`](cuj-write-judgeable-assertions.md), and making them cheaper is
[`cuj-cheapen-evals`](cuj-cheapen-evals.md).

**Trigger.** The gate worked on one page, so it got copied. Now the same assertion exists in twelve
pages with three slightly different wordings. Nobody can answer "what do we actually check on a
how-to?"

**Narrative.** This is the journey where manni docevals stops being a linter and becomes a standard. The
mechanics are small. Named evals under `evals:` in the config, suites that group them, and a page
referencing an eval by name instead of inlining it. The shift is conceptual, in that quality rules
become a *shared, versioned artifact* rather than page decoration.

Two things reliably surprise readers here and both must be documented rather than discovered.

First, **resolution order**. A page can reference a named eval, inline its own, and name a suite that
expands to more, all at once. On a name collision the page wins. That is the right default
(local override beats global default), but it is invisible until it bites. The fix is that
`manni docevals list` shows the resolved plan per page without running anything. Teaching `list` as the
dry-run for this journey saves readers from debugging by running.

Second, **`target-pass-rate` is a suite property, not a page one**. The nuance that binary verdicts seem
to lose lives here. A regression suite targets 1.0 because those checks must all hold. A
capability suite targets something like 0.7 because it measures reach rather than correctness. Readers
who miss this treat every capability finding as a build break and conclude the tool is too strict.

This journey is shared between [Priya](../personas/priya-corpus-owner.md), who owns the library as
infrastructure, and [Sara](../personas/sara-standard-owner.md), who owns what goes in it. In a small
org they are the same person; the pages must not require a handoff between them.

**Status.** All 6 steps are served by written pages (5 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
