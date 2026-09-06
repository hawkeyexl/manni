---
status: accepted
date: 2026-08-31
decision-makers: hawkeyexl
---

# Language is a scope dimension, and translations link with schema.org terms

## Context and Problem Statement

dockg supports localized corpora with exactly one triple. A page-level `lang`/`language`
frontmatter key derives `dcterms:language` on the Document node, as an unconstrained literal.
`sh:maxCount 1`, no datatype, no pattern, so `"de"`, `"de_DE"` and `"German"` all validate. That
value reaches the iiRDS package as `iirds:language`. Nothing else in the tool reads it: `grep
language src/runtime/` returns nothing, no corpus fixture sets it, and it therefore appears in none
of the byte-exact goldens.

That is a gap in the one place this project claims to be different. dockg exists because *"an
absent edge is an interlock, forcing disciplined silence instead of helpful fabrication"*
(DESIGN.md). Language is a variant boundary structurally identical to product variant, on the
axis where a wrong answer is most obvious to the reader. Product variants get the full apparatus.
Positive edges (`iirds:relates-to-product-variant`), explicit negatives
(ADR 01014), `sh:disjoint` conflict detection, and scope filtering in `traverse` with the firing
rule recorded in the trace. Language gets a literal nobody reads. A German question can be
answered out of the English page with a confident citation. That is the edge contamination the
graph is supposed to prevent deterministically.

Four concrete harms follow from the same root:

- **No translation relation exists.** Nothing states that `docs/de/install.md` is the German of
  `docs/en/install.md`. `impact` therefore does not reach a page's translations when its source
  changes. That is the canonical localization governance job, and precisely the category
  [ADR 01008](01008-graph-as-index-not-corpus.md) names as dockg's differentiation over flat
  retrieval. A localization manager cannot ask the graph the only question they have.
- **Coverage describes nobody.** A corpus at 100% English and 0% German reports one blended
  number near 50%. [ADR 01029](01029-coverage-catches-up-with-the-vocabulary.md) already
  established that a coverage row which cannot mean anything teaches readers to ignore the table.
  A row averaged across audiences is the same failure in a different shape.
- **A typo in the language key is silent.** `languge: de` derives nothing and warns about nothing.
  [ADR 01028](01028-near-miss-warnings-for-harvested-keys.md) closed exactly this hole for the
  five harvest keys and never covered the language key, because the language key predates the
  harvest rule.
- **The one fact that exists is unvalidated.** `lang: English` passes `dockg check` today and is
  useless to every consumer, including dockg's own retrieval.

The authoring surface is constrained before any of this is designed. Under
[ADR 01023](01023-adopt-docmetas-common-kg-vocabulary.md) the `kg` block is docmeta's vocabulary,
vendored byte-verbatim with `additionalProperties: false`. **dockg cannot add a key to `kg`.** A
`kg.translation-of` would be a hard validation error against the schema `validate` defaults to.
The bytes cannot be edited without breaking the pin in `test/unit/kg-vocabulary.test.ts`.

## Decision Drivers

- **Language is a scope boundary**, and dockg already has one mechanism for scope boundaries. A
  second, parallel mechanism would be the "special cases layered on shared infrastructure" smell.
- **The custom namespace stays minimal** (CLAUDE.md): prefer an external vocabulary wherever a term
  exists.
- **Never infer.** [ADR 01014](01014-negative-scope.md) refuses to read meaning out of absence, and
  an inverse edge that only exists by entailment is the same class of claim.
- **Real docsets encode locale in the path.** A design that requires `lang:` in every file of every
  locale is not adoptable on the brownfield corpora that are a named audience.
- **`kg` is closed to dockg.** Whatever carries the translation link must live at page level.
- **A finding must be actionable** ([ADR 01033](01033-links-to-non-document-files.md)).

## Considered Options

**Where the language fact comes from:**

1. **Page frontmatter only**, the status quo key, unchanged.
2. **Route-derived, with frontmatter override.**
3. **A dedicated path-pattern config** (`localization.pathPattern`), independent of routes.

**What relates a translation to its source:**

- **A. `schema:translationOfWork` / `schema:workTranslation`.**
- **B. Mint `dockg:translationOf`.**
- **C. `dcterms:isVersionOf` / `hasVersion`.**
- **D. Reuse `prov:wasDerivedFrom`.**

**Which directions are emitted:**

- **i. Materialize both**, from the one authored fact.
- **ii. Emit only the authored direction** and let consumers invert.

## Decision Outcome

**The language source is option 2.** `RouteMapping` gains an optional `language`, so
`{root: docs/de, basePath: /de/, language: de}` labels every document beneath it. Routes already
declare the directory to site mapping, and are already threaded through `analyze`. So this adds
one field to a declaration every localized corpus makes anyway. The alternative is a second
directory-mapping concept that would have to agree with the first. Precedence is **page
frontmatter → route → nothing**. The per-file fact wins, which is what lets a single page in a
translated tree correct its own label.

