# 0073: docevals grades only what no other domain owns

- **Status:** Proposed
- **Serves:** Maya · M11, who stands up a first eval gate. Devin · D11, who
  bounds what the gate can execute.
- **Depends on:** [0048](0048-docevals-domain.md), the domain this narrows.
  [0050](0050-lint-domain.md), which gives page structure to `manni lint`
  and names the `prose` and `format` jobs Vale and remark-lint answer.
- **Relates to:** [0023](0023-metadata-vocabularies.md), whose evals
  vocabulary keeps the open `tool:<kebab>` family this proposal leaves in
  place. [0034](0034-command-grammar.md), the rule that a shared concept has
  one home. [0065](0065-content-model.md), which kept lint's finding `type`
  because docevals parsed it.
- **Supersedes:** Four ADRs from the docevals log:
  [ADR 00004](docevals/00004-level-1-orchestrates-rather-than-reimplements.md),
  [ADR 01005](docevals/01005-fix-the-doc-detective-adapter-invocation-and-finding-granularity.md),
  [ADR 01013](docevals/01013-track-docmeta-4x-and-name-the-schema-set.md) and
  [ADR 01024](docevals/01024-remark-lints-mdx-where-markdownlint-cannot.md).
  Each one's Status line is the only edit.
- **Supersedes, in part:** Four more from that log.
  [ADR 01025](docevals/01025-an-operator-grant-replaces-the-frontmatter-commands-boolean.md),
  for the `page-embedded-steps` grant.
  [ADR 01029](docevals/01029-a-regex-grader-and-a-file-exists-grader.md),
  for `tool:file-exists`.
  [ADR 01040](docevals/01040-since-scopes-a-run-and-exempts-corpus-graders.md),
  for the corpus exemption.
  [ADR 01028](docevals/01028-a-pre-run-feasibility-pass.md), for its
  `tool:docmeta` check. None of them is edited. Also
  [0048](0048-docevals-domain.md) § 5, for the vocabulary docevals reads.
  Pages validate against the shipped `manni:evals:1.0.0`, not the
  `1.0.0-proposal.4` draft. Its Status line is the only edit.
- **Touches:** `src/docevals/**`, `test/docevals/**`,
  `docs/src/content/docs/docevals/**`, `docs/content-strategy/*.md`,
  `manni.config.yaml`, `docs/manni.docevals.yaml`
- **Verdict:** Four graders stay: `ai`, `command`, `human` and `tool:regex`.
  The ten others go, with every option, grant and output line that existed
  for them. An eval that names a grader nobody registered is a usage error.

## Problem

docevals arrived with fourteen graders. Ten of them answer a question that
another place in the family already answers.

| Grader | Who answers it |
|---|---|
| `tool:docmeta` | `manni meta validate` |
| `tool:doc-structure-lint` | `manni lint structure` |
| `tool:vale` | lint's `prose` job, which 0050 assigns to Vale |
| `tool:markdownlint`, `tool:remark` | lint's `format` job, which 0050 assigns to remark-lint |
| `tool:doc-detective` | Doc Detective's own Action, which this repository already runs |
| `tool:freshness` | a metadata rule, so `meta`'s question |
| `tool:reading-level` | a prose metric, which Vale's `metric` rules compute |
| `tool:differentiation` | nobody, and nobody should in this form |
| `tool:file-exists` | `command`, in one line |

ADR 00004 chose the wrappers so one run could report every check with one
exit code. That reasoning held while docevals was a separate tool. Inside
the family it gives each check two homes.

Two homes cost Maya twice. She configures a schema set under
`docevals.evals.<name>.options.schemas` and again under `meta.schemas`. She
reconciles Vale's three severities through `severity-map`, when lint reads
the family's scale directly. When the two runs disagree, she has to find out
which one gates.

The native graders have weak cases of their own.

- `tool:differentiation` compares word frequencies. Reference pages built
  from one template score as similar by design, so it fails the pages it was
  written for.
- `tool:reading-level` scores English only, and duplicates a Vale metric.
- `tool:file-exists` has one use in this repository. Its glob is `*.mdx`,
  resolved beside the page, so it matches the page itself and cannot fail.

None of the ten has a user here. `docs/manni.docevals.yaml` uses only
`tool:docmeta`. The root config uses each grader once, against fixtures.

Devin pays for one of them in risk. `tool:doc-detective` runs shell commands
written in page bodies. That is the only reason the `page-embedded-steps`
grant exists. It is also why the untrusted pull request page describes two
execution paths.

## Decision

### 1. The registry is four graders

| Grader | Why it stays |
|---|---|
| `ai` | Assertions only a reader can decide. This is the product. |
| `command` | The escape hatch for any check, and what `generate` and `promote` write. |
| `human` | A checklist item. The review store exists for the judge's review zone anyway. |
| `tool:regex` | A pattern needs no grant, and it reads `target:`, which no linter does. |

