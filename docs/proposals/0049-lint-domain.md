# 0049: The `lint` domain: `manni lint check`, jobs, and the tools behind them

- **Status:** Proposed
- **Serves:** Three journeys, assigned the next free numbers on this branch.
  If [0048](0048-docevals-domain.md) lands first it takes ranges of its own and
  these three shift up by however many it claims; they are the numbers as
  written in `docs/content-strategy/cujs.md` here.
  - Maya · M9, "Hold every page to the shape its doctype promises". Her how-tos
    are supposed to carry prerequisites and numbered steps. Nothing checks that
    but a reviewer's eye.
  - Devin · D8, "Gate document structure in CI". He already runs
    `manni meta validate`. A second tool with its own config file, its own
    flags and its own exit codes is a second thing to learn and maintain.
  - Theo · T4, "Read a structure failure and fix it". A finding has to name the
    template, the section and the line.
- **Depends on:** Four proposals.
  - [0033](0033-manni-monorepo.md) folds one tool in at a time, and orders
    docevals before lint. This is the fold-in of `doc-structure-lint`.
  - [0034](0034-command-grammar.md) is the grammar: `manni <domain>
    <subcommand>`, no default subcommand for a new domain, one separator per
    list. lint's imported CLI broke all three.
  - [0035](0035-a11y-domain.md) is the fold-in precedent, and the source of the
    family severity scale.
  - [0041](0041-collections.md) moved document sets to a top-level
    `collections:` list: "A tool section never carries `paths`, `exclude` or
    `externalMetadata`." lint's imported config carried the first two.
- **Relates to:** Three.
  - [0044](0044-citations-and-drift.md) set the sibling import rule and the
    `manni:<domain>/<rule>` id shape. This proposal extends the id shape with a
    job segment.
  - [0048](0048-docevals-domain.md) lands first, and ships `tool:vale`,
    `tool:markdownlint` and `tool:doc-structure-lint` graders. The last of those
    calls out to the package this proposal folds in.
  - lint's own imported ADR log, [lint/01001–01008](lint/README.md), records the
    decisions made while it was a separate tool. It stays as written. This
    proposal supersedes **01007** (settings in a `lint:` section of a shared
    *moose* config).
- **Touches (planned):** `src/lint/**`, `src/cli.ts`, `src/index.ts`,
  `schemas/lint/config.json`, `eslint.config.js`, `package.json`,
  `scripts/check-cli-reference.mjs`, `test/lint/**`,
  `test/manni.integration.test.ts`, `docs/src/content/docs/lint/**`,
  `docs/astro.config.mjs`, `docs/content-strategy/{cujs,personas,information-architecture}.md`,
  `media/lint/**`.

## Problem

`doc-structure-lint` checks that a document has the structure its doctype
template expects: the sections, in order, with the paragraphs, lists and code
blocks the template asks for. It is deterministic, it is fast, and it is a
separate npm package with a separate config file.

Maya already runs `manni meta validate` over the same docset, out of the same
`manni.config.yaml`, in the same CI job. Structure is the other half of the same
question — metadata says what a page *is*, structure says whether it is shaped
like one — and answering it costs her a second install, a second config, and a
second set of flags whose names almost but not quite match.

Folding the tool in answers that. The obstacle is that the imported CLI predates
three family rules, and that its shape assumed it was the only thing in the
package.

## Decision

### Verbs name the job, not the tool

`manni lint` gets one verb per **kind of check**, and one that runs them all:

| Command | Ships | Runs |
|---|---|---|
| `manni lint check [paths...]` | now | every configured job |
| `manni lint structure [paths...]` | now | document structure against doctype templates |
| `manni lint prose [paths...]` | deferred | prose rules |
| `manni lint format [paths...]` | deferred | formatting rules |

The imported CLI made `lint` a default subcommand, so `manni lint docs/` ran
`lint lint`. 0034 rules that out for a new domain: meta's default is
grandfathered and "a domain with one verb still spells it". Nothing has shipped
under `manni lint`, so there is nothing to break.

A **job** is what is being checked. The **tool** that answers it is an
implementation the user can swap. Today `structure` is answered by lint's own
engine, named `manni`; a later `prose` job will be answered by Vale and a
`format` job by remark-lint. Naming the verbs after the jobs means swapping the
tool underneath does not change the command anyone types, and running exactly
one kind of check is one word, not a flag.

