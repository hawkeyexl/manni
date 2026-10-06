# 0051: the `graph` domain: the knowledge graph joins the family

- **Status:** Proposed; superseded in part by [0077](0077-graph-reads-every-format-lint-parses.md)
- **Serves:** Maya · M18–M20 · Devin · D12, D13 · Sara · S12 · Theo · T7
- **Depends on:** [0033](0033-manni-monorepo.md), the umbrella this domain
  mounts on and the import recipe it follows. [0034](0034-command-grammar.md),
  the grammar: spelled verbs, no default subcommand, one separator per list.
  [0041](0041-collections.md), the document set. [0046](0046-provenance-pins.md),
  whose `meta-provenance` replaces `kg.provenance` and whose stress test 13
  moves a guard into this tool. [0047](0047-field-location.md), the schema
  annotation this one is modelled on. [0063](0063-the-graph-vocabulary.md),
  which renamed the page block `graph:`. [0067](0067-registering-the-vocabularies.md),
  which registered `manni:graph:1.0.0` and its strict overlay.
  [0070](0070-defaults-register-strict.md), which put it in the default set
- **Relates to:** [0048](0048-docevals-domain.md), the domain folded in before
  this one. Its choices are copied here: `collections:`, `providers:`,
  `--local`, the turn budget, camelCase section keys and a closed ADR log.
  [0035](0035-a11y-domain.md), the precedent for mapping a source's own
  severity scale onto the family's. The source value stays in a field of its
  own. [0052](0052-term-domain.md) and [0073](0073-docevals-grades-what-no-other-domain-owns.md),
  for the line §11 draws with `manni term`. [0074](0074-stewardship-graph-output.md),
  which puts the first marks of §5 in the default set and removes
  `graph.schemas`
- **Supersedes, in part:** graph [ADR 01010](graph/01010-provenance-defaults-and-degradation.md),
  for the tri-state `provenance.git` key only. Git is detected now, and its
  warnings channel stands. graph [ADR 01027](graph/01027-unenforceable-cost-caps.md),
  for the cap itself. It found the dollar cap unenforceable for unpriced models
  and said so in the report; this one removes the dollar and counts turns. graph
  [ADR 01030](graph/01030-the-dockg-vocabulary-document.md), for the namespace
  host only. Its rule, that the namespace IRI must dereference, is why the IRIs
  move to the site that will serve them. graph
  [ADR 01006](graph/01006-shacl-graph-validation.md), for the imported
  `validate` verb, which `manni meta validate` does. Its `check` half stands.
  None of the four is edited, as 0048 left the ADRs it superseded in part.
  [0047](0047-field-location.md), for its claim that `x-manni-location` is the
  one statement a delivery-side tool reads. A published graph reads
  `x-manni-graph-output` instead (§5). The Status line is its only edit
- **Touches:** `src/graph/**` (new), `src/cli.ts`, `src/index.ts`,
  `src/shared/cli-options.ts`, `src/meta/core/{validator,graph-output}.ts`,
  `src/meta/commands/{validate,get,query,fill,schemas}.ts`,
  `src/cite/commands/{add,check}.ts`, `package.json`, `package-lock.json`,
  `manni.config.yaml`, `tsup.config.ts`, `vitest.config.ts`,
  `eslint.config.js`, `scripts/check-cli-reference.mjs`,
  `scripts/clean-dist.mjs` (new), `test/graph/**` (new),
  `docs/src/content/docs/graph/**` (new), `docs/public/graph/ns.ttl` (new),
  `docs/manni.graph.yaml` (new), `docs/src/content/docs/meta/**`,
  `docs/content-strategy/*.md`, `docs/proposals/graph/**` (new),
  `docs/astro.config.mjs`, `CLAUDE.md`
- **Verdict:** Fold moose-kg in as `manni graph`, ten spelled verbs and no
  default. Make it speak the family's values rather than its own. Document sets
  come from `collections:`, and `build` and `fill` take meta's input surface.
  Severities come from the `notice | warning | error` scale. Format names are
  validated, providers are declared once in `providers:` alongside `--local`,
  and a turn budget replaces the dollar cap. Its page block is `graph:`,
  defined by the built-in `manni:graph:1.0.0` and its strict overlay.
  `meta-provenance` replaces `kg.provenance`. What a field publishes is the
  schema's call, through a new `x-manni-graph-output` read from the schema set
  meta resolves. The imported `validate` verb goes, because
  `manni meta validate` is that command. The `dockg` identity goes with it. Its
  ADR log closes at 01040, and later graph decisions go in this series.

