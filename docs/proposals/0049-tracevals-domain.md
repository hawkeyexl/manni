# 0049: the `tracevals` domain: session adherence joins the family

- **Status:** Proposed
- **Serves:** Maya · M14–M17 · Devin · D10, D11 · Sara · S10, S11 · Theo · T5
- **Depends on:** [0033](0033-manni-monorepo.md), the umbrella this domain
  mounts on and the import recipe it follows. [0034](0034-command-grammar.md),
  the grammar: spelled verbs, no default subcommand, one separator per list.
  [0048](0048-docevals-domain.md), the sibling eval domain, whose `providers:`
  map, turn budget, severity scale and format names this one adopts rather
  than deciding again. [0046](0046-provenance-pins.md), whose `meta-provenance`
  records `fill` writes and the self-preference check reads.
  [0047](0047-field-location.md), which marks those records `external`.
  [0023](0023-metadata-vocabularies.md), whose artifact-evals draft is this
  tool's vocabulary
- **Relates to:** [0041](0041-collections.md), which said tracevals takes
  traces, not documents, and is untouched by `collections:`. This proposal
  says where that holds and where it bends.
  [0045](0045-family-encryption-key.md), the precedent that a shared concept
  is defined once under `src/shared/`
- **Supersedes:** tracevals [ADR 01007](tracevals/01007-ship-a-cuj-first-documentation-site.md),
  the co-located content strategy. [ADR 01008](tracevals/01008-rename-the-project-to-moose-tracevals.md)
  and [ADR 01009](tracevals/01009-share-one-moose-config-file-across-the-family.md),
  the moose names and the moose config file.
  [ADR 01012](tracevals/01012-verify-quoted-paths-and-pin-the-vendored-schema.md)
  in part, the vendored schema copy and its hash pin.
  [ADR 01025](tracevals/01025-adopt-artifact-evals-proposal-2.md), the
  vocabulary version. Each keeps its text; only the Status line moves

## Problem

An agent session either followed the instructions it was given or it did not.
Until now nobody could find that out from an installed tool. Maya writes the
artifacts a repository's agents run on: `CLAUDE.md`, skills, subagents, slash
commands. She has no way to ask whether a session honored them. Devin cannot
gate it in CI. Sara cannot tell whether a judge that answers the
question is trustworthy enough to gate a build. Theo reads a red line with
nowhere to go.

moose-tracevals answers all four, and was never published to npm. Using it
meant cloning a second repository, learning a second config file, and reading
reports on a second set of scales. Row 6 of [0033](0033-manni-monorepo.md)
says it folds into the family. This proposal records how.

## Decision

### The domain

`manni tracevals` mounts under the umbrella with `addCommand` and carries five
verbs: `run`, `calibrate`, `fill`, `capture` and `list`. There is no default
subcommand. `docmeta docs/` was grandfathered because scripts had been written
against it; nothing was ever written against `moose-tracevals`, so the verb is
spelled.

The import is hawkeyexl/moose-tracevals at fed983b. An earlier import commit
carried edits to shared files: a second sync fork of the config loader, a
per-tool `packageRoot()`, a rewritten CLI-reference checker. All are dropped.
Each already exists on main or arrived with 0048, and a tool that folds in
adopts what is there rather than bringing its own.

### 1. Traces are not documents, and collections say where, not what

`collections:` names document sets. `run` and `calibrate` take **traces**,
which are session transcripts in Claude Code's own store, so they read no
collection and take no `--collection`. 0041 said as much.

`fill` is the one verb that reads files a person wrote, and it still does not
read `collections:` **to choose its inputs**. A docs collection is not a set
of agent artifacts, and pointing `fill` at one would propose evals for prose
no agent executes. It keeps its own detection. That detection finds the
artifacts a project actually has, under `--project`. It gains
`--exclude <glob>`, repeatable, so a fixture tree can be kept out of a
proposal run.

Every verb does read `collections:` for one other thing. The distinction is
the whole of it: **a collection never selects tracevals' inputs, but it
does say where a relocated block lives.** 0047 marks the whole `metadata` key
`x-manni-location: external` (§4). So `manni meta relocate` can move an
artifact's `evals`, `eval-skip` and `meta-provenance` into the
external-metadata manifest a collection declares. The three move together, as
one block. A tool that read only front matter would then grade that artifact
as declaring nothing. No evals, no trail, no error, and a clean gate over an
artifact with a suite on it. So `run`, `calibrate` and `fill` load every
declared collection's metadata-owning manifest and merge it through meta's own
`mergeExternalMetadata`, which is what `manni cite` does with `citations`.

