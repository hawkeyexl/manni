# 0104: Synthetic users attempt tasks in the docs

- **Status:** Proposed
- **Serves:** Two people.
  - Sara · S18, "Watch a persona attempt a task before a reader does", a new
    journey. She keeps the personas and journeys, and nothing shows that a
    persona can finish one with the pages.
  - Maya, who asks the same question of one page before she merges it.
- **Depends on:** Four proposals.
  - [0085](0085-test-domain-runs-doc-detective.md) made `test` the domain that
    runs outside tools against the docs. This proposal gives it a second job.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    made personas and journeys records a tool can read. A journey is the task,
    and a persona is the reader.
  - [0049](0049-tracevals-domain.md) brought the trace parser, the graders and
    the judge this proposal reuses.
  - [0050](0050-lint-domain.md) split the job from the tool. The verb names the
    job, and config names the tool that answers it.
- **Relates to:** Two records.
  - [tracevals ADR 01000](tracevals/01000-rebuild-as-trace-adherence-evaluator-on-docevals-and-docmeta.md)
    took agent trials out of tracevals, so tracevals stays a reader of finished
    sessions. The launcher lives here instead.
  - [0087](0087-a-golden-set-of-reader-questions.md) keeps a golden set of reader questions.
    Journeys become the golden set of reader tasks.
- **Supersedes:** [0085](0085-test-domain-runs-doc-detective.md) in part. Its
  verb `run` becomes `procedures`, and its refusal of a `test:` section names
  `tools.claude-code` as well.
- **Touches:** `src/test/**`, `src/shared/tools.ts`, `src/cli.ts`,
  `src/family/core/in-play.ts`, `src/strategy/commands/get.ts`,
  `src/tracevals/evals/extract.ts`, `src/docevals/core/discover.ts`,
  `test/test/**`, `test/docevals/unit/discover.test.ts`, `test/shared/tools.test.ts`,
  `test/family/status.test.ts`, `docs/content-strategy/**`,
  `docs/src/content/docs/test/**`, `docs/src/content/docs/strategy/index.mdx`,
  `docs/src/content/docs/meta/reference/configuration.mdx`,
  `docs/astro.config.mjs`, `.github/workflows/docs-as-tests.yml`
- **Verdict:** `manni test` gets a second verb, `tasks`, and `run` becomes
  `procedures`. A synthetic user is Claude Code, started headless in a fresh
  temp workspace, playing a persona record when one is named. It attempts a
  task in plain text, or a journey record's task, from a page or a URL. manni
  then judges its trace and workspace against the docs it had. A write-in task
  needs no declared evals, because it is judged on two things only. Did the
  reader complete it, and did it follow the docs and its persona on the way?
  Journeys with `evals:` are the golden set a bare run replays.

## Problem

Sara's journeys and personas are records since 0102, and `manni strategy
check` proves every page names records that exist. Nothing proves a persona
can finish a journey with the pages.

- **The walk-through test is manual.** The information architecture asks a
  reviewer to follow a journey's pages and confirm a user reaches the outcome.
  The reviewer already knows the product, so the gap a newcomer falls into is
  the one they cannot see.
- **The slots are empty.** The journey schema declared `trigger`,
  `entry-point` and `success-criteria` from the start. None of the 74 journeys
  set any of them, because nothing read them.
- **The other checks stop short of doing.** docevals judges one page against
  an assertion such as "a reader can fix a failing field". No reader tries.
  Doc Detective runs the steps the author wrote, in the author's order. It
  proves the commands work, not that a reader finds them.
- **Writing success criteria first is the barrier.** Sara wants to ask "can
  Theo fix a red check from this page?" in one line. If she must write the
  evals before she asks, she never asks.
- **Personas carry constraints nobody tests.** Theo will not read the whole
  documentation. Another reader avoids the terminal. A page can pass every gate
  and still fail the one reader it was written for.

## Worked example

Sara adds Theo's constraints to his record, then asks one question in plain
text.

```text
$ manni test tasks docs/src/content/docs/meta/fix/index.mdx --persona theo \
    --workspace test/test/fixtures/tasks/red-pr \
    --task "The docs check on my pull request fails with: docs/install.md (root) must have required property 'description' (line 1) [manni:core:1.0.0]. Make it pass."
