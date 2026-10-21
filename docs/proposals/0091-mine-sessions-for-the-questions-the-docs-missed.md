# 0091: Mine agent sessions for the questions the docs missed

- **Status:** Proposed
- **Serves:** Maya · M27, "Draft the questions readers ask". Her golden set
  holds what a model or a writer guessed readers ask. This adds questions a
  reader did ask, and failed to answer from the docs. None of the 66 CUJs
  belongs to the reader, so this is the first proposal whose input is the
  reader's own behavior.
- **Depends on:** Three records.
  - [0087](0087-a-golden-set-of-reader-questions.md) defines the golden-set
    file this writes drafts into, with `answers: []` for a known gap.
  - [0089](0089-findings-say-what-to-do.md) defines the finding contract each
    moment follows.
  - [0049](0049-tracevals-domain.md) brought in the trace reader, the session
    store discovery and the judge this reuses.
- **Relates to:** [0034](0034-command-grammar.md), which decides where the verb
  lives, and [0078](0078-family-check-status-and-claude-code-plugin.md), which
  this leaves alone.
- **Touches:** `src/tracevals/` (`cli.ts`, `commands/gaps.ts` new, `gaps/`
  new, `core/config.ts`, `core/config-schema.json`), `src/shared/golden-set.ts`
  (new), `src/graph/core/questions.ts`, the tracevals reference and journey
  pages, `docs/content-strategy/`, and `test/tracevals/`
