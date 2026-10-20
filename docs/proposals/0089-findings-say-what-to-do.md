# 0089: Findings say what to do, across the family

- **Status:** Proposed
- **Serves:** Every persona who reads a finding.
  - Theo · T1, T2, T3, T4, T6, T7 and T8. He reads a failure in one domain
    and has to find out elsewhere what fixes it.
  - Maya · M24, "Let an agent keep the docs green while it writes them". The
    agent guesses at a fix the tool never named.
  - Devin · D3 and D16. Every SARIF alert links to one generic page, and
    `manni check` has no SARIF at all.
  - Sara · S1 and S12. She writes a `description` on every property and
    shape, and no finding or command shows it.
- **Depends on:** [0088](0088-findings-say-what-the-template-asks-for.md),
  whose pattern this extends from lint to every domain.
- **Supersedes in part:** [0078](0078-family-check-status-and-claude-code-plugin.md)
  and [0051](0051-graph-domain.md). `manni check` and `manni graph check` both
  gain `-f sarif`, as the graph and family sections say.
- **Touches:** `src/shared/guidance.ts`, the reporters of every domain,
  `src/meta/core/`, `src/cite/core/`, `src/term/core/`, `shapes/graph/`,
  `src/family/`, `plugin/manni/`, and the fix and reference pages of each
  domain under `docs/src/content/docs/`

## Problem

0088 gave `manni lint` findings three things. Each names the rule that
judged the page, with what that rule is for and a guide link. Each speaks to
the person who can act. And each root cause is reported once.

Every other domain still reports a symptom and stops. The information needed
usually exists already. It is dropped before it reaches the reporter.

| Persona · CUJ | What they hit today | Cost |
|---|---|---|
| Theo · T1 (meta) | `/outline must be equal to one of the allowed values`, then `must match "else" schema` | He opens the schema to find the values, and reads a wrapper line he cannot act on. |
| Theo · T2 (cite) | `fetch-timeout :15 current src/changed.ts:2 changed` | No remedy is given. He looks up the fix page to learn the command. |
| Theo · T4 (term) | `concepts: "trifocal" names no entry.` | No "did you mean", and no mention of `term fill`. |
| Theo · T6, T8 (evals) | `AI judge: fail (confidence 0.91).` and the reasoning | No reporter prints the assertion, or says whether to fix the page, the session or the eval. |
| Theo · T7 (graph) | `Value does not match pattern` on `dcterms:language` | He has to work out that this means `lang`. One S27 mistake is reported twice. |
| Theo · T3 (a11y) | A GitHub annotation with no selector, summary or element | He reruns locally to find the element. Identical annotations hide the distinct issues. |
| Maya · M24 (agent) | The hook says "Fix them" and never names `manni:fix` | The agent guesses, edits config, or weakens an eval. |
| Maya · M24 | `status` says why a domain is off, never what to type | She falls back to the docs. |
| Devin · D3, D16 | SARIF `helpUri` is one constant, and `check` has no SARIF | Each alert links to a generic page, and each domain needs its own upload. |
| Sara · S1, S12 | No finding or command shows the descriptions she writes | Her intent never reaches the author. |

The outcome this proposal aims at is plain. Each finding names what judged it
and says what that rule is for. It links a guide and says what to do. It
speaks to whoever can act, and says it once. Authors can also print what a
schema or shape asks for before they write.

## Decision

### The shared contract

Every domain follows these seven rules.

| # | Rule |
|---|---|
| C1 | A finding that a rule judged carries `guidance`, an object of four fields. `id` names what judged it, such as a template, schema, shapes file, eval file or rule namespace. `rule` names the rule within it, or is `null`. `description` says what the rule is for, written for the person who fixes it, or is `null`. `guide` is an http(s) URL or `null`. |
| C2 | One renderer, `src/shared/guidance.ts`, prints the lines `<id> <rule>: <description>` and `Guide: <url>`. Pretty prints them dim and indented under the finding. GitHub appends them after `%0A`. SARIF appends them to the message and puts the object in `properties.guidance`. JUnit and markdown put them in the item body. |
| C3 | The message says what to do, and addresses the person who can act. Advice for whoever owns the config, schema or template lives on the fix page. |
| C4 | One finding per root cause. A page that passed never fails. Any baseline entry whose identity changes is named. |
| C5 | A `show` command reads `manni <domain> <noun> show <ref>`, with `-f pretty`, `json` or `markdown`. Markdown prints a skeleton to start from. It exists only for meta schemas and graph shapes, the reusable specs authors write against. |
| C6 | The plugin's fix skill tells the agent to read the guidance lines and the `show` command. It never lets the agent edit a schema, eval, template or config to make a finding pass. |
| C7 | Every string this work touches has no em dash, no sentence over 25 words, and is in the present tense. |

**Decision 1, the JSON key.** Every domain uses `guidance`. It is `null`
when nothing stands behind the finding. The key is additive, and no existing
key changes. lint keeps `template`, its key since 4.13.0, which has the same
four fields. Renaming it would be a breaking change for no reader's benefit.

### meta

Every Ajv finding carries guidance. Its `id` is the schema ref, and its
`rule` is the property path. Its `description` comes from that property's
`description`, and a built-in schema's reference page is its guide. Synthetic
findings carry `null`.

