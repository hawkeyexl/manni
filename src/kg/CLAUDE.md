# manni kg

Guidance for agents working on the knowledge-graph tool, `manni kg`. It derives
an RDF graph from documentation. Frontmatter, links, headings, code blocks and
git history become triples. It then validates that graph against SHACL shapes,
and queries, traverses, searches and exports it.
The root `CLAUDE.md` owns everything repo-wide. That
covers the worktree and npm rules, red/green TDD, fixtures per feature, and
Conventional Commits with what they release. It also covers the demo video
rule, the supersede-never-amend rule for proposals, and the lint and output
conventions. This file adds only what is specific to this tool.

Imported from [hawkeyexl/moose-kg](https://github.com/hawkeyexl/moose-kg) at
9f14ba6, published as nothing: `@hawkeyexl/dockg` never reached npm. Its
sources live under `src/kg/`, its tests under
`test/kg/{unit,integration,real,fixtures,helpers}`, its SHACL shapes under
`shapes/kg/`, its vocabulary document under `ns/kg/`, and its imported ADR log
(closed at 01040) under `docs/proposals/kg/`. It ships no schema file: pages
validate against the kg draft in `docs/proposals/0023/schemas/kg/`, bundled into
the build by `src/kg/schema.ts`. The metadata tool is a sibling in this
repository, imported by relative path (`../meta/index.js`), not a dependency.

## The data model, and the harvest rule

One graph, built from documents, with a deterministic IRI for every node.

- `src/kg/core/analyze.ts` reads one document into a `DocModel`: frontmatter,
  headings with slugs and nesting, links with their resolution, images, code
  blocks.
- `src/kg/core/derive.ts` is the vocabulary mapping: the rules that turn
  `DocModel[]` into `Quad[]`. This is where a new predicate is decided, and the
  file to read before adding one.
- `src/kg/core/emit.ts`, `emit-jsonld.ts` and `emit-rdfxml.ts` serialize those
  quads. `src/kg/core/search-index.ts` and `vector-index.ts` build the search
  artifacts; `iirds-package.ts` and `zip.ts` build the iiRDS container.
- `src/kg/core/git.ts` adds revision history and commit agents.

**The harvest rule is: deeper wins, and the page level is the fallback, per
fact rather than per page** (ADR 01024). A `kg` block that speaks to a fact owns it
outright; where the block is silent, the page-level twin feeds the graph.
`resolveKg` in `derive.ts` is the whole implementation, and the facts it
resolves are the only ones with a page-level twin. Page-level `prerequisites`,
`next-steps` and `related-pages` belong to another vocabulary and are
deliberately not harvested.

The asymmetry that follows is why `src/kg/core/harvest.ts` exists. The `kg`
block is `additionalProperties: false`, so a typo inside it is a schema error.
The same typo at the page level derives nothing, silently, because a page may
carry any other key it likes. Near-miss detection is the answer, and it warns.
A suspicion must never fail a build.

**What a field publishes is the schema's call, not this tool's.**
`x-manni-kg-output` is a boolean beside a top-level property, registered by
`manni meta` and read back through `Validator.kgOutputPreferences`
(`src/kg/core/kg-output.ts`). Absent means `true`. The filter runs **once**,
before `deriveGraph`. All four published outputs descend from what derivation
produces, so dropping the field there keeps it out of every one of them.
A mark nested inside `kg` is ignored, because the mark governs a top-level key
and `kg` is the top-level key.

Encrypted values are harvested like any other. kg never decrypts, so the graph
carries the `~…` token, which says a value exists and nothing about what it is.

## The namespace and the shapes

The *frontmatter key* is `kg:`. The *RDF namespace prefix* is also `kg:`, and
it resolves to `https://hawkeyexl.github.io/manni/kg/ns#`. Never conflate them.
The base IRI for minted nodes defaults to `urn:manni:kg:`.

- `ns/kg/` holds the vocabulary document the namespace IRI dereferences to. The
  rule that it must dereference is the reason the IRIs are the ones above and
  not a host that serves 404.
- `shapes/kg/` holds the SHACL contract `manni kg check` runs. It ships in the
  npm package, because `check` reads it at runtime. `ns/kg/` does not: what has
  to be reachable is the IRI, and that is served from `docs/public/kg/ns.ttl`
  on the site.
- **A published shapes or vocabulary file is immutable.** Evolve by adding a
  new three-segment version file beside it. MAJOR means a graph that used to
  pass now fails. MINOR means one that used to fail may now pass. PATCH means
  no change in validation behavior.
- The custom namespace stays minimal. Prefer a dcterms, skos, prov, schema.org,
  foaf or iiRDS term wherever one exists.
- The shapes are **closed** (`sh:closed`). A new derive predicate therefore
  fails `manni kg check` until the shapes learn it. That failure is the
  feature. A change that alters what the graph contains is not done until the
  shapes say so, in the same commit.

`src/kg/core/shacl.ts` also carries the two SKOS integrity checks core SHACL
cannot express: `skos:broader` cycles, and `skos:related` conflicting with
`skos:broaderTransitive`.

## Two build platforms, and why the runtime stays browser-pure

`tsup.config.ts` builds this tool twice.

1. The Node side: the `manni` bin and the library, `platform: "node"`.
2. `@hawkeyexl/manni/kg/runtime` and `@hawkeyexl/manni/kg/embed`,
   `platform: "neutral"` (ADR 01018). `src/kg/runtime/**` must load in a
   browser: no `node:` imports, no CommonJS interop, no bare specifiers a
   browser cannot resolve. `minisearch` is inlined for that reason, and
   `splitting` is off so `dist/kg/runtime.js` stays one file you can drop in
   with a script tag.

A `node:` import reaching the runtime's module graph is a **released bug**, not
a type error, because nothing in `tsc` knows which half it is compiling. The
bundle-purity test, `test/kg/integration/runtime-bundle.test.ts`, is the only
thing that catches it. It scans the built bundle, so run `npm run build` before
trusting it.

Anything a runtime module needs from Node belongs on the Node side of the seam,
with the runtime taking it as an argument. `src/kg/runtime/vector.ts` reads Web
Crypto off `globalThis` for exactly this reason.

## Determinism is the product contract

`manni kg build` twice over unchanged inputs must be byte-identical.

- Canonically sorted Turtle from the custom emitter, never a library's writer.
- **No wall clock anywhere.** Dates come from frontmatter first, then git
  committer times. Never `Date.now()`.
- **No blank nodes.** Every node gets a deterministic IRI, sanitized so the
  output always parses.
- Compare field by field with `byCodeUnit` (`src/kg/core/sort.ts`) rather than
  joining fields with a separator.
- Keep NUL bytes out of source. They make git classify a file as binary, which
  renders its diffs unreviewable.

`test/kg/fixtures/golden/` is the regression gate, and the corpus it is built
from is `test/kg/fixtures/corpus/`. **Changing the corpus invalidates every
golden**, not one: `graph.ttl`, `graph.jsonld`, `metadata.rdf`,
`traverse.json`, `localizations.json`, and one `search.<lang>.json` plus one
`vectors.<lang>.bin` **per language in the corpus** (ADR 01038). Adding a
language therefore adds two goldens. It also invalidates the document and
triple counts asserted across the build, query, stats and runtime suites.

All of them regenerate from the built CLI: `manni kg build`, then
`manni kg export search` for the indexes and the manifest, then
`manni kg embed --model mock --no-cache` for the sidecars and the manifest's
`vectors` blocks. The mock embedder is why the optional
`@huggingface/transformers` peer is not needed to regenerate them. Update a
golden only deliberately, and read the diff line by line first. Golden
comparison normalizes the tool version literal, so a release does not invalidate
them.

`manni kg stats --check` exits 1 on the fixture corpus **by design**: it carries
a deliberate broken link and a deliberate broken section reference.

## Config ↔ CLI flags (required pattern)

Every user-facing knob flows through the resolved config. CLI flags do **not**
bypass it; they override it.

```text
manni.config.yaml  →  `kg:` key (src/shared/config-file.ts)  →  Ajv validate (src/kg/core/config-schema.json)  →  defaults applied  →  CLI override  →  runtime
```

The family loader finds the file and hands this tool the value under `kg:`.
There is no per-tool legacy file name: a `dockg.config.yaml` is not read.
Inside the section `additionalProperties: false` catches typos; the schema's
root stays permissive because sibling keys are not ours.

Adding a knob:

1. **Schema first.** Add the field to `src/kg/core/config-schema.json`, with a
   positive and a negative case in `test/kg/unit/config.test.ts`.
2. **Type and default.** Extend `KgConfig` and `RawKgConfig` and apply the
   default in `parseConfigSection` (`src/kg/core/config.ts`), so the resolved
   shape is total and downstream code never re-applies one.
3. **Commander option** in `src/kg/cli.ts`, with a thin `.action` delegating to
   the `runX` core.
4. **Override at the read site** with `??`, inside `src/kg/commands/*.ts`.
5. **Read the resolved value** at the consumption site. Never read `argv` from
   a core, an emitter or a reporter.

Corpus-defining settings such as routes and derive sources may be config-only.

## Invariants

- **Exit codes:** `0` ok, `1` findings (SHACL errors, `stats --check` failures,
  fill errors), `2` operational or usage (`KgError`, which extends the family's
  `ToolError`).
- **Severity is the family's**, `notice | warning | error` from
  `src/shared/severity.ts`. SHACL's own `Violation | Warning | Info` maps onto
  it, and the source word stays in `shaclSeverity`, the way a11y keeps axe's
  `impact`. Findings are built through `finding()` in `src/kg/core/shacl.ts` so
  the translation happens in one place and no caller re-derives it.
- **Git is detected, never declared.** History is used wherever git can run over
  a repository, and a run that finds neither warns once through `warn()` and
  builds the rest. The warning carries git's own reason, because detection took
  away the user's way of saying "I require this". Do not add a config switch
  back: a switch for a detectable fact is one more way to be wrong. A job that
  needs the stronger contract expresses it as a shape over the built graph.
- **Machine attribution is page-level `meta-provenance`**, with JSON Pointers,
  written through `mergeMetaProvenance` from `src/meta/internal.ts`, the merge
  `manni meta fill` uses. Never grow a kg copy of it. There is no
  `kg.provenance`; a page that still carries one is refused by name, with the
  migration in the message.
- **Three `kg` pointers are hand-curated and a machine may never claim them**:
  `/kg/sections`, `/kg/revision-of` and `/kg/derived-from`. A `meta-provenance`
  entry naming one is a `manni kg check` finding at `error`. This guard moved
  here from the schema, which could not express it once pointers became free.
- **`kg fill` is the one verb that reaches a model.** Providers come from the
  family's top-level `providers:` map through `src/shared/providers.ts`, with
  `kg.provider` and `kg.model` as the tool-level override and `--local` over
  both. The default is `auto`. Never reimplement a provider, a cache or a price
  table here. The inference layer is
  [`@hawkeyexl/inference`](https://github.com/hawkeyexl/inference).
  `src/kg/llm/` keeps only what is this tool's own: the prompt and proposal
  schema, the cache-key composition, and the config-to-spec mapping.
- **The budget is turns, not dollars.** A turn is one inference call, which
  every model makes and every model can be counted making. A page left unfilled
  by the budget is `skipped` with reason `turn budget`.
- **The fill guardrail vets a proposal before it is written**
  (`src/kg/core/fill-guard.ts`). It simulates each proposal in the derived graph
  and drops any field that would violate the shapes. Accepted proposals fold
  into the guard's state, so two documents in one run cannot jointly corrupt the
  graph. Cached proposals are vetted too. Rejection sits downstream of the
  cache, so a later corpus change can re-admit a proposal without re-asking the
  model.
- **A mock is not coverage of the thing it stands in for** (ADR 01025).
  `createLocalEmbedder` once shipped a hardcoded `device: "wasm"` that threw on
  every real Node call, and the mocks certified it for a whole release. Adding a
  mock for an external library means adding the real-path test in the same
  change; those live in `test/kg/real/`, excluded from `npm test` and run by
  `npm run test:kg:real`.
- **No network in the default suite.** `npm test` is hermetic: model calls go
  through the inference library's `MockProvider`, and the git and CLI subprocess
  seams are injectable.
- **Section keys are camelCase; the vocabulary's own entries are kebab-case.**
  `baseIri`, `maxTurns` and `confidenceThreshold` in the config; `alt-labels`
  and `applies-to` on a page.
- The page vocabulary is **`manni:kg:1.0.0-proposal.3`**, proposed by the
  metadata tool (proposal 0023) and implemented here. `src/kg/schema.ts`
  imports the draft and tsup bundles it, so `dist` never reads `docs/`. Never
  ship a copy or patch it in memory: the vendored copy this tool used to
  publish is exactly what that avoids.

## Commands

- `node dist/cli.js kg build`, a dogfood build over the fixture corpus through
  the repository's own `manni.config.yaml`. The corpus is named by path in the
  `kg:` section rather than declared as a collection, because a bare
  `manni meta validate` reads every collection.
- `node dist/cli.js kg check`, the shapes gate over that graph.
- `node dist/cli.js kg stats --check`, which exits 1 on this corpus by design.
- `npm run test:kg:real`, the real-model suite. It needs the optional
  `@huggingface/transformers` peer and, for the fill half, a server on
  `OLLAMA_BASE_URL`. No CI job runs it.
- The root `CLAUDE.md` lists the rest: build, test, typecheck, lint, the docs
  drift checks and the site build.

## Decision records

A kg decision goes in the family series, as a proposal under
`docs/proposals/NNNN-*.md` in that series' format, like any other domain's.
Proposal 0051 is the first.

The imported ADR log, `docs/proposals/kg/`, is **closed at 01040**. It stays as
the record, and the ADR numbers cited above still resolve there. Do not add an
ADR to it. When a new decision replaces one of its ADRs, the proposal says so.
The ADR's status line is then the only edit, under the root's
supersede-never-amend rule.
