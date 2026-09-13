# manni docevals

Guidance for agents working on the evals tool, `manni docevals`. It runs
deterministic and LLM-as-judge evals against documentation pages. The root
`CLAUDE.md` owns everything repo-wide. That covers the worktree and npm rules,
red/green TDD, fixtures per feature, and Conventional Commits with what they
release. It also covers the demo video rule, the supersede-never-amend rule
for proposals, and the lint and output conventions. This file adds only what
is specific to this tool.

Imported from [hawkeyexl/moose-docevals](https://github.com/hawkeyexl/moose-docevals)
at 670e62b. Its sources live under `src/docevals/`, its tests under
`test/docevals/{unit,integration,fixtures,helpers}`, its imported ADR log
(closed at 01045) under `docs/proposals/docevals/`, and its site under
`docs/src/content/docs/docevals/`. Its content strategy is the family's, in
`docs/content-strategy/`. It ships no schema file: pages validate against the
evals draft in `docs/proposals/0023/schemas/`, bundled into the build. The metadata tool is a sibling in this
repository, imported by relative path (`../meta/index.js`), not a dependency.

## Fixtures (required)

Unit tests are necessary but not sufficient. A **user-facing feature** is a
grader kind, an eval field, a CLI flag, a provider, or an output format. When
you add or change one, also exercise it end-to-end through the real CLI against
`test/docevals/fixtures/pages/`. Cover **every meaningfully distinct shape** it
can take, not just the happy path:

- Each form a field's value can take, including the disabling / no-op form.
- Each enumerated option (every grader kind, provider, report format).
- Each precedence level (config default vs. suite vs. page override).
- The guard paths (skip flags, missing provider, ungranted execution, stale
  assertion hash).

`test/docevals/fixtures/pages/` is a snapshot of doc-detective's docs annotated
with docevals frontmatter. It is deliberately **not** all-passing, because it
encodes both outcomes so the gate is meaningful:

- `goTo.mdx` fails freshness at error severity (drives the expected non-zero exit).
- `concepts.md` is stale at *warning* severity, so it reports a finding but still passes.
- `installation.mdx` has a command eval with no command, which is the script-generation target.
- `find.mdx` has a pre-generated script in `test/docevals/fixtures/pages/docs/actions/manni-docevals/`.
- `index.mdx` is skipped at the page level.

The repository's own `manni.config.yaml` carries the `docevals:` section that
runs this corpus. The inline Doc Detective steps on the docs pages assert
specific outcomes against it. A fixture change that flips one of those must
update the page in the same commit.

The docs section (`docs/src/content/docs/docevals/**`) is a **second** corpus,
required to be all-green. `npm run docs:check-docevals` runs the tool over it
through `docs/manni.docevals.yaml`, reached by `-c` only. That file says what
it checks and what it leaves to the docs-as-tests workflow.

The suite must stay **offline and hermetic**. Judge providers are mocked
(`MockProvider`), process execution is injected (`ExecFn`), and grader
adapters are tested against captured tool output in
`test/docevals/fixtures/tool-output/`. A test that reaches the network or
shells out to a real binary is a defect. The one exception is
`test/docevals/integration/live.test.ts`, gated behind `MANNI_DOCEVALS_LIVE=1`
and skipped by default.

## Content & documentation work (required)

Before drafting or editing any page under `docs/src/content/docs/docevals/**`,
consult the family's content strategy. **Read on demand; do not inline it
here.**

- `docs/content-strategy/personas.md`, the four personas. docevals folded its
  own six into them: Priya, Nate and Iris are Maya's entry now.
- `docs/content-strategy/cujs.md`, the journeys. docevals's are M9–M13, D8–D9,
  S6–S9 and T4.
- `docs/content-strategy/information-architecture.md`, the content set, with
  the `docevals/` section's tree.

The rules that follow from it:

1. **Identify the persona** the page serves: Maya, Devin, Sara or Theo.
2. **Find the matching CUJ** and structure the page around reaching that
   outcome, not by document type.
3. **Link into `reference/`** for exhaustive detail. Journey pages explain the
   path; they do not duplicate flag tables or config keys.
4. **Record the page in `information-architecture.md`.** A page that is not in
   the content set does not get written.
5. **Pages that present commands carry inline Doc Detective steps** against the
   committed fixtures, spelled `manni docevals …`. The docs-as-tests workflow
   runs them.
6. **`reference/cli.mdx` is drift-checked** by `npm run docs:check-cli`: one
   `` ## `docevals <command>` `` section per command, with Option/Argument/Default
   tables that match `src/docevals/cli.ts`.
7. **Verify claims against the source, and exact emitted strings against
   `test/docevals/`.** Type definitions describe the shape of output and
   over-promise.

The strategy is an evidence-based *hypothesis*, not validated research. Re-derive
it from real call evidence when there are users, and expect it to change.

## Decision records

A docevals decision goes in the family series, as a proposal under
`docs/proposals/NNNN-*.md` in that series' format, like any other domain's.
Proposal 0047 is the first.

The imported ADR log, `docs/proposals/docevals/`, is **closed at 01045**
(proposal 0047). It stays as the record, and the ADR numbers cited below still
resolve there. Do not add an ADR to it. When a new decision replaces one of
its ADRs, the proposal says so. The ADR's `status:` line is then the only
edit, under the root's supersede-never-amend rule.

## Testing behavior

Tests that shell out are time-intensive. Rather than re-running to inspect
different parts of the output, save it once to the session scratchpad and read
the file. vitest and node write diagnostics, including failures, to stderr, so
`2>&1` is required to capture them.

**Absolute POSIX paths break the Windows leg of CI.** Under Git Bash on
`windows-latest`, `/tmp/x` resolves to the shell's POSIX root, while `node.exe`
resolves the same literal string against the current drive (`D:\tmp\x`). Use
paths relative to the working directory in any workflow step that both a shell
and Node touch.

## Commands

- `node dist/cli.js docevals run test/docevals/fixtures/pages --deterministic-only`,
  a dogfood run against the fixture corpus through the repository's
  `manni.config.yaml`. The corpus is named as a path, not declared as a
  collection, because a bare `manni meta validate` reads every collection.
- `npm run docs:check-docevals`, the tool over its own docs section
- `MANNI_DOCEVALS_LIVE=1 npm test`, adding the live smoke test via the Claude CLI
- The root `CLAUDE.md` lists the rest: build, test, typecheck, lint, the docs
  drift checks and the site build.

## Architecture

- One concept, the **eval**. Graders are `ai`, `command`, `tool:<name>`, and
  `human`. There are no "runners". The AI grader is spelled `ai` everywhere a
  user or the code can see it: `GraderKind` in `src/docevals/types.ts`, the
  evals draft, and every docs page.
- `src/docevals/core/engine.ts` holds the pipeline. It runs discover → resolve →
  **empty-plan check** → generation pass → deterministic graders → LLM judge →
  reviews → aggregate. Deterministic graders go cheapest first, one `grade()`
  call per eval group. The judge and script generation are injected
  (`options.judge`, `options.generateScripts`) so the engine tests offline.
- `src/docevals/core/resolve.ts` merges page frontmatter with the config's
  suites and named evals. The `evals` key takes array shorthand or object form
  with `suite`/`skip`. Page wins on name collision. `type` defaults to
  `regression`, `grader` to `ai`.
- `src/docevals/graders/` is the grader registry, mirroring the metadata tool's
  schema-registry pattern. Tool adapters parse each tool's output into
  `Finding[]`. Unit tests use captured output plus a fake `exec`, never real
  binaries.
- `src/docevals/judge/` is the judge stage, built on
  [`@hawkeyexl/inference`](https://github.com/hawkeyexl/inference) (ADR 01002).
  The providers, the N-run ensemble, consensus (`partial` counts as fail),
  confidence zones, the response cache, and the price table all live in the
  library. What stays here is this tool's own work. That is the prompts and
  `PROMPT_VERSION`, the page-worded verdict schema, and the cache-key
  composition (`cache.ts`). It is also `provider.ts`, which picks the provider
  and model: flag, then the eval's own `provider:`/`model:`, then
  `docevals.provider`/`model`, then the family's top-level `providers:`. It
  adds the verdict-shaped options to the spec. And it is
  the orchestration in `judge.ts`. Shared provider code lives in
  `src/shared/providers.ts`, the code `manni meta fill` runs. That covers the
  provider names, the `auto` detection and the two refusals. It also covers the
  level-bound precedence, where a model goes only to the provider its own level
  names, and the mapping of `providers:` settings onto `ProviderSpec`. Never
  grow a docevals-only copy. The orchestration covers bounded concurrency
  across targets, the turn budget, the self-judgment warning, and human-review
  resolution. The turn budget is claimed *before* dispatch and a cached
  ensemble spends nothing; the dollar ceiling it replaced could not do that
  under concurrency (ADR 01019). Never reimplement a provider, ensemble,
  cache, or price table here. Three copies of that code drifted apart once
  already, and a fix belongs upstream.
- `src/docevals/graders/exec.ts` re-exports the library's `realExec`, so the
  subprocess provider and the command/tool graders share one cross-spawn
  wrapper. That wrapper owns npm `.cmd` shim resolution, stdin piping past the
  ~32K command-line limit, and StringDecoder-backed output. `outputTail` stays
  local.
- `src/docevals/graders/scriptgen.ts` + `src/docevals/core/frontmatter-edit.ts`
  write LLM-generated check scripts to `{docDir}/manni-docevals/`, with the
  command reference persisted via surgical YAML edits.
- `src/docevals/cli.ts` exports `buildProgram()` and has no entry point; the
  umbrella mounts it as `docevals`. Usage and operational errors leave through
  `fail` from `src/shared/run.ts` (exit 2), warnings through `warn()` from
  `src/shared/warn.ts`, and a caught value's text through `errorMessage()`
  from `src/shared/errors.ts`. Both writers prefix stderr with
  `programName()`; nothing in the tool spells `manni docevals:` by hand.

## Invariants

- Errored judge runs count against consensus. They may push an eval to
  human-review, never to a silent pass.
- Deterministic evals fail only on `error`-severity findings; warnings and notices
  report but pass.
- Exit codes: `0` pass, `1` any fail/error/suite-miss, `2` operational
  (`DocevalsError`, which extends the family's `ToolError`).
- **A run that would check nothing is exit 2; a run that graded nothing warns**
  (ADR 01041). The empty-plan check reads the resolved plan over the pages
  that are *not* `eval-skip`ped, and sits **before** `applySelection` and
  `applySinceScope`. That ordering is the whole reconciliation with ADR 01018
  and ADR 01040. An empty `--eval` is exit 2 with its own message. An empty
  `--since` scope is exit 0 with its own sentence. It also yields to an
  `error`-level resolution problem, which is the better diagnosis. Counting
  resolved evals over *every* page instead broke the fixture `index.mdx`. That
  page carries `eval-skip: true` and no suite, so it resolves zero evals
  rather than skipped ones, and
  `docs/src/content/docs/docevals/evals/index.mdx` runs it expecting exit 0.
  Whenever no result reaches a verdict the run pushes
  a `warning` problem, including when there are no results at all;
  `needs-review` counts as a verdict.
- Bump `PROMPT_VERSION` (`src/docevals/judge/prompt.ts`) whenever judge prompts
  change, and `FILL_PROMPT_VERSION` (`src/docevals/fill/prompt.ts`) whenever the
  fill prompt or `PROPOSAL_SCHEMA` changes. Each is part of its cache key, and
  stale cached output otherwise survives a prompt revision.
- **An errored judge run is never written to the cache** (`VerdictCache` in
  `src/docevals/judge/cache.ts`). The library's `runEnsemble` caches
  unconditionally and cannot tell a permanent failure from a transient one; we
  can. Without this a VRAM exhaustion, a rate limit, or a dropped connection is
  persisted as though it were a verdict and replayed forever. `get` applies the
  same predicate as `set`, because guarding only the write cannot heal an entry
  this class did not write. The mechanism stays the library's; only the
  predicate is ours (ADR 01038).
- **Judging has its own concurrency**, `judge.concurrency`, defaulting to
  `defaults.concurrency` (ADR 01039). A local `llama-cpp` judge runs in-process
  against one GPU, so a corpus judged locally sets it to `1` while leaving
  deterministic graders at 4. The read site tests `Number.isFinite` rather
  than `??`, because the value is typed non-optional. A JS caller handing
  `makeJudge` an older config would otherwise get `NaN` workers, every AI eval
  vanishing from the results, and exit 0. The upstream fix is a mutex inside
  `LlamaCppProvider`; it is owed to `@hawkeyexl/inference`, not reimplemented here.
- **`--since <ref>` scopes what is *graded*, never what is *diagnosed***
  (ADR 01040). Corpus-mode graders are exempt. `GraderContext` carries targets
  rather than a page list, so narrowing a corpus grader's input converts the
  check into a pass instead of shrinking it. `applySinceScope` drops only `ai`
  and `human` evals on unchanged pages. An unrecognised `tool:` kind is
  deliberately kept, so a typo cannot surface on a changed page and vanish on
  an unchanged one. `partial` is derived from `pagesSelected < plans.length`,
  not from the flag's presence.
- **Grader failures are isolated per eval group, in the engine** (ADR 01042).
  `runEvals` drives `groupTargetsByEval` and calls `grader.grade()` once per
  group with the `try`/`catch` around each call. Do not move that boundary
  back up to the grader *kind*. The adapters keep their internal
  `groupTargetsByEval` loops on purpose: the partition is idempotent, and it
  keeps each grader correct when a unit test calls it directly. The error
  message names the eval, not just the kind. The group key sorts object keys
  recursively before `JSON.stringify`, because `resolve.ts` rebuilds `options`
  per page by spread.
- **A baseline suppresses known findings, never the absence of a verdict.**
  `applyBaseline`'s outcome recompute tests
  `f.severity === "error" || f.diagnostic === true`, the same predicate the
  engine uses when it first computes the outcome (ADR 01022).
- **`--deterministic-only` must not warn about the judge provider** (ADR 01043).
  The warning in `src/docevals/commands/run.ts` is `!options.deterministicOnly`
  and nothing else. Commander defaults a `--no-generate` key to `true`, so any
  condition reading `options.generate === true` fires on every invocation that
  is not `--no-generate`. Under `--deterministic-only` the provider is resolved
  lazily, only when generation first needs a script, so a deterministic run
  never detects a provider. Generation's own need for a provider is reported
  by the engine as an `error` result naming the eval.
- Script generation must leave the page byte-identical outside the edited
  frontmatter node.
- **Never truncate content sent to a model.** Long content is split at line
  boundaries (`src/docevals/core/split.ts`) and the parts are merged. For the
  judge, each part contributes evidence and one judge answers once; merging
  per-part *verdicts* is unsound. The chunk budget is part of every cache key
  that covers chunked output.
- `weight` changes how much an eval moves its suite's pass rate and **never**
  its own pass/fail. Counts stay unweighted, the rate is weighted, and the
  graded set is unchanged (pass + fail + error).
- A **criterion** (`docevals.criteria`) contributes one weighted outcome to its
  suite, and its members contribute none. A criterion whose members were not
  all graded is *suspended*, not failed (ADR 01018, one level down).
- Grader options are validated per grader (`validateOptions`). The published
  vocabulary leaves `options` open and says the grader validates it.
- Anything that **writes** a config must nest it under `docevals:`. That
  covers `init`'s `STARTER_CONFIG`, docs examples, and fixtures. A flat file
  is not an error. The family loader passes over a file with no `docevals:`
  key, and the tool runs on pure defaults, silently passing.
  `test/docevals/unit/init.test.ts` guards the scaffold by loading it back
  rather than matching its text; do the same for any new writer. It must also
  **attach** what it defines (ADR 01041): the guard is a bare page run through
  `runList`/`runEvals`, not an assertion about the file's text.
- Content files drive arbitrary code execution by **two** paths. Both are
  default-deny behind one operator grant, `docevals.execution.allow` (CLI
  `--allow-execution`, `--no-execution`). (1) `frontmatter-commands` covers
  `command` evals declared in page frontmatter. (2) `page-embedded-steps`
  covers the `tool:doc-detective` grader executing steps written in page
  *bodies*. Any change near command graders, script generation or the
  doc-detective adapter must preserve both gates. **The grant is defense in
  depth, never sufficient on its own.** A grant says "this corpus is trusted
  to execute", and a fork's pages are not this corpus. The only complete
  control is restricting the job to same-repo pull requests; the
  docs-as-tests workflow carries that gate. Never remove it.
- The page vocabulary is **`manni:evals:1.0.0-proposal.3`**, proposed by the
  metadata tool (proposal 0023) and implemented here (ADRs 01009 and 01045).
  `src/docevals/schema.ts` imports the draft from
  `docs/proposals/0023/schemas/evals/` and tsup bundles it, so `dist` never
  reads `docs/`. **Never ship a copy or patch it in memory**: the copies this
  tool used to publish drifted from the draft twice. Three flat page keys:
  `evals`, `eval-suite` and `eval-skip`, plus a reserved `eval-` prefix, so an
  unrecognized `eval-*` key, `eval-provenance` included, is a page error.
- **Machine attribution is ai-context's, not this vocabulary's** (proposal
  0046). `provenance` pins the body lines a machine wrote, and
  `meta-provenance` names the fields and evals a machine proposed. There is no
  page-level `generated-by`. The self-preference check
  (`src/docevals/judge/self-preference.ts`) reads `provenance` for
  `target: body`, the `fields` of `meta-provenance` for `frontmatter`, both
  for `raw`, and nothing for a companion file. The criterion axis is a
  `meta-provenance` entry listing the eval's id. It stays a warning. `fill`
  writes `meta-provenance` through `mergeMetaProvenance` from
  `src/meta/internal.ts`, the merge `manni meta fill` uses; never grow a
  docevals copy of it.
- **A bare string in the eval list is an assertion, not a reference.**
  `resolvePage` warns when a shorthand matches a defined eval id and
  deliberately does not reinterpret it.
- **Section keys are camelCase; entries are kebab-case.** Every manni tool
  spells its own section keys in camelCase, and so does this one. A kebab
  spelling of one is an unknown key, and its message names the camelCase key.
  The entries under `evals:`, `criteria:` and `suites:` are the entries a page
  carries. So they keep the vocabulary's kebab-case, per ADR 01010 and
  proposal 0047. The one boundary between that spelling and TypeScript's is
  `normalizeEvalDef` in `src/docevals/core/config.ts`. For any camelCase key
  in an entry, `parseConfig` names the kebab spelling it should have.
- **`tool:docmeta` requires `options.schemas`** (ADR 01013). Passing
  `cliSchemas: undefined` would inherit the metadata tool's own
  `DEFAULT_SCHEMAS`, and a bare eval's meaning would then change whenever that
  set widens. Never restore the inherited default. The grader keeps its name;
  it runs the sibling's `runValidate` in-process.

## Config ↔ CLI flags (required pattern)

Every user-facing knob flows through the resolved config. CLI flags do **not**
bypass it; they override it.

```text
manni.config.yaml  →  `docevals:` key (src/shared/config-file.ts)  →  Ajv validate (src/docevals/core/config-schema.json)  →  defaults applied  →  CLI override  →  runtime
```

The family loader finds the file and hands this tool the value under
`docevals:`. There is no per-tool legacy file name: a `docevals.config.yaml` is
not read.
Inside the section `additionalProperties: false` catches typos; the schema's
root stays permissive because sibling keys are not ours. Don't "fix" it.

- `parseConfig()` validates against `config-schema.json` and fills every
  default, so downstream code receives a fully-populated `DocevalsConfig` and
  never re-applies one.
- CLI options are overlaid at the read site with `??`
  (`options.runs ?? ev.runs ?? config.judge.ensembleRuns`), so an unset flag
  falls through to the eval's own value and then to config.
- Runtime code reads the resolved config and options, never raw `argv`.

Tests build configs through `test/docevals/helpers/config.ts`
(`parseDocevalsConfig` / `nestUnderDocevals`) so the nesting lives in one
place. `test/docevals/unit/config.test.ts` calls `parseConfig` directly on
purpose, because it pins the file contract itself.

### Adding a new knob

1. **Schema first.** Add the field under `$defs/docevalsConfig` in
   `config-schema.json`, with a positive and a negative case in
   `test/docevals/unit/config.test.ts`.
2. **Default in `parseConfig()`.**
3. **CLI flag** in `src/docevals/cli.ts`, threaded through the command's
   options type, and a row on `docs/src/content/docs/docevals/reference/cli.mdx`.
4. **Override at the read site** with `??`.
5. **Read the resolved value** at the consumption site.

Don't read `argv` from engine, grader, judge, or reporter code. Don't apply
defaults outside `parseConfig()`. Don't add a CLI flag without the matching
config field.

## Design decisions

The ADR is the record; these are the map.

- **One unified concept, the eval** ([ADR 00001](../../docs/proposals/docevals/00001-one-unified-concept-the-eval.md)).
- **Generated check scripts are files, not inline code** ([ADR 00002](../../docs/proposals/docevals/00002-generated-scripts-are-files-not-inline-code.md)).
- **`type` defaults to `regression`, not `capability`** ([ADR 00003](../../docs/proposals/docevals/00003-type-defaults-to-regression.md)).
- **Level 1 orchestrates, it does not reimplement** ([ADR 00004](../../docs/proposals/docevals/00004-level-1-orchestrates-rather-than-reimplements.md)).
  Deterministic checks wrap existing tools. Native graders exist only where
  nothing else covers the gap: freshness, reading level, and cross-page
  differentiation. This repository's own corpora lint with `tool:remark`, not
  `tool:markdownlint`, because they are MDX (ADR 01024).
- **The metadata tool publishes the vocabulary; this tool implements the
  behavior** (ADR 01009). The field names and the schema both come from
  proposal 0023's draft, which pages validate against directly (ADR 01045).
- **Conceptual source.** The *Docs as Tests with AI* manuscript (draft 4). The
  grader hierarchy, eval sketch fields, 3-run ensemble, confidence zones, 70%
  calibration threshold, and 15% false-positive alert all come from it.
