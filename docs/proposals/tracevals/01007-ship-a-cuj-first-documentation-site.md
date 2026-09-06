---
status: "accepted"
date: 2026-08-03
decision-makers: [hawkeyexl]
---

# Ship a CUJ-first documentation site, with a committed content strategy and mechanical drift gates

## Context and Problem Statement

moose-tracevals had no documentation set. The entire user-facing corpus was a 202-line `README.md`
that documented the CLI as `node dist/cli.js`. That form only works inside a clone of this
repository, leaving no install path at all for anyone consuming the published package. Substantial
shipped surface was documented nowhere. That covered `--history` and the history file format,
`--output`, the markdown reporter, the `RunReport` structure, and `MOOSE_TRACEVALS_HOME`. It also
covered the `type: capability | regression` field added in artifact-evals 0.2, `registerGrader()`,
the programmatic API, and every config key with no CLI flag.

Two questions had to be answered together. **What structure should a documentation set for this
product have?** And **what stops it from drifting away from the code** the way a README does?

## Decision Drivers

- The product's audiences are genuinely distinct, and need different content in a different order.
  They are someone authoring a `SKILL.md`, someone plumbing a CI gate, someone deciding whether an
  LLM verdict is evidence, and someone staring at one red line.
- Documentation of a CLI rots silently. A flag rename, a changed default, or a reworded failure
  message leaves prose that is confidently wrong.
- There is **no user research** for moose-tracevals. Any audience model here is a hypothesis, and the
  documentation has to say so rather than present invented segments as findings.
