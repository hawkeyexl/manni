---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
---

# Adopt docmeta's common `kg` vocabulary instead of self-hosting a frontmatter schema

## Context and Problem Statement

dockg has published its own frontmatter contract since version 0.1, as eight immutable JSON
Schemas under [`schemas/`](../schemas). Each change adds a version file.
[CLAUDE.md](../CLAUDE.md) recorded the rule that made that work. *Schemas and shapes are
self-hosted, and dockg schemas never go into docmeta's built-in registry.*

docmeta has now reversed the premise that rule rested on. Proposal 0023 (*the docmeta metadata
vocabularies*) publishes nine common vocabularies and draws a new dividing line:

> docmeta publishes common metadata vocabularies. Tools implement behavior against them, whether
> graders, graphs, or runtimes.

One of the nine, `docmeta:kg:1.0.0-proposal.1`, **is dockg's `frontmatter-0.8`**, reworked. The
proposal was designed by walking dockg's draft contract alongside docevals' and moose-tracevals'.
It carries an explicit dockg-side ledger. Adopt the kebab spellings and apply a page-level harvest
fallback. Derive the topic type, normalize the single-string shorthand, and supersede the
never-a-docmeta-built-in rule. The proof that it is the same contract is that the proposal's own
`kg` example ladder case 9 is a line-for-line translation of
[`test/fixtures/corpus/docs/configuration.md`](../test/fixtures/corpus/docs/configuration.md).

Two things make this urgent rather than optional. The vocabulary is *common*. A grader, a graph
builder, and a retrieval tool reading the same `kg` block is the whole point, and dockg holding a
private dialect defeats it. The window is also cheap, because the same reversal is free for
docevals and moose-tracevals, neither of which has shipped.

So: where does dockg's frontmatter contract come from now, and what happens to documents written
against 0.8?

## Decision Drivers

- A common vocabulary only pays off if the implementations agree byte for byte. A near-copy is worse
  than no copy, because it looks compatible.
- Proposal 0023 is **under review and explicitly unregistered**, saying "Do not register, sync,
  or default any of these ids before the review concludes." So dockg cannot resolve
  `docmeta:kg:1.0.0-proposal.1` from docmeta's registry. It is not in it.
- dockg's published schemas are immutable. Whatever lands must not edit `frontmatter-0.8.json`.
- Determinism is the product contract. A rename must not move a single triple that is not genuinely
  about the renamed fact.
- docmeta's own house rule: *do not add a deprecated alias to soften a rename*, because an alias is
  a permanent second surface.

## Considered Options

1. **Stay self-hosted.** Keep `frontmatter-0.9` with dockg's own spellings.
2. **Vendor docmeta's draft bytes now**, pending registration, and hard-break the camelCase names.
3. **Vendor, but dual-read camelCase** through a deprecation window.
4. **Wait for docmeta to register `docmeta:kg:1.0.0`** before changing anything.

## Decision Outcome

**Option 2 was chosen.** Ship
[`schemas/docmeta-kg-1.0.0-proposal.1.json`](../schemas/docmeta-kg-1.0.0-proposal.1.json) as a
**byte-verbatim copy** of docmeta's draft, `$id` included, and read only the new kebab spellings.

The file is named for its origin, not `frontmatter-1.0`, because it is not dockg's schema: the
bytes are docmeta's and the `$id` says so. `bundledSchemaPath` points at it;
`frontmatter-0.1`–`0.8` stay on disk untouched, because published schemas are immutable and someone
may still pin one.

**Verbatim is the load-bearing word.** Rewriting the `$id` to a `dockg.dev` URL would have made the
copy dockg's own contract again under a borrowed name. That is the exact failure this decision
exists to avoid. It would also have cost the one cheap integrity check available, a sha256 of the
file against the upstream revision, asserted in `test/unit/kg-vocabulary.test.ts`. A hash rather
than a path comparison, because docmeta is an npm dependency in CI and not a working tree.

Option 4 was rejected on sequencing, not principle. The review it waits on is the one this adoption
is evidence for. Blocking until registration would leave dockg unable to demonstrate that the
vocabulary works in the implementation it was derived from.

Option 3, dual-reading camelCase, was rejected for docmeta's reason and one of dockg's own. The
reason is not that breakage is free. This is a `feat!:`, and it costs the major version and a
release note. It is that an alias is a permanent second surface. Here it would be a second
surface on the very contract whose point is that everyone reads one. dockg's own reason is
narrower and sharper. `dockg validate` would reject a camelCase document that `dockg build`
happily derived from. Two commands disagreeing about what the frontmatter says is a worse
failure than a loud rename.

For the same reason, the deriver stops accepting the deprecated single-object `kg.provenance`
shape and the `kg.generatedBy` key. Both are rejected by the vendored schema, so deriving from
them would reintroduce exactly that disagreement.

### The version scheme this brings with it

The nine vocabularies carry **three-segment** semver where dockg's own artifacts carry two. That is
not cosmetic. Published bytes are immutable, so the only lawful way to fix a typo in a field
`description` is to publish a new version. With two segments the only available move is `0.9`,
which announces new fields when none were added. Three segments let a documentation fix be a PATCH
and say so:

| Segment | Means |
|---|---|
| MAJOR | a document that used to validate now fails |
| MINOR | a document that used to fail may now pass; every old one still validates |
| PATCH | no validation-behavior change at all |