Three rules follow cite's, for cite's reasons:

- **Membership is computed against every declared collection**, never the
  subset a run selected. An artifact `fill` was handed by path is still a
  member of the collection that holds its manifest. A run that decided
  otherwise would report it as declaring nothing and then write a second copy.
- **`fill` writes where the metadata lives.** A manifest that owns the block
  receives the proposals through meta's splice writer; the artifact is not
  touched. Where nothing owns it, the page is written as before, and the run
  says so in the words `meta fill` and `meta derive` already use for a
  homeless key.
- **A URL manifest is readable and not writable.** `run` grades a hosted trail
  happily. `fill` refuses to write into one, exit 2, the way cite refuses the
  same thing. `--offline` refuses to fetch it at all, with meta's message.

There is still no `--collection` and no config key of tracevals' own. A
collection is read because it is already declared, not because tracevals asked
for one.

Detection is also why `run` has no switch naming the trace store. That
location is Claude Code's to say, and it says it with `CLAUDE_CONFIG_DIR`.
tracevals reads that variable, and `MOOSE_TRACEVALS_HOME` is gone.

### 2. The family's values

Severity is `error | warning | notice`, from `src/shared/severity.ts`. The
`info` the imported code used is gone, in the vocabulary and in every report.
Formats are the family's names, with `pretty` first and default: the report
that used to be called `human` is `pretty`, unchanged byte for byte. `list`
reports through `-f json` rather than a `--json` of its own. Section keys are
camelCase, and a kebab spelling is refused with the camel one named. stderr
leaves through the shared `warn()`, `notice()`, `fail()` and `errorMessage()`,
so the prefix is `programName()`'s and never hand-spelled. A parser refusal
exits 2.

### 3. Providers are declared once, and the budget counts turns

The nested `tracevals.provider` object is gone. `tracevals.provider` is now a
provider's name and `tracevals.model` a model within it. The connection
settings live in the family's top-level `providers:` map that 0048 added.
Those settings are `apiKeyEnv`, `baseUrl`, `command` and `modelsDir`.
Selection runs through `src/shared/providers.ts` in this order: `--local`,
`--provider`, the eval's own `provider:`, `tracevals.provider`,
`providers.provider`, then `auto`. `--local` overrides rather than refuses,
with one notice per replaced choice, and `--local --provider <hosted>` is a
contradiction, exit 2. No model id is hardcoded anywhere in the tool.

The per-provider `pricing` table goes with it, and `--max-cost-usd` becomes
`--max-turns`, matching docevals ADR 01019. A dollar ceiling cannot be
enforced exactly while ensemble runs are in flight concurrently; a turn count
can, and a cached ensemble costs no turn. The `cost` built-in grader is a
different thing, and it stays. It grades what the *graded session* spent,
which the trace itself records. It needs no price table of ours.

### 4. The vocabulary is the repository's draft, not a copy

`schemas/tracevals/` shipped two copies of the artifact-evals draft, pinned by
a sha256 test, and their bytes had already drifted from the proposal's. The
copies are gone, with the package `exports` that served them and the
`packageRoot()` lookup that found them. tracevals imports
`docs/proposals/0023/schemas/artifact-evals/1.0.0-proposal.4.json` directly,
and the bundler inlines it, as docevals does with the evals draft.

proposal.4, not the proposal.2 the import carried. That crosses two renames.
`severity: info` became `notice`. `metadata.eval-provenance` became
`metadata.meta-provenance` under a narrowed guard, `^eval-(?!skip$)`. That
guard makes the old key a reserved-prefix error rather than a silently ignored
member. proposal.4 then marks the whole top-level **`metadata`** key with
`x-manni-location: external` (0047), not `meta-provenance` alone. The mark
sits on the map, so `evals`, `eval-skip` and `meta-provenance` relocate as one
block and cannot be split across an artifact and a manifest. What lives
outside the artifact a person reads is therefore the whole declaration, not
only the trail. §1 says how every verb reads it back.

Nothing here needs a migration. The vocabulary is a draft under review, and
the tool that wrote the old spellings was never published.

### 5. The self-preference check reads 0046's records

An artifact whose evals a model proposed, graded by that same model, is a
model marking its own homework. The check keeps both axes:

- **session**: the trace's model is the judge's model;
- **criterion**: the judge's model appears in a `meta-provenance` entry that
  lists the eval's id.

The criterion axis used to read `metadata.eval-provenance`, whose entries
`fill` keyed by `provider:model` while the check compared a bare model name,
so it could quietly never fire. `fill` now writes through the same
`meta-provenance` merge `manni meta fill` uses, and the check reads that.