- **Verdict:** `manni tracevals gaps` reads Claude Code sessions and reports
  each moment an agent left the docs to find an answer. Four tool-call patterns
  find the moments with no model. An opt-in judge drops the noise and phrases
  the reader's question, and `--draft` appends it to a golden-set file. On this
  repo's own transcripts the signal is weak, 3 useful moments in 70 checked.
  So nothing is built until a corpus of sessions that use a product clears the
  bar in [Go or no-go](#go-or-no-go).

## Problem

Every golden question manni holds today was written by a person or drafted by
a model from the page itself. A question drafted from a page can only ask what
the page already says. The questions a reader could not answer are the ones a
golden set most needs, and nothing collects them.

Agents now read docs for people. When the docs fail an agent, its session
records the failure as a sequence of tool calls. It reads a page, then searches
the source for the same thing. It asks the user. It searches the web for the
product's own behavior. It runs a command the docs taught, gets a usage error
and improvises. Each of those moments is a documentation gap with the reader's
question already written down. Today the session is read once, by the agent,
and discarded.

## Evidence

Before scoping anything, throwaway heuristics ran over this machine's sessions
for this repo. They ran outside `src/`, and no transcript data is committed.
The corpus is every session file under the 24 project directories whose names
start with `C--Users-hawkeyexl-Documents-Workspaces-manni`.

| measure | count |
|---|---|
| session files | 2,352 (1,295 main threads, 1,057 subagents) |
| tool calls | 77,790 |
| reads of a published docs page | 648, in 186 files |

Each signal ran as the simplest rule that could find it. Then a sample of each
was read by hand and sorted into four bins. A **true gap** is a question no page
answers today. **Answered, missed** means a page answers it and the agent did
not find or trust it. **Other product** is a real struggle with another
product's docs. **Noise** is everything else.

| signal | rule as run | raw | after cheap filters | checked | true gap | answered, missed | other product | noise |
|---|---|---|---|---|---|---|---|---|
| read-then-source | a docs page read, then a source read or search in the same domain within 8 calls | 193 | 87 where the session never edits that page | 15 | 0 | 1 | 0 | 14 |
| asked-user | every `AskUserQuestion` call | 131 | 131 | 22 | 0 | 0 | 0 | 22 |
| searched-web | `WebSearch` or `WebFetch` naming the product | 744 web calls, 2 naming manni | 2 | 19 searches | 0 | 0 | 6 | 13 |
| command-failed | a manni command that exits 2, then help, source or a retry within 5 calls | 70 | 27 without shell quoting errors, 14 at exit 2 | 14 | 1 | 1 | 0 | 12 |
| **total** | | | | **70** | **1** | **2** | **6** | **61** |

Three of 70 checked moments, about 4%, say something useful about manni's
docs. Six more are real struggles with DITA-OT, Playwright, Vale, Jing or
docutils, whose docs are not ours.

The reason is the corpus. Every session here builds manni. Its agents read a
page and then the source because the task is to verify, cite or change that
page. 84 of the 87 read-then-source moments come from subagents whose brief
asks for file and line evidence. Every `AskUserQuestion` was a design decision
or a permission check. Nobody here is a reader. The heuristics found the
producer, which is who wrote these sessions.

### Worked examples

1. **command-failed, a true gap.** A subagent ran `lint structure` with
   `--color`, read `error: unknown option '--color'`, and dropped the flag. No
   page says how to keep colors when output is piped. The reader's question is
   "How do I keep manni's colors when I pipe its output?"
2. **command-failed, answered but missed.** A subagent wrote a sample config
   whose collection was named `docs`, and the run exited 2 on the name. It then
   read the configuration reference and the source. The reference already says
   the name is reserved. That question belongs in the set with a pin, as a
   findability test.
3. **read-then-source, answered but missed.** A subagent read the meta CLI
   reference, then searched the source for which environment variables
   `--provider auto` checks. The page lists that order today.
4. **searched-web, another product.** A session searched for why DITA-OT's
   `validate` subcommand printed nothing and what it exits with. It is a real
   gap, in DITA-OT's docs.
5. **read-then-source, noise.** A subagent pinning sentences with
   `manni cite add` read a page, then the source line it cites. That is the
   job, not a struggle.

### What the evidence says

- The signals fire on the right shape. Examples 1 to 4 are what the idea
  promises. The rules cannot tell a reader from a producer.
- One cheap filter does most of the work. Dropping moments where the session
  edits the page halves read-then-source. Dropping subagent threads removes 84
  of the 87 that remain.
- A judge is required, not optional. At 4% precision an unjudged report is a
  list of the producer's own workflow.
- The input that matters lives elsewhere. A reader's sessions sit in the
  projects that *use* a product, not in the product's own repo. That is why
  `--all-projects` is the corpus this command is for.

### Go or no-go

Run the same throwaway rules over at least 100 main-thread sessions from
projects that use a product. That product's docs are the collection. Check
50 moments by hand. Build when at least 10 of them are true gaps or answered
but missed. Below that, close this proposal as rejected with the numbers.

### Second run: Doc Detective as the product

The first run had no readers in it. So the same method ran again with Doc
Detective as the product, because sessions on this machine use it to author
tests. The corpus adds the doc-detective workspace and its worktrees to this
repo's sessions. Doc Detective's docs are three things. They are the pages
under `docs/fern/` in its repository, the same pages on its website, and the
skill files of its Claude Code plugin. As before, the rules ran outside
`src/`, and no transcript data is committed.

| measure | count |
|---|---|
| session files | 2,467 (1,341 main threads, 1,126 subagents) |
| tool calls | 102,472 |
| sessions that touch Doc Detective | 52 |
| producer sessions | 32 |
| consumer sessions | 20, with 22 main threads and 829 subagent threads |

A producer session builds Doc Detective. It edits its source, or it studies its
design inside its repository. A consumer session writes test specs, runs the
CLI or reads the docs to integrate it. One session in the Doc Detective
repository wrote inline tests for its own pages, and it counts as a consumer.
Only consumer moments were checked. The producer sessions raised 52 raw
moments, and none of them were read.

The signals were adapted to the product. A docs read is a read of one of the
three sources above, or a call to a plugin skill. A source read is a read or
search of Doc Detective's repository, its installed package or its schemas.
One signal is new. **source-first** is a source read in a thread that never
read the docs before it. Bursts were collapsed, so consecutive calls on one
question count once. Two moments from the session running this check were
dropped.

| signal | rule as run | raw | checked | true gap | answered, missed | noise |
|---|---|---|---|---|---|---|
| read-then-source | a docs read, then a source read within 15 calls | 19 | 10 | 1 | 8 | 1 |
| source-first | a thread's first source read, with no docs read before it | 6 | 5 | 0 | 5 | 0 |
| asked-user | an `AskUserQuestion` naming the product, or within 15 calls of its use | 11 | 11 | 1 | 0 | 10 |
| searched-web | a `WebSearch` or `WebFetch` naming the product | 31 | 6 | 1 | 3 | 2 |
| spec-failed | a Doc Detective run that failed, with shell errors dropped | 31 | 30 | 0 | 5 | 25 |
| **total** | | **98** | **62** | **3** | **21** | **38** |

Of the 62 checked moments, 24 are useful, about 39%. The first run found 4%.
Three of the 21 answered moments were gaps when they happened. The pages that
answer them landed after the session. Three more ran an installed release
older than the docs it read.

#### What the second run says

- The moment bar passes. 24 useful moments clear the 10 the gate asks for.
- The corpus bar fails. The gate asks for 100 sessions from projects that use
  the product. This machine holds 20 consumer sessions.
- Two sessions supply 17 of the 24 useful moments. One research subagent alone
  fired 37 raw moments, so collapsing bursts is required.
- Subagent threads hold 12 of the 24. Reading main threads only, as the design
  does, would lose half the signal. That settles open question 3 against the
  current design.
- `spec-failed` is mostly noise. A failing test is usually the test doing its
  job, and 25 of its 30 checked moments were that.
- `source-first` found 5 useful moments in 5. `asked-user` found 1 in 11.

#### Verdict of the second run

The gate does not pass, so nothing is built. The precision this command needs
appears once a corpus has readers in it. The corpus is still too small to
trust, and the signal set needs three changes before a build. Those are
subagent threads read by default, bursts collapsed, and `source-first` added.
Run the gate again when this machine holds 100 consumer sessions.

#### Gaps it found in Doc Detective's docs

The run surfaced gaps in another product's docs, which that product's owner
can act on now.

1. No reference page describes the results file. A link to its schema returns
   404, so agents read the report schema and the runner's source.
2. No page documents the Node API, such as `runTests` and `detectTests`.
   Agents learned it from a third-party wiki and the source.
3. No page says which files in an input directory become specs, or how to
   exclude some. A repo's YAML sidecar files were read as specs, and its tests
   were dropped.
4. Pages describe the latest release with no version notes. Agents running an
   older release hit a missing `run` command and then read the installed code.
5. Old site URLs redirect to the docs home page. Its fetched content links to
   no action pages, so agents found them through `llms.txt`.

## Design

### Home domain: `tracevals`

Proposal 0034 puts a verb under the domain whose object it acts on. This verb
reads sessions, and a session is tracevals' object.

- **It already reads them.** `src/tracevals/trace/` parses Claude Code
  sessions, with sidecar subagents and resumed sessions. `list` and `run`
  already discover them with `--all-projects`, `--newer-than` and `--limit`.
- **It already judges them.** Its judge takes providers from
  `src/shared/providers.ts`, with `--offline`, `--local`, a cache and
  `judge.redact`.
- **graph owns the format, not the act.** The golden-set file is graph's
  input. Its schema and its duplicate rule move to `src/shared/golden-set.ts`,
  because two domains now write it. graph reads it exactly as before.

The alternatives each break a rule.

| alternative | why not |
|---|---|
| `manni graph fill --from-sessions` | graph would grow the session-store flags `list` and `run` own, and import tracevals' trace reader. |
| a new `manni struggle` domain | A domain with one verb, named for a method rather than its object. Its object is the session, which already has a domain. |
| a family verb | 0078 caps the top-level verbs at two. |

The verb is `gaps`, the job it does, as `lint structure` and `graph stats` name
theirs.

### What is deterministic

Everything below runs with no model and no network. It reads the main thread of
each session only. Subagent threads are skipped, because the evidence shows
their briefs ask for source reads.

A **docs read** is a `Read` of a file in any collection, or a `WebFetch` of a
URL under a collection's `url:`. **Product terms** are the strings in
`tracevals.gaps.product`.

| signal | a moment is |
|---|---|
| `read-then-source` | A docs read, then within 8 tool calls a `Read`, `Grep` or `Glob` of a file outside every collection. The file must be in the project or under a `node_modules` directory named by a product term. |
| `asked-user` | An `AskUserQuestion` call within 8 tool calls after a docs read, or whose text contains a product term. |
| `searched-web` | A `WebSearch` whose query contains a product term. |
| `command-failed` | A shell call whose first command word is a product term and whose result reports exit code 2. Within 5 calls the session runs `--help`, reads a docs page or source, or reruns the command with other flags. |

Two filters drop moments before anything prints.

- **Producer.** A moment is dropped when the same session writes to the page
  or to the source file the moment names.
- **Shell.** A `command-failed` moment is dropped when the error comes from the
  shell, not the product. That means a line starting `bash:` or
  `/usr/bin/bash:`, or a PowerShell `ParserError`.

The report never prints a tool's output. It prints paths, the product's
command reduced to its program, verbs and flag names, and the first 80
characters of a question or search.

### What needs a judge

`--judge` sends each moment to the judge. The window is the docs read, the
calls after it and the agent's text between them. `judge.redact` is applied
first, as it is for `run`. The judge returns a verdict, a question and a page.

- **gap or noise.** Is this a reader's question that a page should answer?
- **the question.** The question as a reader would ask it, with no session
  detail in it.
- **the page.** The collection page it belongs on, or `null`.
- **confidence.** 0 to 1. A gap under `tracevals.gaps.confidenceThreshold` is
  reported as noise.

The judge never decides whether the docs answer the question. A drafted
question lands as a known gap, and a person pins its answer if one exists.
`graph check` then tests whether a search finds it.

### Configuration

```yaml
# before
tracevals:
  provider: auto
  judge:
    redact: []

# after
tracevals:
  provider: auto
  judge:
    redact: []
  gaps:                          # new
    product: [manni]             # new; list of strings
    confidenceThreshold: 0.7     # new; number 0-1
```

| key | type | default | required | meaning |
|---|---|---|---|---|
| `tracevals.gaps.product` | list of strings | detected | no | Strings that mark a search or a command as being about the product. The default is the unscoped `name` and every `bin` name in the project's `package.json`, plus each collection `url:`. An empty list turns `searched-web` and `command-failed` off. |
| `tracevals.gaps.confidenceThreshold` | number 0-1 | `0.7` | no | A judged gap under this confidence is reported as noise and never drafted. |

The pages come from `collections:`, as they do for every domain. The judge's
provider, model, cache and redaction are tracevals' existing keys.

### Command

```text
manni tracevals gaps [traces...] [options]
```

| argument or option | meaning |
|---|---|
| `[traces...]` | Session files, space-separated. With none, and no selector, it picks one interactively on a TTY, as `run` does. |
| `--all-projects` | Read every project's sessions in the session store, not only this project's. |
| `--newer-than <duration>` | Only sessions modified within this window, such as `30m`, `24h`, `7d` or `2w`. |
| `--limit <n>` | The most sessions to read. |
| `--judge` | Judge each moment, drop the noise and phrase each gap's question. |
| `--draft <file>` | Judge, then append each gap to this golden-set file as a draft. Implies `--judge`. |
| `--provider <name>` | Judge provider, as for `run`. |
| `--model <model>` | Judge model, as for `run`. |
| `--local` | As for `run`. |
| `--offline` | Refuse network providers, as for `check`. |
| `--no-cache` | Bypass the judge cache. |
| `-f, --format <format>` | `pretty` (default) or `json`. |
| `-o, --output <file>` | Also write the report to a file. |
| `-c, --config <path>` | Path to `manni.config.yaml`. |
| `--no-config` | Ignore any discovered config file. |

Without `--judge` or `--draft` the command makes no model call and no network
request, so CI stays offline by default.

### Findings and messages

Each moment is a finding under 0089's contract. Its `guidance.id` is
`manni:tracevals/gaps`, its `rule` is the signal, and its `guide` is the
journey page. An unjudged moment is a `notice`. A judged gap is a `warning`.
Judged noise is counted and not listed. A gap report never fails a run.

| finding | severity | message |
|---|---|---|
| `read-then-source` | notice | `docs/meta/reference/cli.mdx was read, then src/meta/core/ was searched, so check that the page answers what the session looked for.` |
| `asked-user` | notice | `The session asked "Which provider does auto pick when…" after reading docs/meta/set-up/fill-providers.mdx, so check that a page answers it.` |
| `searched-web` | notice | `The session searched the web for "manni lint keep colors when piped", so check that a page answers it.` |
| `command-failed` | notice | `manni lint structure --color exited 2 and the session worked around it, so check the page that taught the command.` |
| judged gap | warning | `Readers ask "How do I keep manni's colors when I pipe its output?", so answer it on docs/lint/reference/cli.mdx.` |
| judged gap, no page | warning | `Readers ask "Does manni run on Windows on ARM?", and no page owns it, so pick one or draft it with --draft.` |

| case | stream | exit |
|---|---|---|
| any number of moments or gaps | stdout | 0 |
| `--draft` names a file outside `graph.questionFiles` | stderr, `manni: docs/gaps.yaml is not in graph.questionFiles, so graph check does not read its drafts.` | 0 |
| no trace, no selector, not a TTY | stderr, `manni: no trace given; pass a trace file or run manni tracevals list` | 2 |
| no collections | stderr, `manni: tracevals gaps reads the pages under collections:, and manni.config.yaml declares none, so add one.` | 2 |
| `--draft` file fails the golden-set schema | stderr, `manni: docs/questions.yaml: /2/answers must be array.` | 2 |
| a format other than `pretty` or `json` | stderr, `manni: --format must be one of pretty \| json, got "sarif"` | 2 |
| `--offline` beside a hosted provider | stderr, the existing `check` message | 2 |
| no provider can be used under `--judge` | stderr, the existing `run` message | 2 |

### Output

Pretty, unjudged:

```text
$ manni tracevals gaps --newer-than 7d
Using manni.config.yaml (.)
3d57a75c-04ab-48d9-a48a-1b80e63c04c1  2026-10-12 09:14
  notice  command-failed  manni lint structure --color exited 2 and the session worked around it, so check the page that taught the command.
          manni:tracevals/gaps command-failed: an agent's command failed as a usage error, and it worked around it.
          Guide: https://hawkeyexl.github.io/manni/tracevals/triage/find-docs-gaps/

41 sessions, 3 moments: 1 read-then-source, 0 asked-user, 1 searched-web, 1 command-failed
Not judged. Pass --judge to drop the noise and phrase each question.
```

Pretty, judged, adds the verdict to each moment and replaces the last line.

```text
  warning  command-failed  Readers ask "How do I keep manni's colors when I pipe its output?", so answer it on docs/lint/reference/cli.mdx.

41 sessions, 3 moments: 1 gap, 2 noise (anthropic/claude-sonnet-5-5)
```

`--draft` appends one item per gap and prints one line.

```yaml
- question: How do I keep manni's colors when I pipe its output?
  answers: []
  generated-by: anthropic/claude-sonnet-5-5
  confidence: 0.82
  reviewed: false
```

```text
Drafted 1 question into docs/questions.yaml, marked reviewed: false. 0 dropped as duplicates.
```

The item is the golden-set form from 0087 with no new key. A question that
duplicates one anywhere in the set, under 0087's rule, is dropped. The file
never receives transcript text, only the judge's question.

JSON is one object.

```json
{
  "sessions": 41,
  "moments": [
    {
      "trace": "C:/Users/me/.claude/projects/my-repo/3d57a75c-….jsonl",
      "session": "3d57a75c-04ab-48d9-a48a-1b80e63c04c1",
      "at": "2026-10-12T09:14:03Z",
      "signal": "command-failed",
      "severity": "warning",
      "message": "Readers ask \"How do I keep manni's colors when I pipe its output?\", so answer it on docs/lint/reference/cli.mdx.",
      "page": "docs/lint/reference/cli.mdx",
      "evidence": [
        { "tool": "Bash", "summary": "manni lint structure --color", "exit": 2 },
        { "tool": "Bash", "summary": "manni lint structure", "exit": 0 }
      ],
      "guidance": {
        "id": "manni:tracevals/gaps",
        "rule": "command-failed",
        "description": "An agent's command failed as a usage error, and it worked around it.",
        "guide": "https://hawkeyexl.github.io/manni/tracevals/triage/find-docs-gaps/"
      },
      "verdict": {
        "gap": true,
        "question": "How do I keep manni's colors when I pipe its output?",
        "page": "docs/lint/reference/cli.mdx",
        "confidence": 0.82,
        "generatedBy": "anthropic/claude-sonnet-5-5"
      }
    }
  ],
  "summary": {
    "read-then-source": 1, "asked-user": 0, "searched-web": 1, "command-failed": 1,
    "judged": 3, "gaps": 1, "noise": 2, "drafted": 0
  }
}
```

`verdict` is `null` when the run is not judged. `page` is `null` when no docs
read anchors the moment.

### From minimal to maximal

1. One session, no config beyond the collections.

   ```text
   $ manni tracevals gaps ~/.claude/projects/my-repo/3d57a75c-….jsonl
   ```

   It prints that session's moments and exits 0.
2. The last week of this project's sessions.

   ```text
   $ manni tracevals gaps --newer-than 7d
   ```
3. A reader corpus, from every project on the machine, against this repo's docs.

   ```text
   $ manni tracevals gaps --all-projects --newer-than 30d --limit 200
   ```
4. Scripting, with no model.

   ```text
   $ manni tracevals gaps --newer-than 30d -f json -o gaps.json
   ```
5. Judged on this machine only.

   ```text
   $ manni tracevals gaps --newer-than 30d --judge --local --offline
   ```
6. Judged and drafted with a hosted judge.

   ```text
   $ manni tracevals gaps --newer-than 30d --draft docs/questions.yaml --provider anthropic
   Drafted 4 questions into docs/questions.yaml, marked reviewed: false. 1 dropped as duplicates.
   ```
7. Every option at once.

   ```text
   $ manni tracevals gaps --all-projects --newer-than 30d --limit 200 \
       -c manni.config.yaml --draft docs/questions.yaml \
       --provider llama-cpp --model granite-4.1-3b-q2 --offline --no-cache \
       -f json -o gaps.json
   ```
8. Usage errors.

   ```text
   $ manni tracevals gaps < /dev/null | cat
   manni: no trace given; pass a trace file or run manni tracevals list
   exit 2

   $ manni tracevals gaps --newer-than 7d --no-config
   manni: tracevals gaps reads the pages under collections:, and manni.config.yaml declares none, so add one.
   exit 2

   $ manni tracevals gaps --newer-than 7d -f sarif
   manni: --format must be one of pretty | json, got "sarif"
   exit 2
   ```

## What this does not do

- **Gate anything.** A gap is a question to consider, not a defect. `manni
  check` does not run it, and no exit code reflects it.
- **Decide that the docs answer a question.** That is `graph check`, once a
  person pins the answer.
- **Read other agents' traces.** It reads what tracevals reads, which is Claude
  Code sessions today.
- **Read subagent threads.** The evidence shows their briefs, not their
  readers, send them to the source.
- **Copy transcript text into the repo.** Only the judge's question is written.

## Open questions

1. **Is `gaps` the verb?** tracevals' other verbs are verbs, such as `run`,
   `check` and `list`. `mine` is the alternative, and it reads as a possessive.
2. **Should a draft record where it came from?** A key such as `asked-in` would
   help review, but a session id means nothing on another machine.
3. **Should subagent threads be opt-in?** In a reader's project an `Explore`
   subagent reading docs then source may be a true struggle.
4. **Is exit code 2 the right usage-error signal for other products?** It is
   manni's and POSIX's convention, and many CLIs exit 1 for everything.
5. **Should an answered-but-missed moment draft a question with a pin?** Two of
   the three useful moments were answered. A pinned question would test
   findability at once, but the judge would then decide what answers it.

## Acceptance checklist

- [ ] `docs/proposals/0091-mine-sessions-for-the-questions-the-docs-missed.md`
      reads `Implemented (#NNN)`, and the index row in
      `docs/proposals/README.md` matches.
- [ ] The PR records the go-or-no-go measurement over a corpus of product
      users. At least 10 of its 50 checked moments are useful.
- [ ] `src/shared/golden-set.ts` holds the golden-set schema and the duplicate
      rule. `src/graph/core/questions.ts` imports them, and `graph check` output
      is unchanged.
- [ ] `src/tracevals/commands/gaps.ts` and `src/tracevals/gaps/` exist, and
      `src/tracevals/cli.ts` mounts `manni tracevals gaps` with exactly the
      options in the table above.
- [ ] `tracevals.gaps.product` and `tracevals.gaps.confidenceThreshold` are in
      `src/tracevals/core/config-schema.json`, with the defaults above. With no
      `product`, the default comes from `package.json` and the collection URLs.
- [ ] `manni tracevals gaps <trace>` prints each moment as a notice and exits 0.
- [ ] Each of the four signals fires on its own fixture under
      `test/tracevals/fixtures/gaps/`, and the producer and shell fixtures
      produce no moment.
- [ ] A subagent thread in a fixture produces no moment.
- [ ] Without `--judge` or `--draft`, a test with the network and providers
      stubbed to throw passes.
- [ ] `--judge` with a mocked provider reports gaps as warnings, counts noise,
      and drops gaps under `confidenceThreshold`.
- [ ] `--draft docs/questions.yaml` appends items with `answers: []`,
      `generated-by`, `confidence` and `reviewed: false`, and drops
      duplicates. `graph check` counts them as drafted gaps.
- [ ] `--draft` naming a file outside `graph.questionFiles` prints the stderr
      warning above and exits 0.
- [ ] Each usage error above prints its exact stderr line and exits 2.
- [ ] `-f json` prints the shape above. `verdict` is `null` when not judged.
- [ ] No output prints a tool's result text, and a fixture with a secret in a
      command argument shows it nowhere.
- [ ] `docs/src/content/docs/tracevals/reference/cli.mdx` documents `gaps`,
      and `npm run docs:check-cli` passes against it.
- [ ] `docs/src/content/docs/tracevals/reference/configuration.mdx`
      documents both keys.
- [ ] `docs/src/content/docs/tracevals/triage/find-docs-gaps.mdx` exists. It
      is the journey page the `guide` URL points at.
- [ ] `docs/content-strategy/cujs.md` gains the journey that page serves, and
      `information-architecture.md` lists the page.
- [ ] A demo video for the `feat:` is under `media/`, with no MP4 committed.