`check` takes the shared options and nothing else. Anything job-specific — a
template ref, an explain mode — belongs to a job verb. That keeps `check` from
accumulating every job's flags as jobs are added.

### The tool is named in config, and reachable from the CLI

```yaml
lint:
  structure:
    tool: manni     # optional, default manni; the only structure tool today
```

and on a job verb, in a **Tool options** help group printed after the shared
options, `--tool <name>`. Tools are visible, because someone debugging a
disagreement between two machines needs to know what actually ran. They are not
prominent, because the job is the thing a person means.

`manni lint tools` prints the inventory: per job, the tool, whether it is
configured, whether it is available, what config it reads, and which input
formats it reads. It replaces the imported `manni lint formats` verb, whose
name would have sat one letter from the `format` job.

### Where a tool's settings live

manni's own settings stay directly under `lint:`, unchanged in meaning from the
imported tool: `templates`, `template`, `types`, `overrides`.

An outside tool's settings do **not** go under `lint:`. When the first one lands
it gets a namespace of its own under a new top-level `tools:` key, beside
`collections:` and `encryptionKey:`, with the discovery rule 0041 and 0045
already established:

```yaml
# Deferred. Not part of this proposal's implementation.
tools:
  vale: { config: .vale.ini }
```

The reason to put it at the top level rather than under `lint:` is that a tool
is not lint's. docevals already runs Vale through a grader; when the two meet,
they should read one description of where Vale's config is. The reason to give
each tool its own namespace rather than a shared `{tool, config}` shape is that
tools do not have the same settings, and a lowest-common-denominator shape would
either lie or grow a `passthrough:` blob.

### Document sets come from `collections:`

`lint.paths` and `lint.exclude` are removed. A config that still carries one is
an error naming the key and where it went, exactly as cite's refusal does.
Targets resolve through the same shared machinery meta and cite use, so
`--collection`, `--ext`, `--exclude`, `--allow-empty`, `--no-gitignore`,
`--no-config` and the "No files matched" message behave identically across the
three domains. Every list option follows 0034's one-separator rule:
`--exclude` and `--collection` repeat, `--ext` takes commas once.

### Severity, rule ids and exit codes

Findings carry the family scale from `src/shared/severity.ts`. Every structural
finding is `error`; the imported tool's private `"error" | "warning"` type goes.

Rule ids gain a job segment: `manni:lint/<job>/<rule>`, so
`heading_pattern_error` becomes `manni:lint/structure/heading-pattern`. A prose
finding will read `manni:lint/prose/Google.Passive`, keeping the tool's own rule
name, because that is the name the tool's documentation uses. The JSON
reporter's existing `type` field is unchanged — docevals' grader parses it —
and `ruleId` and `tool` join it.

Exit codes keep the family contract: `0` clean, `1` findings, `2` operational
or usage error. Exit 1 is defined as **at least one `error`-level finding**
rather than "any finding". Today those are the same thing. When a prose tool
brings warnings and suggestions, they will not silently change what CI does.

`--format` gains `junit` through meta's renderer, matching cite's `check`, so
the family's four CI formats are available from every domain that reports
findings.

### Deferred, deliberately

- **`prose` and `format` jobs**, and the `tools:` key they need.
- **A baseline** (`--baseline` / `--write-baseline`). meta and cite have one.
  lint has never had one, and adding it later is additive.
