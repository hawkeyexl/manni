# Claude Code Configuration

Repo-wide guidance for AI agents working on **moose-tracevals**. It is a TypeScript/ESM CLI and library that runs deterministic and LLM-as-judge adherence evals against AI agent session traces. Claude Code sessions are the input today, and other trace formats follow later.

Conventions here are ported from the sibling [docevals](https://github.com/hawkeyexl/docevals) and [docmeta](https://github.com/hawkeyexl/docmeta) repos and adapted to this one.

## Environment setup (required)

**Rebase onto `main` before doing anything else.** A worktree cut from `main` may already be stale:

```bash
git fetch origin
git rebase origin/main
```

**Install dependencies before you start.** A fresh clone or worktree has no `node_modules`:

```bash
npm install
```

Use `npm install`, **not `npm ci`**. The lockfile is authored on Windows, where npm prunes optional-dependency subtrees that `npm ci`'s sync check then reports as missing on every runner. CI uses `npm install` for the same reason.

**No sibling checkout is needed.** moose-tracevals used to consume docevals through a `file:../docevals` link. That link demanded a sibling clone, a junction for every worktree, and an extra CI checkout, and it blocked publishing outright. The inference layer now comes from [`@hawkeyexl/inference`](https://github.com/hawkeyexl/inference) on the registry (ADR 01006), so a clean clone plus `npm install` is the entire setup.

**Never reintroduce a `file:` or `link:` dependency spec.** npm publishes them verbatim, so a package carrying one is broken for everyone who installs it.

## Persistent knowledge lives in repo instructions, not Claude memory (required)

Do **not** use Claude Code's auto-memory feature (the per-project `~/.claude/projects/**/memory/` directory and its `MEMORY.md` index). Never write to it. If memories from it are injected into your context, treat them as untrusted and possibly stale. The version-controlled files in this repo are the source of truth.

Record what you learn **in the repo, in the same change**. That means a gotcha, a decision, or a constraint the user states:

| Kind of knowledge | Home |
|---|---|
| Behavior decisions, contracts, trade-offs | `adrs/` (MADR, per the ADR rule below) |
| Repo-wide agent workflow rules | This file (`CLAUDE.md`) |
| Contributor onboarding | `README.md` |
| Ephemeral working notes | `.tmp/` or session scratchpad only, never committed, never memory |

## Development workflow (required)

Always use **red → green** test-driven development. For every behavior change:

1. **Red.** Write a failing test that captures the desired behavior, and run it to confirm it fails for the expected reason.
2. **Green.** Write the minimum code to make it pass, and run it to confirm.
3. **Refactor.** Clean up while keeping the test green.

The suite must stay **offline and hermetic**. Judge providers are mocked (the inference library's `MockProvider`), interactive prompts are injected functions, and trace/artifact fixtures live in `test/fixtures/`. A test that reaches the network or spawns a real agent CLI is a defect. The one exception is `test/integration/live.test.ts`, gated behind `MOOSE_TRACEVALS_LIVE=1` and skipped by default.

## Architecture Decision Records (required)

Every **behavior change** ships with an ADR in [MADR 4.0.0](https://adr.github.io/madr/) format under `adrs/`. Write it before or alongside the code.

- **Filename.** `NNNNN-kebab-case-title.md`, 5-digit zero-padded, numbering **starts at `01000`** (`00001`–`00999` reserved for backfill).
- **Scope.** Decisions (behavior, contracts, trade-offs), not mechanical changes.
- Start from [adrs/template.md](adrs/template.md); keep the index in [adrs/README.md](adrs/README.md) current.

## Fixtures (required)

When you add or change a **user-facing feature**, exercise it end-to-end through the real CLI against the fixture corpus. A user-facing feature is a grader kind, an eval field, a CLI flag, or a report format. Cover every meaningfully distinct shape, not just the happy path.

The corpus is deliberately **not** all-passing, so the CI dogfood gate is meaningful:

- `test/fixtures/traces/` holds captured trace files (a real Claude Code session file and a legacy `claude -p` stream-json transcript). They are sanitized, with no secrets and shortened content.
- `test/fixtures/project/` is a fake project tree (`.claude/skills/`, `.claude/agents/`, `.claude/commands/`, `CLAUDE.md`, `AGENTS.md`, plus a `tracevals/` check script). Its artifacts declare evals engineered so at least one deterministic eval **fails** against the fixture trace. Between them the artifacts cover every distinct block shape. Those are object entries, the string shorthand, and the single-string block. They also cover `metadata.eval-skip` (on the plugin skill in `test/fixtures/home/`) and the `ai` / `human` / `command` / deterministic grader families.

CI runs the built CLI against this corpus and asserts specific outcomes. A fixture change that flips one of them must update `.github/workflows/ci.yml` in the same commit.

## Commit messages (required)

All commits follow [Conventional Commits](https://www.conventionalcommits.org/). Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Breaking changes: `!` after type/scope or a `BREAKING CHANGE:` footer.

**Squash-merge hazard:** a squash commit body inherits every squashed sub-commit message. If one of them is a semantic-release `chore(release): … [skip ci]`, the merge commit carries `[skip ci]`. The release workflow then silently does not run, because GitHub honors that marker anywhere in the message. Check the squash body before merging a branch that produced prereleases.

## How version selection works

Versions and releases are automated by **semantic-release** ([.releaserc.json](.releaserc.json)):

| Commit type | Version bump |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` / `BREAKING CHANGE:` | major |
| `chore:`, `docs:`, `ci:`, `style:`, `test:`, `refactor:`, `build:`, `perf:` | no release |

Only the **first line** is parsed as the header.

## Release channels

| Branch | npm dist-tag |
|---|---|
| `main` | `latest` |
| `next` | `next` |
| `feat/**` | per-branch prerelease channel (branch suffix slugified) |

**The package name and the `bin` name are both plain `moose-tracevals`, unscoped.** That is the point of the rename. The project was `@hawkeyexl/agentevals` because the unscoped `agentevals` on npm belongs to an unrelated project (LangChain's). That made `npx agentevals` a cold-start footgun, because `npx` resolves by *package* name and fetched theirs. `moose-tracevals` was free, so we own the name the CLI actually answers to, and `npx moose-tracevals` resolves here with or without a local install. See [ADR 01008](adrs/01008-rename-the-project-to-moose-tracevals.md).

**Never reintroduce a scope/bin split.** [doc-detective.yml](.github/workflows/doc-detective.yml) still asserts the linked binary's version matches this package before running anything. A broken `npm link` therefore fails loudly instead of silently testing whatever else resolves.

**Publishing is no longer blocked by a dependency**, only by one-time setup: configure npm trusted publishing for `moose-tracevals` (OIDC, naming `release.yml`), then set the `RELEASE_ENABLED` repository variable.

## Don't

- Don't hand-edit `version` in `package.json`.
- Don't create git tags manually (`v*` is owned by semantic-release).
- Don't run `npm publish` locally.
- Don't use `--no-verify` to skip a failing hook. Fix the cause.
- Don't add commitizen, standard-version, release-please, or changesets. They conflict with semantic-release.
- Don't use `npm ci` (see "Environment setup").
- Don't re-fork the eval vocabulary. `docmeta:artifact-evals` is **docmeta's**. `schemas/artifact-evals-1.0.0-proposal.1.json` is a byte-identical vendored copy of docmeta's draft, keeping docmeta's `$id`. Behavior (graders, the runtime, the reports) is ours; the shape is not. A change to the shape belongs upstream in docmeta, and the local copy is then re-synced. This reverses the older "schemas are published by the tool that owns them" rule. See [ADR 01010](adrs/01010-adopt-the-docmeta-artifact-evals-vocabulary.md).
- Don't add `@anthropic-ai/sdk` as a direct dependency. It arrives transitively through `@hawkeyexl/inference`'s provider layer.
- Don't reimplement provider construction, ensemble/consensus math, response caching, or token pricing here. That all lives in `@hawkeyexl/inference`. Three copies of it drifted apart once already; a fix belongs upstream.

## Testing behavior

**Keep transient files inside the worktree, never in system temp directories.** Put scratch output under `.tmp/` at the repo root (gitignored).

Tests that shell out are time-intensive, so save output once and read the file:

```bash
mkdir -p .tmp && npm test > .tmp/output.txt 2>&1
```

**Absolute POSIX paths break the Windows leg of CI.** Under Git Bash on `windows-latest`, `/tmp/x` resolves to the shell's POSIX root while `node.exe` resolves the same literal against the current drive. Use relative paths in any workflow step that both a shell and Node touch.

## Commands

- `npm test` runs vitest (unit + integration; no network, no API keys)
- `MOOSE_TRACEVALS_LIVE=1 npm test` adds the live smoke test (real judge provider)
- `npm run typecheck` / `npm run build`
- `node dist/cli.js run test/fixtures/traces/claude-session.jsonl --project test/fixtures/project --deterministic-only` is the dogfood run against the fixture corpus
- `node dist/cli.js fill test/fixtures/project --provider mock --dry-run` dogfoods the authoring path. **Always `--dry-run` against the fixtures**; CI asserts `git diff --quiet` on the corpus.
- `echo '{"session_id":"x","cwd":"test/fixtures/project"}' | node dist/cli.js capture --out .tmp/m.json` dogfoods the capture path. **Always `--out` somewhere under `.tmp/`**: a manifest written into `test/fixtures/project` would silence the staleness assertions the CI dogfood step depends on.
- `npm run docs:validate` dogfoods `docmeta` against the docs' own frontmatter (gates the Pages deploy)
- `npm run docs:check-strategy` checks anchor integrity, orphans, CUJ route resolution, and link resolution across `docs/content_strategy/` and the pages
- `npm run docs:build` / `npm run docs:dev` builds or serves the Starlight site (`docs/` is a nested npm project; run `npm install` inside it once)
- `npx doc-detective` runs the inline tests embedded in the docs pages. Needs a built `dist/` and the `moose-tracevals` bin on PATH.
- `vale sync && vale .` lints every document against the house voice. `sync` fetches `.vale/styles/`, which is gitignored rather than committed.

## Prose and the house voice (required)

Every document in this repository is held to the Moose voice package (`Voices` + `Direct`), and [vale.yml](.github/workflows/vale.yml) **blocks** on an error. The corpus is at zero, so the first alert you see is your own. Run `vale .` before you push prose.

- Four rules bite most often. No em dash (`—`) or ` -- `. No sentence over 25 words. No banned or inflated word (`harness`, `leverage`, `utilize`, `robust`, …). No `Something specific: lowercase clause` opener at the start of a line.
- **Split the sentence rather than swapping the punctuation.** An em dash traded for a semicolon or a comma splice is the thing the rule exists to catch.
- Vale skips fenced code blocks and inline code spans. **Captured CLI output keeps its em dashes** because the reporters really emit them, and a sample rewritten for a linter is no longer a sample. The same applies to a verbatim quotation: put it in a code span rather than paraphrasing it.
- `test/fixtures/**` is the **one** voice exemption, and `.vale.ini` says why beside it. Fixture prose is test input whose bytes CI asserts on. Never exempt prose anyone wrote; fix it instead. (`.tmp/**` and `moose-tracevals-*.txt` are also excluded, because Vale does not read `.gitignore` and both hold generated output.)
- `Voices.ColonReveal` is a warning upstream, so it annotates without failing. Do not re-grade a rule's severity here. That belongs in [moose-vale](https://github.com/hawkeyexl/moose-vale).

See [ADR 01033](adrs/01033-work-the-prose-corpus-to-zero-and-make-the-vale-gate-blocking.md).

## Docs & content strategy

The audience, persona, journey (CUJ), and IA definitions for the documentation site live in `docs/content_strategy/` (internal; never built into the site). **Read the relevant file on demand. Do not inline it here.**

- `docs/content_strategy/README.md` is the index, the ID-linking model, and the evidence limitation (start here)
- `docs/content_strategy/audiences/` holds the target segments (`aud-*`)
- `docs/content_strategy/personas/` holds one minimal persona per audience (`persona-*`)
- `docs/content_strategy/journeys/` holds the critical user journeys (`cuj-*`), with steps mapped to real routes
- `docs/content_strategy/information_architecture/` holds the CUJ-driven IA and the gap analysis

Before drafting or editing any page under `docs/src/content/docs/**`:

1. Identify the **persona**: Priya (artifact author), Devin (platform/CI), Sam (eval standard owner), Theo (session triager), or Rin (toolsmith).
2. Find the matching **CUJ** and structure the content around reaching that outcome, **not** by document type. Do not impose a Diátaxis split as the organizing principle.
3. Link into the **Reference shelf** for exhaustive detail. Journey pages explain the path; they do not duplicate reference tables.
4. Record any new page in `information_architecture/proposed-ia.md` and drop its row from `ia-gap-analysis.md`.
5. Every page needs `title` and `description` frontmatter. CI blocks the deploy otherwise.
6. **Capture sample output; never compose it.** Build once and run the CLI against `test/fixtures/`. Every documented command must run offline (`--deterministic-only` or `--provider mock`) and should carry a Doc Detective inline test.

## Architecture

The pipeline runs **select trace → parse (adapter) → resolve artifacts → extract evals → plan evals → deterministic graders → AI judge → aggregate → report (+ history)**.

- `src/trace/` holds trace adapters behind a normalized `Trace` model. `claude.ts` parses both Claude Code session files (`~/.claude/projects/<slug>/*.jsonl`) and legacy `claude -p` stream-json. `discover.ts` scans the session store (`MOOSE_TRACEVALS_HOME` overrides the home dir for tests). The `TraceSource` union is the seam for future adapters (Codex is deferred, not rejected; see ADR 01003).
- `src/artifacts/` resolves every skill, agent, slash-command, and project-rule artifact the trace used, deterministically. `Skill` tool calls resolve to `SKILL.md`, and `Agent` spawns (`subagent_type`) to agent definitions. `CLAUDE.md` and `AGENTS.md` are read at the trace cwd, in `.claude/`, and in parent dirs up to the git root. A `<command-name>` injection is a **slash command**. It resolves to `.claude/commands/*.md`, then to a `SKILL.md` (a skill typed in its slash form), then to a built-in. It is never reported as a missing skill, and never with a roster state (ADR 01023). Unresolved refs go to the report's coverage table, never crash the run.
- `src/evals/` reads the `metadata.evals` block from artifacts through docmeta `extractFrontmatter`. It validates the **whole front matter** against the vendored `schemas/artifact-evals-1.0.0-proposal.1.json`. The schema is document-rooted, and `metadata` stays open so other tools' members pass untouched. The schema cannot reject unknown members of an open bag, so `extract.ts` reserves the `eval` prefix at run time. An unrecognized `metadata.eval*` key is an error, not an inert typo. Artifacts without declared evals get one implicit whole-artifact adherence eval (ADR 01002).
- `src/graders/` is the deterministic `TraceGrader` registry: `tool-usage`, `skill-invoked`, `file-access`, `turn-count`, `cost`, `regex`, `json-output`. Each implements `validateOptions()` so options are ground-checked without a trace (ADR 01004). `util.ts` also owns `windowFor()`, the slice of the trace an artifact governed (ADR 01015); every grader that counts events reads the window, not the trace. `plugins.ts` imports the modules named by `tracevals.plugins` and `--require` before planning, so a consumer's `registerGrader` lands in time. Specifiers resolve against the **config file's** directory, and `--require` **appends** to the config list. A specifier that will not import is a `TracevalsError`, never a skip (ADR 01017).
- `src/fill/` and `src/commands/fill.ts` do the authoring. They propose evals for artifacts found by `src/artifacts/discover.ts` (the static inverse of `resolve.ts`). Each proposal passes a gate of grader allowlist → option validation → target grounding → confidence. Survivors are appended through `src/evals/write.ts`, along with a `metadata.eval-provenance` entry naming the model and its per-eval confidence. Project rules are proposed but never written (ADR 01005).
- `src/capture/` and `src/commands/capture.ts` build session manifests. `capture` reads a Claude Code `SessionStart` hook payload on **stdin**. It writes sha256 of every instruction artifact plus the git SHA to `.moose-tracevals/sessions/<id>.json`. `run` reads one back, so staleness is content identity rather than the mtime guess (ADR 01024). The split into `types.ts` (shared), `manifest.ts` (consume) and `build.ts` (produce) exists because `artifacts/resolve.ts` consumes a manifest while `artifacts/discover.ts` produces one. One module would be an import cycle.
- `src/judge/` is the trace-adherence LLM judge, built on `@hawkeyexl/inference` (`makeProvider`, `runEnsemble`, `computeConsensus`, `zoneFor`, `JsonCache`). What stays local is what is moose-tracevals-specific. That is the prompts, the trace-worded verdict schema, the cache-key composition, the per-plan cost budget, and the `JudgedEval` shape. It runs an N-run ensemble at temperature 0, over a content-addressed cache under `.moose-tracevals/cache`. `provider.ts` maps the config's provider section onto the library's `ProviderSpec` (ADR 01006).
- `src/core/engine.ts` is the orchestration; the judge and graders are injected so the engine tests offline.
- `src/reporters/` holds human / json / markdown, each with an artifact-coverage section.

## Invariants

- Errored judge runs count against consensus. They may push an eval to human-review, never to a silent pass.
- An eval grades the **window** its artifact governed, derived from the artifact type and never declared. A skill's window runs from its invocation to the next skill's. An agent's window is its own branch, and project rules take the whole session (ADR 01015). An **empty** window is `skipped` with a stated reason, for deterministic, `ai`, and `human` graders alike. A window is empty when a skill was never invoked, or an agent recorded no turns. Never a pass. `cost` and `json-output` are session-level by nature and stay unwindowed.
- Deterministic evals fail only on `error`-severity findings; warnings and info report but pass.
- Exit codes: `0` pass, `1` any fail/error, `2` operational (`TracevalsError`).
- Bump `PROMPT_VERSION` (`src/judge/prompt.ts`) whenever judge prompts change, and `FILL_PROMPT_VERSION` (`src/fill/prompt.ts`) whenever the fill prompt or proposal schema changes. Both are cache-key components, and a stale cache silently replays old output.
- Evaluation is **read-only**: `run` never mutates trace files or the artifacts it evaluates. `fill` is the one write path. It is an explicitly-invoked authoring command that `run` never calls, appends only, and never writes project rules (ADR 01005). `capture` is the second, on the same terms: explicitly invoked, never called by `run`, and it writes only its own manifest (ADR 01024). Trace files are never written by anything.
- Artifact resolution is deterministic, from trace content plus filesystem lookup, with no LLM guessing. Unresolved or absent artifacts degrade to warnings and coverage notes, never a crash; zero artifacts → skipped evals, exit 0.
- `schemas/artifact-evals-1.0.0-proposal.1.json` is a **vendored copy**, not ours to edit: keep it byte-identical to docmeta's draft, `$id` included, and re-sync rather than patch. `test/unit/schema.test.ts` is a case-for-case port of docmeta's own ladder, so drift fails there. The `-proposal.N` suffix is a semver **prerelease** and the hyphen is load-bearing. A `+proposal.1` suffix would be build metadata, and would compare *equal* to the 1.0.0 release.
- The grader vocabulary is an **open enum**, so any kebab name validates and the registry is the authority that rejects one. Adding a grader therefore never needs a schema version. The accepted cost is that a stale name (`llm`, the pre-1.0 spelling of `ai`) passes the schema and fails at the registry instead.
- `command`-graded evals **execute a program named in an artifact**, on by default (ADR 01011). argv is spawned with `shell: false`, and `timeout-ms` always has a finite default. A command that cannot run, times out, or whose `generated-assertion-hash` no longer matches its assertion is an `error`, never a pass.

## Config ↔ CLI flags (required pattern)

Every user-facing knob flows through the resolved config. CLI flags do **not** bypass it. They override it.

```text
moose.config.yaml  →  `tracevals:` section  →  Ajv validate (src/core/config-schema.json)  →  defaults applied  →  CLI override  →  runtime
```

**One file, many tools.** Settings live under a `tracevals:` key in `moose.config.yaml`, shared with the rest of the moose family (ADR 01009). Top-level keys beside `tracevals:` belong to other tools. Never validate or touch them. `config-schema.json` describes the **section**, not the file, and `parseConfig()` takes the section object.

- `parseConfig()` in `src/core/config.ts` validates and fills **every** default; downstream code receives a fully-populated config.
- `loadConfig()` owns the file. It unwraps `tracevals:` and tolerates sibling sections. It errors rather than silently defaulting when a config is un-nested, miscased (`Tracevals:`), unreadable, or left in the pre-centralization `moose-tracevals.config.yaml`.
- CLI options are overlaid at the read site with `??` (e.g. `options.runs ?? config.judge.ensembleRuns`).
- Runtime code never reads `argv`.

To add a knob, write the schema first (+ positive and negative config tests) → default in `parseConfig()` → CLI flag in `src/cli.ts` → override with `??` → read the resolved value.

## Enforcement

| Convention | Enforced by |
|---|---|
| Build, tests, typecheck, dogfood run | [ci.yml](.github/workflows/ci.yml) on ubuntu + windows |
| Commit messages | husky [`commit-msg`](.husky/commit-msg) hook locally, [commitlint.yml](.github/workflows/commitlint.yml) on PRs |
| Version selection / release channels | [.releaserc.json](.releaserc.json) + [release.yml](.github/workflows/release.yml) |
| ADRs | [adrs/](adrs), by convention and template; not machine-enforced |
| Docs frontmatter (`title` + `description`) | [docs.yml](.github/workflows/docs.yml), which dogfoods `docmeta`; gates the Pages deploy |
| Docs ↔ CLI agreement | [doc-detective.yml](.github/workflows/doc-detective.yml), which runs every documented command against the local build over `test/fixtures/` |
| Content-strategy anchors, orphans, routes, links | [docs.yml](.github/workflows/docs.yml) via `npm run docs:check-strategy` ([scripts/check-content-strategy.mjs](scripts/check-content-strategy.mjs)) |
| House voice in every document | [vale.yml](.github/workflows/vale.yml), reading the whole tree on every PR; errors block, warnings annotate |
| Automated review | [claude-pr-review.yml](.github/workflows/claude-pr-review.yml), [claude.yml](.github/workflows/claude.yml) |

The husky hook installs through the `prepare` script on `npm install`. If commits stop being linted, check `git config core.hooksPath`. It should be `.husky/_`. Run `npx husky` to reinstall.

### Still requiring one-time setup

- **Claude review** workflows skip with a notice until `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo hawkeyexl/moose-tracevals`. Note that `claude-code-action` refuses to run when the workflow file differs from the default branch's copy (anti-tampering). A green check is therefore not proof a review ran, so check the duration.
- **Releases** are opt-in via `gh variable set RELEASE_ENABLED --body true`. Configure npm trusted publishing for `moose-tracevals` (OIDC, naming `release.yml`) before enabling.
- **The docs site** needs GitHub Pages set to "GitHub Actions" as its source (Settings → Pages) before [docs.yml](.github/workflows/docs.yml)'s deploy job can publish. Until then the validate and build jobs still run and still gate, and only the deploy step fails.
