# 0051: the `kg` domain: the knowledge graph joins the family

- **Status:** Proposed
- **Serves:** Maya · M18–M20 · Devin · D12, D13 · Sara · S12 · Theo · T6
- **Depends on:** [0033](0033-manni-monorepo.md), the umbrella this domain
  mounts on and the import recipe it follows. [0034](0034-command-grammar.md),
  the grammar: spelled verbs, no default subcommand, one separator per list.
  [0041](0041-collections.md), the document set. [0046](0046-provenance-pins.md),
  whose `meta-provenance` replaces `kg.provenance` and whose stress test 13
  moves a guard into this tool. [0047](0047-field-location.md), the schema
  annotation this one is modelled on. [0023](0023-metadata-vocabularies.md),
  whose kg draft is the page vocabulary
- **Relates to:** [0048](0048-docevals-domain.md), the domain folded in before
  this one. Its choices are copied here: `collections:`, `providers:`,
  `--local`, the turn budget, camelCase section keys and a closed ADR log.
  [0035](0035-a11y-domain.md), the precedent for mapping a source's own
  severity scale onto the family's. The source value stays in a field of its
  own
- **Supersedes, in part:** kg [ADR 01010](kg/01010-provenance-defaults-and-degradation.md),
  for the tri-state `provenance.git` key only. Git is detected now, and its
  warnings channel stands. kg [ADR 01027](kg/01027-unenforceable-cost-caps.md),
  for the cap itself. It found the dollar cap unenforceable for unpriced models
  and said so in the report; this one removes the dollar and counts turns. kg
  [ADR 01030](kg/01030-the-dockg-vocabulary-document.md), for the namespace
  host only. Its rule, that the namespace IRI must dereference, is why the IRIs
  move to the site that will serve them. kg
  [ADR 01006](kg/01006-shacl-graph-validation.md), for `kg validate`, which
  `manni meta validate` does. Its `kg check` half stands. None of the four is
  edited, as 0048 left the ADRs it superseded in part
