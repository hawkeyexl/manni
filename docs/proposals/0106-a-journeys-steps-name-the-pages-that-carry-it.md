# 0106: A journey's steps name the pages that carry it

- **Status:** Proposed
- **Serves:** Two people.
  - Sara · S17, "Hold the pages to the strategy they were written for". She
    owns `docs/content-strategy/`, and nothing holds a journey's path to the
    pages it runs through.
  - Theo · T1, "Fix a failing metadata check fast", for the four new rule
    sections. A finding names its rule, and the rule's section says what
    fixes it.
- **Depends on:** Three earlier decisions.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    is the strategy domain, its records, its rules and its output.
  - [0041](0041-collections.md) put document sets in `collections:`. A step's
    page is a page of the run.
  - graph's `routes` map a site route to the file that serves it. A step
    resolves a route the way a link does.
- **Supersedes:** Nothing. 0102 stands as written.
- **Touches:** `src/strategy/`, `src/graph/core/analyze.ts`, the strategy
  pages and reference, `docs/content-strategy/`, the fix skill and three
  journey records.

## Problem

The journey schema already declares `steps:`, a list of `stage`, `doc`,
`exists` and `note`. The field came wholesale from Promptless's records. No
journey here carries one, and no tool reads it. `manni meta validate` checks
its shape, so a step naming a page deleted last month passes every gate.

That leaves four gaps in this repository.

- **A journey has no order.** `manni strategy get m1` prints eight pages,
  sorted by path. The IA's walk-through test says to follow the pages from
  start to finish. The list has neither.
- **Pages that carry a stage do not say so.** M1 says Maya evaluates whether
  manni meta fits, and lands a passing CI step. The meta overview names no
  journey, and the CI page names only `d1`. Nothing records which page
  carries which stage, so nothing can notice.
- **Planned pages live in prose.** The IA's Phase 3 lists case studies. No
  page exists, and no record says which journey owes it.
- **The field is dead weight.** A repository that copies Promptless's records
  gets `exists: true` on every step. No tool says when one stops being true.

## Worked example

Sara works on this repository at the commit this lands on. Her journey is
S17.

She asks which pages carry M1, and in what order. `manni strategy get m1`
prints eight pages sorted by path, and exits `0`. The set is right, and the
order is lost.

She writes M1's stages into the record, from its body. She names pages by
route, as the site's `next-steps:` do, and one by repo path. The case studies
page is the Phase 3 item, so she marks it `exists: false`.

```yaml
steps:
  - stage: Decide whether manni meta fits
    doc: /manni/meta/
  - stage: See how a team like hers adopted it
    doc: /manni/meta/case-studies/
    exists: false
  - stage: Install it and validate one file
    doc: /manni/meta/get-started/
  - stage: Stand up config, schema and CI in one pass
    doc: /manni/meta/set-up/
  - stage: Write the config file
    doc: /manni/meta/set-up/config/
  - stage: Land a passing CI step
    doc: /manni/meta/ci/
  - stage: Fill the fields older pages lack
    doc: docs/src/content/docs/meta/set-up/retrofit.mdx
```

`manni strategy check` names the two pages and the gap. The routes resolve
through the `graph.routes` this repository already declares.

```text
docs/content-strategy/journeys/m1.md:9
  warning manni:strategy/missing-journey      step 1: docs/src/content/docs/meta/index.mdx does not name "m1" in journeys:.
                                              Add it to that page's journeys:, or point the step at a page that does.
docs/content-strategy/journeys/m1.md:10
  notice  manni:strategy/unwritten-step       step 2: doc "/manni/meta/case-studies/" names a page that does not exist.
docs/content-strategy/journeys/m1.md:20
  warning manni:strategy/missing-journey      step 6: docs/src/content/docs/meta/ci/index.mdx does not name "m1" in journeys:.
                                              Add it to that page's journeys:, or point the step at a page that does.

2 warnings, 1 notice in 82 records
```

It exits `0`, because warnings and notices never fail a run. Both pages do
carry the stage, so she adds `m1` to each sidecar's `journeys:`. The next run
says what the CI page now owes.

```text
docs/src/content/docs/meta/ci/index.meta.yaml:6
  warning manni:strategy/missing-parent       personas: does not name "maya", the persona of journey "m1".
                                              Add it, or drop "m1" from journeys:.
```

She adds `maya` to that sidecar's `personas:`, and `docs-engineers` to the
page's own `audiences:`. Then `check` prints only the gap.

```text
docs/content-strategy/journeys/m1.md:10
  notice  manni:strategy/unwritten-step       step 2: doc "/manni/meta/case-studies/" names a page that does not exist.

1 notice in 82 records
```

`manni strategy get m1` now shows the path in order.