## Problem

moose-kg derives an RDF graph from documentation: frontmatter, links,
headings, code blocks and git history become triples that answer questions
prose cannot. What does this page depend on? What breaks if it changes? Which
concepts have no page? It validates the result against SHACL shapes, queries
and traverses it, and searches it lexically or by vector. It exports JSON-LD,
iiRDS or a browser search index.

It was never published. `@hawkeyexl/dockg` is a 404 on npm, and so is
`hawkeyexl.github.io/dockg`. Using it means cloning a second repository and
learning a second config file. It also means reading a report that calls a
failure a `violation` where the rest of the family calls it an `error`.

PR #13 imported it on 2026-09-06, against main at 0922ee7. Main has moved
thirty commits since, and #10 has since shown what an imported tool looks like
once it belongs here. Measured against both, graph still carries its own answer
to nine questions the family has already answered once.

## Decision

### The domain

`manni graph` mounts with `addCommand` and has ten verbs, each spelled:

`init`, `build`, `check`, `fill`, `query`, `stats`, `search`, `traverse`,
`embed`, `export`.

There is no default subcommand. A bare `manni graph` prints its verbs to stderr
and exits 2, as `cite` and `key` do. A parser refusal exits 2 rather than
commander's 1, through `.exitOverride()` and
`showHelpAfterError("(add --help for usage)")`.

### 1. Document sets come from `collections:`

`build` and `fill` read documents. They take the input surface
`manni meta validate` takes, with 0048 §1's collections:

| Argument or option | What it does |
|---|---|
| `[paths...]` | Files, directories and globs, space-separated. |
| `-` | One more page, read from stdin, beside any named paths. Needs `--as`. |
| `--as <format>` | Parse every input as `markdown` or `mdx`. |
| `--ext <list>` | Comma-separated extensions a directory walk or glob keeps, given once. Default `.md,.mdx,.markdown`. A file named outright is not filtered. |
| `--allow-empty` | Zero matched files is success. `build` writes an empty graph, and `fill` an empty report. |
| `--collection <name>` | A configured collection to read. Repeatable, one name per occurrence. |
| `--exclude <glob>` | A glob to leave out. Repeatable, one glob per occurrence. |
| `-c, --config <path>`, `--no-config` | The config file, or none. |

With no paths they read the selected collections. A page from stdin shows as
`<stdin>` in a report and has no git history. `graph fill -` prints the filled
page to stdout and its report to stderr.

Each refusal exits 2:

| Case | stderr |
|---|---|
| `-` without `--as` | ``Reading from stdin (`-`) requires --as <format> to choose an extractor.`` |
| `--as html` | `Unknown format "html". Known formats: markdown, mdx.` |
| No paths and no collections | ``No files to build. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.`` `fill` says `fill`. |
| `graph.inputs` in the config | `manni.config.yaml: "inputs" is no longer a graph key. Document sets are declared once for every tool, under a top-level collections: list.`, then a link to the configuration reference. `graph.exclude` reads the same. |

The stdin sentence is one constant in `src/shared/cli-options.ts`, which
meta and cite read too. No paths and no collections is exit 2 (0014), not a
silent walk of `**/*.md`.

The read verbs (`check`, `query`, `stats`, `search`, `traverse`, `embed`,
`export`) take a built graph, not a document set. They take `-g, --graph`
and the config flags in place of the document-set surface. `init` takes no
options.

### 2. The family's values

- **Severity** is `notice | warning | error` from `src/shared/severity.ts`.
  SHACL's own `Violation | Warning | Info` maps onto it. Violation becomes
  error, and info becomes notice. The source value stays in `shaclSeverity`,
  the way a11y keeps axe's `impact` (0035, stress test 10). `check`'s counts
  become `errors`, `warnings`, `notices`.
