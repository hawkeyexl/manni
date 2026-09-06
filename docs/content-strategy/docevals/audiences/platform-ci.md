---
id: aud-platform-ci
type: audience
segment: Platform / DevEx engineers owning pipelines across many repos
maturity: cross-cutting
docs_owner: Nobody in this segment; they own the pipeline, not the content
firmographics: [scaleup, enterprise, multi-repo, github-actions, gitlab-ci, jenkins, pre-commit]
relationship_stages: [prospect, customer]
personas: [persona-pipeline-owner]
features_emphasized:
  [exit-codes, format-github, format-json, max-turns, response-cache, no-frontmatter-commands,
   deterministic-only, provider-secrets]
evidence_basis: [docmeta-content-strategy, docevals-surface]
---

# Audience: Platform / CI engineers

**Scope:** the people who install and operate the gate without authoring a single eval. They own exit
codes, secrets, runtime, spend, and blast radius. Content quality is not their problem; the *behavior
of the check* is entirely their problem. Authoring lives with
[`aud-docs-platform-team`](docs-platform-team.md) and
[`aud-quality-standard-owner`](quality-standard-owner.md).

## Who they are

Platform, DevEx, or release engineering, maintaining CI for anywhere from a dozen to a few hundred
repos. The mix is GitHub Actions, GitLab CI, Jenkins, and pre-commit. They script everything and
distrust per-repo snowflakes. They have a strong prior that any check which is slow, flaky, or
expensive will be disabled by the first team it inconveniences.

They arrive because a docs team asked them to add a step, or because a docs check started costing
money and landed on their desk.

## What they're trying to do

Add a gate that behaves identically everywhere and fails for exactly one reason. It cannot exceed the
work budget it was given, and it cannot execute untrusted code on a runner.

## Defining pains

This segment carries the two concerns that have no analog in an ordinary docs linter. That is why it
is a first-class audience rather than a note on the lead persona's page.

- **An LLM sits in the critical path.** A model call can be slow, can be rate-limited, can return a
  different answer than yesterday, and costs money per invocation. Every one of those is a novel
  failure mode for a CI step. This segment needs the ensemble, the cache, `--max-turns`, and
  `--deterministic-only` presented as *operational controls*, not as quality features. `--max-turns`
  carries a second-order hazard of its own. Exhausting it *skips* the remaining evals rather than
  failing the job, so a budget set too tight produces a green run with silently reduced coverage.
- **Content files drive arbitrary code execution.** Two distinct paths, and conflating them is a real
  hazard. `scripts.allow-frontmatter-commands` / `--no-frontmatter-commands` gates commands declared in
  page frontmatter, and the `tool:doc-detective` grader executes steps embedded in page bodies. The
  flag governs the first and **not** the second. On a fork pull request, an attacker controls both.
  The only complete answer is a fork gate on the job itself. The docs must say so plainly rather
  than implying the flag is sufficient.
- **Non-zero exit codes must be unambiguous.** `1` for findings and `2` for operational errors have to
  be distinguishable, because they route differently. One blocks the author; the other pages the
  platform team.
- **Per-repo config sprawl.** They want one recipe, parameterized, not a bespoke step per docs repo.
- **Secrets.** A provider API key in CI needs a scope, a rotation story, and an answer for forks.
  Secrets are unavailable there by design, which makes `--deterministic-only` the fork path.

## Buying constraints

- Machine-readable output (`--format json`) and native annotations (`--format github`) so results flow
  into existing dashboards and PR bots without fragile parsing.
- Cache state must survive between runs, or the cost model does not hold. Cache directory location and
  what belongs in a CI cache key must be documented.
- Bounded runtime. Unbounded model calls across a large corpus is an unacceptable job duration.
- No new hosted dependency; the tool must run entirely inside the existing runner.

## Qualified reader (for docs targeting)

- **Prerequisites they bring.** Deep CI fluency across several platforms; secret management; caching;
  supply-chain instincts (they will notice an unpinned third-party action); shell and JSON tooling.
- **Prerequisites they do not bring.** The docs quality vocabulary. They do not know or care what a
  capability suite is, and pages aimed at them should not require it.
- **Subject dependencies.** Exit-code semantics and the deterministic/LLM split must be understood
  before cost, caching, or fork-safety pages will land. That is why
  `ci/exit-codes-and-annotations.mdx` is P0 and `ci/cost-and-caching.mdx` follows it.