```

manni copies the docs and the seed into a temp directory and starts Claude
Code there as Theo. It saves the stream and judges it against his trace and
workspace. `completed` asks whether he did the task. `followed-the-docs` asks
whether every step came from the docs or from what he already knew. One
`constraint` eval asks the same of each constraint. The report ends with
Theo's own account of where he got stuck.

When the task is worth keeping, she writes it as journey T1, with `evals:`
that say what done means, two of them deterministic. From then on she runs
`manni test tasks --journey t1`. The dogfood run in the pull request that
built this proposal is the real transcript.

## Decision

### 1. Two verbs, and no verb that runs both

`manni test procedures` is 0085's `run`, unchanged apart from its name.
`manni test tasks` is the new job. Each verb names the job it checks, as
0050 has lint's do.

The domain has no verb that runs every job. CI already sequences steps, and
the two jobs differ in what they need. Procedures need Doc Detective and run on
every push. Tasks need Claude Code and a model, take minutes and cost money.
The domain is beta, so the rename ships without an alias, as a `feat`.

### 2. A write-in task is judged on completion and adherence

`--task "<text>"` with a page path or a URL is the main way in. Nobody has to
declare anything. A write-in task gets three kinds of eval and no others.

- `completed`, an error, asks whether the reader completed the task as
  written.
- `followed-the-docs`, a warning, asks whether every step came from the docs
  or from what the persona already knows.
- One `constraint` warning per persona constraint asks whether the reader kept
  to it.

The first build derived two to five evals from the task and the docs instead.
The stress test on Doc Detective's docs showed why that was wrong. Four
identical attempts at one task got four different sets of derived evals.
Derived evals also imported the docs' own extras, such as a screenshot the
sample took, and failed three runs whose traces show the task done. The user
decided on 2026-10-23 that a write-in task is judged on completion and
adherence only. Criteria beyond the task's own words belong in a journey.

### 3. Journeys are the golden set

A journey already said who, from where and what done looks like. This proposal
reads `title`, `trigger`, `entry-point`, `personas` and `success-criteria`, and
adds two keys.

- `workspace:` names a seed directory, copied fresh for each run.
- `evals:` lists the journey's golden evals. Each entry is the artifact-evals
  entry tracevals already reads. The key is `evals` to match the family's other
  schemas.

A journey that declares `evals:` joins the golden set, and a bare
`manni test tasks` runs the whole set. Its `success-criteria` is judged as a
`success` eval. A journey with neither is judged like a write-in task, with
`completed` asking about its title.

docevals reads every collection, the strategy records included, and its page
vocabulary also names a key `evals`. So docevals now skips any file whose
`type:` is `audience`, `persona` or `journey`. A record is not a page, and its
`evals:` are tracevals entries that docevals would refuse or run against the
record itself.

### 4. Personas, and their constraints

A persona gains `constraints:`, one sentence each. The synthetic user is told
the persona's fields and its constraints. It is never told the record's body,
because persona prose says how the person uses the product, which is what the
docs must teach.

Constraints are prompted and judged, not enforced. Each is judged after the
run as a warning. The synthetic user keeps every tool, so a run shows when the
docs pushed it off its preference.

### 5. Every run is judged against the docs it had

Two evals ride on every run. `followed-the-docs` is a warning that each step
came from the docs or the persona's own knowledge. Without it, an agent that
already knows the product could succeed with no docs at all. Each persona
constraint is the other.

The judge sees three things, each capped. It reads the transcript with each
tool result, and the files the run added, changed or removed, with their
contents. It also reads the pages the reader opened.

### 6. Claude Code is the synthetic user

Claude Code runs headless with `--setting-sources ""`, so none of the person's
own settings, plugins, hooks or MCP servers reach the synthetic user. It gets
Read, Write, Edit, Glob, Grep, Bash and WebFetch, plus the MCP servers
`tools.claude-code.mcpConfig` names. Web search is hidden, because the test is
whether these docs are enough. Bash is the one terminal on every platform, so a
`tool-order` eval can name it.

Its settings live under `tools.claude-code`, as 0050 has outside tools do:
`model`, `maxTurns` and `mcpConfig`. A global npm install lands in the run's
temp directory, because manni sets `NPM_CONFIG_PREFIX` there.

### 7. `manni check` never runs it

A synthetic user runs whatever the docs tell it to, with the person's
privileges and network. That is 0085's reason for keeping procedures out of the
family's hooks, twice over. `manni status` lists `test` as not checked, with
both verbs as the next step.

## The interface

`docs/src/content/docs/test/reference/cli.mdx` is the full reference, drift
checked against the commander program. The surface in one place:

```yaml
tools:
  claude-code:
    model: sonnet              # the synthetic user's model; default Claude Code's own
    maxTurns: 50               # its turn limit; default 50
    mcpConfig: .mcp.tasks.json # MCP servers it gets, such as a browser