```text
  steps         6 of 7 served
                1  served     Decide whether manni meta fits
                              docs/src/content/docs/meta/index.mdx
                2  unwritten  See how a team like hers adopted it
                              /manni/meta/case-studies/
                3  served     Install it and validate one file
                              docs/src/content/docs/meta/get-started/index.mdx
                …
                7  served     Fill the fields older pages lack
                              docs/src/content/docs/meta/set-up/retrofit.mdx
```

`manni strategy list` shows `6/7` beside M1. She raises `missing-journey` to
`error`, so no step's page can drop its journey unnoticed.

The outcome is the one the problem asked for. Stage 6 of M1 has a page, and
`get` lists it in order. The two pages that carried a stage silently now say
so. The case studies page is a named gap with a file and a line.

## Decision

### 1. `strategy` reads `steps:` on a journey

An item counts when it is a mapping. Its `stage`, `doc` and `note` count when
they are strings. Its `exists` counts when it is `true`, `false` or
`"partial"`. Anything else reads as absent, and the shape stays meta's to
validate, as 0102 decided for every field. A step is numbered by its place in
the list, from 1. `steps:` on an audience or a persona is not read.

### 2. A step's `doc` resolves to a page of the run

A page is any input that is not a record. A `doc` takes one of two forms.

- A repo path resolves from the config file's directory, or from the working
  directory when no config file governs the run. It names the file exactly.
  There is no repository root, because the tool never assumes git.
- A site route starts with `/`. It resolves through `graph.routes`, by
  graph's own `resolveRoute`, with roots rebased onto the run's base as
  `graph build` rebases them.

Anything after `#` or `?` is dropped first, so anchors are not checked. A URL
with a scheme is off-site, as it is for graph. So is a route no
`graph.routes` entry maps.

### 3. Each step gets one state

The tool detects what it can, and reads `exists` only for what it cannot.

| `doc` | `exists` | State |
|---|---|---|
| names a page that names the journey | absent, `true` or `false` | `served` |
| names a page that does not | absent, `true` or `false` | `unclaimed` |
| names a page | `partial` | `partial` |
| names no page | `false` | `unwritten` |
| absent | absent or `false` | `unwritten` |
| names no page | absent, `true` or `partial` | `broken` |
| absent | `true` or `partial` | `broken` |
| off-site or unmapped | absent, `true` or `partial` | `unchecked` |
| off-site or unmapped | `false` | `unwritten` |

A step that names a page claims it exists unless it says `exists: false`.
That tells a planned page from a typo. `partial` is the one value no tool can
detect, so it is the value worth writing by hand.

### 4. Coverage is served steps over steps

`partial`, `unclaimed` and `unchecked` do not count. A partial page still
owes work, an unclaimed page has its own finding, and an unchecked URL was
never looked at.

### 5. Four rules join the table

| Rule | Default | Fires when |
|---|---|---|
| `broken-step` | error | A step's `doc` names no page, or a step says `exists: true` or `partial` and has no `doc`. A step with `exists: false` is exempt. |
| `stale-step` | warning | A step says `exists: false`, and its `doc` names a page. |
| `missing-journey` | warning | A step's page does not name the journey in `journeys:`. |
| `unwritten-step` | notice | A step says `exists: false`, or has no `doc`. |

The steps of a draft or archived journey are exempt from all four, as they
are from `unserved-journey`. `get` and `list` still show their states.

`broken-step` is an error because it is a dangling reference in the record,
like `undefined-reference`. No published repository carries steps, so the
default blocks nobody on upgrade.

### 6. `get`, `list` and the JSON show steps and coverage

No flag, verb or config key is added. A set with no steps prints what it
printed before, byte for byte, in every format.

## Interface

### Config

No key is added. `strategy.severity` accepts four more rule names. This
repository's config, before:

```yaml
strategy:
  severity:
    unserved-journey: error
```

After:

```yaml
strategy:
  severity:
    unserved-journey: error
    missing-journey: error
```

`graph.routes` is unchanged. With no entry, every route `doc` is `unchecked`.
`strategy` reads `graph:` only when some step's `doc` starts with `/`.

### The record field

```yaml
steps:
  - stage: Land a passing CI step
    doc: /manni/meta/ci/
    exists: partial
    note: Covers GitHub Actions only.
```

| Field | Type | What `strategy` does with it |
|---|---|---|
| `stage` | string | Shown by `get`. |
| `doc` | string | Resolved to a page of the run, as decision 2 says. |
| `exists` | `true`, `false` or `"partial"` | `false` marks a page not written. `partial` marks a page that covers the stage in part. |
| `note` | string | Shown by `get` under the step, and in the JSON. |

### Messages

