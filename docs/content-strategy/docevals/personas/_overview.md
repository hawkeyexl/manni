---
id: personas-overview
type: overview
personas:
  - persona-corpus-owner
  - persona-solo-owner
  - persona-pipeline-owner
  - persona-standard-owner
  - persona-contributor
  - persona-retrofitter
lead: persona-corpus-owner
model: qualified-reader
---

# Personas

**Scope:** one minimal persona per audience, and the map between them. The segments themselves are in
[`../audiences/`](../audiences/_overview.md); the journeys these people take are in
[`../journeys/`](../journeys/_overview.md).

## The map

| Persona | Audience | Role | In one line |
|---|---|---|---|
| [**Priya**](priya-corpus-owner.md) `persona-corpus-owner` *(lead)* | [`aud-docs-platform-team`](../audiences/docs-platform-team.md) | Documentation platform lead | Wants the quality bar enforced by the pipeline instead of by her own review fatigue. |
| [**Nate**](nate-solo-owner.md) `persona-solo-owner` | [`aud-solo-docs-owner`](../audiences/solo-docs-owner.md) | Engineer who owns the docs | Wants meaningful coverage of 200 pages in an afternoon, for a few dollars. |
| [**Devin**](devin-pipeline-owner.md) `persona-pipeline-owner` | [`aud-platform-ci`](../audiences/platform-ci.md) | Platform / CI engineer | Wants one gate that behaves identically everywhere, cannot overspend, and cannot run a stranger's code. |
| [**Sara**](sara-standard-owner.md) `persona-standard-owner` | [`aud-quality-standard-owner`](../audiences/quality-standard-owner.md) | Docs quality standard owner | Wants to prove the judge agrees with her often enough to gate a build on. |
| [**Theo**](theo-contributor.md) `persona-contributor` | [`aud-doc-contributor`](../audiences/doc-contributor.md) | Occasional doc contributor | Wants the one red check on his PR to go green. |
| [**Iris**](iris-retrofitter.md) `persona-retrofitter` | [`aud-brownfield-corpus`](../audiences/brownfield-corpus.md) *(cross-cutting)* | Corpus retrofitter | Wants 3,000 unmeasured pages onto a ratchet without a day-one wall of red. |

## Why three names are borrowed from manni meta

**Devin, Sara, and Theo are deliberately the same people as manni meta's personas of those names.** The
two tools are adopted by one reader in one pipeline. The engineer who wires up a metadata gate is the
engineer who wires up an eval gate. The contributor who hits a red frontmatter check is the
contributor who hits a red eval. Reusing the names keeps that continuity legible to anyone working
across both repos, and keeps the two strategies comparable rather than parallel-but-unrelated.

The roles are not identical, and the differences are the interesting part. manni docevals' Devin inherits
two problems manni meta's Devin never had, namely a model in the critical path and content-driven code
execution. manni docevals' Sara owns prose assertions rather than JSON Schema. Priya, Nate, and Iris
are new here. manni meta's lead persona splits into Priya and Nate along the hours-available axis.
`fill` makes the one-person case a genuinely different journey rather than a smaller one.

## The model is a qualified reader, not a skill tier

No persona is labeled beginner, intermediate, or advanced. Those labels describe a person and travel
badly. What a writer actually needs to know is **what this reader already brings** and **what they
must have read first**. Each persona file therefore carries:

- **Prerequisites they bring**, meaning knowledge assumed on arrival, which the page must not re-teach.
- **Prerequisites they do not bring**, the trap. Assuming any of these produces a page that reads
  fine to its author and is unusable by its reader.
- **Subject dependencies**, the pages that must come first for this one to land. These fix the
  reading order inside each section of the IA.

The strictest case is Theo, who has *no* subject dependencies by construction: `fix/index.mdx` may not
assume any other page has been read. Any change that gives it a dependency is a defect.