- **Formats** are validated. Each verb names its list. An unknown `-f` is
  exit 2 with the family's sentence, `Unknown --format "x". Use a | b.`, the
  way a11y and cite each spell it against their own list. `check` adds
  `github`, because it is a CI gate. `fill`, `query`, `stats`, `search`,
  `traverse` and `embed` take `pretty | json`, with `pretty` the default.
  `init`, `build` and `export` write files rather than a report, and take no
  `-f`.
- **`-f` means the output format everywhere.** `graph export` took its target
  there; the target becomes a positional, `manni graph export <jsonld | iirds |
  search>`.
- **Flags say what they mean.** `query` matches on `--subject`, `--predicate`
  and `--object`. `traverse` filters by product subject with
  `--software-subject`, so `--subject` keeps one meaning in the domain.
  `embed` names its model with `--embedding-model`, so it does not read as
  `fill --model`, a provider's model. Its config key stays `graph.embed.model`.
- **One separator per list.** `--shapes` is repeatable, one path per
  occurrence. `--predicates` is a comma-separated list given once. Neither is a
  variadic option any more.
- **Shared plumbing.** `fail()` from `src/shared/run.ts`, `warn()` and
  `notice()` from `src/shared/warn.ts`, `errorMessage()` from
  `src/shared/errors.ts`, `shouldColor` and `--no-color` from
  `src/shared/color.ts`. `DockgError` becomes `GraphError`, extending `ToolError`.
- **Section keys are camelCase**, as 0048 §2 settled for the family.
- **No legacy config names.** `moose.config.yaml` went with #10, and
  `dockg.config.yaml` goes here. The `version: 1` key goes too. Nothing was
  published under either name, so neither gets a migration.

### 3. Providers are declared once, and the budget is turns

`graph fill` is the one verb that reaches a model. It reads the family
`providers:` map from 0048 §3, with `graph.provider` and `graph.model` as the
tool-level override, and gains `--local` with the shared `LOCAL_FLAG_HELP`.
The default is `auto`: a default that names a vendor fails for everyone without
that vendor's key, and graph's was `anthropic`. `mock` stays accepted and unlisted.
`fill.apiKeyEnv`, `fill.baseUrl` and `fill.command` go to the family map.

The dollar cap goes. graph [ADR 01027](graph/01027-unenforceable-cost-caps.md)
already found that `fill.maxCostUsd` silently reads as zero for any model
outside the library's price table, and made the report say so. Turns are
countable for every model, so `--max-turns` and `fill.maxTurns` replace
`--max-cost`, `fill.maxCostUsd` and `fill.pricing`, as docevals ADR 01019 did.
A page left unfilled by the budget is `skipped` with reason `turn budget`.

`--min-confidence` and `fill.minConfidence` become `--confidence` and
`fill.confidenceThreshold`, the names `meta fill`, docevals and tracevals use.

`graph embed --embedding-model` is a local embedding model id, not a
provider's model. It is named apart from `fill --model` for that reason (§2).

### 4. The page vocabulary is `manni:graph:1.0.0`

The page block is `graph:`, and the vocabulary that defines it is the
built-in `manni:graph:1.0.0`. 0063 renamed the block from `kg:` and the draft
family from `manni:kg` to `manni:graph`. 0067 registered it at `1.0.0`, with
its strict overlay `manni:graph-strict:1.0.0`. 0070 put it in the default set,
and `strict: true` stacks the overlay beside it. The block is closed with
`additionalProperties: false`, and `x-manni-location: page` sits on `graph`.

The tool takes the same name. `manni graph`, the `graph:` section of
`manni.config.yaml` and the RDF prefix `graph:` all name the tool, as does
`x-manni-graph-output`.

graph ships no copy of the vocabulary. It imports
`src/meta/schemas/graph/1.0.0.json`, the file meta registers, and tsup bundles
it. One file is therefore both the schema `manni meta validate` checks a page
against and the one graph reads. A page still carrying `kg:` has an unknown
page key, which validates and derives nothing. The `manni:kg` drafts stay byte
for byte as the family's history, and only they still name `kg`.

The vocabulary is 0046's shape. `graph.provenance` is gone. A machine
attribution is page-level `meta-provenance` with JSON Pointers into the block,
such as `/graph/label`, and `fill` writes it through
`src/meta/core/meta-provenance.ts`, the merge `meta fill` uses. The schema
guard that kept machines off `sections`, `revision-of` and `derived-from` could
not survive free pointers, so 0046 stress test 13 moved it here. The harvest
reports a `meta-provenance` pointer under `/graph/sections`,
`/graph/revision-of` or `/graph/derived-from` as a `check` finding at `error`.