- **Touches:** `src/kg/**` (new), `src/cli.ts`, `src/index.ts`,
  `src/meta/core/validator.ts`, `src/meta/core/meta-provenance.ts`,
  `package.json`, `package-lock.json`, `manni.config.yaml`, `tsup.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `scripts/check-cli-reference.mjs`,
  `scripts/clean-dist.mjs` (new), `test/kg/**` (new),
  `docs/src/content/docs/kg/**` (new), `docs/public/kg/ns.ttl` (new),
  `docs/manni.kg.yaml` (new), `docs/proposals/0023/schemas/**`,
  `docs/content-strategy/{personas,audiences,cujs,information-architecture}.md`,
  `docs/proposals/kg/**` (new), `docs/astro.config.mjs`, `CLAUDE.md`
- **Verdict:** Fold moose-kg in as `manni kg`, ten spelled verbs and no
  default. Make it speak the family's values rather than its own. Document sets
  come from `collections:`, and severities from the `notice | warning | error`
  scale. Format names are validated, providers are declared once in
  `providers:` alongside `--local`, and a turn budget replaces the dollar cap.
  Its page vocabulary is the 0023 draft at proposal.3, bundled
  at build, with `meta-provenance` in place of `kg.provenance`. What a field
  publishes is the schema's call, through a new `x-manni-kg-output`. `kg
  validate` goes, because `manni meta validate` is that command. The `dockg`
  identity goes with it. Its ADR log closes at 01040, and later kg decisions go
  in this series.

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
once it belongs here. Measured against both, kg still carries its own answer
to nine questions the family has already answered once.

## Decision

### The domain

`manni kg` mounts with `addCommand` and has ten verbs, each spelled:

`init`, `build`, `check`, `fill`, `query`, `stats`, `search`, `traverse`,
`embed`, `export`.

There is no default subcommand. A bare `manni kg` prints its verbs to stderr
and exits 2, as `cite` and `key` do. A parser refusal exits 2 rather than
commander's 1, through `.exitOverride()` and
`showHelpAfterError("(add --help for usage)")`.

### 1. Document sets come from `collections:`

`build` and `fill` read documents, so they take 0048 §1's surface exactly:
`[paths...]`, `--collection <name>` (repeatable), `--exclude <glob>`
(repeatable), `-c, --config <path>` and `--no-config`. With no paths they read
the selected collections. `kg.inputs` and `kg.exclude` are refused by name,
with meta's and cite's sentences, exit 2. No paths and no collections is exit 2
(0014), not a silent walk of `**/*.md`.

The read verbs (`check`, `query`, `stats`, `search`, `traverse`, `embed`,
`export`) take a built graph, not a document set, so they take `-g, --graph`
and the config flags and nothing else.

### 2. The family's values

- **Severity** is `notice | warning | error` from `src/shared/severity.ts`.
  SHACL's own `Violation | Warning | Info` maps onto it. Violation becomes
  error, and info becomes notice. The source value stays in `shaclSeverity`,
  the way a11y keeps axe's `impact` (0035, stress test 10). `check`'s counts
  become `errors`, `warnings`, `notices`.
- **Formats** are validated. Each verb names its list. An unknown `-f` is
  exit 2 with the family's sentence, `Unknown --format "x". Use a | b.`, the
  way a11y and cite each spell it against their own list. `check` adds
  `github`, because it is a CI gate; everything else stays `pretty | json`,
  with `pretty` the default.
- **`-f` means the output format everywhere.** `kg export` took its target
  there; the target becomes a positional, `manni kg export <jsonld | iirds |
  search>`.
- **One separator per list.** `--shapes` is repeatable, one path per
  occurrence. `--predicates` is a comma-separated list given once. Neither is a
  variadic option any more.
- **Shared plumbing.** `fail()` from `src/shared/run.ts`, `warn()` and
  `notice()` from `src/shared/warn.ts`, `errorMessage()` from
  `src/shared/errors.ts`, `shouldColor` and `--no-color` from
  `src/shared/color.ts`. `DockgError` becomes `KgError`, extending `ToolError`.
- **Section keys are camelCase**, as 0048 §2 settled for the family.
- **No legacy config names.** `moose.config.yaml` went with #10, and
  `dockg.config.yaml` goes here. The `version: 1` key goes too. Nothing was
  published under either name, so neither gets a migration.

### 3. Providers are declared once, and the budget is turns

`kg fill` is the one verb that reaches a model. It reads the family
`providers:` map from 0048 §3, with `kg.provider` and `kg.model` as the
tool-level override, and gains `--local` with the shared `LOCAL_FLAG_HELP`.
The default is `auto`: a default that names a vendor fails for everyone without
that vendor's key, and kg's was `anthropic`. `mock` stays accepted and unlisted.
`fill.apiKeyEnv`, `fill.baseUrl` and `fill.command` go to the family map.

The dollar cap goes. kg [ADR 01027](kg/01027-unenforceable-cost-caps.md)
already found that `fill.maxCostUsd` silently reads as zero for any model
outside the library's price table, and made the report say so. Turns are
countable for every model, so `--max-turns` and `fill.maxTurns` replace
`--max-cost`, `fill.maxCostUsd` and `fill.pricing`, as docevals ADR 01019 did.
A page left unfilled by the budget is `skipped` with reason `turn budget`.

`--min-confidence` and `fill.minConfidence` become `--confidence` and
`fill.confidenceThreshold`, the names `meta fill`, docevals and tracevals use.

`kg embed --model` is a local embedding model id, not a provider, and does not
change.

### 4. The vocabulary is the 0023 draft, at proposal.3

The shipped copy under `schemas/kg/` and its hash pin go. The draft is bundled
at build from `docs/proposals/0023/schemas/kg/1.0.0-proposal.3.json`, the way
docevals bundles the evals draft (0048 §5). One file is therefore both the
draft under review and the schema the tool enforces.

proposal.3 is 0046's shape. `kg.provenance` is gone. A machine attribution is
page-level `meta-provenance` with JSON Pointers, and `fill` writes it through
`src/meta/core/meta-provenance.ts`, the merge `meta fill` uses. The schema
guard that kept machines off `sections`, `revision-of` and `derived-from` could
not survive free pointers, so 0046 stress test 13 moved it here. The harvest
reports a `meta-provenance` pointer under `/kg/sections`, `/kg/revision-of` or
`/kg/derived-from` as a `check` finding at `error`.

### 5. What the graph carries is the schema's call

kg harvests frontmatter into Turtle, JSON-LD, iiRDS and a search index, all of
which get published. Which fields belong in a published graph is a property of
the field, not of the tool. It is therefore recorded where the field is
defined:

```jsonc
"owner": {
  "type": "string",
  "x-manni-location": "external",
  "x-manni-kg-output": false
}
```

`x-manni-kg-output` is a boolean annotation beside a top-level property. It is
registered with `ajv.addKeyword` in `src/meta/core/validator.ts`, where
`x-manni-location` is registered. kg's harvest reads it from the schema set
meta already resolves for the page. Absent means `true`: every field is
harvested. A mark nested inside `kg` is ignored, as 0047 rule 2 ignores one
there.

Encrypted values (0045) are harvested like any other value. kg never decrypts,
so what lands in the graph is the `~…` token, which says a value exists and
nothing about what it is. A field that should not reach a published graph at
all is marked `false`. That is one mechanism for "keep this out of the
output", rather than one rule for encryption and another for everything else.

### 6. Git is detected

`provenance.git`, tri-state since kg ADR 01010, is removed. Git history is used
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
| `https://hawkeyexl.github.io/dockg/ns#` | `https://hawkeyexl.github.io/manni/kg/ns#` |
| `https://hawkeyexl.github.io/dockg/shapes/1.0.0#` | `https://hawkeyexl.github.io/manni/kg/shapes/1.0.0#` |
| `urn:dockg:` (base IRI) | `urn:manni:kg:` |
| `$id: dockg:config:0.1` | `manni:kg:config` |
| `DockgError`, `DOCKG_*` constants | `KgError`, `KG_*` |

