---
status: accepted
date: 2026-08-30
decision-makers: hawkeyexl
---

# Every document node carries a sha256 of its content

## Context and Problem Statement

dockg's output is a graph *about* documents. It says where a document lives
(`dockg:path`), what it is about, and what it links to. It says nothing at all
about what it contained when the graph was built.

That is a gap for the consumer dockg is built for. A search index, an embedding
store, or a RAG pipeline pairs the graph with content it holds separately. It
has no way to answer two questions:

- **Has this document changed since I indexed it?** Today there are two signals.
  `dcterms:modified` comes from frontmatter or a git committer date. It moves for
  edits that change no content, and stays put for content changes made without a
  commit. The other signal is re-reading every file, which is the work the graph
  exists to avoid.
- **Which revision is this row keyed to?** A path is not a revision. Two graphs
  built from the same corpus at different commits are indistinguishable at the
  node level. A store cannot tell a stale row from a current one.

This was proposed in [#7](https://github.com/hawkeyexl/moose-kg/pull/7) on
2026-07-22 and sat unmerged while eleven other changes landed. The idea survives
review. The implementation had gone stale against a namespace move, five shapes
versions, a vocabulary document that did not exist yet, and six byte-exact
goldens. This ADR records the decision as re-taken against the current tree, and
revisits the one design choice that had a better answer available.

## Decision Drivers

- **Determinism is the product contract.** A hash of the file's bytes is
  perfectly deterministic and adds no wall clock, no ordering hazard, and no
  blank node. It is the one fact about content that can be stated without
  putting content in the graph.
- **The graph must stay reviewable.** The alternative is embedding document
  bodies as literals. That would defeat the line-reviewable golden gate and
  duplicate git.
- **The custom namespace stays minimal** (CLAUDE.md), so prefer a standard term
  wherever one exists.
- **Published contracts are immutable.** A new predicate on a `sh:closed` shape
  is a new shapes version, and a new `dockg:` term is a new vocabulary version.

## Considered Options

**What the value is:**

1. **A sha256 of the file's UTF-8 content**, emitted on every document.
2. **`dcterms:modified` alone**, with no new predicate.
3. **The document body as a literal.**

**Which predicate carries it:**

- **A. `dockg:contentHash`** (what #7 proposed).
- **B. `schema:sha256`.**
- **C. `spdx:checksum`.**
- **D. Both A and B**, the second as an interoperability alias.

## Decision Outcome

**A sha256, on `dockg:contentHash`, emitted for every document.**

It is **intrinsic, like `dockg:path`**. It is always emitted, not gated behind a
derive source, and carries no config knob. A hash that is present only sometimes
answers neither question it exists for. A consumer cannot distinguish "unchanged"
from "not stamped".

The digest is taken over the content **as read, line endings included**, so it
is byte-faithful. `test/fixtures/corpus/docs/windows-notes.md` is CRLF on
purpose and hashes as CRLF. For any valid-UTF-8 file the value matches
`sha256sum <file>`. That property makes it usable from a shell without dockg in
the loop.

### Why `dockg:contentHash` and not `schema:sha256`

This is the choice worth explaining, because the repo's own invariant points the
other way and it still loses.

`schema:sha256` is real, its range is `Text`, and its description is exactly this
value. But it is in schema.org's **pending** area, not the released core
vocabulary. schema.org says of that area that "implementation feedback and
adoption ... can help improve our definitions". That is a statement the
definition may still move. dockg publishes immutable schemas, immutable shapes,
and a versioned vocabulary precisely because it treats a contract as something
that must not move underneath a consumer. Keying an always-emitted predicate to
a term whose publisher may change it trades dockg's own stability guarantee for
a namespace saving.

Its `schema:domainIncludes` is also `MediaObject`, and a `dockg:Document` is not
one. dockg emits non-entailing domain hints for exactly this reason, so nothing
would break. But a term used outside the domain its author scoped it to is a
weaker claim than a term dockg defines and stands behind.

So the minimal-namespace rule bends here, and the ADR records why rather than
leaving the next reader to wonder whether schema.org was checked. It was: the
term exists, and it is not yet stable enough to build on. If it graduates to core,
adopting it is a vocabulary-version and shapes-version change like any other.

`spdx:checksum` is rejected on a harder constraint. It models a checksum as a
node with an algorithm and a value. That means either a blank node, forbidden
outright, or a minted IRI per digest, which is real complexity for a single
literal.

Emitting **both** (option D) is rejected for the same reason the namespace is
minimal. Two predicates carrying one literal on every document node inflate
every graph, and give a consumer two things to keep in agreement.

### Consequences

- Good. Content drift is detectable without re-reading the corpus, and a
  consumer's rows have a revision-exact join key.
- Good. The value is checkable against standard tooling such as `sha256sum`, so a
  consumer can verify dockg rather than trust it.
- Good. No blank nodes, no wall clock, nothing order-dependent.
- **Breaking, deliberately:** `shapes/dockg-0.7.ttl` makes `dockg:contentHash`
  *required* on the closed Document shape, so a graph built by an older dockg
  fails the new contract until rebuilt. Required rather than optional because
  the predicate is unconditional: optional would let a regression that stops
  emitting it pass `check` silently. `check.shapes` can pin `dockg-0.6.ttl` for
  a graph that is not being rebuilt.
- Cost. Every document node gains one triple, 5 on the corpus fixture and 37 on
  dockg's own docs graph. Both goldens carrying document nodes were regenerated,
  and the diff is exactly one line per document.
- Neutral. The hash says a document changed, not how. That is the intended
  granularity. dockg reports facts about documents, and a diff is git's job.

### Confirmation

- In `test/unit/analyze.test.ts`, the digest matches an independently computed
  sha256 of the same bytes. CRLF content hashes differently from the same content
  with LF, and identical content in two files hashes identically.
- In `test/integration/build.test.ts`, every `dockg:Document` in the built corpus
  carries exactly one `dockg:contentHash`. Each matches the file on disk read
  independently of dockg.
- In `test/unit/shacl.test.ts`, a graph missing the predicate, and one whose value
  is not 64 lowercase hex characters, both fail `dockg-0.7.ttl`.
- `test/unit/vocabulary.test.ts` runs the bidirectional drift guard. The new term
  is defined in the vocabulary document, and the document defines nothing the
  emitter cannot produce.
- The determinism gates run too. Double-build byte comparison, version-normalized
  golden comparison, n3 round-trip, and the cross-platform digest join over all
  six goldens.

## Pros and Cons of the Options

### 1. A sha256 of the content

- Good. Answers both questions, deterministically, in one literal.
- Good. Verifiable with `sha256sum`, so it does not require trusting dockg.
- Bad. A new required predicate is a breaking shapes change.

### 2. `dcterms:modified` alone

- Good. Already emitted; costs nothing.
- Bad. Measures the wrong thing. It comes from frontmatter or a git committer
  date, so it moves when a document is touched but not changed. It also does not
  move when content changes outside a commit. It cannot answer "is my copy
  stale".

### 3. The document body as a literal

- Good. A consumer needs nothing but the graph.
- Bad. Defeats the line-reviewable golden gate, which is a load-bearing part of
  how changes to the emitter are reviewed here.
- Bad. Multiplies byte-sensitivity hazards (escaping, line endings, encoding) and
  duplicates what git already stores.

### A. `dockg:contentHash`

- Good. Dockg defines it, versions it, and stands behind it. That is the same
  contract posture as every other published artifact here.
- Good. No domain stretch; it is a fact about a `dockg:Document`.
- Bad. A minted term where a standard one nearly fits, against the repo's own
  minimal-namespace preference. Recorded above rather than glossed.

### B. `schema:sha256`

- Good. Standard, self-describing, free for a consumer already reading
  schema.org.
- Good. Honors the minimal-namespace rule exactly.
- Bad. It is **pending**, not released core. The publisher reserves the right to
  change the definition, which is the one property dockg's contracts refuse.
- Bad. Scoped to `MediaObject`, and a document is not one.

### C. `spdx:checksum`

- Good. The most precise model, giving algorithm and value explicitly.
- Bad. Needs a node per checksum, so either a blank node (forbidden) or a minted
  IRI per digest.

### D. Both `dockg:contentHash` and `schema:sha256`

- Good. Stability and interoperability at once.
- Bad. One literal on two predicates, on every document node, forever. Plus two
  things a future change has to keep in agreement.
