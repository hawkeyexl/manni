---
id: ia-gap-analysis
type: information-architecture
scope: What the CUJ-driven IA required, what shipped, and what is still outstanding
companion: proposed-ia.md
current_source: README.md
pages_planned: 34
pages_written: 34
status: content set complete
---

# IA gap analysis

**Scope:** the distance between [the proposed IA](proposed-ia.md) and what exists today. It does not
restate the target structure, so read that file first.

**The content set is complete.** All 34 planned pages are written, and all 82 CUJ steps resolve to a
real page. `manni docevals run` over the site passes 102/102 with no API key.

This document therefore no longer enumerates a backlog. It keeps three jobs:

1. **§1** records where each README section went, so the README can be slimmed without losing
   content.
2. **§2** is the delivery record of what was built and why. That is what a later reader needs when
   deciding whether a page still earns its place.
3. **§4** is the live check: every command, config key, and grader kind maps to a page. **Re-run it
   whenever the CLI grows.** A new capability with no page is a gap the moment it ships, and this
   table is where that becomes visible. Last re-run against ADRs 01038–01043, which added
   `run --since` and `judge.concurrency`, and made a run that would check nothing a usage error.
   That re-run added the **run outcomes** table below. It also caught up the `llama-cpp`
   provider keys from ADR 01037, which the tables had missed. Before that, ADRs 01016–01020 added
   `--seed`, `--eval`, `--suite`, `--baseline`, `--no-baseline`, and `--write-baseline`, plus the
   `baseline` config key. They also removed the `max-cost-usd` keys and the `pricing` block.

