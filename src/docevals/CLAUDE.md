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
`test/docevals/{unit,integration,fixtures,helpers}`, its published schemas
under `schemas/docevals/`, its ADR log under `docs/proposals/docevals/`, its
site under `docs/src/content/docs/docevals/`, and its content strategy under
`docs/content-strategy/docevals/`. The metadata tool is a sibling in this
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
consult `docs/content-strategy/docevals/`. **Read on demand; do not inline it
here.**

- `README.md`, the index, the ID-linking model, and the evidence caveat (start here)
- `audiences/`, six target segments (`aud-*`)
- `personas/`, one minimal persona per audience (`persona-*`)
- `journeys/`, twelve critical user journeys (`cuj-*`), steps → real doc paths
- `information-architecture/`, the CUJ-first IA and its gap analysis

The rules that follow from it:

1. **Identify the persona** the page serves: Priya (corpus owner), Nate (solo
   owner), Devin (pipeline owner), Sara (standard owner), Theo (contributor),
   or Iris (retrofitter).
2. **Find the matching CUJ** and structure the page around reaching that
   outcome, not by document type.
3. **Link into `reference/`** for exhaustive detail. Journey pages explain the
   path; they do not duplicate flag tables or config keys.
4. **Record the page in `proposed-ia.md`.** A page that is not in the content
   set does not get written.
5. **Pages that present commands carry inline Doc Detective steps** against the
   committed fixtures, spelled `manni docevals …`. See "Authoring convention"
   in `proposed-ia.md`. The docs-as-tests workflow runs them.
6. **`reference/cli.mdx` is drift-checked** by `npm run docs:check-cli`: one
   `` ## `docevals <command>` `` section per command, with Option/Argument/Default
   tables that match `src/docevals/cli.ts`.
7. **Verify claims against the source, and exact emitted strings against
   `test/docevals/`.** Type definitions describe the shape of output and
   over-promise.

The strategy is an evidence-based *hypothesis*, not validated research. Re-derive
it from real call evidence when there are users, and expect it to change.

## Architecture Decision Records

Every **behavior change** ships with an ADR in [MADR](https://adr.github.io/madr/)
format under `docs/proposals/docevals/`, beside the ones imported from the
source repository. The root's supersede-never-amend rule applies.

- **Format**: MADR 4.0.0. Front matter carries `status`, `date`, and
  `decision-makers`. The body carries *Context and Problem Statement*,
  *Decision Drivers*, *Considered Options*, *Decision Outcome* (with
  *Consequences* and *Confirmation*), and *Pros and Cons of the Options*.
- **Filename**: `NNNNN-kebab-case-title.md`, 5-digit zero-padded, continuing
  from the highest number in the directory. `00001`–`00999` is the backfill
  range for pre-rule decisions; do not take a number from it for new work.
- **Scope**: decisions (behavior, contracts, trade-offs), not mechanical
  changes.

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

- `node dist/cli.js docevals run --deterministic-only`, a dogfood run against
  the fixture corpus through the repository's `manni.config.yaml`
- `npm run docs:check-docevals`, the tool over its own docs section
- `MANNI_DOCEVALS_LIVE=1 npm test`, adding the live smoke test via the Claude CLI
- The root `CLAUDE.md` lists the rest: build, test, typecheck, lint, the docs
  drift checks and the site build.

## Architecture

- One concept, the **eval**. Graders are `ai`, `command`, `tool:<name>`, and
  `human`. There are no "runners". The AI grader is spelled `ai` everywhere a
  user or the code can see it: `GraderKind` in `src/docevals/types.ts`, the
  published frontmatter schema, and every docs page.
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
  composition (`cache.ts`). It is also the config → `ProviderSpec` mapping
  (`provider.ts`) and the orchestration in `judge.ts`. The orchestration covers bounded concurrency
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
  umbrella mounts it as `docevals`. `fail` comes from `src/shared/run.js` and
  the stderr prefix from `programName()`.

## Invariants

- Errored judge runs count against consensus. They may push an eval to
  human-review, never to a silent pass.
- Deterministic evals fail only on `error`-severity findings; warnings and info
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
  is not `--no-generate`. Generation's own need for a provider is reported by
  the engine as an `error` result naming the eval.
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
- The frontmatter schemas (`schemas/docevals/`) are **published artifacts**,
  not internal source. They ship in the package (`files`/`exports`), and
  consumers point their validator at them by path *or by their `$id` URL*.
  Three-segment semver, and the bytes are frozen once published, so a
  `description` fix is a new version rather than an edit.
  `docs/public/docevals/schemas/` carries the served copy; keep the two
  identical.
- The page vocabulary is **`manni:evals:1.0.0-proposal.2`**, published by the
  metadata tool (proposal 0023) and implemented here (ADR 01009). Four flat
  page keys: `evals`, `eval-suite`, `eval-skip`, and `eval-provenance`, plus a
  reserved `eval-` prefix, so an unrecognized `eval-*` key is an error. Don't
  diverge `schemas/docevals/frontmatter-1.1.0.json` from it without recording
  why. 1.0.0 stays shipped and byte-frozen for consumers who pinned it.
- **A bare string in the eval list is an assertion, not a reference.**
  `resolvePage` warns when a shorthand matches a defined eval id and
  deliberately does not reinterpret it.
- **Every key in a file is kebab-case**; TypeScript stays camelCase
  (ADR 01010). `normalizeEvalDef` in `src/docevals/core/config.ts` is the only
  boundary between them. `parseConfig` names any camelCase key it finds and the
  kebab it should be.
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
`docevals:`; a legacy `docevals.config.yaml` is read whole, with a warning.
Inside the section `additionalProperties: false` catches typos; the schema's
root stays permissive because sibling keys are not ours. Don't "fix" it.

- `parseConfig()` validates against `config-schema.json` and fills every
  default, so downstream code receives a fully-populated `DocevalsConfig` and
  never re-applies one.
- CLI options are overlaid at the read site with `??`
  (`options.runs ?? config.judge.ensembleRuns`), so an unset flag falls
  through to config.
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
  behavior** (ADR 01009). The field names come from proposal 0023; the schema
  file ships from here so its versioning is not gated on the sibling's.
- **Conceptual source.** The *Docs as Tests with AI* manuscript (draft 4). The
  grader hierarchy, eval sketch fields, 3-run ensemble, confidence zones, 70%
  calibration threshold, and 15% false-positive alert all come from it.
