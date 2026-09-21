# 0048: the `docevals` domain: evals join the family

- **Status:** Proposed
- **Serves:** Devin · D9, D10 · Sara · S7–S10 · Maya · M10–M14 · Theo · T5
- **Depends on:** [0033](0033-manni-monorepo.md), the umbrella this domain
  mounts on and the import recipe it follows. [0034](0034-command-grammar.md),
  the grammar: spelled verbs, no default subcommand, one separator per list.
  [0041](0041-collections.md), which names docevals as the next reader of
  `collections:`. [0046](0046-provenance-pins.md), the records the
  self-preference check reads and `fill` writes. [0023](0023-metadata-vocabularies.md),
  whose evals draft is the page vocabulary
- **Relates to:** [0035](0035-a11y-domain.md) and
  [0044](0044-citations-and-drift.md), the two domains folded in before this
  one, whose choices this one copies. [0045](0045-family-encryption-key.md),
  the family-key precedent for a shared concept defined once under
  `src/shared/`
- **Supersedes:** docevals [ADR 01003](docevals/01003-cuj-first-docs-site-and-content-strategy.md),
  the co-located content strategy. Its Status line is the only edit
- **Supersedes, in part:** docevals [ADR 01010](docevals/01010-kebab-case-is-the-file-vocabulary.md),
  for the keys of the `docevals:` section only. Eval, criterion and suite
  entries and grader options stay kebab-case as it decided. docevals
  [ADR 01008](docevals/01008-rename-to-moose-docevals-and-share-one-family-config.md),
  for its migration error on a `docevals.config.yaml`, which is gone. Neither
  ADR is edited. [0017](0017-fill-egress-and-bounds.md) § 3, for `--local`
  refusing a configured hosted provider. It now overrides one, in both tools.
  Its `llama-cpp`-only meaning stands. Its Status line is the only edit
- **Touches:** `src/docevals/**` (new), `src/cli.ts`, `src/index.ts`,
  `src/shared/{providers,config-file,warn}.ts`, `src/meta/core/meta-provenance.ts`
  (lifted from `src/meta/commands/fill.ts`), `src/meta/commands/fill.ts`,
  `src/meta/cli.ts`, `src/meta/internal.ts`,
  `package.json`, `package-lock.json`, `manni.config.yaml`,
  `scripts/check-cli-reference.mjs`, `test/docevals/**`,
  `docs/src/content/docs/docevals/**` (new), `docs/src/content/docs/meta/**`,
  `docs/manni.docevals.yaml`, `README.md`, `SECURITY.md`,
  `docs/content-strategy/{personas,audiences,cujs,information-architecture}.md`,
  `docs/proposals/docevals/**` (new), `docs/proposals/0017-fill-egress-and-bounds.md`,
  `docs/astro.config.mjs`
- **Verdict:** Fold moose-docevals in as `manni docevals`, eight spelled verbs
  and no default. Make it speak the family's values rather than its own. That
  means `collections:`, the severity scale and the format names. It means
  camelCase section keys, and one top-level `providers:` map that `meta fill`
  reads too. `--local` overrides a configured provider in both tools. And it
  means the 0023 draft itself and 0046's records.
  Its content strategy joins the family's files. Its ADR log closes at 01045,
  and later docevals decisions go in this series.

## Problem