Option 3 was rejected on the same grounds ADR 01033 rejected an ignore list. It asks every corpus
to restate, in a second syntax, something it has already told dockg.

**The relation is option A.** `schema:` is already a declared prefix and already emitted
(`schema:image`), so the two terms cost the custom namespace nothing. `ns/dockg-*.ttl` is
untouched by this ADR, holding the line CLAUDE.md draws. `schema:translationOfWork` is defined as the work a work was
translated from, and `schema:workTranslation` as its inverse; that is exactly the fact, with no
reinterpretation.

Option C was rejected because a translation is not a version. `dcterms:hasVersion` would collide
semantically with the revision chains of [ADR 01001](01001-revision-chains.md), which already use
`prov:wasRevisionOf` for the thing that genuinely *is* a later version of a page. Option D fails
for the same reason and worse. `prov:wasDerivedFrom` is already emitted for `kg.derived-from`, so
overloading it would make two different relations indistinguishable in the graph. Option B was
rejected because the term exists.

**Direction: option i.** From the one authored `translation-of` key, dockg emits both:

```turtle
<…/docs/de/install.md>  schema:translationOfWork  <…/docs/en/install.md> .
<…/docs/en/install.md>  schema:workTranslation    <…/docs/de/install.md> .
```

dockg's own runtime does not need the inverse, since `GraphIndex` maintains an inbound index.
External consumers do. A SPARQL query, a JSON-LD reader, or an iiRDS ingest has no such index.
`schema:workTranslation` on the source node **is** the "every localization of this page" list,
answerable in one lookup instead of a scan. Leaving it to entailment would also be the one thing
this project consistently refuses. ADR 01014 rejected `owl:NegativePropertyAssertion` partly
because reasoning is not a dependency dockg takes on. An inverse-by-inference asks consumers to
take it on instead.

### Scope filtering, and one deliberate asymmetry

`ScopeFilter` gains `language`, and `scopeExclusion` treats `dcterms:language` as a positive
predicate alongside `iirds:relates-to-product-variant` and `iirds:has-subject`. The rule matches
the existing one exactly. A node that declares a **different** language is excluded, recorded under
`dcterms:language` so the trace names the firing rule. A node that declares **none** is kept,
because unscoped content applies broadly.

**There is no negative-language predicate**, and the asymmetry with ADR 01014 is deliberate. "This
page does not apply to the SP-X100" is a claim an author makes about applicability. "This page is
not in German" is not a claim anybody makes. A document has one language, `sh:maxCount 1` already
says so, and a second predicate would be a conflict surface with nothing to express. The
`sh:disjoint` machinery that guards variants therefore has no counterpart here and is not added.

### Validation

`dcterms:language` gains a BCP-47 `sh:pattern`. A graph carrying `lang: English` validates today
and will not after this change. That is MAJOR by the rule in CLAUDE.md, and acceptable pre-release
(DESIGN.md). The pattern is what makes the value comparable at all. Scope filtering, per-language
coverage, and the per-locale artifacts of ADR 01038 all key on this string. A free-text label
silently partitions a corpus into buckets of one.

Because shipped shapes are immutable, this lands as a new file. Per CLAUDE.md the next version file
is **three-segment**, so `shapes/dockg-1.0.0.ttl`. It also learns the two `schema:` predicates on
the `sh:closed` Document shape. Without those, `dockg check` fails on every translated corpus, as
designed.

### Measurement

`language` re-enters `COVERAGE_FIELDS`, reversing the drop in
[ADR 01011](01011-metadata-coverage-in-stats.md). That drop was correct on its evidence, since the
field was "near-universally 0% noise" on monolingual corpora. It is wrong the moment language means
something. Coverage additionally reports **per language**, so the blended number stops describing
an audience that does not exist. It also reports the untranslated backlog, meaning source
documents with no translation into a language the corpus otherwise carries. Reporting is on, gating stays opt-in
([ADR 01009](01009-opinionated-defaults.md)).

### Typo safety

`translation-of` joins `HARVESTED_KEYS`, and `lang`/`language` join the near-miss surface that
ADR 01028 built. A page writing `languge:` or `translationof:` gets a warning naming the key it
probably meant, on the warnings channel, without failing the build.

### Consequences

- Good. The localization governance job becomes answerable. `dockg traverse --impact` on an English
  page reaches its translations, and `--lang de` filters retrieval to the German corpus with the
  exclusions recorded in the trace.
- Good. No growth in the `dockg:` namespace, and no second scope mechanism. One table in
  `scopeExclusion` gains one row.
