# Architecture Decision Records

Every **behavior change** in moose-docevals ships with an ADR here. The ADR records the intended behavior and the reasoning. Write it before or alongside the code, so it is the reviewable source of truth rather than an afterthought. The full rule lives in [CLAUDE.md](../CLAUDE.md#architecture-decision-records-required).

## Conventions

- **Format.** [MADR 4.0.0](https://adr.github.io/madr/). Start from [template.md](template.md).
- **Filename.** `NNNNN-kebab-case-title.md`, 5-digit zero-padded.
- **Numbering starts at `01000`** and increments. The range `00001`–`00999` is **reserved** to backfill pre-existing architectural decisions later. Do not use it for new ones.
- **Scope.** Decisions (behavior, contracts, trade-offs), not mechanical changes. Pure refactors, dependency bumps, typo fixes, and style changes don't need one. If a change alters observable behavior or a public contract, it does.
- **Supersede, never amend.** An ADR records what was decided *at the time it was written*, on the evidence available then. That makes the wrong ones as valuable as the right ones. They are the only account of why a decision looked correct before it wasn't. When reality moves past one, write a new ADR that says what it supersedes and why. Do not edit the old file to match what shipped. The one exception is the `status:` line, which is an index entry rather than part of the record. Mark it `superseded by ADR-NNNNN` and change nothing else, not the title, not the decision, not the reasoning, however wrong they read afterwards.

## Index

Numbering starts at `01000`. The `00001`–`00999` range holds decisions that predate the ADR rule, backfilled from [CLAUDE.md](../CLAUDE.md#design-decisions). See [the note below](#the-backfilled-range).

| ADR | Title | Status |
|---|---|---|
| [00001](00001-one-unified-concept-the-eval.md) | One unified concept, the eval, with the grader as the only axis of difference | accepted |
| [00002](00002-generated-scripts-are-files-not-inline-code.md) | Generated check scripts are files referenced as commands, never inline in frontmatter | accepted |
| [00003](00003-type-defaults-to-regression.md) | `type` defaults to `regression`, not `capability` | accepted |
| [00004](00004-level-1-orchestrates-rather-than-reimplements.md) | Deterministic checks orchestrate existing tools rather than reimplementing them | accepted |
| [01000](01000-publish-the-frontmatter-schema-from-this-repo.md) | Publish the frontmatter schema from this repo | superseded by [01009](01009-implement-the-docmeta-evals-vocabulary.md) |
| [01001](01001-fill-proposes-llm-evals-with-confidence-gating.md) | `fill` proposes llm-graded evals with a confidence gate | superseded by [01011](01011-fill-writes-a-durable-provenance-trail.md) |
| [01002](01002-take-inference-from-the-shared-library.md) | Take the inference layer from `@hawkeyexl/inference` | accepted |
| [01003](01003-cuj-first-docs-site-and-content-strategy.md) | A CUJ-first documentation site, driven by a co-located content strategy | accepted |
| [01004](01004-test-the-docs-through-moose-docevals-itself.md) | Test the docs site through moose-docevals itself, with committed cache fixtures | accepted |
| [01005](01005-fix-the-doc-detective-adapter-invocation-and-finding-granularity.md) | Fix the Doc Detective adapter's invocation, failure detection, and finding granularity | accepted |
| [01006](01006-publish-the-docs-site-to-github-pages.md) | Publish the docs site to GitHub Pages, gated on moose-docevals evaluating itself | accepted |
| [01007](01007-validate-format-centrally-as-a-usage-error.md) | Validate `--format` centrally, and reject an unknown value as a usage error | accepted |
| [01008](01008-rename-to-moose-docevals-and-share-one-family-config.md) | Rename to `moose-docevals`, and read config from a shared `moose.config.yaml` | accepted |
| [01009](01009-implement-the-docmeta-evals-vocabulary.md) | Implement `docmeta:evals` as the frontmatter vocabulary, and publish a schema for it | accepted |
| [01010](01010-kebab-case-is-the-file-vocabulary.md) | Kebab-case is the file vocabulary, frontmatter, config, and grader options alike | accepted |
| [01011](01011-fill-writes-a-durable-provenance-trail.md) | `fill` writes a durable `eval-provenance` trail | accepted |
| [01012](01012-config-discovery-walks-up-to-the-repository-root.md) | Config discovery walks up to the repository root | accepted |
| [01013](01013-track-docmeta-4x-and-name-the-schema-set.md) | Track docmeta 4.x, and make `tool:docmeta` name its own schema set | accepted |
| [01014](01014-sarif-and-junit-reporters.md) | SARIF and JUnit reporters, and a suite stamped on every result | accepted |
| [01015](01015-ship-a-composite-action-after-the-first-publish.md) | Ship a composite Action and pre-commit hook, after the first npm publish | accepted (nothing to ship yet) |
| [01016](01016-golden-cases-are-seeded-from-reviews-and-gated-on-human-confirmation.md) | Golden cases are seeded from reviews, and gated on human confirmation | accepted |
| [01017](01017-a-committed-baseline-ratchets-a-legacy-corpus.md) | A committed baseline ratchets a legacy corpus | accepted |
| [01018](01018-selecting-evals-suspends-suite-enforcement.md) | Selecting a subset of evals suspends suite enforcement | accepted |
| [01019](01019-a-turn-budget-replaces-the-cost-budget.md) | A turn budget replaces the cost budget, and cost accounting is removed | accepted |
| [01020](01020-unreadable-tool-output-is-a-finding-not-a-pass.md) | Unreadable tool output is a finding, not a pass | superseded by [01022](01022-a-grader-that-reached-no-verdict-fails-the-eval.md) |
| [01021](01021-a-config-eval-is-one-generation-target.md) | A config-defined eval is one generation target, however many pages use it | accepted |
| [01022](01022-a-grader-that-reached-no-verdict-fails-the-eval.md) | A grader that reached no verdict fails the eval, at any severity | accepted |
| [01023](01023-the-diagnostic-invariant-is-enforced-by-enumeration.md) | The diagnostic invariant is enforced by enumeration, not by inspection | accepted |
| [01024](01024-remark-lints-mdx-where-markdownlint-cannot.md) | remark lints this repo's MDX; markdownlint stays for Markdown | accepted |
| [01025](01025-an-operator-grant-replaces-the-frontmatter-commands-boolean.md) | An operator grant replaces the frontmatter-commands boolean | accepted |
| [01026](01026-split-long-content-never-truncate-it.md) | Split long content for inference; never truncate it | accepted |
| [01027](01027-calibration-requires-both-expected-classes.md) | Calibration requires both expected classes | accepted |
| [01028](01028-a-pre-run-feasibility-pass.md) | A pre-run feasibility pass | accepted |
| [01029](01029-a-regex-grader-and-a-file-exists-grader.md) | `tool:regex` and `tool:file-exists`: the deterministic rungs below the judge | accepted |
| [01030](01030-weight-changes-the-suite-rate-never-the-outcome.md) | `weight` changes a suite's rate, never an eval's outcome | accepted |
| [01031](01031-grader-options-are-validated-per-grader.md) | Grader options are validated per grader | accepted |
| [01032](01032-criteria-group-evals-in-config-not-the-vocabulary.md) | Criteria group evals in config, not in the page vocabulary | accepted |
| [01033](01033-target-selects-the-graded-bytes.md) | `target` selects the graded bytes, and it is called `target`, not `focus` | accepted |
| [01034](01034-self-preference-is-reported-not-warned-to-stderr.md) | Self-preference is reported on the result, not warned to stderr | accepted |
| [01035](01035-publish-frontmatter-1-1-0-for-the-proposal-2-vocabulary.md) | Publish `frontmatter-1.1.0.json` for the proposal.2 vocabulary | accepted |
| [01036](01036-a-self-contained-html-report.md) | A self-contained HTML report | accepted |
| [01037](01037-a-local-llama-cpp-judge-provider.md) | A local `llama-cpp` judge provider | accepted |
| [01038](01038-an-errored-ensemble-is-never-cached.md) | An ensemble containing an errored run is never cached | accepted |
| [01039](01039-judge-concurrency-is-separate-from-corpus-concurrency.md) | Judge concurrency is configured separately from corpus concurrency | accepted |
| [01040](01040-since-scopes-a-run-and-exempts-corpus-graders.md) | `--since <ref>` scopes a run to changed pages, and exempts corpus graders | accepted |
| [01041](01041-a-run-that-resolved-no-evals-is-a-usage-error.md) | A run that resolved no evals is a usage error; a run that graded none of them is a warning | accepted |
| [01042](01042-grader-isolation-is-per-eval-group-not-per-kind.md) | Grader isolation is per eval group, and the engine owns the partition | accepted |
| [01043](01043-the-missing-provider-warning-is-about-the-judge.md) | The missing-provider warning is about the judge; generation reports its own need | accepted |
| [01044](01044-the-prose-gate-blocks-and-the-fixture-corpus-is-exempt.md) | The prose gate blocks on the whole corpus, and the vendored fixtures are exempt | accepted |

## The backfilled range

`00001`–`00004` record the four decisions that predated the ADR rule. They were written from the [CLAUDE.md](../CLAUDE.md#design-decisions) bullets. Their `date:` is therefore when the *record* was written, not when the decision was taken, and each says so at the top.

They are backfills, not reconstructions of a debate nobody had. The options and consequences are the ones visible in the shipped code, which is the honest limit of what a backfill can claim. Treat them as accepted decisions with an unusually thin provenance, and supersede them the same way as any other.

The rest of `00005`–`00999` stays reserved. If another pre-rule decision surfaces, it goes here rather than at the end of the `01xxx` sequence.
