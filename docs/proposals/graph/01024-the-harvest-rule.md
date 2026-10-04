---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
---

# Deeper wins per fact, with the page level as the harvest fallback

## Context and Problem Statement

Until now the `kg` block was the only frontmatter dockg read for graph facts, with one exception:
page-level `tags`/`keywords` were *unioned* into `dcterms:subject` alongside `kg.subjects`.

Adopting `docmeta:kg` ([ADR 01023](01023-adopt-docmetas-common-kg-vocabulary.md)) changes the
situation, because the vocabulary family it belongs to deliberately gives four `kg` fields a
page-level twin:

| Fact | `kg` block | Page level |
|---|---|---|
| what the page is | `kg.type` (closed iiRDS enum) | `type` (open, `docmeta:core`) |
| what it is about | `kg.concepts` | `concepts` (`docmeta:structure`) |
| what it applies to | `kg.applies-to` | `applies-to` (`docmeta:structure`) |
| what it does not | `kg.not-applicable-to` | `not-applicable-to` |
| what it replaces | `kg.revision-of` | `supersedes` (`docmeta:lifecycle`) |

That is intentional. A team should be able to say "this page applies to the FIPS build" without
opening a `kg` block at all. But it leaves dockg with a question it has never had to answer. When
a page declares a fact at both altitudes, which one reaches the graph?

The existing union behavior is not a usable default here. Under a union, a page that says
`applies-to: [SP-X100]` at the top and `applies-to: [SP-X200]` in the block would be scoped to
*both*. That is neither of the things the author wrote. In the negative-scope case
([ADR 01014](01014-negative-scope.md)) it can produce a graph that is disjoint-violating on its own
frontmatter.

## Decision Drivers

- An author correcting a page-level fact in the `kg` block must be able to *replace* it, not add to
  it. Correction is the common reason to reach for the deeper altitude.
- Silence must stay silent. A page with no `type` and no `kg` block must derive nothing, not a
  guessed topic type ([ADR 01008](01008-graph-as-index-not-corpus.md)).
- The two `type` altitudes speak different vocabularies: the page's is open, `kg.type` is a
  published iiRDS enum. dockg must not invent iiRDS terms.
- Sections are explicit-only ([ADR 01013](01013-section-level-metadata.md)). Whatever is decided
  for documents must not start leaking document facts into section nodes.
- dockg must not quietly claim facts belonging to vocabularies it does not implement.

## Considered Options

1. **Union both altitudes.** The current `tags` behavior, generalized.
2. **Deeper wins, per fact.** A `kg` field that is present owns that fact outright.
3. **Deeper wins, per page.** Any `kg` block at all suppresses every page-level twin.
4. **Read the `kg` block only.** No harvest, and page-level twins are ignored.

## Decision Outcome

**Option 2 was chosen.** *Deeper wins, with the page level as the harvest fallback, **per fact***.
This is also the ruling recorded on the docmeta side, so the two repos agree on what the
vocabulary means.

Per fact, not per page, is the whole distinction. Under option 3, adding `kg.label`, a fact with
no page-level twin at all, would silently switch off a page's `applies-to`. Facts are resolved one
at a time, in [`resolveKg`](../src/core/derive.ts), which is the single place the rule lives.

Option 4 was rejected because it makes the page-level twins dead keys in dockg specifically. That
would make dockg the reason the family's flat-page design does not work.

**Scope is deliberately limited to the five facts above.** The harvest rule as stated on the docmeta
side also mentions `prerequisites` → `dcterms:requires` and `next-steps`/`related-pages` →
`dcterms:references`. Those are not twins of any `kg` field. They are `docmeta:structure`'s own
fields, and harvesting them is *implementing another vocabulary*, not resolving an altitude
conflict. That is separate work with its own shapes impact. A test pins that dockg does not do it
today, so the absence is a decision rather than an oversight.

### Deriving `kg.type` from the page's `type`

When the block is silent, the page's open `type` derives a topic type through a fixed map in
[`src/core/iirds.ts`](../src/core/iirds.ts):

| page `type` | `kg.type` |
|---|---|
| `how-to` | `task` |
| `tutorial` | `learning` |
| `explanation` | `concept` |
| `reference` | `reference` |
| `troubleshooting` | `troubleshooting` |

A page type with **no** entry derives nothing. That is the important half. Inventing an iiRDS term
for `blog-post` would put a claim in the graph that nobody made. iiRDS's enum is published, and
dockg references its terms rather than minting them
([ADR 01012](01012-iirds-core-vocabulary.md)).

### Consequences

- **`concepts` changes from union to replacement.** A corpus that sets `kg.concepts` *and* a
  page-level `concepts` will lose the page-level values from `dcterms:subject`. `tags`/`keywords`
  are unaffected: they are dockg's own derive source and a different fact, so they still union in.
- **Pages with no `kg` block can now derive iiRDS triples.** A corpus that types its pages at the
  top level will gain `iirds:has-topic-type` and `iirds:relates-to-product-variant` edges on
  upgrade. That is the feature, but it is a graph diff and the release note must say so. It can
  also surface real `sh:disjoint` findings that were previously invisible.
- `emitIirdsTyping` is no longer gated on a `kg` block existing. Sections are unaffected: they are
  passed their own block, never the harvested one, so explicit-only still holds.
- The page-level spelling is `generated-by`, not the old camelCase `generatedBy`. That key is not
  part of this rule. `docmeta:ai-context` owns it outright, and the `kg` twin is gone
  ([ADR 01023](01023-adopt-docmetas-common-kg-vocabulary.md)). It moves in the same release.

### Confirmation

- `test/unit/derive.test.ts` has a "the harvest rule" block. It covers each fact in all three
  states. Block only, page only, and both, where the block must win *outright*. It also covers
  every one of the five type mappings and the unmapped page type deriving nothing. Then the
  explicit block winning, the shorthand on every list field, and the guard that a harvested
  document fact never reaches a section node.
- A test pins that `prerequisites`/`next-steps`/`related-pages` derive nothing, so the scope
  boundary is enforced rather than merely described.
- [`test/fixtures/corpus/docs/harvest.md`](../test/fixtures/corpus/docs/harvest.md) carries the
  feature end-to-end through the golden: page-level `type`, `applies-to` in single-string shorthand,
  `concepts`, `supersedes`, and `generated-by`, with no `kg` block at all.

## Pros and Cons of the Options

### 1. Union both altitudes

- Good, because nothing is ever lost.
- Bad, because a correction becomes an addition, and for `applies-to`/`not-applicable-to` a page
  can contradict itself into a SHACL violation from frontmatter that reads perfectly sensibly.

### 2. Deeper wins, per fact

- Good, because the deeper declaration means what an author reaching for it intends: replace this.
- Good, because facts stay independent. Declaring one `kg` field never disturbs another.
- Bad, because "both are set" silently drops a value. Loud enough in the golden diff; invisible in
  a single page.

### 3. Deeper wins, per page

- Good, because it is one rule to state.
- Bad, because it couples unrelated facts: a `kg.label` would switch off a page's `applies-to`.

### 4. Block only, no harvest

- Good, because it is the smallest change and the most predictable.
- Bad, because it makes the family's page-level fields inert in dockg, which is the tool that most
  needs them.