### 5. What the graph carries is the schema's call

graph harvests frontmatter into Turtle, JSON-LD, iiRDS and a search index, all of
which get published. Which fields belong in a published graph is a property of
the field, not of the tool. It is therefore recorded where the field is
defined:

```jsonc
"owner": {
  "type": "string",
  "x-manni-location": "external",
  "x-manni-graph-output": false
}
```

`x-manni-graph-output` is a boolean annotation beside a top-level property. It is
registered with `ajv.addKeyword` in `src/meta/core/validator.ts`, where
`x-manni-location` is registered. Absent means `true`: every field is
harvested. A mark nested inside `graph` is ignored, as 0047 rule 2 ignores one
nested inside a block.

graph reads the marks from the schema set meta resolves for each page. That
set is the page's `$schema`, then meta's overrides, `schemas:`, `register`,
`strict` and the default set. They come from the `meta:` section of the config
the build runs under. graph keeps no schema set of its own, so one config
decides what a page is checked against and what its published graph carries.

graph reads a page the way meta reads it. Its metadata is the frontmatter
merged with every key an external-metadata manifest of its collections owns
(0047, 0058, 0068). The merge is meta's `mergeWithMarks`, reached through
`src/meta/internal.ts`, so the join, ownership and refusal rules are meta's. A
manifest meta refuses exits 2 in meta's words. The marks apply to the merged
page, so a field kept in a `{page}.meta.yaml` is filtered like one on the page.
`graph fill` writes each key where `meta fill` would. A key a local manifest
owns goes to the page's entry there, and the rest go to the page. Under
`--no-config` no collection is declared, so no manifest is read, as in meta. A
page from stdin is in no collection, so no manifest supplies it.

There is no `graph.schemas` key. A config that sets one fails the config
schema with `/graph: unknown key "schemas"`, exit 2, as any unknown key does.

The mark lives in the vocabulary that defines the field. The default set
carries `manni:stewardship:1.1.0` (0074), which marks `owner`, `stakeholders`
and `reviewed-by` `false`. A default run therefore keeps the three fields that
name people out of every published output.

Encrypted values (0045) are harvested like any other value. graph never decrypts,
so what lands in the graph is the `~…` token, which says a value exists and
nothing about what it is. A field that should not reach a published graph at
all is marked `false`. That is one mechanism for "keep this out of the
output", rather than one rule for encryption and another for everything else.

### 6. Git is detected

`provenance.git`, tri-state since graph ADR 01010, is removed. Git history is used
when git is available and the corpus is a repository. A run that finds neither
warns once through `warn()` and builds the rest. A switch for a detectable
fact is one more way to be wrong. The warnings channel ADR 01010 built is what
makes detection safe here. `provenance.qualified` stays: it
switches what is written, not what is discovered.

The warning carries git's own reason for the degradation, because detection
took away the user's way of saying "I require this": `the graph has no revision
history or commit agents: <why>`. "Not a repository", "git is not on PATH" and
"`git log` timed out" want different fixes. In CI the warning is now the only
thing between a runner that lost git and a quietly thinner graph.

### 7. One identity

The `dockg` spellings that reach a user or a consumer become `manni`:

| Before | After |
|---|---|
| `https://hawkeyexl.github.io/dockg/ns#` | `https://hawkeyexl.github.io/manni/graph/ns#` |
| `https://hawkeyexl.github.io/dockg/shapes/1.0.0#` | `https://hawkeyexl.github.io/manni/graph/shapes/1.0.0#` |
| `urn:dockg:` (base IRI) | `urn:manni:graph:` |
| `$id: dockg:config:0.1` | `manni:graph:config` |
| `DockgError`, `DOCKG_*` constants | `GraphError`, `GRAPH_*` |

graph ADR 01030 required the namespace IRI to dereference, and minted a vocabulary
document for it. The document is what moves: it is served at
`docs/public/graph/ns.ttl` on the site this package actually publishes, and the
dockg host never served anything. Nothing was published under the old IRIs, so
this is a rename and not a migration; the golden graph is regenerated once.