The `tool:` prefix stays. The shipped `manni:evals:1.0.0` restricts a grader
to `ai`, `command`, `human` or `tool:<kebab>`, so `regex` alone would not
validate. No published schema changes.

### 2. Everything that existed for the ten goes

- The option keys `schemas`, `template`, `template-path`, `field`,
  `max-age-days`, `max-grade`, `scope`, `max-similarity`, `path` and
  `exists`, and the tool `command` override.
- The `page-embedded-steps` grant. `execution.allow` keeps one value,
  `frontmatter-commands`.
- `severity-map` in docevals' own config. Page frontmatter follows the shipped
  vocabulary, which allows it, so a page that sets it gets a warning.
- The corpus grader mode, and with it the `--since` exemption and its notice.
- `last-reviewed` as a key that makes docevals load a manifest.

### 3. An unregistered grader is a usage error

Today an eval that names an unknown grader errors on every page, with exit
1. That blames the page for the eval's own bug, which ADR 01029 already
refuses for a bad pattern. The resolve step now rejects it before any page
is read.

```text
manni docevals: manni.config.yaml: eval "fresh-enough" names grader "tool:freshness", which is not registered. Registered graders: ai, command, human, tool:regex.
```

Exit 2, from `run`, `list`, `generate` and `promote` alike.

### 4. The starter config demonstrates a check the four can do

`init` scaffolded `fresh-enough`. It now scaffolds `no-todo-markers`, a
`tool:regex` eval at `error` that fails on `TODO`, `TBD` or `FIXME`. A
corpus that was never checked still produces a finding with no key, and the
finding carries a line.

## Known limits

- **Nothing owns the review clock.** `last-reviewed` still validates as a
  date, and `meta derive` still stamps it. No check compares it to today.
  `manni meta query` over `last_reviewed` is the stopgap until `meta` gains
  an age rule.
- **Vale and remark run directly for now.** Lint's `prose` and `format`
  jobs do not exist yet. Until they do, a corpus runs those tools as its own
  CI steps, as this repository already does.
- **One report becomes several.** A gate that wants meta, lint and docevals
  runs three steps. Each reports on the family's severity scale with the
  family's exit codes, so the steps compose. A single combined report is an
  umbrella question for 0034, not a grader question.

## Stress test

### 1. Why not keep the wrappers until lint's jobs ship?

Because docevals has not shipped. Every wrapper kept now becomes a surface
users configure, and removing it later is a breaking release. Removing it
before the first release costs a draft diff.

### 2. Why cut `tool:freshness` when nothing replaces it?

Its rule is about metadata, so its home is `meta`. Keeping it in docevals
would give the review clock a home that the next proposal has to move.
`cite check` is also the better signal for most pages. It flags a page whose
cited source changed, which a calendar cannot see.

### 3. Why keep `human` when it rarely runs?

It costs almost nothing. The review store, its invalidation and the `review`
command exist for the judge's uncertain verdicts. A `human` eval reuses all
three for an assertion no code or model should decide.

### 4. Why is an unknown grader exit 2 and not exit 1?

Exit 1 means the pages need fixing. An eval that names a grader nobody
registered fails on every page, whatever the page says. The fix is in the
config, which is what exit 2 means.

### 5. Does a third party lose `registerGrader`?

No. The function stays, and a registered grader passes the new check. Only
the corpus mode goes, because no grader the family ships uses it.

## Consequences

- The grader reference documents four kinds. The page that taught
  `tool:doc-detective` is gone, and the untrusted pull request page
  describes one execution path.
- CUJ M13, "report the linters we already run through one gate", is
  retired. D11's fork answer drops page-embedded steps.
- The fixture corpus fails `no-todo-markers` where it failed freshness, so
  the docs' runnable examples keep their exit 1.
- lint's JSON output loses its docevals consumer. 0050's stress test 6 and
  0065 kept the finding `type` key because the `tool:doc-structure-lint`
  grader parsed it. That reason is gone, so a later lint proposal may weigh
  the key on lint's own users alone.
- Prose that a tool can check moves to lint. 0050's stress test 7 left that
  open, and lint's ADR 01003 drew the line at "docevals judges prose". The
  line now holds as written: docevals judges, and lint checks.
- The repository grades its own site. The root `docevals:` section defines
  a suite per domain, which the site's pages already name, and
  `no-todo-markers` runs in each. `docs:check-docevals` runs it with
  `--deterministic-only`, and `docs/manni.docevals.yaml` is gone.
- The fixture showcase moves beside its fixtures, into
  `test/docevals/fixtures/pages/manni.config.yaml`. The docs' runnable
  examples run from that directory, so the paths they show are ones a reader
  would type.
- Eval frontmatter validates through `manni meta validate` against the
  shipped vocabulary, which already runs in CI.