- The sibling [docmeta](https://github.com/hawkeyexl/docmeta) repo already solved this shape and
  the result is in production. Divergence should be earned, not accidental.
- The published package must stay `dist` + `schemas`. Docs tooling cannot leak into it.
- The offline-and-hermetic testing rule applies to any new gate: no gate may reach the network.

## Considered Options

- **Structure:** CUJ-first (nav groups are jobs) vs. Diátaxis (nav groups are document genres) vs.
  expanding the README in place.
- **Strategy artifacts**, committed and agent-readable, against strategy held informally.
- **Drift enforcement:** dogfooded frontmatter validation, Doc Detective inline tests, a CLI
  introspection check, or nothing.

## Decision Outcome

The chosen option is **a CUJ-first Astro + Starlight site in a nested `docs/` project, driven by a
committed content strategy under `docs/content_strategy/`.** It is **gated by dogfooded frontmatter
validation and Doc Detective inline tests.**

**CUJ-first over Diátaxis.** Nav groups map to jobs, and every page is justified by the journey it
serves. Those jobs are *Get started*, *Declare what to check*, *Run it in CI*, *Trust the judge*,
and *Read a failing eval*. Diátaxis sorts content by the writer's genre rather than the reader's
task. It remains a useful lens on a single page, and a poor top-level structure. Reference is a flat
lookup shelf that journeys deep-link into. It supports navigation, it does not drive it.

**The strategy is a committed artifact, not a document.** `docs/content_strategy/` carries five
audiences (`aud-*`), five personas (`persona-*`), ten journeys (`cuj-*`), and the IA. They are
cross-linked by stable IDs with two invariants. There are no dangling references, and no persona without a journey or journey
without a persona. `CLAUDE.md` points at it so writing tasks are anchored rather than improvised.

**The evidence limitation is recorded in the artifact itself.** The audiences are derived from the
product surface, the ADR record, and docmeta's validated split, rather than from users. The strategy
README says so, and names re-grounding as the first maintenance action. The alternative, presenting
derived segments as research, would make the strategy unfalsifiable.

**Two gates, not three.** Frontmatter validation dogfoods `docmeta`, already a runtime dependency.
The library that reads `metadata.evals` from a `SKILL.md` therefore also validates this site's pages,
and blocks the Pages deploy on a missing `title` or `description`. Doc Detective runs the exact
commands the docs present against the freshly built CLI over `test/fixtures/`. A CLI-introspection
check (docmeta's `check-cli-reference.mjs`) was **considered and deferred**. Doc Detective already
asserts the documented flags through `--help`, so the marginal coverage did not justify a second
mechanism.

### Consequences

- Good, because the six largest undocumented surfaces get their first documentation. The README
  becomes a hook plus a link table rather than the product's documentation.
- Good, because a drifted example fails CI instead of misleading a reader. Sample output is
  *captured* from the CLI, never composed.
- Good, because docs dependencies live in a nested `private` project, so `files` stays `dist` +
  `schemas`.
- Good, because the docs tests are as hermetic as the unit suite. Every tested command runs
  `--deterministic-only` or `--provider mock` with `MOOSE_TRACEVALS_HOME` pinned to the fixture home.
- Bad, because two npm projects means two lockfiles and two installs.
- Bad, because adding a nav group requires an `astro.config.mjs` edit, since `autogenerate` throws
  on an empty directory. The `extend/` group is therefore absent until its first page lands.
- Bad, because the gaps are now enumerated in public. `ia-gap-analysis.md` lists ten unwritten pages
  of a twenty-four page content set, which is the intent rather than a defect.

### Confirmation

- `.github/workflows/docs.yml` runs `npm run docs:validate` (dogfooded `docmeta`), which gates the
  build, which gates the Pages deploy. A page missing `title` or `description` does not ship.
- `.github/workflows/doc-detective.yml` runs every documented command against the local build.
  Two guards make it trustworthy. It verifies `npx moose-tracevals --version` matches this package
  before running anything (see below). It also asserts `test/fixtures/project` is byte-identical
  afterwards, since the docs exercise `fill --dry-run` against the real corpus.
- `scripts/check-content-strategy.mjs`, run by the same workflow via `npm run docs:check-strategy`,
  enforces the invariants the strategy declares about itself. There is no dangling
  `aud-*`/`persona-*`/`cuj-*` reference, and no persona without a journey or journey without a
  persona. Every `exists: true` route resolves to a real page, and every internal site link points
  somewhere. Without it the ID-anchor model is decoration.

## Pros and Cons of the Options

### CUJ-first structure

- Good, because each nav group has one owner persona and one set of outcomes, so "does this page
  belong?" has an answer.
- Good, because it makes gaps visible: a journey step with no page is a `[GAP]` row rather than an
  absence nobody notices.
- Bad, because a page serving two personas needs a judgement call about where it lives.

### Diátaxis as the top-level structure

- Good, because it is widely understood and needs no local explanation.
- Bad, because it splits a single journey across four sections, and the reader has to reassemble it.
  Install lands in Tutorial, CI in How-to, consensus in Explanation, and flags in Reference.
- Bad, because it invites writing a genre to completeness rather than a journey to usefulness.

### Expanding the README

- Good, because it is one file with no build.
- Bad, because it cannot serve five audiences without becoming unreadable for all of them. The
  README was already the largest thing nobody read to the end.

### A CLI introspection check (deferred)

- Good, because it mechanically compares the reference page against the real commander program.
- Neutral, because Doc Detective already asserts documented commands and flags through `--help`.
- Bad, because it is a second bespoke script to maintain for overlapping coverage. Revisit if the
  CLI reference drifts in practice.

## Note: `npx agentevals` is not a safe cold command

Discovered while writing the docs and worth recording, because
[CLAUDE.md](../CLAUDE.md#release-channels) previously implied otherwise. The `bin` name is
independent of the package name, but **`npx` resolves by package name**. The unscoped `agentevals`
on npm belongs to an unrelated project, so `npx agentevals` with nothing installed fetches that
package, not this one. It resolves correctly only once `@hawkeyexl/agentevals` is a local
dependency, since npm prefers `node_modules/.bin`.

The documentation therefore shows `npm install --save-dev @hawkeyexl/agentevals` before any
`npx agentevals`, and `npx @hawkeyexl/agentevals` for the zero-install path. The Doc Detective
workflow asserts the linked binary's version matches this package before running any test. A
broken `npm link` therefore fails loudly instead of silently testing somebody else's CLI.

> **Resolved by [ADR 01008](01008-rename-the-project-to-moose-tracevals.md).** This hazard is what drove
> the rename: `moose-tracevals` was available unscoped, so package name and `bin` name are now the same
> string and `npx moose-tracevals` is safe cold. The install caveats this note produced have been removed
> from the docs; the Doc Detective version assertion is kept.