- **A severity map** (`lint.severity.<rule>`, in cite's shape with `off`). It
  waits for the first job with more than one severity.
- **A `collection:` form in `overrides[]`.** An override is template policy over
  a glob, not a document set.

## Stress test

### 1. Why not a verb per tool, `manni lint vale`?

Because the tool is the part meant to be swappable. A repo that moves from Vale
to something else would have to change its CI command, its docs and its
muscle memory, for a change that does not alter what is being checked. Naming
the job also gives `check` something to mean: run them all.

### 2. Then why is the tool in the config at all?

Because "what ran" is not always inferable, and a disagreement between a
developer's machine and CI usually turns out to be two versions of one tool, or
a config file found in one place and not the other. `manni lint tools` answers
that in one command. Naming the tool in config is also what makes the swap a
one-line change rather than a flag on every invocation.

### 3. Does `check` need `-t/--template`?

No, and giving it one would be the first step to giving it every job's flags.
`--template` forces one template over every file, which is a structure concept;
`manni lint structure -t …` says so. Config still reaches `check`, so the CI
invocation is unaffected.

### 4. Is `manni` a good name for the structure tool?

It is the engine that ships in this package, and it is the name that appears in
`manni lint tools` and in the JSON `tool` field beside `vale` and
`remark-lint`. The alternative, `builtin`, describes its packaging rather than
its identity, and stops being true the moment someone vendors it.

### 5. What happens to a repo that used `doc-structure-lint.config.yaml`?

Nothing automatic. That tool's config names are dropped rather than carried
forward, with the migration written in the docs. The imported code also read
`moose.config.yaml`; 0048 removes that name from shared discovery, and this
proposal does not reintroduce it. Carrying two dead file names into a package
that has never read them would make them supported.

### 6. The JSON shape is a contract. Is adding fields safe?

docevals' `tool:doc-structure-lint` grader parses `-f json` and reads `type`.
The envelope stays a top-level array and `type` keeps its value, so the grader
keeps working; `ruleId` and `tool` are additive. The follow-up that switches
that grader to call `runLint` in-process removes the contract altogether.

### 7. Where does prose actually belong — here or in docevals?

lint's own ADR 01003 drew the line as "this tool checks structure, docevals
judges prose". That line was about determinism: docevals was the thing with a
language model in it. Vale is deterministic, so the line does not settle where
it goes. This proposal reserves the `prose` verb and the id segment and leaves
the question to the proposal that implements it, which will have to supersede
01003's sentence rather than quietly contradict it.

### 8. Why does `--explain` still exit 0?

Unchanged from the imported tool, and worth restating because it is
counterintuitive: `--explain` answers a question about configuration, so its
exit code says whether it could answer, not whether the docs are clean. A page
that routes to no template is an answered question. Automation reads the
ordinary run for that.

### 9. Does the fold-in recipe hold?

Mostly. `src/lint/` imports meta only through `../meta/index.js` and
`../meta/internal.js`, its `cli.ts` exports `buildProgram()` with no entry
point, and its error class extends `ToolError` (renamed `MooseLintError` →
`LintError`). Three things the recipe does not cover came up: the tool ships
built-in templates (`templates/lint/tgdp/**`) and JSON schemas, which need
`package.json` `files` entries; it brings a `src/shared/package-root.ts` helper
that tracevals and kg will also want; and its `asciidoctor` dependency is the
meta-package, which drags in a CLI and four template engines for a parser that
needs `@asciidoctor/core`.

### 10. 372 lint warnings

The import carries 372 `no-non-null-assertion` warnings behind a scoped ESLint
relaxation, 35 in `src/lint` and 337 in `test/lint`. docevals cleared the same
backlog before merging rather than after. This does the same: the relaxation is
deleted, not inherited.

## Verification

- `npm run typecheck`, `npm test`, `npm run build`, and `npm run lint` with
  **zero** warnings.
- `npm run docs:check-cli` covers `lint` through a new `PAGES` row, so the
  reference page and the commander program cannot drift.
- `test/manni.integration.test.ts` asserts the domain is listed, that
  `manni lint` alone is a usage error listing the verbs, and that
  `manni lint structure --help` shows the full path.
- The example ladder in the plan is walked by hand against `dist/cli.js`,
  including every exit code and stderr line.
- docevals' grader still parses `manni lint structure -f json`.

## Not breaking

`manni lint` has never shipped. Every rename here — the verb, the removed
`paths:`/`exclude:` keys, the dropped legacy config names, `formats` →
`tools` — is a change to an unreleased surface. The published
`doc-structure-lint` package is unaffected; it is archived separately, with a
migration note in the docs.

## Consequences

- The family gains a fourth reporting domain, and the first one whose verbs
  name jobs rather than objects. If tracevals or kg has the same shape, this is
  the precedent.
- `manni:lint/<job>/<rule>` puts a third segment in a family rule id. Anything
  parsing rule ids must not assume two.
- A later `tools:` key is a fourth top-level family key. The discovery rule that
  0041 and 0045 wrote once now has one more member.
- Exit 1 meaning "an error-level finding" is stated before any domain needs the
  distinction, which is cheaper than changing it afterwards.
