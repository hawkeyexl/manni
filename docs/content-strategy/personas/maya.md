---
type: persona
id: maya
title: Maya, Documentation Engineer
description: Maya owns a 2,000-page docs-as-code repo for a platform product.
audience: docs-engineers
proficiency:
  - Markdown, YAML and Git.
  - Reading a CI config.
goals:
  - Every doc has correct, complete frontmatter so the search index and the content catalog stay trustworthy.
pains:
  - Contributors omit required fields like `type`.
  - Values are fat-fingered, with `date-time` formatted incorrectly or enum values misspelled.
  - Metadata drifts as the team grows, and she has no enforcement mechanism. All she has is review fatigue.
constraints:
  - Wants every red build to point at a rule she can name, never at a model's verdict.
---

Maya owns a 2,000-page docs-as-code repo for a platform product. She is comfortable with Markdown, YAML, Git, and reading a CI config. She is not a JSON Schema expert.

**How she uses manni meta.** She installs it, writes or adopts a schema, adds a CI step, then mostly operates it hands-off. She returns when the standard needs tightening.

**Which tools she owns work in.** She owns work in meta, lint, cite, a11y, docevals and tracevals. She stands up the metadata gate and holds each page to the shape its doctype promises. She pins the claims on her pages, and she checks the published site. She also holds pages to the quality bar her team wrote down, and holds the agent instructions her repo runs on to the same standard.

**What docevals adds to her job.** The rules that matter most on her pages cannot be written as lint rules or schemas. Two examples are "this page promises nothing unshipped" and "it says why before how". docevals is where she encodes them, as named assertions in config that pages and suites reference. Her constraint there is explicability. She will be asked why a build is red, and "a model said so" ends the pilot. So she reaches for `command` and `tool:regex` graders first and treats an `ai` eval as the last resort. The linters already in her pipeline keep their own steps. Every manni domain in it reports on one severity scale with one set of exit codes.

She meets docevals in two situations that change the journey, not the person:

- **When she is the only one writing the docs**, alongside another job. She reads `--help` before a guide and gives the tool ten minutes. The first run has to find something real on one of her own pages, with no provider key (`--deterministic-only`). Writing an assertion per page is arithmetically out of reach, so `fill` is the entry point rather than a convenience. She has to learn early that proposals are cached before the confidence gate, so re-gating costs nothing. Budgets are counted in inference calls, never dollars, and converting them is her provider's rate card.
- **When she is handed a corpus she did not write.** The first honest run on thousands of unmeasured pages fails nearly everything. The instinct it produces is to weaken the assertions until the build is green, and that destroys the standard for good. The inversion she needs is to keep the assertions honest, turn them on at `error`, and record today's findings in a committed baseline. CI then fails only on new findings, and the backlog is a number that falls. `fill` proposes and she triages, one directory at a time, because nobody can review a 3,000-page pull request. The first pass is the largest spend she will ever see, and it arrives before any value has shown.

The docevals strategy imported with the tool called these three situations Priya (the docs platform lead), Nate (the solo owner) and Iris (the retrofitter). They are the same job at different team sizes and corpus states, so they are Maya here.

**What tracevals adds to her job.** The instructions she writes for agents accumulate the way documentation does. A `SKILL.md` here, a subagent definition there, a `CLAUDE.md` nobody rereads. Nothing checks whether any of it is still followed. tracevals grades a session that already happened against the artifacts it used, so "is this instruction decorative?" has an answer. The strategy imported with that tool named five audiences. Four were already these four people. The fifth was Rin, a toolsmith who wants the library rather than the binary. He is Devin reading the JSON report and calling the namespace export. So he is folded into D15 and the API reference rather than added here.

**The one decision she is not equipped for.** `fill` is the only part of manni meta that sends her documents to a third party. Clearing the retrofit backlog (M4) therefore makes her choose a provider, or refuse hosted inference entirely and run it on her own hardware. She does not own her organization's data-egress policy, but she is the one who has to answer to it. And the default is detected from her environment rather than chosen.

**Why she is the lead persona.** She is the primary adopter. She touches installation, config, schema selection, and CI wiring, which is every layer of the stack. Her journey (M1) is the anchor.
