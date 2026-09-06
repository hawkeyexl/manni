---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Every third party is exercised for real somewhere in CI

## Context and Problem Statement

`dockg embed` against a real model never worked. `createLocalEmbedder` hardcoded
`device: "wasm"`, which transformers.js v4 rejects in Node, so every real-model run failed at
pipeline construction. It shipped that way for a whole release
([ADR 01025](01025-embedder-cross-platform-reality.md)). The suite was green throughout. The only
embedder coverage was its *absence* path plus a mock that validates nothing about the
library it stands in for.

That is not a one-off. A survey of all 55 third parties dockg depends on covered packages, external
binaries, network endpoints, and file-format contracts. It found the same shape in four more
places, and the pattern is consistent. **The seam is tested and the integration is not.**

Two of those places are worse than a mock, because they look like coverage:

- `META-INF/metadata.rdf` is hand-written XML that **no RDF/XML parser has ever read**. Its tests
  assert substrings of dockg's own output and compare it byte-for-byte to a golden.
- The `.iirds` ZIP is read back only by a central-directory reader written inside the test files
  themselves. That reader shares every assumption the writer makes.

A golden is a regression gate, not a consumer. It catches *unintended* change and nothing else. The
distinction is demonstrable. Drop a namespace declaration from the RDF/XML emitter and the golden
comparison fails, as designed. But regenerate the golden the way any deliberate emitter change
would, and **all 13 export tests pass while the file is no longer parseable RDF**. That is the hole.
Whatever is emitted on the day the golden is regenerated becomes the definition of correct.

## Decision Drivers

- Determinism is the product contract, and a deterministic invalid artifact is still invalid.
- The three formats with no consumer check, RDF/XML, ZIP and JSON-LD, are exactly the ones the
  *outside world* consumes. Turtle, the one dockg itself reads back, is the one already covered.
- `dockg export -f iirds` is a headline feature whose entire external contract is unverified.
- The default suite must stay hermetic and fast; a rule that makes `npm test` need the network
  would not survive contact with contributors.
- A rule is enforceable; a case-by-case judgement is not.

## Considered Options

1. **A rule with a named exception list.** Every third party driven for real somewhere in CI.
2. **Case-by-case**, adding real-path tests where someone thinks of it.
3. **Golden-only**, accepting that byte stability is the contract.
4. **Property-based validation of our own output.** Assert well-formedness with our own checks
   rather than adopting consumers.

## Decision Outcome

**Option 1 was chosen.**

> Wherever a mock, a fixture, or a static scan stands in for something outside this repo, a
> real-execution test exists somewhere in CI. The mock's docblock names the real thing it
> stands in for. A mock with no real counterpart is an untested integration wearing a green check.

Three consequences make it operable rather than aspirational:

- **"Somewhere in CI" is not "in `npm test`".** The default suite stays hermetic. Real-path tests
  that need network, weights, or a browser live in their own configs and jobs. That is
  `test/real/` and the `embed-real` job today.
- **A golden is never the real-path test.** Neither is a reader written beside the assertions it
  serves. The consumer has to be an implementation dockg did not write.
- **Exceptions are named here, with a reason and a compensating hermetic seam.** An unlisted
  unexercised dependency is a defect, not a judgement call.

### What this phase closes

| Artifact | Consumer adopted | What it now catches |
|---|---|---|
| `META-INF/metadata.rdf` | `rdfxml-streaming-parser` | unbound prefixes, unescaped text, malformed XML |
| the `.iirds` container | `yauzl`, with `validateEntrySizes` | bad central directory, size/CRC disagreement, OCF `mimetype` violations |
| `graph.jsonld` | `jsonld` (digitalbazaar), cross-checked against `graph.ttl` | an `@context` that expands CURIEs to the wrong IRIs |

The iiRDS mandatory set from [ADR 01017](01017-iirds-package-export.md) is now asserted against the
*parsed* graph rather than the emitted string. Exactly one `iirds:Package` with exactly one
`iiRDSVersion`. Every information unit typed and linked by `is-part-of-package`. Every
`iirds:Rendition` carrying `source` and `format`, and no blank nodes surviving a round trip.

### Named exceptions

- **The plusmeta iiRDS Validation Tool.** ADR 01017 calls it the de-facto gate and it is not in the
  repo. It is a hosted service, so it cannot run in a hermetic job, and its `min_requirements.rdf`
  is not ours to redistribute. *Compensating control:* the mandatory set above, checked through an
  independent parser. *Obligation:* run the hosted validator by hand when the package projection
  changes, and record the result in the PR.
- **The four LLM providers.** `MockProvider` stands in for all of them and none has been driven for
  real. Scheduled as the last slice of this phase, through a local server rather than paid keys.
- **`claude-cli` specifically has no seam at all.** `providerSpecFor` never sets `spec.exec`, so
  not even a hermetic stub is possible without a source change. Either it gains the exec seam
  `src/core/git.ts` already has, or the provider goes.
- **`globalThis.fetch` in the runtime content resolver.** Stubbed, and staying stubbed. It is a
  well-designed injection point, it is serve-side, and real-network coverage would add nothing the
  stub does not already cover.
- **`picocolors`' colorizing branch.** Never exercised, because test stdout is not a TTY.
  Deliberately not worth a pseudo-terminal.

### Consequences

- Three devDependencies join for their consumer role only: `rdfxml-streaming-parser`, `yauzl`,
  `jsonld`. None ships; none is imported by `src/`.
- `ajv-formats` was declared and never imported, so it was removed. `@rdfjs/types` and
  `@types/mdast` were type-imported but undeclared, resolving only through transitive trees. Both
  are now declared.
- The rule creates work when a dependency is added. That is the point; the alternative is the
  release dockg already shipped.
- Not every corruption is caught. A wrong size in a ZIP *local* header still passes, because yauzl
  reads the central directory. Recorded so the boundary is known rather than assumed.

### Confirmation

`test/integration/format-consumers.test.ts`. A test that has never failed proves nothing, so each
assertion was verified against a deliberate mutation of the emitter it guards:

| Mutation | Result |
|---|---|
| Drop a namespace declaration from the RDF/XML emitter | caught; **and still caught after the golden is regenerated**, which no existing test is |
| Point a JSON-LD `@context` prefix at the wrong IRI | caught, as a quad-set mismatch against the Turtle |
| Corrupt the uncompressed size in the ZIP central directory | caught by `validateEntrySizes` |
| Deflate the `mimetype` entry, violating OCF | caught |
| Corrupt the same size in the ZIP *local* header | **not caught**, recorded above as a known limit |

## Pros and Cons of the Options

### 1. A rule with a named exception list

- Good, because it turns "did anyone think of this?" into a checkable property.
- Good, because the exception list makes the remaining risk visible instead of absent.
- Bad, because it raises the cost of adding a dependency.

### 2. Case-by-case

- Good, because it costs nothing up front.
- Bad, because it is what produced the embedder bug. Nobody decided not to test it.

### 3. Golden-only

- Good, because byte stability is genuinely most of what dockg promises.
- Bad, because a golden regenerated over invalid output makes the invalidity permanent, and the
  regeneration step is a normal part of every deliberate change.

### 4. Property-based validation of our own output

- Good, because it needs no new dependencies.
- Bad, because it re-encodes our own understanding of the format. If we misread the spec, our
  checker misreads it identically. The value of an outside implementation is precisely that it does
  not share our misconceptions.