```

```text
manni test tasks [targets...]
  --task <text>  --journey <id>…  --persona <id>…  --workspace <dir>
  -c <path>  -f pretty|json|github  --provider <name>  --model <id>
  --keep  --allow-empty  --progress|--no-progress  --no-color
```

A run is one start, one task and one persona, and manni runs every
combination. Exit `0` means every run passed, `1` that a run failed, and `2` an
operational or usage error. A run passes when no `error` eval failed, errored
or needs review.

## Known limits

- **One run is one sample.** A synthetic user is not deterministic, so a
  verdict can differ between runs. Repeated runs and a pass rate are left
  until a golden task flakes.
- **A path start reads source.** Components and route links read as source,
  so a page that renders well can read badly. Serve the site and pass its URL
  to test what readers see.
- **A write-in task's only criteria are its own words.** `completed` is one
  judged verdict, so a vague task gets a vague verdict. Criteria that matter
  belong in a journey's `evals:`.
- **The terminal is not confined.** The workspace is a temp copy, but a
  command the docs give can reach anywhere the person can.
- **Claude Code is the only runtime.** A second one waits for someone to ask.

## What was rejected

| Option | Verdict |
|---|---|
| Running trials from tracevals | Rejected. ADR 01000 took them out on purpose, and tracevals stays a reader. |
| A `test run` that runs every job | Rejected. CI sequences steps already, and the jobs differ in cost and needs. |
| Requiring declared evals for every task | Rejected. Writing them first is the barrier, so a write-in task is judged on completion instead. |
| Deriving evals from the task and the docs | Rejected after the stress test. Derived evals changed from run to run, imported the docs' own extras, and failed three runs whose traces show the task done. |
| `outcomes:` as the journey key | Rejected for `evals:`, to match the family's other schemas. |
| Enforcing constraints by withholding tools | Rejected for now. "Avoids" is a preference, and a judged warning shows when the docs forced it. |
| Giving the synthetic user the persona's body | Rejected. The body describes the product the docs must teach. |
| Mapping a path start to its published URL | Rejected. The site may not be running, and a URL target already covers it. |

## Stress test

### 1. Does an agent that knows the product make every task pass?

It can, and `followed-the-docs` is the guard. The judge sees the pages the
reader opened and the persona's stated knowledge, and warns on a step that
came from neither.

### 2. Why one completion verdict instead of evals derived from the docs?

Derived evals looked better on paper. They named what success meant, and a
person could promote the good ones into a journey. In practice they measured
the derivation as much as the docs. Ids and counts changed between identical
runs, and an extra drawn from a docs example could fail a run the reader
finished. A write-in task is a question in the reader's words, so the reader's
words are the criterion. The account and the trace still say where the docs
fell short, and a journey holds criteria that need to be exact.

### 3. Why judge constraints instead of enforcing them?

"Avoids the terminal" is not "has no terminal". A reader who dislikes the
terminal still uses it when the docs leave no other way, and that is the
finding. Enforcing it would turn a docs gap into a blank failure.

### 4. Why is a journey the golden set and not a file of its own?

A journey already carried the task, the start, the readers and what done looks
like. Two more keys make it runnable. A second kind of file would hold the same
fields under other names.

## Open questions

- When a golden task flakes, is the answer `--runs` with a pass rate, or a
  better eval?
- Should a page target run the journeys it names, without `--journey`?

## Consequences

- Good, because a persona can attempt a journey on demand, and the gap arrives
  with that reader's account of it.
- Good, because a plain-text question needs no setup beyond Claude Code.
- Good, because the journey slots 0102 declared now have a reader.
- Bad, because every run costs model time and money, and a verdict is one
  sample.
- Bad, because `manni test run` is gone, and scripts that called it break.
- CUJ S18 joins Sara's journeys, and the `test/` section gains a journey page.