### 8. The imported `validate` verb goes

The imported `validate` checked a page's frontmatter against the graph
vocabulary with meta's own validator and meta's own reporters. That is
`manni meta validate`, which is also how every other vocabulary in the family
is checked. `manni:graph:1.0.0` is in the default set, so it checks the
`graph:` block with no config at all. Two names for one command is what
"commands must have parallel behaviors" exists to prevent. Removing a verb is
cheap now and breaking after the first release. The graph CLI reference says
so beside `check`.

`graph check`, which validates the *built graph* against SHACL shapes, is not
affected: it is the half of ADR 01006 that meta cannot do.

### 9. The content strategy is the family's

Upstream's `docs/content_strategy/` does not come across. As 0048 §7 settled,
a joining tool brings no strategy directory and adds no persona unless no
existing one fits. graph's journeys fold into Maya, Devin, Sara and Theo, and the
CUJs are M18–M20, D12, D13, S12 and T7. T6 is docevals' "Fix a failing eval",
so Theo's graph journey, "Fix a red `graph check`", is T7.

graph's terms join the family termbase. Each is a `type: term` page under
`docs/src/content/docs/meta/reference/glossary/`, and the section keeps no
glossary page of its own.

### 10. The imported ADR log closes at 01040

`docs/proposals/graph/01000`–`01040` come across as written, and nothing in them
is edited beyond a Status line. They are the record of decisions made in
another repository, on the evidence available there. Later graph decisions go in
this `00NN` series, and `docs/proposals/README.md` gains a row for the log.

### 11. Concepts belong to `manni term`

0073 narrowed docevals to what no other domain owns. The same rule draws the
line between graph and `manni term`, since both touch concepts.

`manni term` owns the concepts. It owns the glossary, its `type: term` pages,
and the SKOS concept scheme that `manni term write -f skos` renders as JSON-LD.
A team that wants its terminology as SKOS runs that command.

graph mints a `skos:Concept` from a page's `graph:` block, as one node among
the pages, links, sections and provenance around it. `graph export jsonld`
emits the whole graph. It is a reserialization of what `build` derived, not a
second writer of the termbase.

## Known limits

1. **A collection is read by every tool.** As 0048 records, this repository
   cannot declare a `graph-fixtures` collection without `meta validate` and `cite
   check` reading it too. The fixture corpus is therefore named by path in the
   CI gate, and the docs dogfood lives in `docs/manni.graph.yaml`, reached only
   with `-c`.
2. **`x-manni-graph-output` is advisory for a graph built elsewhere.** It governs
   what graph harvests. A consumer reading the frontmatter directly is not bound
   by it, and a value marked `false` is still in the repository.
3. **graph fill and meta fill remain two fill implementations.** They now share
   the provider selection, the confidence and turn vocabulary, and the
   `meta-provenance` writer. Folding the rest into one layer is a follow-up,
   as 0048 left the docevals judge and fill layers.
4. **Nothing can demand git provenance any more.** ADR 01010's `true` existed
   for a CI job that requires reproducible attribution and would rather fail
   than emit a graph without it. Detection cannot serve that case: the run
   warns and produces the thinner graph. If a job turns out to need the
   stronger contract, it belongs in `check` as a shape over the built graph.
   That is an assertion about output, rather than a switch back in the config.
5. **The browser build is a second platform contract.** `./graph/runtime` and
   `./graph/embed` are built `platform: neutral`, so a `node:` import reaching
   them is a released bug rather than a type error. The bundle-purity test is
   the only thing that catches it.

## Stress test

### 1. Why not keep `validate` as an alias?

Because an alias is a permanent second surface for one command, and that is the
thing the parallel-behaviors rule exists to prevent. The cost of removing it
also never gets lower than it is today: dockg is unpublished, so no script
anywhere runs it. The docs rewrite is one page.

### 2. Why move the IRIs, when the import was deliberately byte-identical?

The import kept `dockg:` so builds could be diffed against upstream. That was
the right call for an import commit and is the wrong one for a release. An IRI
is the part of the output a consumer stores and links to. ADR 01030's own rule
is that it must dereference; `hawkeyexl.github.io/dockg` returns 404 and always
did, while `hawkeyexl.github.io/manni/graph/ns` is a page this repository builds.
The golden graph is regenerated once and diffed, so the rename is checked by
the same determinism gate that checks everything else.

