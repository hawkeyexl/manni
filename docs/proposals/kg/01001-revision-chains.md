---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# Revision chains from declared kg.revisionOf plus git-rename derivation

## Context and Problem Statement

Documents supersede other documents (v2 guides, migrated pages). PROV-O models
this as `prov:wasRevisionOf`. What should mint those edges in a
single-snapshot graph where old versions may no longer exist as files?

## Decision Drivers

- Deterministic; no guessing which docs are "versions" of each other.
- Author intent should be expressible without git.
- Renames recorded by git are cheap, real revision facts.

## Considered Options

1. Frontmatter-declared only (`kg.revisionOf`).
2. Git-rename-derived only.
3. Both, sharing the derivedFrom resolution rules (chosen).
4. Content-similarity inference.

## Decision Outcome

Chosen option 3. `kg.revisionOf` (schema 0.3) resolves exactly like
`kg.derivedFrom`, meaning doc-relative, then repo-relative, then URL.
Unresolvable entries surface as `dockg:brokenLink`. One shared helper does both
(`provTargetEdge`/`resolveProvDocPath` in src/core/derive.ts). Under
`provenance.git`, each rename hop old→new additionally emits
`<newDoc> prov:wasRevisionOf <{base}doc/{oldPath}>` and types the
historical-path node `prov:Entity`. Content-similarity inference was rejected
as non-deterministic.

### Consequences

- Good. Works with or without git, multi-hop rename chains produce one edge
  per hop, and broken declarations feed `stats` like broken links do.
- Bad. Rename detection rides git's `-M` similarity heuristic, which is
  best-effort and documented as such. Historical-path IRIs also name entities
  that no longer exist as files, intentionally, since they are PROV entities
  rather than documents.

### Confirmation

Derive unit tests for declared (resolved/URL/broken) and rename-derived edges;
schema 0.3 acceptance tests in test/integration/validate.test.ts.

## Pros and Cons of the Options

- **Declared only.** Explicit, but it misses the history git already knows.
- **Git only.** Free facts, but no way to declare cross-file succession.
- **Both** (chosen). Full coverage, with a slight risk of duplicate edges when
  an author declares what git also derives. That is harmless, since quads dedupe.
- **Similarity inference.** Rejected as non-deterministic and unexplainable.
