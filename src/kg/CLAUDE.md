# Claude Code Configuration

Repo-wide guidance for AI agents working on dockg. Conventions here are ported from
[doc-detective](https://github.com/doc-detective/doc-detective)'s repo guidance, adapted to this
codebase.

## Environment setup (required)

**Rebase onto `main` before doing anything else.** In a fresh worktree or stale checkout:

```bash
git fetch origin
git rebase origin/main
```

**Install dependencies.** dockg consumes [docmeta](https://www.npmjs.com/package/docmeta)
from the npm registry (`^1.3.0`), so a clean checkout needs nothing but:

```bash
npm install
```

CI runs `npm ci`, and so can you. This repo carried a "never `npm ci`, the lock is
platform-skewed" rule for a while. The theory was that a Windows-generated lock omits the
Linux-side optional dependencies of `@napi-rs/wasm-runtime` (rolldown's wasm binding).
**That was a misdiagnosis**, twice over:

- The lock records **all fourteen** `@rolldown/binding-*` packages, every Linux one included,
  each with its `os`/`cpu`, `resolved`, and `integrity`. Nothing platform-specific is missing.
- rolldown no longer ships a `wasm32-wasi` binding at all, so `@emnapi/core` and `@emnapi/runtime`
  are not reachable in this tree and cannot be dropped from anywhere.

The real variable was **npm's own version**, not the contributor's OS. docmeta recorded the same
finding after hitting this through the identical dependency path. npm ≤ 11.6.2 drops those
entries on Linux, macOS and Windows alike; 11.6.3 keeps them on all three.

That floor is enforced, not advisory. `engines.npm` is `>=11.6.3` and [.npmrc](.npmrc) sets
`engine-strict=true`. A too-old npm fails at install with `EBADENGINE` instead of quietly
writing a lockfile CI will reject. The reasoning is in
[ADR 01040](adrs/01040-the-npm-floor-and-the-return-to-npm-ci.md). Do not assume the Node floor
covers it. Node 24.11.0 satisfies `>=24` and bundles npm **11.6.1**. Above the floor, regenerate
the lock normally.

Still worth doing after any dependency change: **read the lockfile diff**. A change that adds
packages you cannot name, or removes any, is worth stopping for.

There is no sibling-checkout step. dockg depended on `file:../docmeta` while docmeta's
`extractFrontmatter` export was unreleased, and that dependency is gone. Never
reintroduce a `file:`/`link:` spec, since npm publishes them verbatim and
`prepublishOnly` (scripts/check-publishable.mjs) now refuses to.

Don't reach for `--no-verify` when a husky hook fails. Install the missing deps or fix the
message instead. It buys nothing anyway. CI re-runs every hook check, including commitlint
across the PR's commit range, so a bypassed hook becomes a failed PR.

## Persistent knowledge lives in repo instructions, not Claude memory (required)

Do **not** use Claude Code's auto-memory for dockg knowledge. When you learn something durable, be
it a gotcha, a decision, or a convention, record it **in the repo, in the same change**:

| Kind of knowledge | Home |
|---|---|
| Behavior decisions, contracts, trade-offs | [adrs/](adrs) (MADR, see below) |
| Repo-wide agent workflow rules | This file |
| User-facing behavior, config, commands | [docs/src/content/docs/](docs/src/content/docs) (the published site) |
| Who the docs serve, and why they are shaped this way | [docs/content_strategy/](docs/content_strategy) |
| Contributor mechanics | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Ephemeral working notes | `.tmp/` (gitignored), never committed |

## Invariants of this codebase (required reading)

- **Determinism is the product contract.** `dockg build` twice over unchanged inputs must be
  byte-identical. That means canonically sorted Turtle from the custom emitter
  (`src/core/emit.ts`) and no wall clock anywhere: dates come from frontmatter first, then git
  committer times, never `Date.now()`. It also means no blank nodes ever, since every node gets a
  deterministic IRI. IRIs are sanitized so output always parses.
  `test/fixtures/golden/graph.ttl` is the corpus golden and the regression gate. Update it only
  deliberately. Inspect the diff line by line first. Golden comparisons normalize the
  `dockg:version` literal. The corpus fixture pins `provenance.git: false`
  ([ADR 01010](adrs/01010-provenance-defaults-and-degradation.md)) so the golden captures
  derivation, not this repo's HEAD committer date. The temp-repo tests cover git-derived output
  instead.
- **Naming:** the *frontmatter key* is `kg:`; the *RDF namespace prefix* is `dockg:`
  (`https://hawkeyexl.github.io/dockg/ns#`, moved there by
  [ADR 01030](adrs/01030-the-dockg-vocabulary-document.md), which is where it resolves).
  Never conflate them. The custom namespace stays minimal, so prefer
  dcterms/skos/prov/schema.org/foaf terms wherever one exists.
- **The frontmatter schema is docmeta's; the shapes are dockg's.** docmeta publishes the common
  metadata vocabularies and dockg implements graph behavior against them
  ([ADR 01023](adrs/01023-adopt-docmetas-common-kg-vocabulary.md)). The `kg` block is
  `docmeta:kg`, shipped as **byte-verbatim vendored bytes** at
  `schemas/docmeta-kg-1.0.0-proposal.1.json`, `$id` and all. docmeta's proposal 0023 is
  under review and forbids registering the id until it concludes. Never edit those bytes or
  re-point the `$id` at `dockg.dev`. A sha256 pin in `test/unit/kg-vocabulary.test.ts` is what
  notices an upstream revision, and it only works on an exact copy. The SHACL shapes contract in
  [shapes/](shapes) stays self-hosted. Both ship in the npm package, and `dockg validate` /
  `dockg check` default to the bundled file by path.
- **Published schema and shapes files are immutable**; evolve by adding a new version file, and
  make the new file's version **three-segment** (`1.0.0`, not `0.9`). Two segments force a
  description-only fix to announce itself as a MINOR that adds fields it did not add. MAJOR = a
  document that used to validate now fails · MINOR = one that used to fail may now pass · PATCH =
  no validation-behavior change. The existing `frontmatter-0.N.json` / `dockg-0.N.ttl` files are
  published and stay as they are; the convention binds the next version file.
- **Exit codes:** `0` ok · `1` findings (validation failures, `check` violations, `stats --check`
  broken links, fill errors) · `2` operational error (`DockgError`). `cli.ts fail()` rethrows
  non-DockgError. SHACL severities map onto this: `sh:Violation` → 1, `sh:Warning`/`sh:Info` →
  reported but 0.
- **The inference layer is [`@hawkeyexl/inference`](https://github.com/hawkeyexl/inference), not
  local code** (ADR 01021). Providers, the response cache, the price table, and the
  schema-validated retry all live there. `src/llm/` keeps only what is dockg's own: the SKOS
  prompt and proposal schema (`prompt.ts`), the cache-key composition (`cache.ts`), and the
  config → `ProviderSpec` mapping (`provider.ts`). Never reimplement a provider here. Three
  copies of this code drifted apart once already; a fix belongs upstream.
- **No network in the default test suite.** `npm test` is hermetic. LLM code paths go through
  the library's `MockProvider`, re-exported from [src/index.ts](src/index.ts) for downstream
  use, and the exec seam is injectable for git/CLI subprocess tests. **A mock is not coverage
  of the thing it stands in for.** `createLocalEmbedder` shipped a hardcoded `device: "wasm"`
  that throws on every real Node call, and mocks certified it for a whole release
  ([ADR 01025](adrs/01025-embedder-cross-platform-reality.md)). Where a mock stands in for a
  third-party API, the real one must be exercised **somewhere**. `test/real/` holds those,
  excluded from `npm test` (`vitest.config.ts`). The `embed-real` and `fill-live` CI jobs run
  them (`test:real`, `test:real:cross`, `test:real:fill`). Adding a mock for an external library
  means adding the real-path test in the same change. Where that is impossible, name the
  exception in [ADR 01026](adrs/01026-exercise-every-third-party.md) with its reason.
  `vitest.config.ts` sets `INFERENCE_NO_AUTO_INSTALL`, because the inference library installs
  `node-llama-cpp` on demand. Without it, a test that reached the local provider by accident
  would download from the network.
- **A green run against a server that ignores the constraint proves nothing.** Ollama covers the
  `openai` provider for real, compiling `response_format: json_schema` to a GBNF grammar. But it
  accepts `tool_choice` and never reads it, which is the entire mechanism the `anthropic` provider
  depends on. That path stays an exception rather than gaining a test that would be green, hollow,
  and intermittently red ([ADR 01031](adrs/01031-exercising-the-llm-providers.md)).
- **LF everywhere.** [.gitattributes](.gitattributes) declares `* text=auto eol=lf`, so the
  object store and every working tree are LF on every platform regardless of a contributor's
  global `core.autocrlf`. Exemptions use `-text` and **must stay below** the `*` rule. The last
  matching line wins, so an override placed above it silently does nothing.
- `test/fixtures/corpus/docs/windows-notes.md` is CRLF **on purpose**, pinned by
  `.gitattributes`. Don't normalize it. (`-text` keeps its bytes verbatim, exempt from the LF
  rule above.)
- **No NUL bytes in source.** They make git classify a file as binary, which excludes it from
  LF normalization and renders its diffs unreviewable. For ordering, compare field by field with
  `byCodeUnit` ([src/core/sort.ts](src/core/sort.ts)) instead of joining fields with a separator.

## Branches and pull requests (required)

Changes land on `main` via a branch and a pull request, not direct pushes.
Branch names follow the release channels (`feat/**` gets its own npm
dist-tag; `fix/**`, `docs/**`, etc. for the rest). The PR body carries the
docs-impact statement and links any ADRs. CI must be green before merge.

## Development workflow (required)

Always **red → green** TDD. Write the failing test first and run it to confirm it fails for the
expected reason. Then write the minimum code, confirm green, and refactor. The verification loop
is:

```bash
npm run format:check && npm run lint && npm run typecheck && npm run build && npm test
```

**Build before test.** Integration tests execute `dist/cli.js`, not `src/`.

Enforcement is layered (see [adrs/01007](adrs/01007-quality-gate-enforcement.md)). `pre-commit`
runs lint-staged (Prettier + ESLint over the **staged** blobs) then `typecheck`, and `pre-push`
runs the full loop. CI re-runs everything plus commitlint across the PR's commit range. The CI copy is
authoritative, and hooks are advisory by construction.

Formatting is Prettier's job and linting is ESLint's; `eslint-config-prettier` keeps them from
arguing. Prettier **must never** touch `test/fixtures/` or `schemas/`. Both are byte-sensitive,
and `.prettierignore` encodes that. If you add a byte-exact fixture, add it there too.

## Architecture Decision Records (required)

Every **behavior change** ships with an ADR in [MADR](https://adr.github.io/madr/) format under
[adrs/](adrs), written before or alongside the code:

- **Format:** MADR 4.0.0, meaning YAML front matter (`status`, `date`, `decision-makers`) plus
  *Context and Problem Statement*, *Decision Drivers*, *Considered Options*, *Decision Outcome*
  (*Consequences*, *Confirmation*), *Pros and Cons of the Options*.
- **Filename:** `NNNNN-kebab-case-title.md`, 5-digit zero-padded, numbering **starts at `01000`**.
  `00001`–`00999` is reserved for backfilling pre-existing decisions.
- **Scope:** decisions (behavior, contracts, trade-offs), not mechanical changes. Refactors,
  dependency bumps, and doc/typo fixes don't need one.

## Feature coverage (required)

Unit tests are necessary but not sufficient. A **user-facing feature** (new derive source, config
key, CLI flag, output shape) also needs:

- **Corpus/fixture coverage of every meaningful permutation.** That is each value shape and each
  toggle state, including the off/no-op form. It also covers precedence between config and CLI,
  and the guard paths (missing git repo, unsupported frontmatter, broken targets).
- **The determinism gates:** double-build byte comparison, golden comparison (version-normalized),
  and an n3 parser round-trip of emitted Turtle.
- Integration tests live in `test/integration/` and run the built CLI against
  `test/fixtures/corpus/` or per-test `mkdtempSync` directories.
- **A contract ships with a ladder.** An executable ladder of *named* cases covers a schema or a
  shapes file. It carries positives and, just as importantly, negatives, each pinned to the reason
  it holds. (`test/unit/kg-vocabulary.test.ts` is the model; it is docmeta's own review ladder,
  ported case for case.) A negative that passes for the wrong reason is a silent hole, so assert
  *which* key the rejection names, not merely that one happened.

Changing the corpus fixture invalidates every byte-exact golden under `test/fixtures/golden/`.
That is `graph.ttl`, `graph.jsonld`, `metadata.rdf`, `traverse.json`, `localizations.json`, and one
`search.<lang>.json` plus one `vectors.<lang>.bin` **per language in the corpus** (ADR 01038). It
also invalidates the doc/triple counts asserted across `build`, `validate`, `query-stats` and
`runtime-sparql`. All are regenerable from the built CLI. `export --format search` writes the
indexes and the manifest into a directory. Then `dockg embed --model mock --no-cache` writes the
sidecars and fills in the manifest's `vectors` blocks, so the optional
`@huggingface/transformers` peer is not needed. Adding a *language* to the fixture therefore adds
two goldens, not one. Note `dockg stats --check` exits `1`
on this fixture by design: it carries a deliberate broken link and a broken section ref.

## Documentation impact (required)

Behavior change → answer explicitly: does this add, change, or remove something a user can see,
run, configure, or rely on? **If yes, the docs are part of the change's definition-of-done.** The
affected page under [docs/src/content/docs/](docs/src/content/docs), the `dockg init` starter
template, and command `--help` text all land in the same commit. If no (pure refactor,
internal-only), say so in the commit body. Rule of thumb: a change that warrants an ADR has docs
impact.

The README is a router, not a manual. It carries the hook, a five-line quickstart, and a table
of links into the site. Do not move reference material back into it.

### Writing or changing a page

Read [docs/content_strategy/README.md](docs/content_strategy/README.md) first. It is the entry
point, and these are pointers into it, not a summary of it.

1. **Name the persona.** [personas/_overview.md](docs/content_strategy/personas/_overview.md).
   A page that serves everyone serves no one.
2. **Find the CUJ.** [journeys/_overview.md](docs/content_strategy/journeys/_overview.md). The
   page exists to move that persona along that journey.
3. **Structure around the outcome, not the document type.** Do *not* impose a Diátaxis
   tutorial/how-to/explanation/reference split as the organizing principle. The nav is
   journey-voiced, and the Reference shelf supports navigation rather than driving it.
4. **Link into Reference; do not restate it.** Journey pages explain the path.
5. **Check the page's place and launch status** in
   [proposed-ia.md](docs/content_strategy/information_architecture/proposed-ia.md). Every page
   needs a CUJ. The three navigation-only pages named in the gap analysis are the exception.
6. **Every page needs `title` and `description`.** That is a machine-enforced deploy gate.
7. **Never hand-write command output.** Capture it by running the built binary against a
   committed fixture under [test/fixtures/](test/fixtures). Determinism means what you capture is
   what every reader sees, and a transcribed approximation is a claim nothing checks.

Three gates run in [docs.yml](.github/workflows/docs.yml) and all of them block:
`npm run docs:check-strategy` (anchor and coverage invariants), `npm run docs:check-cli`
(reference/cli.mdx vs commander), and `npm run docs:check-links` (every `/dockg/…` target
resolves). The docs workflow also builds a graph from the docs themselves and holds it to
`dockg check` and `dockg stats --check`.

Doc Detective is a **fourth gate with a narrower reach**. It lives in its own workflow
([doc-detective.yml](.github/workflows/doc-detective.yml)) because its steps execute shell from
the pull request's own content. So it is skipped on fork PRs, and a skipped job does not block.
Treat fork contributions as unverified for command output.

**Documented command output is executed, not trusted**
([ADR 01035](adrs/01035-executing-documented-command-output.md)). Some pages carry trailing
`{/* test … */}` / `{/* step … */}` blocks that run the built CLI against `test/fixtures/dd/` and
assert on its output. `npm run docs:test` prints how many, and that is the only place the count
belongs. Written here it goes stale the first time somebody adds a page, which has already
happened once. The run needs the build linked as `dockg` (`npm link && npm link
@hawkeyexl/dockg`). Three things about these blocks are load-bearing:

- **Output is asserted with `stdio`**, a single field matching stdout *or* stderr. `stdout` and
  `stderr` are not properties of the `runShell` schema, and a step using them is **dropped without
  failing the run**. That is how 22 of 33 steps once vanished from a green run.
- **`--exit-on-fail` is not optional.** The CLI exits 0 on a failing step without it.
- **`scripts/check-doc-tests.mjs` is the backstop**, and it fails on both halves. One is a step
  that declared but did not run, the other a step that ran but did not pass. `docs:test` runs it
  after the suite; never run the suite without it.

Fixtures for these tests live in `test/fixtures/dd/`, deliberately apart from
`test/fixtures/corpus/`, which feeds the six byte-exact goldens and must not gain files.

## SHACL shapes impact (required)

Behavior change → answer explicitly: does this change what the emitted graph contains or means
(new predicates, new node types, changed cardinalities)? **If yes, the SHACL shapes are part of
the change's definition-of-done.** Update [shapes/](shapes), adding a new version file when the
published contract must change, because shipped shapes are immutable. Keep the clean-corpus
`dockg check` gate green (`test/integration/check.test.ts`), and note the shapes impact in the
commit body. If no, say so in the commit body. The closed shapes (`sh:closed`) mean a new derive
predicate **will** fail `dockg check` until the shapes learn it. That failure is the feature.

## Commit messages (required)

[Conventional Commits](https://www.conventionalcommits.org/), enforced by the husky `commit-msg`
hook ([commitlint.config.cjs](commitlint.config.cjs)). Types from `@commitlint/config-conventional`.
Breaking changes: `!` after type/scope or a `BREAKING CHANGE:` footer.

**Subject must be lower-case.** The `subject-case` rule rejects `feat: PROV-O support`; write
`feat: prov-o support`.

## How version selection works

Releases are fully automated by **semantic-release** ([.releaserc.json](.releaserc.json)):

| Commit type | Version bump |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` / `BREAKING CHANGE:` | major |
| `chore:`, `docs:`, `ci:`, `style:`, `test:`, `refactor:`, `build:`, `perf:` | no release |

## Release channels

| Branch | npm dist-tag |
|---|---|
| `main` | `latest` |
| `next` | `next` |
| `feat/**` | `<slug>` (lowercased branch suffix) |

## Don't

- Don't hand-edit `version` in `package.json`; semantic-release owns it.
- Don't create `v*` git tags manually or run `npm publish` locally.
- Don't use `--no-verify` to skip the commit-msg hook.
- Don't add commitizen, standard-version, release-please, or changesets.
- Don't ever emit wall-clock time, blank nodes, or unsorted output from the emitter.
- Don't let Prettier near `test/fixtures/` or `schemas/`. They hold byte-exact baselines and
  immutable published schemas. Keep `.prettierignore` covering them.
- Don't disable an ESLint rule repo-wide to silence one call site; disable it inline, with the
  reason (see the post-Ajv boundary in [src/core/config.ts](src/core/config.ts)).
- Don't write dockg knowledge to Claude auto-memory; put it in this repo.

## Testing behavior

Keep transient files inside the worktree. Scratch output, saved command logs, and throwaway build
targets go under `.tmp/` at the repo root (gitignored), not `%TEMP%`/`/tmp`. (Per-test isolation
via `mkdtempSync(tmpdir(), ...)` inside tests is fine, since vitest cleans those paths' relevance
up with the run.) To inspect long output, save it once and read the file:

```bash
mkdir -p .tmp && npm test > .tmp/test-output.txt 2>&1
```

## Config keys ↔ CLI flags (required pattern)

Every user-facing knob lives in `dockg.config.yaml`, schema-first. Knobs that vary
per invocation (output paths, dry-run, cost caps, provider overrides) also get CLI
flags that override the resolved config. Corpus-defining settings (routes,
provenance, derive sources) may be config-only. Command cores read the merged
result, never raw argv. Adding a knob:

1. **Schema first:** add the field to [src/core/config-schema.json](src/core/config-schema.json)
   (`additionalProperties: false` everywhere, since unknown keys must fail loudly).
2. **Type + default:** extend `DockgConfig` and apply the code-side default in `parseConfig`
   ([src/core/config.ts](src/core/config.ts)) so the resolved shape is total.
3. **Commander option** in [src/cli.ts](src/cli.ts), thin `.action` delegating to the `runX` core.
4. **Override in the command core:** `opts.x ?? config.section.x` inside `src/commands/*.ts`.
5. **Red→green test per step:** config default + rejection test in `test/unit/config.test.ts`,
   behavior tests at the layer the knob affects.

Precedence: `dockg.config.yaml` → Ajv validation → CLI override → runtime.

## Automated review

Every non-draft PR is reviewed by
[.github/workflows/claude-pr-review.yml](.github/workflows/claude-pr-review.yml),
which posts a single cohesive GitHub review. Its prompt is scoped to the
invariants above, meaning determinism, IRI stability, golden regression, schema
immutability, and exit codes. So the highest-value findings are contract
violations, not style. Mentioning `@claude` on an issue, PR, or review comment
triggers [claude.yml](.github/workflows/claude.yml) for ad-hoc work. Both use
the repo's `CLAUDE_CODE_OAUTH_TOKEN` secret.

## Related files

- [.github/workflows/ci.yml](.github/workflows/ci.yml), the full loop and the determinism gate on
  ubuntu × macos × windows, then a `cross-platform` job that compares the emitted artifacts'
  digests *across* runners. Three per-OS golden checks prove three platforms each match one golden;
  the join is what proves they match each other
- [.github/workflows/docs.yml](.github/workflows/docs.yml), the strategy invariants, CLI drift,
  page frontmatter, the graph gate over dockg's own docs, then the Pages deploy
- [.github/workflows/vale.yml](.github/workflows/vale.yml), the prose gate. It is blocking and
  reads the whole corpus, not only a pull request's added lines
- [scripts/](scripts), holding `check-content-strategy.mjs`, `check-cli-reference.mjs`,
  `check-docs-links.mjs`, `check-publishable.mjs`
- [dockg.docs.yaml](dockg.docs.yaml), dockg pointed at its own documentation. Not named
  `dockg.config.yaml` deliberately: that filename is discovered implicitly and would apply to
  every bare invocation from the repo root, including the integration tests
- [.releaserc.json](.releaserc.json) · [commitlint.config.cjs](commitlint.config.cjs)
- [.husky/](.husky), holding `commit-msg` (commitlint), `pre-commit` (lint-staged + typecheck),
  `pre-push` (full loop)
- [eslint.config.js](eslint.config.js) · [.prettierrc.json](.prettierrc.json) ·
  [.prettierignore](.prettierignore) · [.npmrc](.npmrc) (`engine-strict`) ·
  [.gitattributes](.gitattributes) (LF policy)
- [schemas/](schemas), the published frontmatter JSON Schemas (the validate default)
