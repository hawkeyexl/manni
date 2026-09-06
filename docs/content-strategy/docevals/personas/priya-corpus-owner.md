---
id: persona-corpus-owner
type: persona
name: "Priya, Documentation Platform Lead"
audience: aud-docs-platform-team
role: Lead of a documentation team accountable for the quality of a large docs-as-code corpus
lead_persona: true
proficiency: [markdown, mdx, yaml-frontmatter, git, globs, reading-ci-workflows, docs-linters]
prerequisites:
  [pull-request-workflow, the-idea-of-a-passing-test-suite, at-least-one-existing-docs-linter]
goals:
  - Encode the quality bar the team already reviews by hand into named, versioned assertions
  - Apply different checks to different page types without per-page duplication
  - Get a CI signal the first time a page stops meeting the bar
  - Consolidate the linters already in the pipeline behind one gate and one output format
pains:
  - The rules that matter most cannot be expressed as lint rules
  - Review fatigue is the only enforcement mechanism and it does not scale
  - Five quality tools, five configs, five output formats
  - Quality regressions are invisible until a reader complains
content_types: [anchor-guide, conceptual-explainer, configuration-reference, ci-recipe]
journeys:
  [cuj-first-gate, cuj-eval-library, cuj-orchestrate-tools, cuj-write-judgeable-assertions,
   cuj-ci-wire, cuj-resolve-review, cuj-retrofit-corpus]
---

# Persona: Priya

**Scope:** the lead persona, the primary adopter and owner for
[`aud-docs-platform-team`](../audiences/docs-platform-team.md). Priya configures manni docevals and lives
with it daily. She is not the person who defines the standard in a large org; that is
[Sara](sara-standard-owner.md). Nor is she the person who operates the pipeline; that is
[Devin](devin-pipeline-owner.md). Below a certain team size she is all three.

Priya leads a docs team of six maintaining about 1,200 pages of MDX for a platform product. She is
fluent in Markdown, YAML, Git, and globs, and she can read and edit a CI workflow. She has opinions
about which of the five linters in the pipeline are earning their runtime. She is not an LLM
practitioner and does not want to become one.

What she needs from the docs is a path from "we review this by hand and it is slipping" to "the
pipeline tells us." That path threads install, the frontmatter contract, named evals, suites, the
grader hierarchy, and a CI step. That is why her journey,
[`cuj-first-gate`](../journeys/cuj-first-gate.md), is the backbone the site is built around. She will
follow it once, carefully, and then operate mostly hands-off, returning when the bar needs tightening
or a new page type appears.

Her defining constraint is **explicability**. She will be asked, in a pull request and eventually by
her engineering leadership, why a build is red. "A model said so" ends the conversation badly and
ends the pilot shortly after. Everything she adopts must produce a failure a human can read, argue
with, and act on. That is why she reaches for `command` and `tool:*` graders wherever they will do
the job. She treats an ai eval as the choice of last resort rather than the default. She arrives
sympathetic to that discipline; the docs need to make it easy to follow rather than argue for it.

Success for Priya looks like a quarter in which nobody discussed the style guide in a code review,
because the pipeline had already handled it. One page failed for a reason the author fixed in
four minutes without asking her.