dockg adopts this for its own published artifacts going forward. The existing
`frontmatter-0.N.json` and `dockg-0.N.ttl` files are published and stay as they are; the convention
binds the next version file of each, which will be three-segment.

### Consequences

- **Every 0.8 document must be migrated.** The `kg` block is closed, so `prefLabel`, `subjects`,
  `topicType`, `appliesTo`, `softwareSubject` and the rest now fail `dockg validate` loudly rather
  than being silently ignored. This is a breaking change and the release note must say so.
- **`dockg.config.yaml` breaks too, and the release note must say that separately.** It is easy
  to read this decision as frontmatter-only and migrate just the docs. Two config surfaces name
  the same vocabulary and were renamed with it:
  - `fill.fields`, whose enum is the twelve fillable field names. `fields: [prefLabel]` now
    fails Ajv with `/fill/fields/0: must be equal to one of the allowed values` (exit 2).
  - `stats.coverageThreshold`, whose per-field map is `additionalProperties: false` over the
    measured field names. `coverageThreshold: { prefLabel: 80 }` fails the same way.

  Both rejections are the intended loud failure, and `test/unit/config.test.ts` pins them so the
  enums cannot quietly widen back.
- **`dockg fill` refuses a document whose `kg.provenance` is the deprecated single-object shape**
  rather than overwriting it. `provenance` is written wholesale on every fill, and the legacy
  shape is deliberately unreadable. Proceeding would silently delete another model's
  outstanding review record, the one thing the provenance trail exists to prevent. It is a
  per-doc error, so the run continues at exit 1, and the message names the migration.
  Proposal 0023's summary claims "every 0.8-valid document stays valid". That holds for the
  *widening* only. Its own ladder pins N2 and N8, both 0.8-valid, as expected rejects.
- **The emitted graph does not move.** Only frontmatter *keys* changed; the RDF mapping always
  lived in field descriptions. `iirds:has-topic-type`, `dockg:notApplicableToVariant` and every
  other predicate keep their names, so a consumer's SPARQL keeps working. Migrating the corpus
  fixture produced a **byte-identical golden**. That is the fidelity proof, and the same role
  proposal 0023's translated ladder case plays.
- Two places do surface a field name as data, and they change: the `dockg:filledField` literal and
  the `#prov.kg-fill.<model>.field.<name>` IRI.
- The `kg` block gains the single-string shorthand and loses the empty-list hole (`minItems: 1`
  everywhere). So `applies-to: []`, which used to read as "scoped, to nothing", is now a
  rejection.
- **dockg now tracks an upstream draft.** When docmeta publishes a new revision of the proposal,
  the sha256 pin fails, which is the intended signal. When the id is finally registered, the
  vendored copy should be reconsidered. That is a follow-up this ADR does not decide.
- The published SHACL shapes are **unchanged**. Their shape-node local names still read
  `dsh:Document-topicType`, but `sh:path` values are the predicates, and those did not move.
  The cosmetic drift is corrected at the next genuine shapes version.
- [CLAUDE.md](../CLAUDE.md)'s "schemas and shapes are self-hosted" invariant is superseded in its
  schema half. Shapes remain self-hosted; the frontmatter schema is vendored.
- The field *naming* recorded in ADRs [01012](01012-iirds-core-vocabulary.md),
  [01013](01013-section-level-metadata.md), [01014](01014-negative-scope.md) and
  [01015](01015-fill-confidence.md) is superseded here. Those ADRs remain authoritative for their
  decisions. The iiRDS vocabulary, section-level typing, negative scope, and the confidence
  trail all survive intact under new spellings.

### Confirmation

- `test/unit/kg-vocabulary.test.ts` ports **all 21 cases** of docmeta's own `kg` ladder, 9 positive
  and 12 negative. They run against the vendored file, alongside the sha256 pin and an `$id`
  assertion. Each negative names the key its error must point at, so a case cannot pass for the
  wrong reason.
- The golden determinism gate is byte-identical across the migration, and `dockg check` stays at
  0 violations on the clean corpus. That is the evidence no shapes bump is owed.
- `test/unit/schema-sync.test.ts` now proves the property it always existed for: a `kg` block
  shaped the way `fill` proposes is *validated* against the schema, rather than compared on a
  declared `type` string.

## Pros and Cons of the Options

### 1. Stay self-hosted

- Good, because nothing breaks and no upstream draft is tracked.
- Bad, because it forfeits the only thing a common vocabulary buys, which is a grader, a graph,
  and a retrieval tool reading one block. It keeps all the cost of maintaining a schema.

### 2. Vendor verbatim, hard break

- Good, because the bytes are provably upstream's, checkable with one hash.
- Good, because `validate` and `build` cannot disagree about what frontmatter means.
- Bad, because every existing corpus needs a migration pass, with no codemod shipped.

### 3. Vendor with a camelCase dual-read

- Good, because existing corpora keep building untouched.
- Bad, because the two commands disagree. `build` would derive from documents `validate` rejects.
- Bad, because the alias never goes away in practice. It is a second surface on the one
  contract whose value is that there is only one.

### 4. Wait for registration

- Good, because it avoids carrying a copy at all.
- Bad, because the review it waits for is the one this work is evidence for.