| Rule | Message | Line |
|---|---|---|
| `broken-step`, a `doc` | `step 5: doc "docs/gide.md" names no page. Correct doc, or set exists: false if the page does not exist.` | the `doc:` line |
| `broken-step`, no `doc` | `step 3: exists: true, but the step has no doc. Name its page in doc:, or set exists: false.` | the `exists:` line |
| `stale-step` | `step 6: exists: false, but doc "docs/ci/index.md" names a page. Set exists: true or partial, or drop exists:.` | the `exists:` line |
| `missing-journey` | `step 4: docs/reference.md does not name "m1" in journeys:. Add it to that page's journeys:, or point the step at a page that does.` | the `doc:` line |
| `unwritten-step`, a `doc` | `step 7: doc "/site/tutorial/" names a page that does not exist.` | the step's first line |
| `unwritten-step`, no `doc` | `step 8: no page carries this stage.` | the step's first line |

The text before the advice is the baseline's key. `missing-journey` names the
page by its path from the working directory. Every finding carries
`field: "steps"` and the journey's `id`. Exit codes are 0102's.

A step that names a route while `graph:` is invalid fails the run with exit
`2` and graph's own message. The runner prefixes each line.

```text
manni: Invalid config in <config path>:
manni:   /graph/routes/0: must have required property 'root'
```

The unknown-rule message lists all ten rules.

### Output shapes

`get -f pretty` gains a `steps` row after `personas` and before `pages`. Its
first line is the coverage. Each step is its number, its state padded to nine
and its stage. Under it, dim, is the page `doc` names, else `doc` as written,
then the note.

`list -f pretty` gains a `steps` column between `pages` and `title`, holding
`served/steps`. It appears only when some journey has steps.

`get -f json` and `list -f json` carry `steps` and `coverage` on a journey
with at least one step, after `personas` and before `namedBy`. A step carries
`stage`, the `doc`, `exists` and `note` written, `line`, `state`, and `page`
when `doc` names one.

`check -f json` gains `summary.steps`, after `references`, when the set's
journeys carry steps. A clean pretty run then reads
`✓ 82 records, 1478 references, 17 steps, no findings`. `github`, `sarif`
and `junit` are unchanged in shape.

The programmatic API does not change. `src/index.ts` exports meta only.

## Known limits

- **This repository's check prints one notice** while the case studies page
  stays unwritten. `manni check` and every hook still exit `0`.
- **Tagging a step's page moves its lines.** The dogfood adds a frontmatter
  line to the meta CI page, so the commit runs `manni meta derive` too.
- **Two reports for one gap.** A journey whose steps' pages all leave it out
  draws `unserved-journey` and a `missing-journey` per step. Both are true,
  and each names a different fix.
- **A run given paths reads fewer pages.** A step whose page is outside them
  is `broken`, as a journey is unserved there.
- **Baseline keys carry the step number.** A step inserted above a baselined
  finding gives it a new key, so it reports again once.
- **Two accounts of one fact.** A step's `doc` and a page's `journeys:` both
  say that page serves the journey. `missing-journey` reconciles one
  direction. The record body's `**Steps.**` prose is a third, and no rule
  reads it.
- **Promptless-style records** with full URLs on every step check nothing and
  cover nothing. `get` says `unchecked` on each, so the reason shows.

## Rejected

- **A new URL resolver, or a `strategy.siteUrl` key.** `graph.routes` already
  maps routes to files.
- **Counting a step's `doc` as the page naming the journey.** The Read hook,
  docevals and graph read the page's own `journeys:`.
- **Dropping `exists` and detecting everything.** `false` tells a planned
  page from a typo, and `partial` cannot be detected.
- **One rule for both directions of `exists`.** A dead `doc` misleads a
  reader, and `exists: false` on a written page is good news.
- **A `strategy steps` or `strategy coverage` verb.** `get` and `list`
  already show records.
- **A rule that every page naming a journey is one of its steps.** Reference
  pages name journeys too.
- **Checking anchors, or step order against `prerequisites`.** graph's link
  check owns sections.
- **Resolving a full URL on the site's own origin.** It needs an origin, and
  this repository's collection `url:` is the local preview.

## Open questions

The review settled four. A gap is a notice finding, `unwritten-step`. Only
served steps count toward coverage. A scheme URL stays off-site.
`broken-step` defaults to `error`.

## Verification

- `test/strategy/steps.test.ts` covers every row of the state table, the
  anchor drop, a scheme URL, an unmapped route and a positional run.
- `test/fixtures/strategy/steps/` breaks each step rule once, and its draft
  journey draws nothing. `check` exits `1` on its `broken-step`.
- On this repository, `strategy check` shows the three findings above before
  the sidecar edits, and one notice after them.
- `strategy get m1`, `m5` and `d5` show `6 of 7`, `5 of 5` and `5 of 5`.
- A typo in M1's step 7 exits `1` on `broken-step` at its line. `exists:
  false` on step 3 warns `stale-step`.
- `manni check` exits `0`, and `manni status` shows the strategy row as
  before.