moose-docevals runs deterministic and LLM-judged evals against documentation
pages. It lived in its own repository
([hawkeyexl/moose-docevals](https://github.com/hawkeyexl/moose-docevals)) and
was never published to npm. Anyone who wanted a model to grade a page in CI
cloned it and ran it from source. The family package that the same team
installs for `meta`, `cite` and `a11y` had no `docevals`.

0033 said each sibling tool folds in on its own branch. `tool/docevals` did
that at 670e62b, and the branch then sat while main moved. Main picked up
collections, the family key, one severity scale, per-domain docs checks,
derive, provenance pins and the 2.x releases. The tool as imported disagreed with
the family on most shared concepts. It had its own document set
(`docevals.files`), its own lowest severity (`info`), its own report name
(`human`) and kebab-case settings. It pinned model IDs. It kept a copy of a
draft schema, its own content strategy and its own ADR rule. Each of those is
a second spelling of something the family already defines once.

The evidence is the branch history, `git log --oneline origin/main..HEAD` on
`tool/docevals` over 2.1.0. The import is f4f00b3. The decisions below are
the commits that followed it, and the sections name them.

## Decision

### The domain

`manni docevals` has eight verbs: `list`, `run`, `generate`, `fill`,
`promote`, `calibrate`, `init` and `review`. There is no default subcommand
(0034). `manni docevals` alone prints help and exits 2, as `manni a11y` does.
`src/docevals/cli.ts` exports `buildProgram()` and is mounted with
`addCommand`. `DocevalsError` extends `ToolError`. The programmatic surface is
a `docevals` namespace on `@hawkeyexl/manni` (e3fdfac). It is a namespace
rather than a flat merge, so `loadConfig` and `parseConfig` do not collide with
meta's.

### 1. Document sets come from `collections:`

0041 moved the document set to the family-level `collections:` list and
named docevals as the tool that would read it next. docevals reads it the way
meta and cite do, and `docevals.files` is gone (c178de1).

`list`, `run`, `generate`, `fill` and `promote` take the same document
surface:

- `[paths...]`: files, directories and globs, relative to the working
  directory.
- `--collection <name>`: repeatable, one value per occurrence.
- `--exclude <glob>`: repeatable, one value per occurrence.
- `--no-config`.

With no paths, a verb reads the selected collections. Each collection's
`paths:` resolve from the config file's directory, narrowed by its own
`exclude:`. `node_modules` and `.git` are never read.

The refusals are meta's and cite's sentences, all exit 2:

| When | stderr |
|---|---|
| `docevals.files` present | `manni: manni.config.yaml: "files" is no longer a docevals key. Document sets are declared once for every tool, under a top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections` |
| `--collection` beside paths | `manni: --collection selects a configured collection; it cannot be combined with paths.` |
| `--collection` with no config | `manni: --collection needs a config file to select from.` |
| an undeclared collection | `manni: no collection named "nope" in manni.config.yaml. Configured: guides, blog.` |
| no paths and no collections | ``manni: No files to evaluate. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.`` |

The last sentence names the verb: `to list`, `to fill` and `to read` for
`list`, `fill`, and `generate` and `promote`. `docevals.files` is refused by
name rather than reported as an unknown key. A config written for the
imported tool had it, and the message says where the setting went.

The old default, `files.include: **/*.{md,mdx}`, evaluated everything beneath
the working directory with no config at all. 0041's stress test 6 recorded
that docevals would lose it. A run with no inputs is exit 2 (0014).

### 2. The family's values

Every value here is one another domain already has. docevals takes the
family's and drops its own (d1c5103, fa246c6, 4d56c1b, 3f8cf54, 11de1d6).

- **Severity** is `notice | warning | error`, from `src/shared/severity.ts`.
  `info` is gone and is an ordinary schema error. Vale's `suggestion` maps to
  `notice`. SARIF writes `notice` as `note`, and GitHub as `::notice`.
- **Formats.** `-f pretty` is the default on `list`, `run` and `fill`.
  `human` is an unknown format, exit 2. `run` accepts `pretty`, `json`,
  `markdown`, `github`, `sarif`, `junit` and `html`, and its help lists all
  seven from the list the parser validates against.
- **Section keys are camelCase**, as meta's and cite's are:
  `defaults.failFast`, `judge.ensembleRuns`, `judge.zones.autoPass`,
  `scripts.timeoutMs`, `fill.confidenceThreshold`. The `version` key is gone.
  A kebab-case section key is an unknown key, and names its counterpart:
  `/docevals/judge: unknown key "ensemble-runs"; did you mean "ensembleRuns"?`
- **Entries keep the vocabulary's spelling.** Eval, criterion and suite
  entries stay kebab-case, and so do grader options, as in
  `target-pass-rate` and `severity-map`. They are the same entries a page
  carries in its frontmatter, and `use:` makes a page entry and a config
  entry interchangeable. ADR 01010 was written to prevent one field with two
  spellings, camel in config and kebab on the page. That half of it stands.
  The other half made the section's own settings kebab-case. It does not
  stand. Those settings are nobody's vocabulary but the tool's, and every
  sibling spells its settings in camelCase.
- **stderr** goes through the shared layer. Usage and operational errors leave
  through `fail()` from `src/shared/run.ts`, exit 2. Warnings go through
  `warn()`, said once, with the `programName()` prefix. A caught value's text
  comes from `errorMessage()`. The hand-spelled `manni docevals:` prefix, which
  named no bin, is gone.
- **Parser refusals exit 2.** Commander exits 1 on a parse error, and the
  docevals program never overrode it. So `manni docevals list --since main`
  exited 1, the code for a failed eval. The program now installs the same
  `exitOverride` and help pointer as meta, cite, key and a11y:
  `error: unknown option '--since'` then `(add --help for usage)`, exit 2.
- **The environment variable** a command grader reads is
  `MANNI_DOCEVALS_FILE`. `MOOSE_DOCEVALS_FILE` is not set. The script
  generation prompt says the new name, so `SCRIPTGEN_VERSION` is 2.

### 3. Providers are declared once, for every tool

The imported config had `provider.default: anthropic` and a pinned `model:`
per provider. `claude-sonnet-4-5` was already stale. A default that names a
vendor fails for everyone without that vendor's key.

The selection code moved from `src/meta/commands/fill.ts` to
`src/shared/providers.ts` (4bb9760), and docevals calls it (12ab20c). The
caller passes its own error class and the config key its user writes, so
meta's messages are unchanged and docevals's messages name
`docevals.provider`.

**The settings are a family key** (f78b8fb). On this branch they were first
`docevals.providers`, a map under the tool's own section. But `meta fill`
sends content to a model too, and it read no connection settings at all. A
second map under `meta.fill` would declare one gateway twice. `collections:`
(0041) and `encryptionKey:` (0045) set the pattern for a concept every tool
shares. That is one top-level key, parsed once in `src/shared/config-file.ts`.
`providers:` is the third such key.

```yaml
providers:              # top level, beside collections:; read by meta fill and docevals
  provider: auto        # auto | anthropic | openai | claude-cli | llama-cpp; default auto
  model: <id>           # optional; needs a named provider; manni sets no default
  anthropic:  { apiKeyEnv: ANTHROPIC_API_KEY }
  openai:     { baseUrl: https://api.openai.com/v1, apiKeyEnv: OPENAI_API_KEY }
  claude-cli: { command: claude }
  llama-cpp:  { modelsDir: .models, thoughtTokens: 0 }   # modelsDir resolves from the config file

docevals:
  provider: <name>      # optional; wins over providers.provider for docevals
  model: <id>

meta:
  fill:
    provider: <name>    # optional; wins over providers.provider for meta fill
    model: <id>
```

- `auto` detects exactly as `meta fill` does: an Anthropic key, then an OpenAI
  key, then the Claude CLI, then a local model.
- `model` has no manni default. The inference library picks the provider's
  own, and the cache key names the resolved model, so a changed library
  default changes the key.
- **Precedence** runs from `--local` to `--provider`, then to the eval's own
  `provider:` (docevals only). Then come `docevals.provider` or
  `meta.fill.provider`, then `providers.provider`, then `auto`.
- **A model goes only to the provider its own level names.** A `--provider`
  that differs from the provider beside a configured model does not inherit
  that model, which the winner could not run. A level naming no provider lends
  its model to the provider in force. `--model` applies to whichever provider
  wins.
- **Connection settings always come from the family map**, whichever level
  chose the provider. Under `auto`, a configured `baseUrl`, `command` and
  llama-cpp section reach detection. `meta fill` honours them now, which it
  never did before.
- **A file holding only `providers:` is config** for every tool, as a file
  holding only `collections:` is.
- An unknown provider and a model under `auto` are meta's refusals, exit 2:
  `Unknown provider "x". Available: …` and
  `Model "x" was given without a provider: … Set --provider or docevals.provider to one of …`.
  `providers.model` without `providers.provider` is refused in the same words,
  naming `providers.provider`.
- **`docevals.providers` is refused by name**, as `docevals.files` is in § 1,
  exit 2:
  `manni: manni.config.yaml: "providers" is no longer a docevals key. Provider settings are declared once for every tool, under a top-level providers: map. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#providers`
- **An eval's own choice fails that eval.** A per-eval provider that cannot be
  built gives that eval an error result. The run exits 1, and the rest of it
  still grades. The run's own selection is checked before any page is read.
  A refused selection exits 2 before anything runs. When the run's provider
  cannot be had, with no key and nothing detected, the run warns and grades
  the deterministic evals only. Under `--ai-only` that case exits 2 instead.
  The split is the one in 0035 § stress test 2. A seed that will not load is
  the run's input, and a crawled page that will not load is a finding.
- Under `--deterministic-only`, the provider is resolved only when a command
  eval needs a script generated. A deterministic run never probes the machine.

**`--local` overrides, in both tools** (77410ed). 0017 § 3 gave
`meta fill --local` refusal semantics. It refused a hosted provider wherever
one was named, config included. This branch first left docevals without the
flag, since `--provider llama-cpp` already outranks the eval and the config.
The family map breaks both positions. Once `providers.provider` names a hosted
provider for every tool, a refusing `--local` fails in every repository that
commits one. The job that must keep content in the building would have to
rewrite the config first. So `--local` now means `llama-cpp` over every level
that can name a provider.

- It is on `meta fill` and on docevals `run`, `generate`, `fill`, `promote`
  and `calibrate`. One implementation in `src/shared/providers.ts` serves both
  tools.
- A configured or eval-level choice is set aside, and each replaced choice is
  said once on stderr through `warn()`:
  `--local: using llama-cpp instead of "<name>" from <source>.` The source is
  `providers.provider`, `docevals.provider`, `fill.provider`, or
  `eval "<id>" in <file>`.
- A `--provider` other than `llama-cpp` or `auto` beside it is exit 2:
  `--local and --provider <x> contradict each other: --local runs inference on this machine with llama-cpp. Drop one of them.`
  A command line that contradicts itself is a usage error. A config the job
  did not write is not.
- `claude-cli` never qualifies, as 0017 § 3 decided. Its binary runs locally
  and its inference does not.
- A configured model applies only where its level named `llama-cpp`, and
  `--model` always applies.
- Detection never runs under `--local`. The old `--local cannot use …`
  refusals and the check after detection are gone.
- Under `--deterministic-only` nothing is judged, and `--local` says nothing.

This supersedes 0017 § 3 in part. Its `llama-cpp`-only meaning and its
`claude-cli` exclusion stand, and its refusal of a configured hosted provider
does not. 0017's Status line records that, and nothing else in it changes.
`--deterministic-only` is still the run that needs no provider at all.

### 4. No legacy config names

The import still read `moose.config.yaml` and `docevals.config.yaml` with a
warning, and its docs promised a migration error for the second (ADR 01008).
docevals has no pre-family file name now (3f8cf54). `docevals.config.yaml`
is not read, and nothing warns about it.

moose-docevals was never published. No config file outside its own repository
was ever written against those names. `CLAUDE.md` says not to add an alias to
soften a rename unless asked. An alias here would soften nothing, and it would
be a permanent second surface. cite and a11y read no pre-family name either.

### 5. Pages validate against the 0023 draft, and no copy ships

docevals shipped `schemas/docevals/frontmatter-1.0.0.json` and `1.1.0.json`,
with served copies under the site and two package exports. It validated pages
against 1.1.0 with the severity enum patched in memory. Those copies had
drifted from the draft twice, in the severity scale and in `eval-provenance`.

Pages now validate against `manni:evals:1.0.0-proposal.3`, imported from
`docs/proposals/0023/schemas/evals/` and bundled by tsup, so `dist` reads
nothing under `docs/` (dd18733). The copies, their exports and
`frontmatterSchemaPath` are gone. `docevals.frontmatterSchema` is the draft
object, and `FRONTMATTER_SCHEMA_ID` is its id.

0023's drafts are unregistered. A file under `schemas/` in this package is a
published, immutable URL (0009). Publishing a copy of a draft would freeze
a vocabulary that is still under review. The drafts carry no migration
promise, so dropping copies nobody installed breaks nothing. ADR 01045 is the
tool-level record of this decision, written in the log before it closed.

The cost is 01045's. A user who wants `manni meta validate` to check eval
declarations copies the draft into their repository. The citations
vocabulary's users do the same.

### 6. The self-preference check reads 0046's records

0046 dropped the page-level `generated-by` and `eval-provenance`. The
machines that wrote the body are in `provenance`, and machine-proposed fields
and evals are in `meta-provenance`. The check reads those and nothing else
(25859ab).

The content axis compares the judge's model with the record for what the
eval's `target` reads:

| `target` | Record compared |
|---|---|
| `body` (the default) | `provenance` |
| `frontmatter` | the `fields` of `meta-provenance` |
| `raw` | both |
| `{ source: file }` | none. A companion file carries its own record if it is a page |

The criterion axis is a `meta-provenance` entry for the judge that lists the
eval's id under `evals`. The judge proposed the assertion it now grades.
Content wins when both hold. Either is a warning, never a failure: bias skews a
verdict but does not stop one forming (ADR 01034).

The three warnings, each prefixed with the page path:

- `provenance names <model> for the body this eval grades, and it is also the judge. Self-judging favors the author; give "<eval>" a model: of its own.`
- `meta-provenance names <model> for the fields this eval grades, and it is also the judge. …`
- `meta-provenance says <model> proposed "<eval>", and it is also the judge. …`

Each is said once on stderr through `warn()`. The result's
`selfPreference: { axis, model }` keeps its shape, and the run's warning-level
problem carries the same sentence, so it reaches every reporter.

`fill` writes one `meta-provenance` entry per model, in the same edit as the
evals, with the ids under `evals` and each one's `confidence` (6b51b11). It
merges by `generated-by` through `mergeMetaProvenance`, lifted into
`src/meta/core/meta-provenance.ts` so both fill commands use one merge
(683d908). A second run, or a `meta fill` by the same model, extends one
entry. `eval-provenance` is not written. On a page, it is now the
reserved-prefix error, exit 1 from `run`. The pretty report prints the entry
under the page line, as `meta fill` does. The JSON carries `metaProvenance`
per page in meta's shape.

### 7. The content strategy is the family's

moose-docevals brought its own strategy directory under ADR 01003: six
audiences, six personas, twelve CUJs and a proposed IA. The family keeps one
set of flat files, and a tool that joins brings no directory of its own
(41f205e).

- **No new persona.** Devin, Sara and Theo were already the family's personas
  by name. Their docevals needs are short additions to their entries. Priya,
  Nate and Iris are Maya as a platform lead, as a solo owner and as a
  retrofitter, so they fold into Maya. a11y added no persona either (0035).
- **CUJs.** The twelve journeys are M10–M14, D9–D10, S7–S10 and T5 in
  `docs/content-strategy/cujs.md`.
- **IA.** `information-architecture.md` gains the `docevals/` content set, with
  each page's CUJs and launch status.
- **The six audiences** map onto the four in `audiences.md`.

This supersedes ADR 01003's co-located strategy. Its CUJ-first structure
survives, because the family's strategy was already CUJ-first. What goes is
the second location. ADR 01003's Status line is marked superseded and nothing
else in it changes. `ia-gap-analysis.md`, a delivery record rather than
strategy, moved beside the ADRs.

### 8. The imported ADR log closes at 01045

`docs/proposals/docevals/` stays as the record, cited by SHA in the import
commit. The supersede-never-amend rule still applies to its Status lines. No
new file is added to it.

Later docevals decisions go in this series, as `docs/proposals/NNNN-*.md`.
This proposal is the first. One tool with two logs would have two numbering
schemes and two formats, MADR there and this series' header block here. And a
decision that touches a shared concept would have no obvious home. This
series already records decisions for three domains and the family layer.
`src/docevals/CLAUDE.md` says so in place of its ADR-per-behavior-change rule,
and the log's README carries a closing note.

## Known limits

1. **A collection is read by every tool.** A bare `manni meta validate`
   reads every declared collection, and so does `manni cite check`. So this
   repository could not declare a `docevals-fixtures` collection: meta would
   validate the fixture pages against its default schemas, and 13 of them
   fail `google:okf:0.1`. The fixture corpus is named on the command line
   instead (`manni docevals run test/docevals/fixtures/pages`), and
   `manni.config.yaml` says why. Scoping which collections a tool reads by
   default is a question for a future proposal, not one this domain should
   answer for every tool.
2. **Registering the 0023 drafts is 0023's question.** Until the evals
   vocabulary is registered, no URL serves it, and a page cannot point
   `$schema` at it.
3. **Two `providers:` settings do not steer detection under `auto`.** The
   inference library looks only for `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
   A custom `apiKeyEnv` neither makes a provider detectable nor reaches the
   provider detection picks. And `llama-cpp` counts as usable when
   `node-llama-cpp` can start, whatever `modelsDir` holds. Both are the
   library's rules, and a fix belongs upstream. Naming the provider is the
   workaround, and the configuration reference says so.

## Stress test

### 1. Why not keep the imported ADR log open?

It would be the smaller change. But the log's own rule is one ADR per
behavior change. This series' rule is a proposal for a change bigger than a
commit message. A contributor with a docevals change touching `src/shared/`
would have to pick one, and a reviewer would have to look in both. The family
layer is where most remaining docevals decisions land, because the tool now
shares its config, its values and its records. Closing the log costs one
README note and keeps every existing ADR as written.

### 2. Why is `docevals.files` refused rather than migrated?

Because a migration would read two places for one set indefinitely. 0041
already refused `meta.sidecars` by name for the same reason. The message is the
migration. It names the replacement and links to it.

### 3. Why not keep kebab-case for the whole section, as ADR 01010 decided?

01010's argument is that a field means one thing wherever it is written. It
holds for eval entries, and they keep kebab-case. It does not hold for
`judge.ensembleRuns`, which no page carries. Against it stands the family
rule that a shared concept is spelled once. Every sibling section is
camelCase, and a user who writes `meta.fill.maxTurns` and
`docevals.fill.max-turns` in one file is the drift 01010 was trying to avoid.
The boundary is now the one a reader can see: an entry a page could carry is
kebab, and a setting is camel.

### 4. Why does `--local` override a configured provider rather than refuse it?

Because the refusal protected against the wrong author. 0017 feared a stray
key, or a config nobody checked, sending internal pages to a hosted provider.
Under `--local` detection never runs, so no stray key can choose anything. A
configured hosted provider is a choice the repository made for ordinary runs.
The person typing `--local` is making a narrower choice for this run, and the
narrower choice should win.

The refusal also had a cost that grew with the family map. A repository that
commits `providers.provider: anthropic` for every tool would make `--local`
exit 2 on every command that takes it. The one job that must keep content in
the building would need its own config file.

What stays a refusal is the contradiction on one command line.
`--local --provider openai` states two incompatible intents in one breath, and
guessing which one was meant is exactly what an egress control must not do.
The notice keeps the override visible, so a run never silently ignores what
the config says.

## Consequences

- `manni --help` lists `docevals`. `npm i -D @hawkeyexl/manni` is the install
  path for doc evals, and moose-docevals has none of its own.
- The site gains `docevals/`, drift-checked by `docs:check-cli`, with its own
  dogfood over the section through `docs/manni.docevals.yaml`
  (`npm run docs:check-docevals`).
- `package.json` records `node-llama-cpp` as an optional peer dependency.
- Nothing here was released, so no rename is breaking for anyone: `info`,
  `human`, the kebab section keys, `docevals.files`, `docevals.providers`,
  `MOOSE_DOCEVALS_FILE`, the schema copies and `eval-provenance` existed only
  on the unmerged branch.
- `meta fill` changes in two released behaviours, both additive. It reads
  connection settings from `providers:`, where it read none before. And
  `--local` beside a hosted `fill.provider` now runs locally with a notice,
  where it exited 2. A run that succeeded before behaves the same, and nothing
  that `--local` kept on the machine leaves it now.

## Release

The branch ships as `feat(docevals)` commits on top of 2.1.0, so
semantic-release cuts a minor. No commit on it is `feat!:`. This proposal
becomes `Implemented (#10)` when PR #10 merges.
