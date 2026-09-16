# manni tracevals

Guidance for agents working on the session adherence tool, `manni tracevals`.
It runs deterministic and LLM-as-judge adherence evals against AI agent session
traces. Claude Code sessions are the input today, and other trace formats
follow later. The root `CLAUDE.md` owns everything repo-wide. That covers the
worktree and npm rules, red/green TDD, fixtures per feature, and Conventional
Commits with what they release. It also covers the demo video rule, the
supersede-never-amend rule for proposals, and the lint and output conventions.
This file adds only what is specific to this tool.

Imported from [hawkeyexl/moose-tracevals](https://github.com/hawkeyexl/moose-tracevals)
at fed983b. Its sources live under `src/tracevals/`, its tests under
`test/tracevals/{unit,integration,fixtures}` with `test/tracevals/helpers.ts`,
its imported ADR log (closed at 01033) under `docs/proposals/tracevals/`, its
`SessionStart` hook under `plugin/tracevals/hooks/`, and its site under
`docs/src/content/docs/tracevals/`. Its content strategy is the family's, in
`docs/content-strategy/`. It ships no schema file: artifacts validate against
the draft in `docs/proposals/0023/schemas/artifact-evals/`, bundled into the
build. The metadata tool is a sibling in this repository, imported by relative
path (`../meta/index.js`), not a dependency. Proposal 0049 is the record of the
fold-in.

## Fixtures (required)

Unit tests are necessary but not sufficient. A **user-facing feature** is a
grader kind, an eval field, a CLI flag, a provider, or a report format. When you
add or change one, also exercise it end-to-end through the real CLI against
`test/tracevals/fixtures/`. Cover **every meaningfully distinct shape** it can
take, not just the happy path.

The corpus is deliberately **not** all-passing, so a dogfood run is meaningful:

- `test/tracevals/fixtures/traces/` holds captured trace files: a Claude Code
  session file, a resumed session, one with a sidecar subagent transcript, and a
  legacy `claude -p` stream-json transcript. They are sanitized, with no secrets
  and shortened content.
- `test/tracevals/fixtures/project/` is a fake project tree (`.claude/skills/`,
  `.claude/agents/`, `.claude/commands/`, `CLAUDE.md`, `AGENTS.md`, plus a
  `tracevals/` labels file and check script). Its artifacts declare evals
  engineered so at least one deterministic eval **fails** against the fixture
  trace. Between them the artifacts cover every distinct block shape: object
  entries, the string shorthand, and the single-string block. They also cover the
  `ai` / `human` / `command` / deterministic grader families.
- `test/tracevals/fixtures/home/.claude/` is a fake session store, reached by
  pointing `CLAUDE_CONFIG_DIR` at it. Its plugin skill is where
  `metadata.eval-skip` is exercised. `test/tracevals/fixtures/relocated/`,
  `plugins/`, `plugin-project/`, `no-commands/` and `review-only/` each exercise
  one narrower path.

The suite must stay **offline and hermetic**. Judge providers are mocked (the
inference library's `MockProvider`), interactive prompts are injected functions,
and process execution is injected. A test that reaches the network or spawns a
real agent CLI is a defect. The one exception is
`test/tracevals/integration/live.test.ts`, gated behind `MANNI_TRACEVALS_LIVE=1`
and skipped by default.

## Content & documentation work (required)

Before drafting or editing any page under
`docs/src/content/docs/tracevals/**`, consult the family's content strategy.
**Read on demand; do not inline it here.**

- `docs/content-strategy/personas.md`, the four personas. tracevals folded its
  own five into them. Priya became Maya, Sam became Sara, and its Devin and Theo
  became the family's. Rin, the toolsmith, is D11 and the API reference.
- `docs/content-strategy/cujs.md`, the journeys. tracevals's are M14–M17, D10,
  D11, S10, S11 and T5.
- `docs/content-strategy/information-architecture.md`, the content set, with the
  `tracevals/` section's tree and its source-of-truth mapping.

The rules that follow from it:

1. **Identify the persona** the page serves: Maya, Devin, Sara or Theo.
2. **Find the matching CUJ** and structure the page around reaching that
   outcome, not by document type.
3. **Link into `reference/`** for exhaustive detail. Journey pages explain the
   path; they do not duplicate flag tables or config keys.
4. **Record the page in `information-architecture.md`.** A page that is not in
   the content set does not get written.
5. **Pages that present commands carry inline Doc Detective steps** against the
   committed fixtures, spelled `manni tracevals …`.
6. **`reference/cli.mdx` is drift-checked** by `npm run docs:check-cli`: one
   `` ## `tracevals <command>` `` section per command, with Option / Argument /
   Default tables that match `src/tracevals/cli.ts`.
7. **Verify claims against the source, and exact emitted strings against
   `test/tracevals/`.** Type definitions describe the shape of output and
   over-promise.

Four constraints hold across the section, from proposal 0049. No page prints a
dollar figure for what tracevals itself spends, because its budget is counted in
turns. The `cost` grader is the exception, and its finding is about the *graded*
session's spend. No page names a default model id, because none is hardcoded.
No page shows `manni tracevals <trace>` without the verb, because 0034 removed
the default subcommand. And the strategy is an evidence-based *hypothesis*, not
validated research.

## Decision records

A tracevals decision goes in the family series, as a proposal under
`docs/proposals/NNNN-*.md` in that series' format, like any other domain's.
Proposal 0049 is the first.

The imported ADR log, `docs/proposals/tracevals/`, is **closed at 01033**
(proposal 0049 §7). It stays as the record, and the ADR numbers cited below
still resolve there. Do not add an ADR to it. When a new decision replaces one
of its ADRs, the proposal says so. The ADR's `status:` line is then the only
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

- `node dist/cli.js tracevals run test/tracevals/fixtures/traces/claude-session.jsonl --project test/tracevals/fixtures/project --deterministic-only`,
  the dogfood run against the fixture corpus. It exits `1` on purpose: the
  corpus carries a failing eval.
- `node dist/cli.js tracevals fill test/tracevals/fixtures/project --provider mock --dry-run`
  dogfoods the authoring path. **Always `--dry-run` against the fixtures**, so
  the corpus stays byte-identical.
- `echo '{"session_id":"x","cwd":"test/tracevals/fixtures/project"}' | node dist/cli.js tracevals capture --out .tmp/m.json`
  dogfoods the capture path. **Always `--out` somewhere under `.tmp/`**: a
  manifest written into `test/tracevals/fixtures/project` would silence the
  staleness assertions.
- `CLAUDE_CONFIG_DIR=test/tracevals/fixtures/home/.claude node dist/cli.js tracevals list --all-projects`
  enumerates the fixture session store rather than the real one.
- `MANNI_TRACEVALS_LIVE=1 npm test` adds the live smoke test (a real judge
  provider).
- The root `CLAUDE.md` lists the rest: build, test, typecheck, lint, the docs
  drift checks and the site build.

## Architecture

The pipeline runs **select trace → parse (adapter) → resolve artifacts → extract
evals → plan evals → deterministic graders → AI judge → aggregate → report
(+ history)**.

- `src/tracevals/trace/` holds trace adapters behind a normalized `Trace` model.
  `claude.ts` parses both Claude Code session files
  (`~/.claude/projects/<slug>/*.jsonl`) and legacy `claude -p` stream-json.
  `discover.ts` scans the session store under `configDir()`, which reads Claude
  Code's own `CLAUDE_CONFIG_DIR` and falls back to `~/.claude`. The location is
  **detected rather than switched**, so a test or CI job points at a fixture tree
  with the same variable the agent reads. tracevals has no home-directory
  override of its own. `picker.ts` is the interactive chooser `run` opens when a
  TTY is on both ends and no trace was named. The `TraceSource` union is the seam
  for future adapters (Codex is deferred, not rejected; ADR 01003).
- `src/tracevals/artifacts/` resolves every skill, agent, slash-command and
  project-rule artifact the trace used, deterministically. `Skill` tool calls
  resolve to `SKILL.md`, and `Agent` spawns (`subagent_type`) to agent
  definitions. `CLAUDE.md` and `AGENTS.md` are read at the trace cwd, in
  `.claude/`, and in parent dirs up to the git root. A `<command-name>` injection
  is a **slash command**. It resolves to `.claude/commands/*.md`, then to a
  `SKILL.md` (a skill typed in its slash form), then to a built-in. It is never
  reported as a missing skill, and never with a roster state (ADR 01023).
  Unresolved refs go to the report's coverage table, never crash the run.
- `src/tracevals/evals/` reads the `metadata.evals` block from artifacts through
  the metadata tool's `extractFrontmatter`. It validates the **whole front
  matter** against
  `docs/proposals/0023/schemas/artifact-evals/1.0.0-proposal.4.json`, imported
  directly by `schema.ts` and inlined by the bundler, so the built CLI never
  reads `docs/`. The schema is document-rooted, and `metadata` stays open so
  other tools' members pass untouched. A schema cannot reject unknown members of
  an open bag, so `extract.ts` reserves the `eval-` prefix at run time, as
  `^eval-(?!skip$)`. An unrecognized `metadata.eval-*` key is an error, not an
  inert typo. Artifacts without declared evals get one implicit whole-artifact
  adherence eval (ADR 01002).
- `src/tracevals/evals/external.ts` reads the block back when `manni meta
  relocate` moved it. proposal.4 marks the whole top-level `metadata` key
  `x-manni-location: external` (proposal 0047). So `evals`, `eval-skip` and
  `meta-provenance` relocate as one block, and cannot be split across an
  artifact and a manifest. Reading is meta's merge, not a second loader:
  `loadExternalEvals` loads every manifest that owns `metadata`, and
  `forArtifact` merges one artifact through `mergeExternalMetadata`. Membership
  is decided by **every declared collection**, not the ones a run selected, because
  no collection ever chooses tracevals' inputs (proposal 0049 §1). A URL manifest
  is readable here, unlike in `manni cite`, since `run` and `calibrate` only
  read; `fill` refuses to write into one at the point of writing.
- `src/tracevals/graders/` is the deterministic `TraceGrader` registry:
  `tool-usage`, `tool-order`, `skill-invoked`, `file-access`, `turn-count`,
  `cost`, `regex`, `json-output` and `command`. Each implements
  `validateOptions()` so options are ground-checked without a trace (ADR 01004).
  `util.ts` owns `windowFor()`, the slice of the trace an artifact governed
  (ADR 01015); every grader that counts events reads the window, not the trace.
  `plugins.ts` imports the modules named by `tracevals.plugins` and `--require`
  before planning, so a consumer's `registerGrader` lands in time. Specifiers
  resolve against the **config file's** directory, and `--require` **appends** to
  the config list. A specifier that will not import is a `TracevalsError`, never
  a skip (ADR 01017). `BUILTIN_GRADER_KINDS` is frozen before any registration,
  so "a plugin added a kind" stays distinguishable from "a plugin took over a
  built-in".
- `src/tracevals/fill/` and `src/tracevals/commands/fill.ts` do the authoring.
  They propose evals for artifacts found by `artifacts/discover.ts` (the static
  inverse of `resolve.ts`). Each proposal passes a gate of grader allowlist →
  option validation → target grounding → confidence. Survivors are appended
  through `evals/write.ts`, along with a `metadata.meta-provenance` entry naming
  the model and its per-eval confidence, merged through `mergeMetaProvenance`
  from `src/meta/internal.ts`, the merge `manni meta fill` uses. Never grow a
  tracevals copy of it. Project rules are proposed but never written (ADR 01005).
- `src/tracevals/capture/` and `src/tracevals/commands/capture.ts` build session
  manifests. `capture` reads a Claude Code `SessionStart` hook payload on
  **stdin** and writes sha256 of every instruction artifact plus the git SHA to
  `.manni/tracevals/sessions/<id>.json`. `run` reads one back, so staleness is
  content identity rather than the mtime guess (ADR 01024). **Nothing goes to
  stdout in hook mode**, because a `SessionStart` hook's stdout becomes model
  context; the report goes to stderr through the family's `notice()` instead.
  The split into `types.ts` (shared), `manifest.ts` (consume) and `build.ts`
  (produce) exists because `artifacts/resolve.ts` consumes a manifest while
  `artifacts/discover.ts` produces one. One module would be an import cycle.
- `src/tracevals/judge/` is the trace-adherence LLM judge, built on
  [`@hawkeyexl/inference`](https://github.com/hawkeyexl/inference) (`makeProvider`,
  `runEnsemble`, `computeConsensus`, `zoneFor`, `JsonCache`). What stays local is
  what is tracevals-specific: the prompts, the trace-worded verdict schema, the
  cache-key composition, the turn budget, and the `JudgedEval` shape. It runs an
  N-run ensemble at temperature 0 over a content-addressed cache under
  `.manni/tracevals/cache`. Never reimplement provider construction,
  ensemble/consensus math, response caching or token pricing here. A fix belongs
  upstream, and three copies of that code drifted apart once already.
- `src/tracevals/judge/provider.ts` maps a run onto the library's `ProviderSpec`
  through **`src/shared/providers.ts`**, the same code `manni docevals` and
  `manni meta fill` run. That module owns the provider names, `auto` detection,
  the refusals, and `--local`, which overrides every configured or eval-level
  choice with `llama-cpp` and names each one it replaced. Precedence is
  `--local`, `--provider`, the eval's own `provider:`, `tracevals.provider`,
  `providers.provider`, then `auto`. A contradicting `--provider` is exit 2.
  Connection settings (`apiKeyEnv`, `baseUrl`, `command`, `modelsDir`) are the
  family's top-level `providers:` map and are **never** a `tracevals:` key.
  Never grow a tracevals-only copy.
- `src/tracevals/core/engine.ts` is the orchestration; the judge and graders are
  injected so the engine tests offline. `src/tracevals/aggregate.ts` builds the
  corpus report, `src/tracevals/history.ts` the run-over-run comparison.
- `src/tracevals/reporters/` holds pretty / json / markdown, each with an
  artifact-coverage section, and `format.ts` is the one source of truth for
  `-f/--format` values.
- `src/tracevals/cli.ts` exports `buildProgram()` and has no entry point; the
  umbrella mounts it as `tracevals`. Usage and operational errors leave through
  `fail` from `src/shared/run.ts` (exit 2), warnings through `warn()` and
  run-scoped reports through `notice()` from `src/shared/warn.ts`. Both writers
  prefix stderr with `programName()`; nothing in the tool spells
  `manni tracevals:` by hand.

## The turn budget

The budget is counted in **turns, not dollars** (proposal 0049 §3, matching
docevals ADR 01019). `judge.maxTurns` and `--max-turns` stop the run after that
many uncached ensemble runs, and a cached ensemble spends none. A dollar ceiling
cannot be enforced exactly while ensemble runs are in flight concurrently; a turn
count can. `fill.maxTurns` is the same idea over inference calls. Evals left
unjudged report `skipped` with `reason: "turn budget"`, never a pass. There is no
`--max-cost-usd` and no per-provider `pricing` table. The `cost` **grader** is a
different thing and stays: it grades what the *graded session* spent, which the
trace itself records.

## Invariants

- Errored judge runs count against consensus. They may push an eval to
  human-review, never to a silent pass.
- An eval grades the **window** its artifact governed, derived from the artifact
  type and never declared. A skill's window runs from its invocation to the next
  skill's. An agent's window is its own branch, and project rules take the whole
  session (ADR 01015). An **empty** window is `skipped` with a stated reason, for
  deterministic, `ai` and `human` graders alike. A window is empty when a skill
  was never invoked, or an agent recorded no turns. Never a pass. `cost` and
  `json-output` are session-level by nature and stay unwindowed.
- Deterministic evals fail only on `error`-severity findings; `warning` and
  `notice` findings report but pass. The scale is the family's, from
  `src/shared/severity.ts`; the `info` the imported code used is gone.
- Exit codes: `0` pass, `1` any fail/error, `2` operational (`TracevalsError`,
  which extends the family's `ToolError`).
- **What decides the report shape is how traces were selected, not how many came
  back.** One named trace is a `RunReport`. A discovery selector
  (`--all-projects`, `--since`, `--limit`) is a `BatchReport` even when it
  matches exactly one, so a script piping `--format json` gets a stable shape
  (ADR 01018). Naming traces and selecting them is exit 2.
- Bump `PROMPT_VERSION` (`src/tracevals/judge/prompt.ts`) whenever judge prompts
  change, and `FILL_PROMPT_VERSION` (`src/tracevals/fill/prompt.ts`) whenever the
  fill prompt or proposal schema changes. Both are cache-key components, and a
  stale cache silently replays old output.
- Evaluation is **read-only**: `run` never mutates trace files or the artifacts
  it evaluates. `fill` is the one write path. It is an explicitly-invoked
  authoring command that `run` never calls, appends only, and never writes
  project rules (ADR 01005). `capture` is the second, on the same terms:
  explicitly invoked, never called by `run`, and it writes only its own manifest
  (ADR 01024). Trace files are never written by anything.
- Artifact resolution is deterministic, from trace content plus filesystem
  lookup, with no LLM guessing. Unresolved or absent artifacts degrade to
  warnings and coverage notes, never a crash; zero artifacts means skipped evals
  and exit 0.
- The vocabulary is `manni:artifact-evals:1.0.0-proposal.4`, **imported from
  `docs/proposals/0023/schemas/` rather than copied**. Don't re-fork it and don't
  vendor a copy. Two copies used to ship under `schemas/tracevals/`, held still
  by a sha256 pin, and had drifted from the draft anyway (proposal 0049 §4). Behavior is ours, meaning the graders, the runtime and the
  reports. The shape is not, and a change to the shape is a change to the
  draft.
  `test/tracevals/unit/schema.test.ts` is a case-for-case port of the draft's own
  ladder, so drift between the draft and what this tool accepts fails there. The
  `-proposal.N` suffix is a semver **prerelease** and the hyphen is load-bearing.
  A `+proposal.4` suffix would be build metadata, and would compare *equal* to
  the 1.0.0 release.
- The grader vocabulary is an **open enum**, so any kebab name validates and the
  registry is the authority that rejects one. Adding a grader therefore never
  needs a schema version. The accepted cost is that a stale name (`llm`, the
  pre-1.0 spelling of `ai`) passes the schema and fails at the registry instead.
- `command`-graded evals **execute a program named in an artifact**, on by
  default (ADR 01011). argv is spawned with `shell: false`, and `timeout-ms`
  always has a finite default. A command that cannot run, times out, or whose
  `generated-assertion-hash` no longer matches its assertion is an `error`, never
  a pass.
- **The self-preference check reads 0046's records** (proposal 0049 §5). It keeps
  both axes. *session* is the trace's model being the judge's model. *criterion*
  is the judge's model appearing in a `meta-provenance` entry that lists the
  eval's id.
  The criterion axis used to read `metadata.eval-provenance`, keyed differently
  from what the check compared, so it could quietly never fire.
- **Section keys are camelCase; entries are kebab-case.** Every manni tool spells
  its own section keys in camelCase, and so does this one. A kebab spelling of one
  is an unknown key, and its message names the camelCase key. The entries inside a
  `metadata.evals` block keep the vocabulary's kebab-case.

## Config ↔ CLI flags (required pattern)

Every user-facing knob flows through the resolved config. CLI flags do **not**
bypass it; they override it.

```text
manni.config.yaml  →  `tracevals:` key (src/shared/config-file.ts)  →  Ajv validate (src/tracevals/core/config-schema.json)  →  defaults applied  →  CLI override  →  runtime
```

The family loader finds the file and hands this tool the value under
`tracevals:`. There is no per-tool legacy file name: a `moose.config.yaml` is not
read, and neither is a `tracevals.config.yaml`.

- `parseConfig()` in `src/tracevals/core/config.ts` validates and fills **every**
  default; downstream code receives a fully-populated config and never re-applies
  one.
- Inside the section `additionalProperties: false` catches typos. The schema
  describes the **section**, not the file, and `parseConfig()` takes the section
  object. Sibling keys are not ours; don't "fix" that.
- **Two loader checks the standalone tool had are deliberately gone, and are not
  to be re-added.** It used to reject `tracevals` keys left at the file's top
  level, and a miscased `Tracevals:` section. Discovery is now the family's
  (`src/shared/config-file.ts`). The family contract is that one
  `manni.config.yaml` holds one top-level key per tool. Keys beside `tracevals:`
  belong to other tools and are never touched. A tool that reads a sibling's keys
  to guess at a mistake in its own is reading someone else's config. It would also
  have to be taught every future tool's key names to stay right. `Tracevals:` is not this tool's section, by the same rule that makes
  `a11y:` not this tool's section. Both now read as "no tracevals config", which
  is what the contract says they are.
- CLI options are overlaid at the read site with `??`, as in
  `options.runs ?? config.judge.ensembleRuns`. An unset flag falls through to the
  eval's own value, and then to config.
- Runtime code reads the resolved config and options, never raw `argv`.

### Adding a new knob

1. **Schema first.** Add the field in `src/tracevals/core/config-schema.json`,
   with a positive and a negative case in `test/tracevals/unit/config.test.ts`.
2. **Default in `parseConfig()`.**
3. **CLI flag** in `src/tracevals/cli.ts`, threaded through the command's options
   type, and a row on `docs/src/content/docs/tracevals/reference/cli.mdx`.
4. **Override at the read site** with `??`.
5. **Read the resolved value** at the consumption site.

Don't read `argv` from engine, grader, judge, or reporter code. Don't apply
defaults outside `parseConfig()`. Don't add a CLI flag without the matching
config field. And don't accept a flag that quietly does nothing. `list` has no
`-c`/`--no-config` for exactly that reason.
