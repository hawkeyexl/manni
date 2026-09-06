---
id: persona-solo-owner
type: persona
name: "Nate, Engineer who owns the docs"
audience: aud-solo-docs-owner
role: Engineer, founder, or developer advocate writing the docs alongside another full-time job
proficiency: [general-engineering, npx, env-vars, globs, yaml, reading-help-output]
prerequisites: [git, markdown, running-a-cli]
goals:
  - Get real coverage of a corpus he cannot personally re-read, in an afternoon
  - Stop shipping pages that contradict the product
  - Know how many model calls a run will make before starting it
pains:
  - Hand-writing an assertion per page does not fit the hours he has
  - Pages go stale silently; the product moved and nobody noticed
  - Cost anxiety is personal; it is his card or a cap he argued for once
  - Every config key he must understand before the first useful run is a chance to quit
content_types: [quickstart, single-command-recipe, cost-and-caching-explainer, cli-reference]
journeys: [cuj-bootstrap-corpus, cuj-first-gate, cuj-cheapen-evals]
---

# Persona: Nate

**Scope:** the owner-of-everything persona for
[`aud-solo-docs-owner`](../audiences/solo-docs-owner.md). Nate is separated from
[Priya](priya-corpus-owner.md) by **hours available**, not by page count or company size. The same
person at a 3,000-person company with no docs team is still Nate.

Nate is a senior engineer at a startup who writes the docs because someone has to. Two hundred pages
of Markdown in the product repo. He has complete unilateral authority, with no review board, no
procurement, and no security questionnaire, and roughly no time. He will read `--help` before he reads a
guide, and he will judge the tool within about ten minutes.

What he needs from the docs is a first run that produces a **real finding on a real page of his**,
fast. Not a tour of the eval model, not a config walkthrough, but evidence that the tool sees something
he did not. If the quickstart spends its first screen explaining regression versus capability suites,
he is gone. That constraint is what keeps `get-started/index.mdx` short and pushes every concept it
does not strictly need into [`get-started/how-manni docevals-works.mdx`](../information-architecture/proposed-ia.md).

His second constraint is that **hand-authoring assertions is arithmetically impossible** for him. Ten
minutes per eval times two hundred pages is not a project he will start. [`fill`](../journeys/cuj-bootstrap-corpus.md)
is therefore not a convenience feature for Nate. It is the entire product. Everything around it
matters proportionally. `--dry-run` lets him look before he leaps, and `--max-turns` bounds a mistake
to a countable number of model calls. Raw proposals are cached before
gating, so re-running at a different `--confidence` is free. He needs to learn that last fact early,
because otherwise he will treat every re-run as another charge and tune the threshold exactly once.

He also needs the tool to be genuinely useful **without a provider at all**. `--deterministic-only` is
how he evaluates on a Sunday with no key set. If that path is presented as a degraded mode rather
than a real one, he never gets to the part that costs money.

Success for Nate is a Tuesday six months later. A `manni docevals run` catches that the install command
he changed in the CLI still says the old thing on three pages. He fixes it before anyone files an
issue.
