---
id: aud-docs-platform-team
type: audience
segment: Docs platform team running a large docs-as-code corpus
maturity: enterprise
docs_owner: A dedicated documentation team, with a lead accountable for quality
lead_audience: true
firmographics: [scaleup, enterprise, docs-as-code, monorepo-or-docs-repo, ci-gated, 500-5000-pages]
relationship_stages: [prospect, customer]
personas: [persona-corpus-owner]
features_emphasized:
  [named-evals, suites, target-pass-rates, tool-graders, severity, ci-integration, response-cache]
evidence_basis: [docmeta-content-strategy, doc-detective-user-base, docevals-surface]
---

# Audience: Docs platform team

**Scope:** organizations where a standing docs team owns a large docs-as-code corpus and is
accountable for its quality. This is the **lead audience**. It does not cover the one-person case
([`aud-solo-docs-owner`](solo-docs-owner.md)). Nor does it cover the pipeline owners who install the
gate but do not author evals ([`aud-platform-ci`](platform-ci.md)). The separate job of defining what
"good" means belongs to [`aud-quality-standard-owner`](quality-standard-owner.md). At smaller scale
that last role is the same person.

## Who they are

Three to fifteen writers plus a lead, maintaining several hundred to a few thousand pages in Git.
Markdown or MDX with YAML frontmatter, a static site generator, pull-request review, and a CI
pipeline that already runs something. That is usually a link checker and a prose linter. They are
fluent in Markdown, YAML, Git, and reading a CI config. They are not compiler engineers, and they do
not want to maintain a bespoke quality tool.

Their quality bar is already written down somewhere: a style guide, a page-template checklist, a
"definition of done" in a wiki. What they lack is any way to *enforce* the half of it that a linter
cannot express.

## What they're trying to do

Make documentation quality a property of the pipeline rather than a property of whoever happened to
review the PR. Concretely, encode the checks they already do by hand into named, versioned
assertions. Apply them consistently by page type, and get a signal in CI when a page stops meeting
the bar.

## Defining pains

- **The rules that matter most are unenforceable.** markdownlint catches a malformed table. Nothing
  catches "this page promises a feature we have not shipped," or "this page never says why you would
  use the thing." Nothing catches "these two reference pages are now 90% the same text" either.
- **Review fatigue is the enforcement mechanism, and it does not scale.** Standards decay quietly as
  the team and the corpus grow. Nobody decides to lower the bar; it just erodes.
- **Tool sprawl.** Vale, markdownlint, a link checker, a frontmatter validator, and a structure linter
  each have their own config, CI step, and output format. Consolidating them is
  a project nobody has time to start.
- **Quality regressions are invisible until a reader complains.** There is no equivalent of a failing
  test for prose, so there is no moment where the team learns a page got worse.

## Buying constraints

- Must run in existing CI without a new service, a new account, or a hosted control plane.
- Must produce a **deterministic, explicable** failure. "The build is red because a model said so" is
  not something this audience can take to engineering leadership.
- Per-run cost must be bounded and predictable enough to defend in a budget conversation; an
  unbounded per-PR LLM bill is disqualifying.
- Sending page content to a model provider needs an answer for security review. The `claude-cli`
  provider and any OpenAI-compatible `base-url` (including a self-hosted endpoint) are the answers.
  They must be documented as such rather than buried in a provider table.
- Adoption has to be incremental. A tool that requires annotating 2,000 pages before it produces
  value will not get past the pilot.

## Qualified reader (for docs targeting)

- **Prerequisites they bring.** Git and pull-request workflow; YAML frontmatter; globs; reading and
  editing a CI workflow file. Also the concept of a test suite that passes or fails, and at least one
  existing docs linter in their pipeline.
- **Prerequisites they do not bring.** LLM-as-judge mechanics, ensemble consensus, prompt versioning,
  or JSON Schema authoring beyond copy-and-adapt.
- **Subject dependencies.** The eval → grader → verdict model, and the grader hierarchy, must be
  understood before any page about suites, severity, or CI output will make sense. That is why
  `get-started/how-manni docevals-works.mdx` is a P0 page rather than a nice-to-have explainer.
