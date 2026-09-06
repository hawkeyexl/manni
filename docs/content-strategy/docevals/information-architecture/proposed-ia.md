---
id: proposed-ia
type: information-architecture
scope: Proposed IA for the manni docevals documentation site, designed CUJ-first
covers_subtree: docs/src/content/docs/docevals/
excludes: [README.md, adrs/, docs/content-strategy/]
derived_from: ../journeys/
companion: ia-gap-analysis.md
page_count: 34
pages_written: 34
status: complete
priorities: { P0: 18, P1: 11, P2: 5 }
---

# Proposed information architecture

**Scope:** the structure of the published site, meaning everything under `docs/src/content/docs/docevals/`. It does
not cover the repo README (a hook and a pointer, not a docs surface), the ADRs, or this strategy
directory. **This was a proposal; it is now the built structure.** All 34 pages are written and the seven
sections below are live. It remains the register: a page not listed here should not exist, and a
page listed here that stops resolving is a defect.

**Method: CUJ-first, not content-first.** Sections are derived from what the
[journeys](../journeys/_overview.md) require, in the order they require it, not from the topics the
README happens to cover today. That distinction is doing real work here. A content-first IA of
manni docevals would produce sections named after commands (`run`, `fill`, `promote`, `calibrate`), which
is exactly the shape that fails every persona. Nobody's job is "use the `promote` command."

## Navigation tree

```
Home: "What are you trying to do?" router + a 60-second proof
│
├─ Get started        universal on-ramp        → cuj-first-gate
│
├─ Write evals        (Priya · Sara)           → cuj-eval-library
│                                                cuj-write-judgeable-assertions
│                                                cuj-orchestrate-tools
│
├─ Adopt at scale     (Nate · Iris)            → cuj-bootstrap-corpus
│                                                cuj-retrofit-corpus
│                                                cuj-cheapen-evals
│
├─ Run it in CI       (Devin)                  → cuj-ci-wire
│                                                cuj-bound-cost-and-risk
│
├─ Trust the judge    (Sara)                   → cuj-trust-the-judge
│                                                cuj-resolve-review
│
├─ Fix a failing eval (Theo)                   → cuj-fix-red-check
│                                                 highest traffic; cross-cutting; no prerequisites
│
└─ Reference          lookup shelf                supports every journey
```

| Nav section | Directory | Sidebar label |
|---|---|---|
| On-ramp | `get-started/` | Get started |
| Authoring | `evals/` | Write evals |
| Scale adoption | `adopt/` | Adopt at scale |
| Operations | `ci/` | Run it in CI |
| Judge confidence | `judge/` | Trust the judge |
| Troubleshooting | `fix/` | Fix a failing eval |
| Lookup | `reference/` | Reference |

### Why these seven

- **`adopt/` is separate from `get-started/`** because bootstrapping a corpus is a different journey
  from standing up a first gate, not a bigger version of it. Merging them would bury `fill`, the
  feature that decides whether [Nate](../personas/nate-solo-owner.md) adopts at all, inside a
  tutorial he would have already left.
- **`judge/` is a section rather than reference material** because "can I trust this?" is an adoption
  blocker for every segment, not a detail. Demoting it to a reference page answers the question only
  for readers who already believe the answer.
- **`fix/` is top-level and shallow** because its reader arrives from a CI annotation, not from
  navigation, and never sees the rest of the tree.
- **`reference/` is a flat shelf that journeys deep-link into.** It supports navigation; it does not
  drive it. Exhaustive flag tables, config keys, and grader options live here so journey pages can
  explain a path without duplicating detail.

## Content set

★ = P0 launch. Every page names the CUJ it serves; a page that serves none needs a stated disposition
in [`ia-gap-analysis.md`](ia-gap-analysis.md) §3.

### Home

| Page | CUJ | Pri | Notes |
|---|---|:--:|---|
| `index.mdx` | all | ★ | Router. What are you trying to do? Plus a 60-second proof, with one page, one assertion, and one red run. |

### Get started, the on-ramp

| Page | CUJ | Pri | Notes |
|---|---|:--:|---|
| `get-started/index.mdx` | `cuj-first-gate` | ★ | Install, `init`, one assertion, one run, one real finding. Minimum vocabulary; Nate must reach a finding without meeting "capability suite". |
| `get-started/how-manni docevals-works.mdx` | `cuj-first-gate`, `cuj-orchestrate-tools` | ★ | The eval → grader → verdict model and the grader hierarchy. Sits *after* the quickstart deliberately: Priya needs it before committing, Nate needs to not hit it first. |

### Write evals, for Priya and Sara