Messages are rewritten for the page's author. `must be one of:` lists the
values that pass, and each `$schema` refusal tells the author what to use.
The config owner's advice moves to the fix page. Ajv's `if`, `anyOf` and
failed `oneOf` wrappers are dropped, because each one only ever appears
beside a child error.

`manni meta schemas show <ref>` prints a schema as an outline, as JSON, or
as a frontmatter skeleton.

**Decision 4, the description's length.** A finding carries the first
sentence of the description. Built-in descriptions mix author text with
maintainer rationale, and their bytes are immutable. `schemas show` prints
the full text.

This proposal neither rewords built-in descriptions nor adds `examples`.
Both need new schema versions.

### cite and term

Every cite finding carries `manni:cite` guidance, and its guide is the rule's
anchor on the fix page. Each message keeps its status text and gains one
sentence of remedy. A marker that names no entry reports `marker-orphan`
alone.

`term check` findings carry `manni:term` guidance, linked to the rules page.
Vale's findings from `term lint` keep Vale's own description and link. A
misspelt term gets a "did you mean" built from term labels.

**Decision 3, term's baseline identity.** Each message keeps its 4.13 text as
a frozen key, and new advice goes in a separate field. The fingerprint reads
the key. No term baseline changes now, or when advice is reworded later.

**Decision 11, cite's guide.** The guide is the fix page's anchor for the
rule. It is the T2 page, and it has an anchor for every rule once
`claim-reanchored` gains its row.

Neither domain gains a `show` verb. A citation and a term entry are not
specs that authors write against, and `term get` already prints an entry.

### docevals and tracevals

Every eval result carries guidance. Its `id` is the file that declares the
eval, its `rule` the eval's name, and its `description` the assertion. One
renderer prints a judged verdict the same way in both tools, and it always
quotes a failing run. Each failure message says what to change. A tracevals
message also says when the eval itself is what needs the fix.

**Decision 7, review in CI.** An eval that needs review emits one warning in
GitHub and in SARIF output. tracevals already fails the build on review by
default, without saying why.

No verdict field tells the session from the artifact. Adding one
changes the prompt version, invalidates caches and needs golden sets re-run.

### graph

The bundled shapes gain a description on every named shape. Wherever a
page's frontmatter feeds the value, they also gain a message the author can
act on. Each
finding leads with the pages, and its guidance names the shape. A merged
result is reported once, and S27 is reported once per pair.

`manni graph shapes` lists the shapes in use, and `graph shapes show` prints
one as an outline, as JSON or as a frontmatter skeleton.

**Decision 5, the shapes version.** The new shapes file is 1.1.1, a patch.
Validation behavior is unchanged, and a test holds 1.1.0 and 1.1.1 to the same
results. 1.1.0 stays byte for byte as it was.

**Decision 6, graph SARIF.** `manni graph check` gains `-f sarif`, so that
`manni check -f sarif` can carry graph findings. Each blamed page is a
location at line 1. A finding that blames no page is counted in a run
notification instead. This replaces the format list 0051 gave `graph check`.

Graph findings still carry no line numbers. They cost a lot and help few
messages.

### a11y and test

An a11y violation carries axe's own description and help link as guidance.
Pretty output shows each element's html. GitHub output carries the selector,
the failure summary and the html.

A failed `test run` step carries guidance from Doc Detective's action and its
page. The message admits that the tool cannot tell causes apart. Identical
failures across browsers or platforms collapse to one.

**Decision 8, a11y collapse.** Identical violations across pages collapse in
GitHub output only, to stay under the annotation cap. Pretty and JSON stay
per page.

**Decision 2, `test run -f json`.** It stays Doc Detective's object as is,
with no guidance. 0085 requires that, and it is the one exception to C1.

Neither a11y nor test gains SARIF. A URL cannot anchor in code scanning,
and Doc Detective has its own JUnit.

### status, check and the hooks

Each row of `manni status` that is not in play gains `next`, one sentence
saying what to do. The PostToolUse and Stop hooks name the `manni:fix` skill.
A hook that could not check a file carries the whole message. Each
operational error gains one next step and keeps its prefix.

`manni check -f sarif` writes one SARIF log. Each domain that ran adds its
own run, and a final run notes each check that was skipped or errored. This
replaces 0078's answer to open question 5, which left SARIF out of `check`.

**Decision 10, the SessionStart briefing.** It omits `next`. That is advice
for the config owner, and the setup skill says to add nothing unasked.

### Delivery

**Decision 9, the demo video.** The work ships as one stack and one release,
so it gets one video, made at the tip.

## What was rejected

- **Renaming lint's `template` key to `guidance`.** It is released, and the
  rename would be a breaking change. The shape is already the same.
- **A `show` verb for every domain.** Only schemas and shapes are reusable
  specs. The rest already have a command that prints one item.
- **Full descriptions in every finding.** Built-in descriptions carry
  maintainer rationale that an author cannot act on.
- **A repo-wide em-dash sweep.** About 215 strings carry one. That is its own
  `fix:` change.
- **Splitting term's `label-overlap` rule.** It would change the rule id, the
  severity key and every fingerprint.

## Consequences

- Good, because every finding names its rule and links a guide, in every
  format.
- Good, because an agent reads which skill to use and what not to edit.
- Good, because one SARIF upload covers every check a repository set up.
- Bad, because descriptions become interface. Rewording one changes what
  every author reads.
- Bad, because meta's wrapper fingerprints go stale in existing baselines.
  The exit code does not change.
