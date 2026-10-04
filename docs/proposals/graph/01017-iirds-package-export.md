---
status: accepted
date: 2026-07-24
decision-makers: [manuel.r.b.silva]
---

# iiRDS package export (unrestricted, deterministic)

## Context and Problem Statement

Phase 6 shipped JSON-LD export. The export arc's other target is the format
tekom's ecosystem actually ingests, an **iiRDS package**. That is a ZIP
(`.iirds`) carrying `META-INF/metadata.rdf` (RDF/XML) plus the source content
files exposed as `iirds:Rendition`s. This is what lets a Content Delivery Portal
consume dockg's graph. It is also the payoff of the Phase 2 iiRDS mapping. The
classification dockg already derives lands in the package metadata rather than
staying trapped in a Turtle file. That covers topic-type, subject,
product-variant and lifecycle-phase. `dockg export --format iirds` has existed as a
stub since Phase 6, and this makes it real.

The hard question is scope and conformance. Which iiRDS variant to target, what
plays the content role, and how to keep the package inside dockg's determinism
contract of byte-identical rebuilds.

## Decision Drivers

- **Achievability without a content pipeline.** dockg has markdown sources and a
  graph; it has no PDF/A or XHTML5 renderer.
- **Conformance.** The package must validate against the iiRDS rules (anchored to
  the plusmeta iiRDS Validation Tool, the de-facto gate).
- **Determinism is the product contract.** Two exports over an unchanged graph
  must be byte-identical, with no wall clock, no blank nodes, no random UUIDs.
- **No heavy dependencies.** dockg hand-rolls its serializers so formatting is
  controlled; it has no ZIP or XML library and should not grow one.
- **The "support everything optional" mandate.** Enrichment (title, creator,
  product) should be possible, but absence must still yield a valid package.

## Considered Options

1. **Unrestricted iiRDS 1.3**, markdown-source renditions, hand-rolled RDF/XML +
   ZIP, optional `export.iirds` config for enrichment.
2. **iiRDS/A** (archiving). Needs self-contained PDF/A or a constrained
   iiRDS-XHTML5 content profile, meaning a markdown→XHTML5/PDF converter.
3. **iiRDS/H** (handover, VDI 2770). Needs PDF/A per Document, a root
   `index.html`, a mandatory JSON-LD twin, and mandatory Creator `Party`,
   `ProductVariant` and `Identity` metadata.
4. **A ZIP/RDF library** (`jszip`, `rdflib`) instead of hand-rolling.

## Decision Outcome

**Option 1 was chosen: unrestricted iiRDS 1.3, hand-rolled.**

Research against the spec and the validator's own `min_requirements.rdf` pass
fixture established that unrestricted iiRDS has a **thin** mandatory metadata
set. One `iirds:Package` with exactly one `iirds:iiRDSVersion`. Information
units as subclasses with IRIs and no blank nodes, linked via
`iirds:is-part-of-package`. dockg types each document `iirds:Topic`, the
subclass that carries the Phase-2 `has-topic-type` and `has-subject`
classification. And each content file as an `iirds:Rendition` with
`iirds:source` and `iirds:format`. Creator `Party`, `ProductVariant` and
`Identity` are **iiRDS/H-only** MUSTs, optional here. Unrestricted also permits
any content format, so the raw markdown source ships directly as
`text/markdown`, with no renderer.

Three new hand-rolled, deterministic pieces mirror the existing emitters.
`src/core/zip.ts` provides `writeZip`, putting `mimetype` first and stored,
deflating others via the native `zlib`, zeroing DOS timestamps, and fixing entry
order. `src/core/emit-rdfxml.ts` provides `emitRdfXml(quads, prefixes)`, sorted
`rdf:RDF`, no blank nodes, XML-escaped. `src/core/iirds-package.ts` provides
`projectPackage`, the graph to iiRDS projection.
An optional `export.iirds` config block (`title`, `creator`, `version`) adds a
package title, a Creator `iirds:Party`→`vcard:Organization`, and the version
literal. Absent, the package is still minimally valid.

Determinism holds end to end. IRIs are baseIri-derived and never a random UUID.
The RDF/XML is sorted, the ZIP metadata zeroed, and the entry order fixed.

### Consequences

- Good. A conformant, semantically rich iiRDS package with zero new runtime
  dependencies and the same determinism guarantees as the Turtle/JSON-LD output.
- Good. The `export` command's `--format` surface is now fully populated
  (`jsonld` + `iirds`).
- Neutral. Three more serializers to maintain (ZIP, RDF/XML, projection); covered
  by unit + golden + double-build regression gates.
- Bad. `iirds:A`/`iirds:H` remain out of reach until dockg grows a content
  pipeline. Explicitly deferred.

### Confirmation

- Unit tests cover three pieces. `writeZip` for mimetype stored-first, deflate
  round-trip, entry order, and double-write identity. `emitRdfXml` for sorted,
  escaped, well-formed output. `projectPackage` for Package, Document, Rendition
  and classification, the creator config, the missing-file error, and an n3
  round-trip of the projected quads.
- Integration runs `dockg export --format iirds` over the corpus. `mimetype`
  comes first, `META-INF/metadata.rdf` matches a text golden, content files are
  present, and a double export is byte-identical.
- The Turtle and JSON-LD goldens are untouched. The built graph, `dockg check`,
  and the frontmatter schema are unaffected, since the package is a projection.

## Pros and Cons of the Options

### Option 1, unrestricted 1.3, hand-rolled

- Good. Achievable now; conformant; deterministic by construction; no deps.
- Good. Markdown ships as-is, with no renderer and no determinism risk from HTML.
- Bad. Not archival/handover-grade (no PDF/A).

### Option 2, iiRDS/A

- Good. Archival-grade, self-contained.
- Bad. Requires a markdown→PDF/A or iiRDS-XHTML5 converter dockg doesn't have.

### Option 3, iiRDS/H

- Good. VDI 2770 handover conformance.
- Bad. The largest scope: a PDF/A pipeline, a mandatory JSON-LD twin, and
  mandatory Party, Product and Identity. Far beyond this phase.

### Option 4, a ZIP or RDF library

- Good. Less code to own.
- Bad. Library output order and formatting are not a stability contract. Pinning
  determinism means post-processing anyway, which is most of the hand-rolled
  work plus a dependency. The Turtle and JSON-LD emitters set that precedent.