kg ADR 01030 required the namespace IRI to dereference, and minted a vocabulary
document for it. The document is what moves: it is served at
`docs/public/kg/ns.ttl` on the site this package actually publishes, and the
dockg host never served anything. Nothing was published under the old IRIs, so
this is a rename and not a migration; the golden graph is regenerated once.

### 8. `kg validate` goes

`kg validate` checked a page's frontmatter against the kg vocabulary with
meta's own validator and meta's own reporters. That is `manni meta validate`
with the kg draft in `meta.schemas` or an override, which is also how every
other vocabulary in the family is checked. Two names for one command is what
"commands must have parallel behaviors" exists to prevent. Removing a verb is
cheap now and breaking after the first release. The docs say so on the page
where `validate` used to be documented.

`kg check`, which validates the *built graph* against SHACL shapes, is not
affected: it is the half of ADR 01006 that meta cannot do.

### 9. The content strategy is the family's

Upstream's `docs/content_strategy/` does not come across. As 0048 §7 settled,
a joining tool brings no strategy directory and adds no persona unless no
existing one fits. kg's journeys fold into Maya, Devin, Sara and Theo, and the
CUJs are M18–M20, D12, D13, S12 and T6.

### 10. The imported ADR log closes at 01040

`docs/proposals/kg/01000`–`01040` come across as written, and nothing in them
is edited beyond a Status line. They are the record of decisions made in
another repository, on the evidence available there. Later kg decisions go in
this `00NN` series, and `docs/proposals/README.md` gains a row for the log.

## Known limits

1. **A collection is read by every tool.** As 0048 records, this repository
   cannot declare a `kg-fixtures` collection without `meta validate` and `cite
   check` reading it too. The fixture corpus is therefore named by path in the
   CI gate, and the docs dogfood lives in `docs/manni.kg.yaml`, reached only
   with `-c`.
2. **`x-manni-kg-output` is advisory for a graph built elsewhere.** It governs
   what kg harvests. A consumer reading the frontmatter directly is not bound
   by it, and a value marked `false` is still in the repository.
3. **kg fill and meta fill remain two fill implementations.** They now share
   the provider selection, the confidence and turn vocabulary, and the
   `meta-provenance` writer. Folding the rest into one layer is a follow-up,
   as 0048 left the docevals judge and fill layers.
4. **Nothing can demand git provenance any more.** ADR 01010's `true` existed
   for a CI job that requires reproducible attribution and would rather fail
   than emit a graph without it. Detection cannot serve that case: the run
   warns and produces the thinner graph. If a job turns out to need the
   stronger contract, it belongs in `check` as a shape over the built graph.
   That is an assertion about output, rather than a switch back in the config.
5. **The browser build is a second platform contract.** `./kg/runtime` and
   `./kg/embed` are built `platform: neutral`, so a `node:` import reaching
   them is a released bug rather than a type error. The bundle-purity test is
   the only thing that catches it.

## Stress test

### 1. Why not keep `kg validate` as an alias?

Because an alias is a permanent second surface for one command, and that is the
thing the parallel-behaviors rule exists to prevent. The cost of removing it
also never gets lower than it is today: dockg is unpublished, so no script
anywhere runs it. The docs rewrite is one page.

### 2. Why move the IRIs, when the import was deliberately byte-identical?

The import kept `dockg:` so builds could be diffed against upstream. That was
the right call for an import commit and is the wrong one for a release. An IRI
is the part of the output a consumer stores and links to. ADR 01030's own rule
is that it must dereference; `hawkeyexl.github.io/dockg` returns 404 and always
did, while `hawkeyexl.github.io/manni/kg/ns` is a page this repository builds.
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

### 4. Why not have kg refuse encrypted values instead?

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

## Consequences

- `manni kg` ships in the family package. A user installs one thing and runs
  `manni kg build` next to `manni meta validate`.
- A graph built by 2.x carries `manni` IRIs. Anything built by dockg does not,
  and the two are not mergeable without rewriting subjects.
- Vocabulary drafts gain one keyword, which every schema author may set and
  only kg reads.
- `docs:check-cli` gains a `kg` row, `docs:check-kg` becomes a docs gate, and
  the site gains a `kg` section.
- moose-kg is archived with a README pointing here. There is no npm
  deprecation, because nothing was published.

## Release

`feat(kg)`, a minor. The PR is squash-merged with that title, as 0033 §5
prescribes, and the ADR log's closure is part of the same commit.
