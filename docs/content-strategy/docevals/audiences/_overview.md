---
id: audiences-overview
type: overview
audiences:
  - aud-docs-platform-team
  - aud-solo-docs-owner
  - aud-platform-ci
  - aud-quality-standard-owner
  - aud-doc-contributor
  - aud-brownfield-corpus
lead: aud-docs-platform-team
axis: who owns the docs × company maturity
---

# Target audiences

**Scope:** the segmentation axis and the six segments derived from it. Per-segment detail lives in the
individual files; the people who represent each segment live in [`../personas/`](../personas/_overview.md).

## Segmentation axis

Segments are cut on **who owns the docs × company maturity**. Team size, tooling, budget authority,
security posture, and dominant pain all fall out of that axis. A solo owner at a startup and a docs
platform team at an enterprise want the same outcome and have almost nothing else in common.

The axis produces five segments. A sixth, `aud-brownfield-corpus`, is a **cross-cutting lens**. It is
defined by the *state of the corpus* rather than by who owns it, and it overlaps three of the five.

| Audience | Segment | Maturity | Who owns docs | Dominant pain |
|---|---|---|---|---|
| [`aud-docs-platform-team`](docs-platform-team.md) **(lead)** | Docs org running a large docs-as-code corpus | scaleup / enterprise | A dedicated docs team | Quality drifts faster than review can catch it |
| [`aud-solo-docs-owner`](solo-docs-owner.md) | One person owns every page | startup / scaleup | An individual, often part-time | No hours to spend on quality infrastructure |
| [`aud-platform-ci`](platform-ci.md) | Platform / DevEx owning pipelines across many repos | cross-maturity | Nobody in this segment; they own the pipeline | An LLM and content-driven code execution in the critical path |
| [`aud-quality-standard-owner`](quality-standard-owner.md) | Owns what "good" *means* | scaleup / enterprise | The standard, not its enforcement | Cannot prove the judge agrees with them |
| [`aud-doc-contributor`](doc-contributor.md) | Hit a red check on their PR | any | Nobody, passing through | One error, no context, wants out |
| [`aud-brownfield-corpus`](brownfield-corpus.md) *(cross-cutting)* | Thousands of existing pages, zero evals | any | Overlaps the first, second, and fourth rows | Any honest first run is a wall of red |

## Why the lead is the lead

`aud-docs-platform-team` touches every layer: install, config, the eval library, the grader
hierarchy, CI, cost, and human review. Its journey is the backbone
([`cuj-first-gate`](../journeys/cuj-first-gate.md)); the other segments enter, exit, or specialize it.
When two segments want incompatible things, the lead wins.

## Signal that cuts across every segment

Three concerns showed up against all five primary segments. That is why they get first-class
structural treatment rather than a footnote on one persona's page:

1. **"Can I trust an LLM to gate my build?"** Nondeterminism in CI is the objection that precedes
   every other objection. The ensemble, the confidence zones, the human-review escape hatch, and
   `calibrate` exist to answer it. The site gives them a whole section (`judge/`) rather than
   burying them in reference.
2. **"What does this cost, and can it surprise me?"** Per-run cost is a live variable, not a fixed
   licence. `judge.max-turns`, `fill.max-turns`, and response caching are adoption features, not
   tuning knobs, and are documented as such. The tool bounds and reports *inference calls*, never
   dollars (ADR 01019). The docs answer this question by making the call count predictable ahead of
   the run. The rate card is left to the reader's own provider.
3. **"What executes when I run this on a stranger's pull request?"** Frontmatter-declared commands and
   Doc Detective steps embedded in content are arbitrary code execution driven by the content files
   themselves. Every segment inherits this risk the moment the gate runs on forks. Only
   `aud-platform-ci` is equipped to reason about it, which is why that segment owns the page.

## Deliberately not segmented

- **By docs framework** (Docusaurus / Starlight / MkDocs / Hugo). manni docevals reads frontmatter from
  Markdown and MDX and never touches the site build, so framework choice does not change the journey.
- **By company size alone.** Size correlates with ownership but does not determine it. Plenty of
  large orgs still have exactly one person who owns docs quality, and they behave like
  `aud-solo-docs-owner`, not like `aud-docs-platform-team`.

See [`../README.md`](../README.md) for the evidence basis behind all of this, and its limits.
