---
status: "accepted"
date: 2026-08-10
decision-makers: [hawkeyexl]
consulted: []
informed: []
---

# Rename the project to `moose-tracevals` and publish it unscoped

## Context and Problem Statement

The project shipped as `@hawkeyexl/agentevals` with a `bin` of `agentevals`. The scope was not a choice. The unscoped `agentevals` on npm belongs to an unrelated project (LangChain's), so the name the CLI answers to was owned by someone else. That split is a standing footgun, because `npx` resolves by *package* name. `npx agentevals` on a machine with nothing installed fetches LangChain's package and runs it. Every install path in the docs had to carry a caution box explaining the hazard, and CI needed a version assertion to prove `npm link` had taken.

The name was also imprecise. This tool does not evaluate agents; it evaluates *traces*. It reads a session that already happened, and asks whether that session adhered to the skills, agent definitions, and project rules it used. "agentevals" describes agent benchmarking, which is what the package that owns the name actually does. `trace` is already the noun at the center of the architecture: the `Trace` model, the `TraceSource` adapter seam (ADR 01003), and the `TraceGrader` registry (ADR 01004).

### The `moose-` prefix

The shipped name is `moose-tracevals`, not `tracevals`. `tracevals` was verified free on npm and
GitHub, and would have satisfied every driver above. The prefix is a naming choice made by the
maintainer rather than a constraint discovered in the registry. It is recorded here as the
distribution name so the rest of this ADR reads against what actually shipped.

**This section is a placeholder for the reason.** No rationale for the prefix is recorded because
none was stated, and inventing one would make this ADR misleading to the next reader. Whoever owns
the decision should replace this paragraph with the actual motivation.

## Decision Drivers

- The CLI should own the name it is invoked by, so `npx <name>` is never someone else's code.
- The name should describe the input the tool actually takes, and stay true as trace adapters beyond Claude Code arrive (ADR 01003).
- Nothing was ever published: `@hawkeyexl/agentevals` has no versions on npm and therefore no consumers. The rename is free now and expensive after the first release.
- Sibling naming should stay legible: `docmeta`, `docevals`, `tracevals`. The shipped name departs
  from this pattern deliberately; see the prefix note below.

## Considered Options

- Rename to `moose-tracevals`, published unscoped
- Rename to `@hawkeyexl/moose-tracevals`, keeping the scope
- Keep `@hawkeyexl/agentevals`

## Decision Outcome

The chosen option is to **rename to `moose-tracevals`, published unscoped**. It is the only option that makes the package name, the `bin` name, and the invoked command the same string. `moose-tracevals` and `@hawkeyexl/moose-tracevals` were both unregistered at the time of the decision; taking the unscoped name removes the split rather than relocating it.

The rename is total, not cosmetic. It covers the package name and `bin`, the `MOOSE_TRACEVALS_HOME` and `MOOSE_TRACEVALS_LIVE` environment variables, the `moose-tracevals.config.yaml` config filename, and the `.moose-tracevals/` runtime directory (cache and `history.jsonl`). It also covers the `TracevalsError` and `TracevalsConfig` exported types, the default `moose-tracevals-report.{json,md}` output names, and the internal schema `$id`s (`moose-tracevals:config:0.1`, `moose-tracevals:verdict:0.1`). Last, it covers the published `artifact-evals-*.json` `$id` URLs, the GitHub repository, and the documentation site's base path.

**No compatibility shim ships.** The old environment variables, config filename, and state directory are not read as fallbacks. With zero published versions there is no installed base to be compatible with. A silent fallback would be a permanent maintenance surface bought for no one.

### Consequences

- Good, because `npx moose-tracevals` resolves to this CLI cold, with or without a local install. The hazard the docs kept warning about is gone rather than documented.
- Good, because the name describes the input (a trace) instead of overclaiming the subject (an agent), and survives the addition of non-Claude trace adapters.
- Good, because it removed three caution asides from the docs and simplified the install instructions to a single path.
- Bad, because "agent evals" is the phrase people search for and "trace" is a term this tool teaches rather than one users arrive with. Mitigated by keeping `agents`, `claude-code`, and `evals` in the package `keywords` and naming agent sessions in the package description, rather than by the name itself.
- Bad, because `trace` collides with distributed tracing (OpenTelemetry spans, latency), so the name can suggest performance analysis. Judged a milder collision than shipping under a name owned by a live, adjacent package.
- Bad, because the docs site moves from `/agentevals` to `/moose-tracevals` and the published schema `$id` URLs change host path. GitHub redirects the renamed repository, so existing `$id` URLs continue to resolve; the `$id`s were never referenced by a published package.
- Bad, because the prefix breaks the `docmeta` / `docevals` sibling pattern and lengthens every
  invocation, weighing `npx moose-tracevals run <trace>` against `npx tracevals run <trace>`,
  without adding meaning that `trace` and `evals` do not already carry.
- Neutral, because the prefix does not reintroduce the hazard this ADR exists to remove. Package
  name and `bin` name remain the same string, and `moose-tracevals` was unregistered on npm.
- Neutral, because the repository rename, the npm trusted-publishing configuration, and the GitHub Pages source are one-time manual steps outside this change.

### Confirmation

`grep -ri agentevals` over the tree (excluding `node_modules/`, `.git/`, and `dist/`) returns only deliberate references to the old name. Those are this ADR, ADRs [01006](01006-take-inference-from-the-shared-library-not-docevals.md) and [01007](01007-ship-a-cuj-first-documentation-site.md), which record the pre-rename state and carry superseded-by notes. They also include the `CLAUDE.md` paragraph explaining the change, and the `release.yml` header comment. Any other hit is a missed rename.

**A rename sweep must be checked multiline.** The mechanical pass turned sentences *about* the old name into false claims (`` `moose-tracevals` … belongs to an unrelated project ``). The first review of this change missed two of them, because the grep was line-anchored while the sentences wrapped across a line break. Search for the *claims*, not just the token: `rg -U 'moose-tracevals`?\s*\n?\s*(on npm )?belongs to'`. Watch article agreement too. "An agentevals" became an incorrect "an tracevals" in the first pass
of this rename, and the same trap applies to any vowel-initial name.

The unit and integration suites assert the new environment variable and state-directory names, and [ci.yml](../.github/workflows/ci.yml) dogfoods the renamed binary against `test/fixtures/`. [doc-detective.yml](../.github/workflows/doc-detective.yml) still asserts that `npx moose-tracevals --version` matches this package's version before running the documented commands.

## Pros and Cons of the Options

### Rename to `moose-tracevals`, published unscoped

- Good, because package name, `bin` name, and invoked command are one string, so `npx` cannot resolve elsewhere.
- Good, because it matches the unscoped sibling `docmeta`.
- Neutral, because an unscoped name is squattable until first publish; the window is the time to trusted-publishing setup.
- Bad, because it forfeits the `@hawkeyexl/*` grouping that `@hawkeyexl/inference` uses.

### Rename to `@hawkeyexl/moose-tracevals`, keeping the scope

- Good, because it groups with `@hawkeyexl/inference` and the scope guarantees the name cannot be taken.
- Bad, because it reproduces the exact problem being solved. `npx moose-tracevals` would still resolve to whoever registers the unscoped name, and every install path would still need the caution box.

### Keep `@hawkeyexl/agentevals`

- Good, because it costs nothing and the docs already describe the hazard accurately.
- Bad, because the hazard is permanent, gets worse with adoption, and cannot be fixed later. The unscoped name is not obtainable.
- Bad, because the name keeps describing agent benchmarking rather than trace adherence.
