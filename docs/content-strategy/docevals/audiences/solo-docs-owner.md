---
id: aud-solo-docs-owner
type: audience
segment: One person owns every page
maturity: startup
docs_owner: A single individual, often an engineer or DevRel wearing the docs hat part-time
firmographics: [startup, scaleup, oss-project, docs-in-product-repo, 20-300-pages, no-docs-budget]
relationship_stages: [prospect, customer]
personas: [persona-solo-owner]
features_emphasized: [fill, confidence-threshold, dry-run, max-turns, init, deterministic-only]
evidence_basis: [doc-detective-user-base, docevals-surface, docmeta-content-strategy]
---

# Audience: Solo docs owner

**Scope:** products where documentation is owned end-to-end by one person, usually alongside another
full-time job. Distinguished from [`aud-docs-platform-team`](docs-platform-team.md) by hours
available, not by page count or company size. A 3,000-person company with exactly one person who
cares about docs quality belongs here.

## Who they are

An engineer, founder, or developer advocate who writes the docs because someone has to. Twenty to
three hundred pages, usually in the product repo rather than a separate docs repo, published with
whatever static site generator was easiest. High technical proficiency, near-zero available hours,
and complete unilateral authority, with no review board, no procurement, and no security
questionnaire.

They frequently arrive from an adjacent tool. They already run a linter or a frontmatter validator
and are looking for the next increment of automated quality. They have concluded that manual review
of their own writing does not work.

## What they're trying to do

Get meaningful automated coverage of a corpus they cannot personally re-read, in an afternoon, for a
few dollars. They are not trying to encode a quality standard. They are trying to stop shipping
pages that contradict the product.

## Defining pains

- **Hand-authoring assertions does not fit the budget.** Writing a good eval takes ten minutes and
  they have two hundred pages. The arithmetic kills the project before it starts, which makes `fill`
  the difference between adoption and abandonment for this segment.
- **Stale content is the failure mode they actually hit.** The product moved, the page did not, and
  nobody noticed for six months.
- **Cost anxiety is personal, not institutional.** There is no budget line; it is their own card, or
  a spend cap they had to argue for once. An unbounded run is not a risk to manage, it is a reason not
  to start. `--dry-run`, `--max-turns`, and the fact that re-running against cache is free are
  load-bearing.
- **No appetite for configuration.** Every key in `manni.config.yaml` they must understand before
  the first useful run is a chance to give up. `init` plus sensible defaults has to carry them.

## Buying constraints

- Time-to-first-value measured in minutes. If the quickstart does not produce a real finding on a real
  page, they close the tab.
- Zero infrastructure. `npx` and an env var, or the `claude-cli` provider and no key at all.
- Must degrade gracefully without a provider. `--deterministic-only` has to be genuinely useful on its
  own, so the tool has a free tier of behavior for someone evaluating it on a Sunday.
- How much a run will do must be knowable *before* it does it, not reported after. `--max-turns`
  bounds it in inference calls. The tool prints no dollar figure, so converting that to money is the
  reader's own arithmetic against their provider's rates.

## Qualified reader (for docs targeting)

- **Prerequisites they bring.** Strong general engineering skill; comfortable with `npx`, env vars,
  globs, and YAML; will read a `--help` before a guide.
- **Prerequisites they do not bring.** Any documentation-methodology vocabulary. "Regression versus
  capability suite," "target pass rate," and "confidence zone" are all unfamiliar and must be earned,
  not assumed.
- **Subject dependencies.** None beyond the eval → grader → verdict model. This segment must be able
  to reach a useful first run *without* reading about suites, calibration, or the grader hierarchy.
  That is the constraint that keeps `get-started/index.mdx` short.
