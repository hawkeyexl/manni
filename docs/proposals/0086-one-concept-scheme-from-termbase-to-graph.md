# 0086: One concept scheme, from the termbase to the graph

- **Status:** Implemented (#184–#190, #195); superseded in part by [0087](0087-a-golden-set-of-reader-questions.md)
- **Serves:** Three journeys.
  - Sara · S6, "Define our terminology and make `concepts:` mean something".
    Her term pages now shape the graph, and her pages' freeform concepts turn
    into term pages.
  - Maya · M18, "See the docset as a graph". One concept has one node, however
    a page spells it.
  - Devin · D12, "Gate the graph in CI". Each page must be found for the
    questions it declares.
- **Depends on:** Three earlier proposals.
  - [0052](0052-term-domain.md) is the `term` domain. Its § 2 promised that the
    term fields fall back into the graph.
  - [0063](0063-the-graph-vocabulary.md) renamed the block to `graph` and kept
    that promise in its § 4.
  - [0084](0084-tbx-lossless-and-multilingual-terms.md) made a term one record
    per language, joined on `id`.
- **Relates to:** Two records.
  - [0051](0051-graph-domain.md) § 11 says `manni term` owns the concepts. That
    stays true. The graph reads the termbase and never writes it.
  - [0074](0074-stewardship-graph-output.md) is the `x-manni-graph-output`
    mark, which still governs what a page publishes.
- **Supersedes, in part:** [0051](0051-graph-domain.md) § 11, where it implies
  the graph and the termbase hold separate concept sets. Its Status line is the
  only edit.
- **Touches:** `src/shared/term-labels.ts`, `src/graph/core/` (`derive.ts`,
  `iri.ts`, `shacl.ts`, `config-schema.json`), `shapes/graph/shapes-1.1.0.ttl`
  (new), `ns/graph/ns-1.2.0.ttl` (new), `src/term/core/` (`check.ts`,
  `load-set.ts`, readers and writers), `src/term/commands/fill.ts` (new),
  `src/meta/schemas/terminology{,-strict}/1.2.0.json` (new),
  `src/meta/core/validator.ts`, `docs/src/content/docs/`, `test/`
- **Verdict:** The termbase and every page's freeform concepts feed one SKOS
  concept scheme. `manni term fill` turns concepts the termbase lacks into term
  pages. With `--crawl` it also finds terms in page text. `term check` holds the
  scheme to the integrity rules a thesaurus needs. Terms map to outside
  vocabularies and travel as SKOS. A schema can hold any field to the termbase
  with `x-manni-term`. `graph check` asks each page's `sample-questions` and
  reports a page that is not found for its own question.

## Problem

### Two hierarchies that never meet

A term page carries `broader`, `narrower`, `alt-labels` and `definition`. 0052
§ 2 said the graph harvests them, and the `manni:graph` schema text still says
so. `derive.ts` never did. The graph builds its concepts from `graph:` blocks
and `concepts:` alone. So a team keeps two hierarchies, and nothing tells them
when the two disagree.

### One concept, two nodes

The graph mints a concept from the slug of whatever label a page wrote. A page
that writes `concepts: [PAL]` gets `concept/pal`. The term "Pluggable auth
layer", which lists PAL as an alt-label, gets a node of its own. A term whose
`id` differs from its label's slug gets a third.

### A termbase starts empty and loud

Pages name concepts long before anyone writes a term page. The day the first
term page lands, `term check` reports `undefined-term` at error on every
freeform concept in the corpus. Nothing turns those concepts into term pages.
Teams turn the rule off, and the termbase stays a list nobody checks.

### The vocabulary cannot leave, or arrive

There is no SKOS reader, so a scheme kept in VocBench or TemaTres cannot be
read. The SKOS writer drops top concepts and repeats a node per language. A
term cannot say it matches a Wikidata item or an industry vocabulary.

### Taxonomies outside the termbase

`audiences` is "your own taxonomy, unenumerated". A schema can enumerate values
with `enum`, but it cannot say "a term under Audience". So the org's taxonomy
lives in two places, the termbase and every schema that copies it.

### A graph nobody asks anything

Pages declare `sample-questions`, which `manni:ai-context` calls "the
retrieval-eval hook". Nothing reads them. `graph check` proves the graph's
shape, and nothing proves a reader can find a page by asking.

## The pipeline

The work runs as a pipeline. A controlled vocabulary comes first, then a metadata schema, a
taxonomy, a thesaurus, an ontology and a knowledge graph. Each stage feeds the
next, and later stages send fixes back up. manni already holds each stage in a
domain. This proposal connects them so the hand-offs happen in the tools.

## Design

### 1. One concept scheme

A concept comes from one of three places, and all three feed one
`skos:ConceptScheme`.

- **A term entry.** It can be a term page, a manifest, a TBX file or a glossary
  construct. The graph reads it through the same loader and collections
  `term check` uses.
- **A `graph:` block.** That means its `label`, `broader`, `narrower` and
  `related-concepts`.
- **A reference.** That means `concepts:`, `graph.concepts` or a section's
  `concepts`.

Identity follows the termbase.

- **Resolution.** A label resolves to a term by its label, then its id, then an
  alt-label. Case is ignored, and the page's own language is tried first.
- **Redirects.** A `see:` entry resolves to its target, and its label becomes
  an alt-label there.
- **IRIs.** A concept with a term is `{baseIri}concept/{id}`. A freeform
  concept keeps `{baseIri}concept/{slug}`. An id defaults to its label's slug,
  so most IRIs do not move.

The hierarchy is the union of every source.

- **Both directions.** Each `broader` edge is emitted with its `narrower`, and
  each `related` edge both ways.
- **Disagreement.** When a page's `graph:` block adds an edge to a concept the
  termbase defines, both edges stand. `term check` reports the extra edge as a
  notice, `hierarchy-outside-termbase`, on the page that declared it.
- **Content.** A term's concept carries `prefLabel`, `altLabel`, `hiddenLabel`,
  `definition` and `scopeNote`. Each is tagged with the term's language when it
  has one. Each language of a term joins one concept.
- **Top concepts.** A concept with no broader concept is a top concept of the
  scheme, both ways round.
- **Shapes.** `shapes-1.1.0.ttl` admits the new predicates. It is a minor
  version, because a graph that failed may now pass.

The config gains one derive source, `terms`, on by default.

```yaml
graph:
  build:
    derive: [frontmatter, sections, links, tags, images, code, provenance, terms]
```

A config that lists `derive` and leaves out `terms` builds what it built
before.

`term check` reads the same union. `broader-cycle` runs over every edge. An
alt-label in `concepts:` is now `alt-label-reference`, a warning, because the
graph resolves it. It used to be `undefined-term` at error.

### 2. Terminology 1.2.0

`manni:terminology:1.2.0` adds six keys.

| key | meaning |
|---|---|
| `notation` | A code that identifies the concept in another system |
| `exact-matches` | The same concept in another vocabulary |
| `close-matches` | A near-equivalent concept elsewhere |
| `broad-matches` | A broader concept in another vocabulary |
| `narrow-matches` | A narrower concept in another vocabulary |
| `related-matches` | An associated concept in another vocabulary |

Each match key takes one IRI or a list. `definition` is no longer required by
the schema. `term check` reports a missing one as `missing-definition`, at
error. The strict overlay keeps the requirement. `conflicting-matches` reports
an IRI listed under two kinds. `graph check` reports a mapping that points into
the scheme itself.

### 3. `manni term fill`

`term fill` creates a term page for each concept pages name and the termbase
lacks. It fills a missing definition on an entry that has none. It never
overwrites what a person wrote.

- **Definitions.** With a provider configured, a model drafts each definition.
  The draft passes a confidence gate and is recorded in `meta-provenance`.
- **Stubs.** With no provider, or with `--offline`, the page has no definition,
  and `missing-definition` reports it.
- **Carried facts.** Alt-labels, hierarchy and a `graph:` block's definition
  come from the pages that named the concept.
- **Crawl.** `--crawl` sends page bodies and free `keywords:` to the model,
  which proposes terms the metadata never named. A candidate needs
  `term.fill.crawl.minPages` pages and a confidence above the threshold.

### 4. Integrity rules

`term check` gains the checks a thesaurus needs.

| rule | default |
|---|---|
| `asymmetric-related` | warning |
| `related-in-hierarchy` | warning |
| `related-siblings` | notice |
| `label-overlap` | error |
| `ambiguous-alt-label` | warning |
| `deprecated-label` | warning |
| `orphan-term` | notice, only where the termbase has any hierarchy |
| `keyword-candidate` | notice |

`keyword-candidate` names a free keyword that appears on several pages and
matches no term. It feeds the next round of `term fill`.

### 5. SKOS in and out

A `.ttl` or `.jsonld` file named on the command line, or listed in
`term.manifests`, reads as SKOS. A directory walk never picks one up, because
the graph's own output is Turtle. `-f skos` merges languages into one node and
writes top concepts, notations and matches. `-f skos-ttl` writes the same
scheme as Turtle. Every field SKOS holds survives a round trip.

### 6. `x-manni-term`

A schema marks a field whose values must be terms.

```json
"audiences": {
  "type": "array",
  "items": { "type": "string" },
  "x-manni-term": { "under": "Audience" }
}
```

`under` limits the values to terms below that one, at any depth. The branch
root is never a value. `meta validate` reports `term:undefined`,
`term:outside-branch` and `term:alt-label`. `meta fill` offers the allowed
labels. A run that finds no termbase warns once and checks nothing.

### 7. Sample questions

`graph build` derives each page's `sample-questions` as `graph:sampleQuestion`.
`graph check` asks each one through the retrieval `graph search` uses. It
reports a page that is not in the top `graph.check.questions.top` results for
its own question. The default severity is warning.

The check measures finding, not answering. Judging an answer needs a model,
and `graph check` stays deterministic.

## What this does not do

- **Write the termbase from the graph.** The graph reads terms. Only `term fill`
  and a person write them.
- **Judge prose.** Definitions are drafted by `term fill` and reviewed by a
  person. Their quality is docevals' ground, through `term lint` and judged
  evals.
- **Reason over the scheme.** There are no OWL axioms and no inference. The
  checks are structural, and SHACL stays closed-world.

## Decisions

The user took these on 2026-10-18.

- A hierarchy conflict resolves as a union, and gets flagged.
- The bootstrap verb is `term fill`, beside `meta fill` and `graph fill`.
- A model drafts definitions when one is configured. Otherwise the page is a
  stub, and `term check` reports the gap.
- A sample question that is not found is a warning by default.
- `under` admits descendants at any depth, never the branch root.
- `term fill` gains a crawl mode.
