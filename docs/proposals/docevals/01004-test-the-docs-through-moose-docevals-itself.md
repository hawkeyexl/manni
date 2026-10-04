---
status: "accepted"
date: 2026-08-03
decision-makers: [hawkeyexl]
---

# Test the docs site through moose-docevals itself, with committed cache fixtures

## Context and Problem Statement

moose-docevals is a documentation-testing tool. Shipping a documentation site whose commands are not tested
would be an unforced credibility failure. `docmeta` solves the equivalent problem with inline Doc
Detective steps in each `.mdx` plus a dedicated `doc-detective.yml` workflow.

moose-docevals has an option docmeta does not: it already ships a **`tool:doc-detective` grader**. So the
question is whether to port docmeta's standalone workflow or compose the doc tests into
`moose-docevals run`. A second problem follows either way. **Most moose-docevals commands need an LLM.** The
pages documenting `fill`, `promote`, `calibrate`, and judged `run` cannot be tested the way `list`
and `run --deterministic-only` can.

## Decision Drivers

- Dogfooding is the strongest possible demonstration of the product.
- CI must be green with **no `ANTHROPIC_API_KEY`**. The repo has no provider secret, and forks
  cannot have one.
- Inline test steps execute shell commands, so fork pull requests are a real attack surface.
- The existing `test/fixtures/pages/` gate deliberately encodes *failures*; it cannot be replaced by
  an all-green corpus.
- Doc tests must not become a maintenance sink that gets disabled.

## Considered Options

**For running the doc tests**

1. **Composed.** Pages carry `evals:` frontmatter; `moose-docevals run` drives the doc tests via
   `tool:doc-detective`, one job.
2. **Standalone.** Port docmeta's `doc-detective.yml` verbatim, independent of moose-docevals.
3. **Both layers.** Standalone for command accuracy, `moose-docevals run` for prose quality.

**For the LLM-dependent pages**

A. **Deterministic subset only.** Never test the LLM paths.
B. **Committed cache fixtures.** Commit `.moose-docevals-cache` entries so judged runs replay with no key.
C. **Live calls, gated.** Run them for real behind a `MOOSE_DOCEVALS_LIVE=1`-style gate.

## Decision Outcome

**Option 1 (composed)** wins, together with **option B (committed cache fixtures)**.

- `.doc-detective.json` at the repo root; `docs/moose.config.yaml` as a second config, separate
  from the fixture-corpus config at the root.
- A `verify-docs` job runs `npm run docs:verify`, then builds the Astro site.
- `judge.cacheDir: docs/.moose-docevals-cache` and `fill.cacheDir: docs/.moose-docevals-cache/fill`,
  and **not** the default `.moose-docevals/cache`, which the root `.gitignore` excludes. This keeps the fixture cache
  disposable and the docs cache version-controlled with no `.gitignore` surgery.
- `npm run docs:refresh-cache` clears and regenerates; `docs/.moose-docevals-cache/README.md` documents it.
- `doc-detective` is pinned as a devDependency so `npx --no-install` resolves a known version rather
  than whatever is global.

**Two things this decision deliberately accepts.**

**A recurring breakage.** Cache keys include `PROMPT_VERSION` and `FILL_PROMPT_VERSION`. Bumping
either is already required whenever prompts change. It invalidates every fixture and turns
`verify-docs` red until they are regenerated. This is a **feature**. A prompt change can change a
verdict, and the docs present those verdicts as documented behavior. The red build forces someone to
re-read the affected pages instead of letting a stale example survive. It is written into the `PROMPT_VERSION`
invariants in `CLAUDE.md` so it is never mistaken for a bug.

**A security gate that a config flag does not provide.** `scripts.allowFrontmatterCommands` and
`--no-frontmatter-commands` gate commands declared in page *frontmatter*. The `tool:doc-detective`
grader executes steps embedded in page *bodies*, which those do **not** cover. The only complete
control is restricting the job to same-repo pull requests, which `verify-docs` does. The
`CLAUDE.md` invariant was widened to name both paths. A reader who sets the flag and believes
they are safe against a hostile fork is wrong in the most dangerous possible way.

### Consequences

- Good, because one job and one config surface make the docs site a genuine second dogfood corpus.
- Good, because a documented command that drifts from the code fails the build. **This only became
  true with ADR 01005.** As first written, the `tool:doc-detective` grader could not detect a failure
  at all, so the gate ran and verified nothing. Treat "the gate is wired" and "the gate fails when it
  should" as separate claims needing separate evidence.
- Good, because `verify-docs` is green today with no API key. Verified locally, 24/24 evals passing
  at exit 0 with `ANTHROPIC_API_KEY` unset.
- Bad, because the cache-regeneration duty is real recurring work, and a contributor who bumps a
  prompt without a provider configured cannot discharge it locally.
- Bad, because a failure in moose-docevals' own judging could in principle mask a doc-test failure.
  That is the cost of composing rather than keeping the layers independent. Accepted because
  `commands-work` is an `error`-severity eval whose failure is reported per page, not swallowed.
- Neutral. **No cache fixtures exist yet.** The site is currently section-index stubs and the
  `docs-page` suite is deterministic-only; judging placeholder prose would produce fixtures asserting
  nothing. The LLM evals are defined and collected in a `docs-page-full` suite, to be switched on with
  the first real page. The mechanism is built and documented; the fixture set is empty by design.

### Confirmation

- The `verify-docs` job in `.github/workflows/ci.yml` runs on every pull request and push to `main`.
- Its `if:` condition is the fork gate; the step comment marks it as a security control that must not
  be removed.
- Running `npm run docs:verify` with no `ANTHROPIC_API_KEY` must exit 0. Once LLM evals join the
  suite, a cache miss surfaces as a provider error. A green run with no key is then proof the
  fixtures are real, not proof that nothing was checked.
- `test/fixtures/pages/` and its `ci.yml` assertions are unchanged.

## Pros and Cons of the Options

### Option 1, Composed through `moose-docevals run`

- Good, because it is the strongest dogfood: the tool gates its own docs using its own grader.
- Good, because one job and one config surface, and prose evals and command tests report together.
- Bad, because the layers are coupled, so a moose-docevals regression could mask a doc-test regression.

### Option 2, Standalone, mirroring docmeta

- Good, because independence: a broken judge can never hide a broken doc test.
- Good, because it is a proven, copyable configuration.
- Bad, because it ignores a capability moose-docevals already ships. It leaves the obvious question
  ("why doesn't moose-docevals test its own docs?") unanswered on the highest-visibility surface.
- Bad, because two workflows and two config surfaces to keep in step.

### Option 3, Both layers

- Good, because the most complete coverage and the clearest separation of concerns.
- Bad, because it is the most CI surface to maintain for a site that currently has eight stub pages.
  Revisit once the P0 content set exists.

### Option A, Deterministic subset only

- Good, because zero flake, zero cost, and no maintenance duty.
- Bad, because the pages most likely to be wrong are exactly the ones left untested. Those are
  `fill`, `promote`, `calibrate`, and judged `run`.

### Option B, Committed cache fixtures

- Good, because the LLM-path docs are genuinely tested, offline, for free, on every run.
- Bad, because prompt bumps invalidate the fixtures and require regeneration.

### Option C, Live calls, gated

- Good, because truest coverage, and it mirrors the existing `test/integration/live.test.ts` pattern.
- Bad, because it costs money per run, needs a secret the repo does not have, and can flake on model
  nondeterminism. Flake would teach the team to ignore a red docs check.