### 6. The content strategy is the family's

No new persona. Upstream's five fold in. Priya goes into Maya, Sam into Sara,
and upstream's Devin and Theo into the family's. Rin, the toolsmith, goes into
D11 and the API reference. The journeys become M14–M17, D10, D11, S10, S11 and
T5 in `docs/content-strategy/cujs.md`. There is no `docs/content-strategy/tracevals/`
directory, for the reason 0048 gave: a per-tool strategy is a second answer to
the question of who the family serves.

### 7. The imported ADR log closes at 01033

`docs/proposals/tracevals/` is a record, not a live log. Later decisions about
tracevals are family proposals in the NNNN series. They are family decisions
now. They land in one package, on one config file, under one set of scales.

## Known limits

- **A collection declared for one tool is read by every tool.** The family
  file is shared, so `manni meta validate` with no paths validates whatever
  `collections:` names. tracevals declares no collection of its own. It reads
  the declared ones only to find a relocated block (§1), so it never widens
  what a run covers. It does inherit the shared declaration's blast radius.
- **Two collections owning `metadata` for one artifact is refused by `fill`,
  exit 2.** Reading two is meta's duplicate finding. Writing would be the
  tiebreak 0020 refuses, so the writer stops instead.
- **`fill` detects artifacts by convention.** An artifact in a location no
  convention names is never proposed for, and `--exclude` can only subtract.
- **The homeless-key warning is silent when no collection is declared.**
  proposal.4 marks `metadata` external unconditionally. So a repository with
  no `collections:` at all would hear the warning on every `fill`. The schema
  would rather its evals lived somewhere that repository has not set up. The
  warning is kept for the case a person can act on: collections exist, and
  none of them owns the block.
- **The judge digest is redacted best-effort** (ADR 01020) before it leaves
  the machine. The verdict cache under `.manni/tracevals/cache` keeps the
  observed text in the clear. The family key (0045) covers schema-marked
  fields, not caches. A repository that treats session content as sensitive
  should keep that directory out of version control, which `.gitignore`
  already does.

## Stress test

### 1. Why re-import instead of rebasing the branch that already existed?

Because almost every conflict would be resolved by deleting the branch's side.
Its shared-file edits were written against a main from before collections, the
family key and the providers map. Those edits are the config-loader fork,
`packageRoot()` and the CLI-reference rewrite. Re-landing the tool's own trees
on top of 0048 and re-applying four small mounts by hand is smaller than
resolving them. It leaves no fork behind.

### 2. Why does `fill` keep its own detection when every other document verb takes `collections:`?

Because its inputs are not documents. `.claude/skills/*/SKILL.md` and
`CLAUDE.md` are instructions to a machine, they live where the runtime looks
for them, and a person does not choose their paths. Reading a docs collection
would propose evals for prose that no agent ever executes. The parity rule
asks the verbs to share a surface where that makes sense. Here it does not.
`--exclude` covers the case a collection would have served.

That is about **selection** only. A collection that contains an artifact still
says where that artifact's `metadata` block lives, and `fill` reads and writes
it there (§1). Ignoring the declaration would have meant proposing evals an
artifact already declares, and writing a second copy of them to the page.

### 3. Why not keep `--max-cost-usd` as well, for people who budget money?

Two spellings of one budget is the thing "commands must have parallel
behaviors" exists to prevent, and of the two, turns is the honest one. Dollars
were computed from a price table that goes stale silently, and an unknown
model priced at zero made a ceiling that could not bind. A turn is a fact
about the run.

### 4. Why bundle proposal.4 when docevals bundles proposal.3?

Because proposal.4 is the current draft, and its one addition is the mark
tracevals is the first tool to need: `meta-provenance` is `external`. Bundling
proposal.3 would ship a tool that cannot see a trail `manni meta relocate`
moved. The two drafts are independent files, so docevals moving to its own
proposal.4 is a separate change and not a condition of this one.

## Consequences

- One install, `@hawkeyexl/manni`, gets a team meta, a11y, cite, docevals and
  tracevals, on one config file and one set of scales.
- `manni tracevals` is a `feat`, a minor release. Nothing in it breaks a
  published surface, because none of it was published.
- The tool's own state stays where the import put it, under `.manni/tracevals/`.
- hawkeyexl/moose-tracevals is archived once the release is on npm, with a
  README pointing here (row 8 of 0033).

## Release

`feat(tracevals): fold moose-tracevals in as manni tracevals`, squash-merged:
a minor on top of the release that carries 0048.