### 3. Why a new annotation rather than reusing `x-manni-location`?

They answer different questions. `x-manni-location` says whether a field is
*written* in the page or in a manifest. 0047 marks the people fields
`external` because a manifest is the better place to maintain them. It says
nothing about whether a delivered artifact should carry them. A field can be
external and still belong in the graph, as `authors` does on a published page.
Another can be page-local and not belong in the graph at all. Overloading one
mark would make
`manni meta relocate` a publishing decision.

### 4. Why not have graph refuse encrypted values instead?

Because "this value is encrypted" and "this field should not be published" are
different facts, and only the second one is stable. An encrypted value is
already unreadable. Copying its token into the graph leaks nothing and keeps
the shape of the record honest. A field that genuinely must not appear is
marked once in the schema, and it stays out whether or not anyone encrypts it.

### 5. Why does `check` get `github` but not `sarif` and `junit`?

Because `github` is the format that changes what a reviewer sees on a pull
request. SHACL findings also do not carry line numbers, which is most of what
SARIF and JUnit consumers key on. Adding them later is a reporter, not a
redesign.

### 6. Why rename the page block, and why take the vocabulary id with it?

The first draft of this proposal kept `kg:` for the page block. It shared that
spelling with the RDF prefix on purpose, since any other spelling looked like a
third name for one tool. The tool's own guidance then had to tell contributors
that the key and the prefix were different things.

A name that needs a warning is the wrong name. `graph:` says what the block
describes, and the tool, its config section and its RDF prefix take the same
name.

**Changed as a result:** the block is `graph:` and its pointers are
`/graph/…`. Keeping the id `manni:kg` while the block became `graph` was
possible, since `manni:artifact-evals` already claims `metadata`. It would have
reintroduced the mismatch one level up, so the vocabulary is renamed too. 0063
made that change on main, and this domain takes it.

The rename is a draft diff, not a migration, because nothing registered either
id and the tool is unpublished. The one live URL it moves, the vocabulary's
review page on the site, gets a redirect.

## Consequences

- `manni graph` ships in the family package. A user installs one thing and runs
  `manni graph build` next to `manni meta validate`.
- A graph built by 2.x carries `manni` IRIs. Anything built by dockg does not,
  and the two are not mergeable without rewriting subjects.
- Vocabularies gain one keyword, which every schema author may set and only
  graph reads.
- The page block is `graph:`. A page still carrying `kg:` validates and
  contributes nothing to the graph.
- `docs:check-cli` gains a `graph` row, `docs:check-graph` becomes a docs gate, and
  the site gains a `graph` section.
- moose-kg is archived with a README pointing here. There is no npm
  deprecation, because nothing was published.

## History

This proposal was drafted as the `kg` domain, `manni kg`, in
`0051-kg-domain.md`. That draft named the keyword `x-manni-kg-output`, the
config section `kg:` and the RDF prefix `kg:`. It bundled the page vocabulary
from the `manni:graph:1.0.0-proposal.1` draft. It also gave the tool a schema
set of its own, `kg.schemas`.

Four changes followed before the domain merged.

- 0063 renamed the page block `graph:`, and the tool took the same name. The
  domain, its config section, its RDF prefix and its keyword became `graph`.
  `kg.schemas` became `graph.schemas`.
- 0067 and 0070 registered the vocabulary as `manni:graph:1.0.0` and put it in
  the default set. graph now reads the registered file instead of the draft.
- 0074 published `manni:stewardship:1.1.0` with the first marks. It removed
  `graph.schemas`, so graph reads the set meta resolves.
- Three flags were renamed with no alias. `query --s`, `--p` and `--o` became
  `--subject`, `--predicate` and `--object`. `traverse --subject` became
  `--software-subject`. `embed --model` became `--embedding-model`. `build`
  and `fill` gained `-`, `--as`, `--ext` and `--allow-empty` in the same
  change.

Theo's graph journey was numbered T6 in the draft. docevals took T6 first, so
the journey is T7.

## Release

`feat(graph)`, a minor. The PR is squash-merged with that title, as 0033 §5
prescribes, and the ADR log's closure is part of the same commit.