- Good. A localized corpus can adopt this by adding one key per route, not one key per file.
- Bad. **Breaking twice.** `lang: English` stops validating. A corpus with translated pages that
  does not declare the relation gains nothing. Its `check` may newly fail too, if it carried a
  non-BCP-47 language. Pre-release, and the migration is a one-line frontmatter fix.
- Bad. The inverse edge doubles the triples this feature emits. That is accepted. It is one triple
  per translated page, deterministic, sorted, and blank-node-free like everything else.
- Neutral. `dcterms:language` remains a plain literal rather than becoming a language-tagged
  literal on the title or description. Language *tagging* of literals is a separate question
  about what the graph says, not what it is scoped to, and is out of scope here.

### Confirmation

- `test/unit/derive.test.ts` holds named cases for route-derived language, frontmatter overriding
  the route, and neither present. Also a resolvable `translation-of`, an unresolvable one falling
  to `dockg:brokenLink`, and a source page carrying two translations.
- In `test/unit/harvest.test.ts`, `languge` and `translationof` each warn and name the intended
  key. A page declaring both the real key and a near-miss does not warn.
- `test/unit/shapes.test.ts` and `test/integration/check.test.ts` show the BCP-47 pattern rejects
  `English` and accepts `de`, `de-DE`, `zh-Hans`. Deleting `schema:translationOfWork` from the
  shapes makes `check` fail on the corpus, proving the closed shape is doing work.
- The corpus fixture gains a `docs/de/` route carrying every permutation above. All goldens
  regenerate with the diff read line by line, and `dockg check` stays green on the clean corpus.
- In `test/unit/config.test.ts`, `routes[].language` round-trips and is absent as a key when
  unset. It is rejected at the config layer for `English`, `de_DE`, `d` and `de-`. That enforces
  the BCP-47 pattern where a bad tag is cheapest to catch, before it reaches the graph.
- In `test/unit/schema-sync.test.ts`, the bundled-defaults guard follows
  `shapes/dockg-1.0.0.ttl`. The coverage and config-schema drift guard covering `language` lands
  with the measurement slice, not this one. `COVERAGE_FIELDS` is untouched here.

## Pros and Cons of the Options

### Language source

**1. Page frontmatter only**

- Good. Zero new surface; the key already exists.
- Bad. Requires the key in every file of every locale. On the brownfield corpora dockg targets,
  that is a bulk edit before any value appears. A single missed file also silently drops out of
  its locale.

**2. Route-derived with frontmatter override**, chosen

- Good. One declaration per locale, on a config object localized corpora already write.
- Good. Reuses the routes plumbing already threaded into `analyze`.
- Good. The per-file override keeps the escape hatch for a page that sits in the wrong tree.
- Bad. A corpus with no routes configured gets no route-derived language. That is acceptable,
  since such a corpus has no locale directories to derive from either.

**3. Dedicated path-pattern config**

- Good. Works without routes, and expresses layouts routes cannot (`install.de.md`).
- Bad. A second directory-mapping concept that must agree with routes, and nothing forces it to.
  Two sources of truth for "which tree is this file in" is the drift hazard ADR 01033 avoided.
- Bad. A new knob owes a schema field, a default, a CLI story, and tests, for a layout that can be
  expressed as a route.

### The relation

**A. schema.org terms**, chosen

- Good. The term exists, is standard, and is already a declared prefix here.
- Good. The custom namespace does not grow.
- Bad. Schema.org's `CreativeWork` framing is looser than iiRDS's; the terms carry no constraint
  dockg can lean on, so the shapes do that work.

**B. Mint `dockg:translationOf`**

- Good. Total control of the definition, and a vocabulary entry dockg can state precisely.
- Bad. Mints a term that exists elsewhere, against the standing rule. Two properties and a
  vocabulary version, bought for nothing.

**C. `dcterms:isVersionOf` / `hasVersion`**

- Good. Dcterms is already a core namespace here.
- Bad. A translation is not a version, and dockg already models versions with `prov:wasRevisionOf`
  (ADR 01001). The collision would make revision chains and translation links indistinguishable to
  a consumer.

**D. `prov:wasDerivedFrom`**

- Good. Already emitted; no new predicate at all.
- Bad. Already emitted *for something else* (`kg.derived-from`). Overloading it destroys the
  distinction rather than expressing it.

### Direction

**i. Materialize both**, chosen

- Good. "all localizations of this page" is one lookup for every consumer, not just dockg's.
- Good. No entailment dependency, consistent with ADR 01014.
- Bad. One extra triple per translated page.

**ii. Authored direction only**

- Good. Minimal output.
- Bad. Pushes an inverse-property reasoner onto every consumer, or a full scan onto those
  without one. That is for a graph whose whole promise is that consumers need no RDF stack.