The outstanding work is listed in [§5](#5-still-outstanding).

## 1. README decomposition map

The README is a features tour. Every section has a destination, so it can be slimmed to a hook, a
five-line quickstart, and links without losing content. Slimming it is **not** part of this change.
It happens when the destination pages exist.

| README section | Destination |
|---|---|
| Title, tagline, grader hierarchy | `index.mdx`, `get-started/how-manni docevals-works.mdx` |
| Install | `get-started/index.mdx` |
| Declare evals in frontmatter | `evals/index.mdx`, `reference/frontmatter.mdx` |
| Validating the frontmatter itself | `evals/deterministic-checks.mdx` (`tool:docmeta`), `reference/frontmatter.mdx` |
| Generated check scripts | `evals/deterministic-checks.mdx`, `adopt/review-generated-scripts.mdx` |
| `promote` | `adopt/promote-to-deterministic.mdx` |
| Proposing evals with `fill` | `adopt/index.mdx` |
| Commands table | `reference/cli.mdx` |
| Useful `run` flags | `reference/cli.mdx` |
| Exit codes | `reference/output-and-exit-codes.mdx`, `ci/exit-codes-and-annotations.mdx` |
| Judge providers | `judge/choose-a-provider.mdx` |
| Response caching, cost | `ci/cost-and-caching.mdx` |
| Configuration | `reference/configuration.mdx` |
| Calibration | `judge/calibrate.mdx` |
| License | Stays in the README |

**Stays in the README permanently:** the hook, badges, a five-line quickstart, install, and links into
the site. Nothing else.

## 2. Delivery record of the content the CUJs require

All 34 pages are written. Priorities below are the order they were built in and the order to restore
them in if the site is ever rebuilt. `state` records what each was before this pass.

### P0, launch (18)

| Page | State | Serves | Why it matters |
|---|:--:|---|---|
| `index.mdx` | partial | all | Nobody can self-route without it; every persona lands here first. |
| `get-started/index.mdx` | partial | `cuj-first-gate` | Nate's ten-minute window. No finding, no adoption. |
| `get-started/how-manni docevals-works.mdx` | new | `cuj-first-gate`, `cuj-orchestrate-tools` | The model every other page assumes. Priya will not commit her team without it. |
| `evals/index.mdx` | partial | `cuj-first-gate`, `cuj-eval-library` | The frontmatter contract, the tool's primary interface. |
| `evals/write-good-assertions.mdx` | new | `cuj-write-judgeable-assertions` | The page that does most for Sara. Vague assertions are the root cause of flaky evals. |
| `evals/deterministic-checks.mdx` | new | `cuj-orchestrate-tools`, `cuj-cheapen-evals` | Without it readers conclude manni docevals means "an LLM grades my docs" and lose the cost argument internally. |
| `adopt/index.mdx` | partial | `cuj-bootstrap-corpus` | `fill` is the entire product for the solo owner. |
| `ci/index.mdx` | partial | `cuj-ci-wire` | A gate that is not in CI is a linter someone runs sometimes. |
| `ci/exit-codes-and-annotations.mdx` | new | `cuj-ci-wire`, `cuj-resolve-review` | Conflating exit 1 and exit 2 makes the check look flaky and gets it removed. |
| `ci/untrusted-pull-requests.mdx` | new | `cuj-bound-cost-and-risk` | **Highest consequence on the site.** A plausible wrong answer causes a real security incident. |
| `judge/index.mdx` | partial | 3 CUJs | "Can I trust this?" blocks every segment; three journeys route through this page. |
| `fix/index.mdx` | partial | `cuj-fix-red-check` | Highest traffic. A blocked contributor who cannot self-serve is how the gate gets removed. |
| `reference/index.mdx` | new | *(navigation)* | Shelf entry point. |
| `reference/cli.mdx` | new | 2 CUJs | Eight commands and their flags exist only in `--help` today. |
| `reference/configuration.mdx` | new | 2 CUJs | Every config knob is currently undocumented outside the schema file. |
| `reference/frontmatter.mdx` | new | 3 CUJs | The published schema needs prose; resolution order is invisible until it bites. |
| `reference/graders.mdx` | new | `cuj-orchestrate-tools` | Nine grader kinds with per-kind `options`, documented nowhere. Also owes the `tool:doc-detective` contract: `options.command` is a partial override, and a timeout is reported distinctly from a failure (ADR 01005). |
| `reference/output-and-exit-codes.mdx` | new | `cuj-first-gate` | Four output formats; readers must be able to parse what they see. |

### P1, depth (11)

| Page | Serves | Why |
|---|---|---|
| `evals/named-evals-and-suites.mdx` | `cuj-eval-library` | The step from a linter to a standard. |
| `evals/test-your-commands.mdx` | `cuj-orchestrate-tools` | The self-testing convention this site itself runs on. |
| `adopt/retrofit-a-legacy-corpus.mdx` | `cuj-retrofit-corpus` | The severity inversion. Getting it wrong ends adoptions. |
| `adopt/promote-to-deterministic.mdx` | `cuj-cheapen-evals` | Without the ratchet, cost grows with the corpus forever. |
| `ci/recipes.mdx` | `cuj-ci-wire` | Devin runs four CI platforms, not one. |
| `ci/cost-and-caching.mdx` | `cuj-bound-cost-and-risk`, `cuj-bootstrap-corpus` | Unpredictable spend is what gets a check disabled. |
| `judge/calibrate.mdx` | `cuj-trust-the-judge` | The artifact Sara hands a skeptic. |
| `judge/human-review.mdx` | `cuj-resolve-review` | A queue nobody knows how to clear becomes a queue nobody clears. |
| `judge/choose-a-provider.mdx` | `cuj-trust-the-judge`, `cuj-ci-wire` | The security-review answer: self-hosted endpoint, or no API key at all. |
| `fix/faq.mdx` | `cuj-fix-red-check` | Failures that are not the contributor's to fix. |
| `reference/glossary.mdx` | *(vocabulary)* | Ten terms used across every section. |

### P2, completeness (5)

| Page | Serves | Why deferred |
|---|---|---|
| `evals/regression-vs-capability.mdx` | `cuj-write-judgeable-assertions`, `cuj-retrofit-corpus` | Covered in outline by `write-good-assertions` and `severity-and-findings` until it earns a page. |
| `evals/severity-and-findings.mdx` | `cuj-orchestrate-tools`, `cuj-retrofit-corpus` | The ratchet is teachable inside `retrofit-a-legacy-corpus` first. |
| `adopt/review-generated-scripts.mdx` | `cuj-cheapen-evals` | `promote-to-deterministic` covers the essential warning. |
| `ci/consume-results.mdx` | `cuj-ci-wire` | Only bites once a team has a dashboard to feed. |
| `reference/files-and-state.mdx` | `cuj-resolve-review` | Paths are discoverable; documenting them is a completeness fix. |

## 3. Pages that serve no CUJ

Two of the 34 are not required by any journey step. Both are kept, with a stated reason. The check
exists so that furniture is a decision rather than an accident.

| Page | Disposition | Reason |
|---|---|---|
| `reference/index.mdx` | **Keep** | Navigation, not content. Starlight needs a section entry point and readers need a shelf index. It carries no unique information and must not grow any. |
| `reference/glossary.mdx` | **Keep** | Vocabulary support. Ten terms recur across every section; a glossary is cheaper than defining them repeatedly. If it starts explaining rather than defining, it has become a concept page in the wrong section. |

Nothing is pruned, because nothing exists yet. **Re-run this section at the first content audit.**
After launch, pages accumulate that serve no journey, and that is when this table earns its keep.

## 4. Surface coverage check

Every part of the tool's public surface must map to a page. Anything unmapped is a gap, not an
omission. Verified against `src/cli.ts`, `src/core/config-schema.json`, and `src/graders/registry.ts`.

### Commands

| Command | Documented in |
|---|---|
| `run` | `get-started/index.mdx`, `ci/index.mdx`, `reference/cli.mdx` |
| `list` | `evals/named-evals-and-suites.mdx`, `reference/cli.mdx` |
| `generate` | `evals/deterministic-checks.mdx`, `reference/cli.mdx` |
| `fill` | `adopt/index.mdx`, `reference/cli.mdx` |
| `promote` | `adopt/promote-to-deterministic.mdx`, `reference/cli.mdx` |
| `calibrate` | `judge/calibrate.mdx`, `reference/cli.mdx` |
| `review` | `judge/human-review.mdx`, `reference/cli.mdx` |
| `init` | `get-started/index.mdx`, `reference/cli.mdx` |

Notable flags with a home beyond the CLI reference: `--deterministic-only` and `--ai-only`
(`evals/deterministic-checks.mdx`, `fix/index.mdx`); `--no-frontmatter-commands`
(`ci/untrusted-pull-requests.mdx`); `--no-cache` and `--max-turns` (`ci/cost-and-caching.mdx`);
`--format` (`reference/output-and-exit-codes.mdx`); `--fail-on-review`
(`ci/exit-codes-and-annotations.mdx`); `--runs` (`judge/index.mdx`); `--provider`/`--model`
(`judge/choose-a-provider.mdx`); `--dry-run` and `--confidence` (`adopt/index.mdx`); `--write`
(`adopt/promote-to-deterministic.mdx`); `--golden` and `--seed` (`judge/calibrate.mdx`); `--no-generate`
(`evals/deterministic-checks.mdx`); `--eval` and `--suite` (`fix/index.mdx`,
`evals/named-evals-and-suites.mdx`, `ci/exit-codes-and-annotations.mdx`); `--baseline`,
`--no-baseline` and `--write-baseline` (`adopt/retrofit-a-legacy-corpus.mdx`,
`reference/files-and-state.mdx`).

`--since` (ADR 01040) is documented **only** in `reference/cli.mdx`. That is a mapped surface, not an
unmapped one, but it is the thinnest kind. The flag exists to make a CI job affordable on a large
corpus, and the CUJ that wants it still shows only unscoped invocations. That CUJ is
`cuj-run-in-ci`, via `ci/index.mdx` and `ci/cost-and-caching.mdx`. Listed in
[§5](#5-still-outstanding).

### Config keys

Keys are written fully qualified so this table is greppable against
`src/core/config-schema.json` rather than merely readable.

| Key | Documented in |
|---|---|
| `version` | `reference/configuration.mdx` |
| `files.include`, `files.exclude` | `reference/configuration.mdx`, `adopt/retrofit-a-legacy-corpus.mdx` |
| `defaults.suite` | `evals/named-evals-and-suites.mdx` |
| `defaults.fail-fast`, `defaults.concurrency` | `reference/configuration.mdx` |
| `provider.default`, `provider.anthropic`, `provider.openai`, `provider.claude-cli`, `provider.llama-cpp` | `judge/choose-a-provider.mdx`, `reference/configuration.mdx` |
| `judge.ensemble-runs`, `judge.temperature`, `judge.zones` | `judge/index.mdx` |
| `judge.concurrency` | `reference/configuration.mdx` |
| `judge.false-positive-alert` | `judge/calibrate.mdx` |
| `judge.cache-dir`, `fill.cache-dir` | `ci/cost-and-caching.mdx`, `reference/files-and-state.mdx` |
| `judge.max-turns`, `fill.max-turns` | `ci/cost-and-caching.mdx` |
| `baseline` | `adopt/retrofit-a-legacy-corpus.mdx`, `reference/configuration.mdx`, `reference/files-and-state.mdx` |
| `scripts.dir`, `scripts.config-dir`, `scripts.timeout-ms` | `adopt/review-generated-scripts.mdx`, `reference/configuration.mdx` |
| `scripts.allow-frontmatter-commands` | `ci/untrusted-pull-requests.mdx` |
| `fill.confidence-threshold`, `fill.max-evals-per-page`, `fill.temperature` | `adopt/index.mdx` |
| `evals` (named evals), `suites` (incl. `target-pass-rate`) | `evals/named-evals-and-suites.mdx` |

Golden-case fields (`reviewed`, `content-hash`, `source`, `reviewed-by`) are covered by
`judge/calibrate.mdx` and `reference/files-and-state.mdx` (ADR 01016). The baseline file's own
shape is in `reference/files-and-state.mdx` (ADR 01017).

Eval fields (`assertion`, `type`, `grader`, `evidence`, `examples`, `command`, `success-exit-codes`,
`timeout-ms`, `generated`, `options`, `severity`, `severity-map`) are all covered by
`reference/frontmatter.mdx`. Of those, `assertion`/`evidence`/`examples` are taught in
`evals/write-good-assertions.mdx`, and `severity`/`severity-map` in `evals/severity-and-findings.mdx`.

### Grader kinds

| Kind | Documented in |
|---|---|
| `ai` | `judge/index.mdx`, `evals/write-good-assertions.mdx` |
| `command` | `evals/deterministic-checks.mdx` |
| `human` | `judge/human-review.mdx` |
| `tool:docmeta` | `evals/deterministic-checks.mdx`, `reference/graders.mdx` |
| `tool:markdownlint` | `evals/deterministic-checks.mdx`, `reference/graders.mdx` |
| `tool:remark` | `reference/graders.mdx` |
| `tool:vale` | `evals/deterministic-checks.mdx`, `reference/graders.mdx` |
| `tool:doc-structure-lint` | `evals/deterministic-checks.mdx`, `reference/graders.mdx` |
| `tool:doc-detective` | `evals/test-your-commands.mdx`, `reference/graders.mdx` |
| `tool:freshness` | `reference/graders.mdx` |
| `tool:reading-level` | `reference/graders.mdx` |
| `tool:differentiation` | `reference/graders.mdx` |

### Run outcomes

Added on this re-run (ADRs 01040–01043). The three tables above check *inputs*, meaning commands,
keys, and graders. An exit code is an **output**, so a new exit-2 condition could ship with no page
and nothing here would notice. It nearly did.

| Outcome | Documented in |
|---|---|
| Exit `0` / `1` / `2`, and who each routes to | `reference/output-and-exit-codes.mdx`, `fix/index.mdx`, `ci/exit-codes-and-annotations.mdx` |
| Exit 2 on an unknown `--format` | `reference/output-and-exit-codes.mdx` |
| Exit 2 on an empty input set (`discoverPages`) | `reference/cli.mdx` |
| Exit 2 when `--eval` / `--suite` match nothing | `fix/index.mdx`, `reference/cli.mdx`, `ci/exit-codes-and-annotations.mdx` |
| Exit 2 on an unresolvable `--since` ref, and on `--since` with `--write-baseline` | `reference/cli.mdx` |
| Exit 2 when **a run would check nothing** (ADR 01041) | `reference/output-and-exit-codes.mdx`, `fix/index.mdx` |
| Exit 0 with a statement, on an empty `--since` scope | `reference/cli.mdx` |
| Exit 0 with a warning, when **the run graded nothing** (ADR 01041) | `reference/output-and-exit-codes.mdx` |
| Exit 1 on a suite below target, suspended by `--eval` / `--suite` / `--since` | `reference/output-and-exit-codes.mdx`, `evals/named-evals-and-suites.mdx` |
| `--fail-on-review` widening exit 1 | `ci/exit-codes-and-annotations.mdx` |

**No unmapped surface.** Re-run this check whenever a command, config key, grader, **or run
outcome** is added. A new capability with no page is a documentation gap the moment it ships, and
these tables are where that becomes visible.

Two behavior changes from the same re-run are deliberately *not* new rows, because neither is a
surface a reader looks up:

- **`--deterministic-only` no longer warns about an unavailable provider** (ADR 01043). It removes
  noise from output no page ever quoted; `reference/cli.mdx` never documented the warning.
- **A grader error now names the eval that failed** (ADR 01042). A message-wording change inside an
  `error` result whose shape `reference/output-and-exit-codes.mdx` already documents.

## 5. Still outstanding

The content set is complete; these are not.

| Item | Why it is not done | Blocking? |
|---|---|---|
| ~~**GitHub Pages deployment**~~ | **Done** (ADR 01006). `docs.yml` runs verify → build → link check → deploy on every push to `main`; the site is live at <https://hawkeyexl.github.io/manni/docevals/>. | n/a |
| **LLM evals on the docs corpus** | The `docs-page` suite is deterministic-only. `docs-page-full` adds `no-future-promises`, `serves-one-journey`, and `readable`, and needs committed cache fixtures generated with a provider (`npm run docs:refresh-cache`). | No, but the prose quality of these pages is currently ungated. |
| **Slimming the README** | Now unblocked: §1 maps every section to a destination that exists. | No. |
| ~~**`manni docevals list --format` validation**~~ | **Done** (ADR 01007). An unknown `--format` is a usage error on every command that takes the flag. `ci.yml` asserts exit 2 and the allowed-set message through the built CLI on both runners. | n/a |
| **A `baseline` glossary entry** | The term now recurs across six pages. `reference/glossary.mdx` is alphabetical and its description reads "The ten terms", so adding one is an edit rather than a consistency fix. | No. |
| **`--since` in the CI journey pages** | Documented in `reference/cli.mdx` only (ADR 01040). `ci/index.mdx` and `ci/cost-and-caching.mdx` show unscoped runs, and neither mentions the `fetch-depth: 0` that a scoped run needs, which is the one detail a reader hits before anything else. | No, but it is the gap most likely to produce a support question. |
| **A suite that graded nothing still reports `ok`** | `summarizeSuites` computes the pass rate over the graded set, so an empty suite meets any target: `--deterministic-only` over the fixture corpus prints `tutorial: 0/0 passed — 100% vs target 70% ok`. Named and left open by ADR 01041, which fixes the run-level case. Reusing ADR 01018's `partial` flag is the obvious remedy, and is a third decision. `partial` currently means "a filter was active" and renders as such. Generalizing it changes a public JSON field's meaning, two reporters' wording, and every `--deterministic-only` run's output. | No; the run-level warning now prints beside that line and contradicts it. |
| **A recording recipe in `ci/recipes.mdx`** | `ci/exit-codes-and-annotations.mdx` says `--write-baseline` does not belong in the gating job, but no page shows the separate recording invocation. | No. |
| **`calibrate --max-turns` is run-wide only because its cases now batch** | Recorded in ADR 01016. If `calibrate` ever returns to judging case-by-case, the flag silently becomes per case again. That is why ADR 01019 withheld it in the first place. | No; a note for whoever touches that loop. |

### What will drift first

Ranked by likelihood, for whoever picks this up next:

1. **Reference pages against a changing CLI.** `reference/cli.mdx`, `configuration.mdx`, and
   `graders.mdx` restate the source. The inline Doc Detective steps catch changed *behavior*; they do
   not catch a new flag that nobody documented. §4 is the guard, so run it.
2. **Captured output samples.** `output-and-exit-codes.mdx` embeds real run output. A reporter change
   makes those stale silently, since no step asserts against the pretty-printed form.
3. ~~**Cross-links.**~~ **Now guarded.** `scripts/check-docs-links.mjs` resolves every internal
   `href` in the built site against `docs/dist` and runs in both `ci.yml` and `docs.yml`, so a
   renamed route fails the pull request and blocks the deploy. 1,354 links checked, currently zero
   broken.
