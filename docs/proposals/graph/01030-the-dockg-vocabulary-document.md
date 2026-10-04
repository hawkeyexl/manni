---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# A vocabulary document for `dockg:`, at an IRI that resolves

## Context and Problem Statement

dockg mints 17 terms, being 2 classes, 12 properties and 3 role individuals, under
`https://dockg.dev/ns#`. Nothing in the repository defined any of them. The SHACL shapes
*constrain* the terms; no file said what one means, and the namespace IRI resolved to nothing at
all.

dockg's pitch is standards-typed output consumed by the outside world. This was the one place it
did not hold itself to the standard it sells. A consumer receives a graph, hits
`dockg:brokenLink`, and does what linked data says to do. Dereferencing the IRI got nothing.

## Decision Drivers

- The custom namespace is deliberately small, and every term in it exists because no published
  vocabulary had one. Those are exactly the terms a consumer cannot look up elsewhere.
- Published schemas and shapes are immutable and versioned by adding a file. A vocabulary is the
  same kind of artifact and should follow the same rule.
- [ADR 01014](01014-negative-scope.md) refuses inference dockg did not assert. A definition document
  must not smuggle it back in.
- A vocabulary rots the moment a phase mints a predicate and forgets the document. Whatever ships
  needs a guard, not a convention.

## Considered Options

For the document:
1. **RDFS**, with non-entailing domain and range.
2. **OWL**, with domains, ranges, and disjointness axioms.
3. **A prose reference page only**, human-readable but not machine-readable.

For the namespace:
4. **Move it to the docs origin now**, at `https://hawkeyexl.github.io/dockg/ns#`.
5. **Acquire `dockg.dev`** and serve it there.
6. **Ship the file, leave the IRI unresolvable.**

## Decision Outcome

**Option 1 was chosen for the document, and option 4 for the namespace.**

### RDFS, not OWL

dockg emits nothing that depends on reasoning. OWL axioms would duplicate the SHACL shapes, which
already own every constraint, while inviting reasoners to infer what ADR 01014 exists to refuse.
The split to hold, and the one the document states in its own header:

> **RDFS defines what a term means; SHACL says what a valid graph looks like.**

For the same reason, domain and range use `schema:domainIncludes` and `schema:rangeIncludes` rather
than `rdfs:domain`/`rdfs:range`. Those RDFS terms are *entailment rules*: asserting
`rdfs:domain dockg:Document` licenses a reasoner to type any subject carrying the property as a
Document, which is a claim dockg never made. schema.org's pair documents the same intent and
entails nothing. A test asserts the RDFS forms appear zero times.

Each term carries `rdfs:label`, an `rdfs:comment` that says what it means **and what it does not**,
`rdfs:isDefinedBy` pointing home, and `skos:example` where the shape is non-obvious. The comments
carry the distinctions that matter. `dockg:brokenLink` is a finding about this corpus, not a claim
that the target does not exist. `dockg:confidence` is a model's estimate of its own reliability,
not a measurement.

### The namespace moves, and it is breaking

`dockg.dev` does not resolve and is not ours. Pre-release breaking changes are explicitly fine, and
this one is free now and expensive later. Every IRI in every graph anyone has built would have to
change. So the namespace becomes `https://hawkeyexl.github.io/dockg/ns#`, served by the
documentation site that already exists.

Being a **hash namespace** is what makes this cheap: strip the fragment and one document serves
every term. GitHub Pages cannot content-negotiate, so the practical floor is a page at `/dockg/ns/`
carrying the terms, with `<link rel="alternate" type="text/turtle">` to `/dockg/ns.ttl`.

Two IRI families move together, the terms and the shapes namespace (`dsh:`). That means a new
`shapes/dockg-0.6.ttl`, since published shapes are immutable. **0.6 changes no constraint.** The
`schemas/frontmatter-0.*.json` `$id`s stay as they are. They are published, superseded by
`docmeta:kg`, and rewriting a published id would be worse than leaving it.

### Consequences

- **Breaking.** Every `dockg:` IRI in every emitted graph changes. Two goldens regenerate,
  `graph.ttl` and `graph.jsonld`, the only two carrying the namespace. The diff is the
  namespace lines and nothing else, which is the evidence that nothing else moved.
- `check`'s bundled default becomes `shapes/dockg-0.6.ttl`.
- `ns/` ships in the npm package beside `schemas/` and `shapes/`, so an offline consumer can load
  the vocabulary by path.
- The site gains a page at `/dockg/ns/` that is deliberately **not** in the sidebar: a reader
  arrives there by dereferencing an IRI, not by browsing. Its address is decided by the namespace,
  not by the navigation. It is the one page on the site where that is true.
- `scripts/check-docs-links.mjs` learned that a link may target a published *file* rather than a
  page. It previously resolved only `<route>/index.html`, so `/dockg/ns.ttl` read as broken.

### Confirmation

`test/unit/vocabulary.test.ts` runs the drift guard in **both** directions. It reads the emitter's
side out of `src/` rather than from a hand-kept list, because a hand-kept list is the thing that
drifts:

- every term the emitter can produce is defined here;
- **nothing is defined that the emitter cannot produce.** A definition for a term that does not
  exist misleads exactly as much as a term with no definition;
- every term has a label, a comment, and an `rdfs:isDefinedBy`;
- the ontology header carries title, license, `owl:versionInfo`, `owl:versionIRI`, and the VANN
  prefix declarations. A consumer that fetches the document learns the prefix the emitter writes
  rather than guessing it;
- `rdfs:domain` and `rdfs:range` appear zero times.

The link checker's new asset branch was verified in both directions: `/dockg/ns.ttl` resolves, and
a link to `/dockg/nope.ttl` is still reported unresolved.

## Pros and Cons of the Options

### 1. RDFS with non-entailing domain/range

- Good, because it says what terms mean without asserting anything a reasoner can act on.
- Good, because it leaves constraints where they already live, in SHACL.
- Bad, because `schema:domainIncludes` is a schema.org convention rather than a W3C
  recommendation; a consumer expecting `rdfs:domain` finds nothing.

### 2. OWL

- Good, because it is the more standard choice for a vocabulary, and tooling expects it.
- Bad, because it duplicates the shapes and invites the inference this project spent an ADR
  refusing. A graph that says "absent means unknown" should not ship axioms that let a reasoner
  conclude otherwise.

### 3. Prose page only

- Good, because it costs least and readers get the same explanation.
- Bad, because dereferencing an IRI is what a linked-data consumer does, and it would still get
  nothing machine-readable.

### 4. Move to the docs origin

- Good, because it resolves today, at no cost, on infrastructure that already exists.
- Bad, because the namespace is now tied to a GitHub Pages URL. Moving again later means another
  breaking change, cheap now and expensive after release.

### 5. Acquire `dockg.dev`

- Good, because it is the more permanent home and reads better.
- Bad, because it makes correctness wait on a purchase, and nothing about the vocabulary needs it.
  Worth revisiting before 1.0, when the move is still affordable.

### 6. Ship the file, leave the IRI dead

- Good, because it defines the terms with no breaking change at all.
- Bad, because the whole complaint was that the IRI resolves to nothing. Shipping a definition
  nobody can reach from the graph solves the smaller half of the problem.