| Page | CUJ | Pri | Notes |
|---|---|:--:|---|
| `evals/index.mdx` | `cuj-first-gate`, `cuj-eval-library` | ★ | The frontmatter contract. Array shorthand vs. object form, `suite`, `skip`, inline vs. referenced. |
| `evals/write-good-assertions.mdx` | `cuj-write-judgeable-assertions` | ★ | The page that does most for Sara. `assertion` + `evidence` + `examples` as one mechanism. The two-reviewer test. |
| `evals/deterministic-checks.mdx` | `cuj-orchestrate-tools`, `cuj-cheapen-evals` | ★ | `command` and `tool:*` graders; wrapping existing linters; the generate path for a plain-language command eval. |
| `evals/named-evals-and-suites.mdx` | `cuj-eval-library` | P1 | Named evals, suites, `target-pass-rate`, resolution order, `manni docevals list` as the dry-run. |
| `evals/test-your-commands.mdx` | `cuj-orchestrate-tools` | P1 | The inline Doc Detective convention. See [Authoring convention](#authoring-convention-for-pages-that-show-commands). |
| `evals/regression-vs-capability.mdx` | `cuj-write-judgeable-assertions`, `cuj-retrofit-corpus` | P2 | Why `regression` is the default; how pass-rate targets carry the nuance binary verdicts appear to lose. |
| `evals/severity-and-findings.mdx` | `cuj-orchestrate-tools`, `cuj-retrofit-corpus` | P2 | `error` fails; `warning`/`info` report and pass. `severity-map`. The severity ratchet. |

### Adopt at scale, for Nate and Iris

| Page | CUJ | Pri | Notes |
|---|---|:--:|---|
| `adopt/index.mdx` | `cuj-bootstrap-corpus` | ★ | `fill`. `--dry-run` before write, always. Say early that raw proposals are cached *before* gating, so re-gating is free. |
| `adopt/retrofit-a-legacy-corpus.mdx` | `cuj-retrofit-corpus` | P1 | The ratchet. Record today's findings in a committed baseline, gate on new ones, never weaken the assertion. State the per-rule-per-file limit plainly. Severity inversion is the fallback, not the headline. The highest-consequence page in the adopt set. |
| `adopt/promote-to-deterministic.mdx` | `cuj-cheapen-evals` | P1 | `promote` is report-only by default; `--write` is a deliberate act. |
| `adopt/review-generated-scripts.mdx` | `cuj-cheapen-evals` | P2 | Generated scripts are version-controlled source. Reviewing them is the point of writing them to files. |

### Run it in CI, for Devin

| Page | CUJ | Pri | Notes |
|---|---|:--:|---|
| `ci/index.mdx` | `cuj-ci-wire` | ★ | GitHub Actions recipe. Third-party actions pinned to a full commit SHA, which Devin will check. |
| `ci/exit-codes-and-annotations.mdx` | `cuj-ci-wire`, `cuj-resolve-review` | ★ | `0`/`1`/`2` and who each routes to. `--format github`. `--fail-on-review` as a policy fork. |
| `ci/untrusted-pull-requests.mdx` | `cuj-bound-cost-and-risk` | ★ | **Highest-consequence page on the site.** Two execution paths; the flag covers one; forks need a gated job. This repo's `verify-docs` job is the worked example. |
| `ci/recipes.mdx` | `cuj-ci-wire` | P1 | GitLab CI, Jenkins, pre-commit. |
| `ci/cost-and-caching.mdx` | `cuj-bound-cost-and-risk`, `cuj-bootstrap-corpus` | P1 | `judge.max-turns` / `fill.max-turns`, a budget in inference calls, not dollars, that *skips* remaining targets rather than aborting. Content-addressed caching, what invalidates an entry, what belongs in a CI cache key. Must not print a dollar figure, since the tool reports none (ADR 01019). |
| `ci/consume-results.mdx` | `cuj-ci-wire` | P2 | `--format json`, the TypeScript API. |

### Trust the judge, for Sara

| Page | CUJ | Pri | Notes |
|---|---|:--:|---|
| `judge/index.mdx` | `cuj-trust-the-judge`, `cuj-write-judgeable-assertions`, `cuj-resolve-review` | ★ | Reproducibility, the ensemble, consensus (`partial` counts as fail; errored runs count against consensus), confidence zones. |
| `judge/calibrate.mdx` | `cuj-trust-the-judge` | P1 | Golden set, agreement rate, the 70% floor and why the fix is the assertions, `false-positive-alert`. |
| `judge/human-review.mdx` | `cuj-resolve-review` | P1 | `manni docevals review`; persistence; self-invalidation on page change; a repeat offender is a diagnosis. |
| `judge/choose-a-provider.mdx` | `cuj-trust-the-judge`, `cuj-ci-wire` | P1 | `anthropic`, OpenAI-compatible (incl. self-hosted), `claude-cli` with no key. The security-review answer. |

### Fix a failing eval, for Theo

| Page | CUJ | Pri | Notes |
|---|---|:--:|---|
| `fix/index.mdx` | `cuj-fix-red-check` | ★ | Triage table first screen. **No subject dependencies**, so it must work cold from an annotation link. |
| `fix/faq.mdx` | `cuj-fix-red-check` | P1 | Failures that are not the contributor's to fix: needs-review, stale `assertion-hash`, exit 2. |

### Reference, the lookup shelf

| Page | CUJ | Pri | Notes |
|---|---|:--:|---|
| `reference/index.mdx` | *(navigation)* | ★ | Shelf index. Disposition in [`ia-gap-analysis.md`](ia-gap-analysis.md) §3. |
| `reference/cli.mdx` | `cuj-eval-library`, `cuj-bootstrap-corpus` | ★ | Every command and flag. |
| `reference/configuration.mdx` | `cuj-eval-library`, `cuj-bound-cost-and-risk` | ★ | Every `manni.config.yaml` key, type, and default, including provider blocks and the `max-turns` budgets. |
| `reference/frontmatter.mdx` | `cuj-eval-library`, `cuj-cheapen-evals`, `cuj-write-judgeable-assertions` | ★ | Every eval field; resolution order; `generated.assertion-hash`. |
| `reference/graders.mdx` | `cuj-orchestrate-tools` | ★ | The densest page on the site, with every kind in the registry and its `options` table. **Must state that `options.command` is a *partial* override for `tool:doc-detective`**, because `--input` and `--exit-on-fail` are appended regardless. The latter matters because the grader cannot detect a failure without it (ADR 01005). A reader who assumes their array is the whole argv will be wrong. |
| `reference/output-and-exit-codes.mdx` | `cuj-first-gate` | ★ | `human`/`json`/`markdown`/`github` shapes; exit codes. |
| `reference/files-and-state.mdx` | `cuj-resolve-review` | P2 | `.manni/docevals/` layout: caches, `reviews.yaml`, golden set, generated script paths. |
| `reference/glossary.mdx` | *(vocabulary)* | P1 | eval, grader, assertion, evidence, suite, ensemble, consensus, confidence zone, calibration, regression vs. capability. Disposition in §3. |

## Source-of-truth mapping

Reference pages must never contradict the code. Cross-read the corresponding source **before**
writing, and verify literal emitted strings against the tests. Type definitions describe the shape of
output and over-promise.

| Reference page | Source of truth |
|---|---|
| `reference/cli.mdx` | `src/cli.ts` |
| `reference/configuration.mdx` | `src/core/config-schema.json`, `src/core/config.ts` |
| `reference/frontmatter.mdx` | `schemas/frontmatter-1.0.0.json`, `src/core/resolve.ts` |
| `reference/graders.mdx` | `src/graders/registry.ts`, each grader under `src/graders/` |
| `reference/output-and-exit-codes.mdx` | `src/reporters/`, `src/cli.ts` |
| `reference/files-and-state.mdx` | `src/judge/cache.ts`, `src/fill/cache.ts`, `src/core/reviews.ts`, `src/graders/scriptgen.ts` |
| `judge/index.mdx` | `src/judge/judge.ts`, `src/judge/verdict-schema.json`, `@hawkeyexl/inference` |
| `judge/choose-a-provider.mdx` | `src/judge/provider.ts` |

To capture real sample output, build and run rather than hand-writing it:

```bash
npm run build && node dist/cli.js list test/docevals/fixtures/pages/**/*.mdx
```

## Authoring convention for pages that show commands

manni docevals is a docs-testing tool, so its own docs are tested by manni docevals, via the
`tool:doc-detective` grader. Any page presenting a command carries two things:

1. **An `evals:` frontmatter block** naming the `docs-page` suite from `docs/manni.config.yaml`.
2. **Inline Doc Detective steps** at the foot of the file, as MDX comments, running the exact commands
   the page presents against committed fixtures under `test/fixtures/`:

   ```mdx
   {/* step {"description":"Exit 1 when an eval fails.","runShell":{"command":"manni docevals run test/docevals/fixtures/pages/goTo.mdx --deterministic-only","exitCodes":[1]}} */}
   ```

Both are executed by the `verify-docs` CI job. A documented command that drifts from the code fails
the build, which is the entire premise of the product, applied to itself.

**Two constraints on those steps.** They run shell commands, so the job is gated to same-repo pull
requests; `--no-frontmatter-commands` does *not* cover this path (see
`ci/untrusted-pull-requests.mdx`). And LLM-path commands replay from committed cache fixtures in
`docs/.manni-docevals-cache/`, so bumping `PROMPT_VERSION` or `FILL_PROMPT_VERSION` invalidates them and
requires `npm run docs:refresh-cache`.

## Deferred

Recorded here so they are decisions rather than omissions:

- **GitHub Pages deployment.** The site builds and is verified in CI; publishing it is a separate
  change (manni meta's `docs.yml` is the model).
- **Migrating the dogfood corpus.** `test/docevals/fixtures/pages/` stays, because it deliberately encodes failures so
  the gate is meaningful. The docs corpus is an additional all-green gate, not a replacement.
