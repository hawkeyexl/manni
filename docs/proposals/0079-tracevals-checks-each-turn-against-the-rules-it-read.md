# 0079: tracevals checks each turn against the rules it read

- **Status:** Proposed
- **Serves:** Maya · M25, "Catch a broken rule before the agent hands back",
  which cross-references M17, M23 and M24.
- **Depends on:** [0078](0078-family-check-status-and-claude-code-plugin.md),
  for the plugin, envelope detection and the Stop protocol.
  [0049](0049-tracevals-domain.md), for the domain. A minor release of
  `@hawkeyexl/inference`, for decisions, Jev and the model host.
- **Relates to:** [0075](0075-time-windows-and-execution-in-the-evals-domains.md)
  and [0076](0076-artifact-evals-1-1-0-tool-order.md). Tracevals ADRs
  [01015](tracevals/01015-grade-each-artifact-against-the-window-it-governed.md)
  (windows), [01016](tracevals/01016-read-the-availability-roster-and-check-the-artifact-that-never-fired.md)
  (`when`), [01020](tracevals/01020-redact-the-judge-digest-before-it-leaves-the-machine.md)
  (redaction) and [01024](tracevals/01024-capture-a-session-manifest-so-staleness-is-exact.md)
  (capture). Docevals ADR 01039, on parallel local judges.
- **Supersedes, in part:** [0078](0078-family-check-status-and-claude-code-plugin.md),
  for one row of its in-play table. tracevals is no longer "never" in play. It
  is in play under a hook envelope when `tracevals.conformance` exists. 0078's
  Status line is the only edit.
- **Touches:** `src/tracevals/` (new `rules/`, the turn judge, three verbs),
  `src/tracevals/graders/when.ts`, `src/family/`, `plugin/manni/hooks/hooks.json`,
  `docs/src/content/docs/tracevals/`, `docs/content-strategy/cujs.md`
- **Verdict:** At the end of each turn, tracevals finds the files that exist to
  govern the agent and extracts their rules. Then it judges the turn. A
  confident violation blocks the stop once, so the agent fixes the work before
  it hands back. A fast model judges inside the loop, and a stronger one
  extracts rules outside it. Local models stay loaded in one host process
  between hooks.

## Problem

### Maya, finding out after the agent hands back

Maya runs coding agents in a repo whose rules live in many files. There are
`CLAUDE.md`, `AGENTS.md` and `GEMINI.md`, nested ones too. There are
`.claude/rules` and `.cursor/rules`, skills with their reference files, and a
house style guide.

She learns that the agent broke one of those rules in one of two ways. She
reads the diff, or she runs `manni tracevals run` over the session afterwards
(M17). Both happen after the agent has handed back. The fix costs her a review
cycle and a new prompt. The rule sat in the agent's context the whole time, and
nothing told it.

The outcome she wants is a check at the end of every turn. It names the rule,
the file it came from, and what the turn did. The agent fixes the work, or says
why the rule does not apply, before the turn reaches her.

### What tracevals cannot do today

tracevals is a post-hoc grader over whole transcripts. Six things stand between
it and a check at the end of a turn.

1. **No hook path.** `run` takes trace files and exits 0, 1 or 2. Nothing
   answers a Stop envelope with a block decision.
2. **Four artifact types.** Resolution knows skills, agents, slash commands and
   project rules from cwd up to the git root. It misses nested rules files,
   `.claude/rules`, `.cursor/rules`, imports and skill reference files.
3. **No rules from prose at run time.** `fill` extracts evals, but only when
   someone runs it, and it writes frontmatter. An artifact with no evals gets
   one whole-artifact judgement.
4. **No turn.** The judge reads the window an artifact governed. Nothing selects
   the last turn.
5. **Latency.** The default is three judge runs per eval. A local model loads
   on every invocation. Neither fits a hook that runs on every turn.
6. **A hook that stays silent.** ADR 01024 keeps `capture` off stdout, because
   SessionStart stdout becomes context. That stands. This check talks to the
   agent on purpose, so it goes through 0078's `manni check`.

## Decision

### Two model roles

Work inside the loop and work outside it have different budgets. They get
different models.

| Role | Does | Configured by |
|---|---|---|
| Out of the loop | Rule extraction, `prepare`, `check` by hand, `run` and `fill` | `tracevals.provider` and `tracevals.model`, the keys that exist today |
| In the loop | Judging a turn inside a Stop or SubagentStop hook | `tracevals.conformance.hook.provider` and `.model`, falling back to the out-of-loop keys |

A hosted setup can put Sonnet out of the loop and Haiku in it. A local setup can
use Qwen3.5-4B for both. Whether a run is in the loop is detected from the hook
envelope. No flag switches it.

### Rule sources and their triggers

A repo's rules apply whichever agent runs. So tracevals reads every agent's
rules files, and scopes each by its own format's trigger. Resolution is
deterministic, from the filesystem and the trace. No model decides which files
count. A model only extracts rules from them.

| Format | Files | In scope when |
|---|---|---|
| `claude-md` | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, user `~/.claude/CLAUDE.md` | Always, for cwd and its ancestors. A subdirectory's file applies once the session touches a file under it. |
| `claude-rule` | `.claude/rules/**/*.md`, user `~/.claude/rules/**/*.md` | Without `paths:`, always. With `paths:`, once the session touches a matching file. |
| `agents-md` | `AGENTS.md`, `.claude/AGENTS.md`, nested | As for `claude-md`. The nearest file wins a conflict. |
| `gemini-md` | `GEMINI.md`, user `~/.gemini/GEMINI.md`, nested | As for `claude-md`. |
| `cursor-rule` | `.cursor/rules/**/*.mdc`, and `.md` files there with frontmatter | `alwaysApply: true` means always. `globs` means once the session touches a match. Other rules apply once the agent reads them. |
| `kiro-steering` | `.kiro/steering/*.md`, user `~/.kiro/steering/*.md` | `inclusion: always`, or no frontmatter, means always. `fileMatch` follows `fileMatchPattern`. `manual` and `auto` apply once the agent reads them. |
| `speckit-constitution` | `.specify/memory/constitution.md` | Always |
| `openspec-project` | `openspec/project.md` | Once the agent reads it |
| `import` | Files an `@path` line pulls into a `claude-md` or `gemini-md` file, up to four hops, the depth at which Claude Code stops expanding them | With the importing file |
| `skill` | An invoked skill's `SKILL.md`, and every file read under its directory | The skill's window, as today |
| `slash-command`, `agent` | As today. The agent's definition applies under SubagentStop. | Their windows, as today |
| `designated` | A file named in `conformance.include` | Always. A person chose it to govern the agent, so a turn that skipped reading it is still held to it. |

To touch a file is to Read, Write or Edit it. That is Claude Code's own trigger
for path-scoped rules. `paths:`, `globs` and `fileMatchPattern` each accept a
single glob or a list. `exclude` removes a file from every row.

The triggers mirror each agent's documentation. The sources are Claude Code's
memory page, the AGENTS.md site and Gemini CLI's GEMINI.md page. Cursor's rules
page and Kiro's steering page complete the list.

The judge prompt states the precedence these formats share. A nearer file
overrides a farther one. A prompt the user typed in the turn overrides any file.
Following an explicit request is never a violation.

### Only files that govern an agent

Reading a file never makes it a rule source. A README, a product docs page, a
design doc or an API reference describes other systems or other readers. Judging
the agent against one would fail it for sentences never meant for it. Two
defenses keep those out.

1. **Which files.** The table above is a closed list. `include` adds files a
   person names, and it is empty by default. This repo would name
   `docs/content-strategy/**`, because its `CLAUDE.md` tells agents to consult
   it.
2. **Which sentences.** Extraction keeps only directives addressed to the agent
   working in the repo. Descriptions of a system, instructions for end users,
   examples and quoted rules yield nothing. A skill reference that documents an
   API yields no rules, though its skill counts.

### Spec-driven toolkits

Three spec-driven toolkits keep agent guidance apart from specs. tracevals reads
the guidance.

- Spec Kit's constitution holds the principles its agent skills develop under.
- Kiro's steering files carry inclusion modes, much like Cursor's rules.
- OpenSpec's `project.md` holds project conventions. Its `AGENTS.md` is already
  an `agents-md` source.

Their specs are left out on purpose. Spec Kit's `spec.md`, `plan.md` and
`tasks.md` describe the system to build. So do Kiro's `requirements.md`,
`design.md` and `tasks.md`, and OpenSpec's `specs/` and `changes/`. Checking
code against a spec is a different job, with different false positives.

### Extraction and its cache

The out-of-loop model reads a source and returns its rules. Each rule has a
kebab `id`, its text, and a `when`.

```json
[
  { "id": "run-npm-ci-first",
    "text": "Run npm ci first when working in a worktree.",
    "when": { "command-matches": "\\bnpm (test|run)\\b" } },
  { "id": "accent-not-red",
    "text": "The accent colour may not be red, green, yellow or cyan.",
    "when": { "file-access": "media/**" } }
]
```

Rules a trace cannot show are dropped, as `fill` drops them into
`needsSharpening`. "Prefer boring code" is one. A source that declares `ai`
evals is not extracted. Its eval assertions are its rules, with their own
`when`.

Results are cached in `.manni/tracevals/cache/rules`. The key is the provider,
the model, the prompt version and the sha256 of the whole file. A partial read
still holds the agent to the whole file, because a cache keyed on slices would
rarely hit. The cache outlives the session, so a file pays for extraction once
per version.

Every entry is written to a temporary file and renamed into place. A reader
never sees half an entry.

### The turn

A turn starts at the last prompt the user typed. Tool results and hook feedback
do not start one. Under SubagentStop, the turn is the subagent's whole run.

The turn is rendered as `run` renders a window, with the same redaction and
caps. Claude Code writes the transcript asynchronously, so its last message can
lag. Stop and SubagentStop carry `last_assistant_message`, and tracevals appends
it when the transcript lacks it.

### When tracevals stays out of the way

A Stop runs these gates in order. Each is deterministic and cheap. The first
gate that finds nothing to do ends the run.

| # | Gate | Decided by | When it stops the run |
|---|---|---|---|
| 1 | Not in play | No `tracevals.conformance` section | Silent. The transcript is not parsed. |
| 2 | A judge's own session | `MANNI_TRACEVALS_JUDGE` in the environment | Silent. tracevals sets it in its own environment before it spawns anything, so every child inherits it from the start. A `claude-cli` judge cannot set off this hook again. |
| 3 | Empty turn | Nothing after the last typed prompt | Silent |
| 4 | No rule sources | The sources table resolves nothing for this turn | Silent |
| 5 | Still downloading | The library reports the local model as `downloading` | One message per session |
| 6 | Not applicable | Every in-scope rule's `when` fails over the turn | Silent. Each rule counts as `skipped`, never `pass`. |
| 7 | Model not on disk | The local model or runtime is missing | One message per session. Nothing downloads. |
| 8 | Not enough memory | The library's memory probe, the one `auto` tiering uses | One message per session |
| 9 | Already judged | The verdict cache holds this turn, rule set and model | The cached verdict is reused. The key is the provider, model, mode, runs, temperature and prompt version. It also holds a sha256 of the rendered turn, and one of the rules with their sources, ids and text. |

The cache is read last, because its key needs the model's state limit. A
local model can only report that once it is on disk. Under a hook, a local extraction
model meets gates 5, 7 and 8 before any uncached extraction. So nothing
downloads. A hosted model skips those three gates.

### `when` on every rule, and `command-matches`

Extracted rules use the trigger grammar evals already use, `options.when` from
ADR 01016. Every listed condition must hold. A rule with no `when` applies to
every turn.

| Condition | Holds when |
|---|---|
| `file-access: <glob>` | The turn read, wrote or edited a matching file. |
| `tool-used: <name>` | The turn called that tool. |
| `prompt-matches: <regex>` | A prompt the user typed in the turn matches. |
| `turn-count-above: <n>` | The session has more than `n` turns. |
| `command-matches: <regex>` | **New.** A Bash command in the turn matches. |

`command-matches` exists because most project rules are about commands.
`tool-used: Bash` holds on nearly every turn, so it filters nothing. `options`
is an open object by the vocabulary's own rule, so the new condition needs no
schema change. `run` gets it too, because `when` is one module for every
grader.

### The judge, decisions first

When the in-loop provider can make decisions, the judge makes one. The
rendered turn is the shared state. Each applicable rule is one `choice`
question with four options.

| Option | Meaning |
|---|---|
| `followed` | The turn did what the rule asks. |
| `violated` | The turn did what the rule forbids, or skipped what it requires. |
| `not_applicable` | The rule had nothing to say about this turn. |
| `unclear` | The turn does not show enough to tell. |

The state is encoded once, and every question branches from it. The
intelligent-if benchmark measured 29.7 ms per decision this way, on 8 KB
states, with Qwen3.5-4B on one RTX 4090. Jev quotes 70 to 500 ms per request.

A provider that cannot decide, such as Anthropic, OpenAI or `claude-cli`, makes
one generative call per run instead. That call returns only the rules the turn
broke or could not settle. A rule it leaves out was followed or did not apply.

Which mode runs is detected from the provider. It is never configured.

### The block bar

Small models are confidently wrong when the evidence is missing. The
intelligent-if benchmark found Qwen3.5-4B at 0.95 confidence on a question its
evidence could not settle. So `unclear` is an explicit option, and only
violations block.

- **Decision mode.** A rule blocks when `violated` is the top option and its
  probability reaches `judge.zones.autoFail`.
- **Generative mode.** A rule blocks only when every run lists that same rule
  as violated, each at the bar, and no run errored. A rule some runs flag and
  others leave out is `needs-review`.
- **Anything else** is `needs-review`. It never blocks, and it never fails
  `tracevals check`.

The repair pass judges the whole turn once more. The turn has grown, so the
verdict cache misses. It costs one call, and it is the only way to tell the
user a rule is still broken.

### Concurrency and the model host

Claude Code neither queues nor drops hooks. Each hook is a process of its own,
and hooks for overlapping events run at once.

| Overlap | Can it happen? | What happens |
|---|---|---|
| Two Stops in one session | No. The next turn cannot end until this Stop hook returns. | Nothing to do |
| `prepare` and the first Stop | Yes. `prepare` runs async from session start. | The Stop queues behind `prepare` in the host, then finds the rules cached. A model still downloading skips the Stop at gate 5. |
| Several SubagentStops | Yes, when parallel subagents finish together | They queue in the host. Each judges its own transcript. None is dropped or reloads the model. |
| A Stop and a background subagent's SubagentStop | Yes | The same queue |
| Hooks from several sessions | Yes, for example one session per worktree | One host per machine, so one queue |

A local model loads once and stays loaded in a **model host**. That is one
background process per machine and user, and the inference library owns it.
Hooks are its clients. Without it, every Stop pays a model load. Parallel
subagents would each load their own copy, and docevals ADR 01039 records that
failure.

- **Starting.** A hook or `prepare` that needs a local model connects to the
  host, and starts it detached when none runs. `tracevals check` by hand uses a
  running host and never starts one. CI and one-off runs leave no process
  behind.
- **Transport.** It uses a named pipe on Windows and a Unix socket elsewhere,
  both from Node's `net` module. Only the current user can reach it.
- **Queue.** Requests for one model run one at a time, first in, first out. A
  request that waits 120 seconds is withdrawn. Its hook skips and says so once.
- **Leases.** `prepare` takes a lease for its session at SessionStart. A
  SessionEnd hook returns it through `manni tracevals release`.
- **Keep-alive.** A model stays loaded while a lease is held and in use within
  `providers.llama-cpp.keepAlive`. Every request renews its session's lease. A
  lease idle past keep-alive lapses, which covers a session that crashed. With
  no lease left, the model unloads. The host exits when nothing is loaded.
- **Memory.** The host loads a second model only when the library's probe says
  both fit. Otherwise it unloads the idle one first.
- **Failure.** A client whose host dies starts a new one and retries once. A
  second failure skips the turn with a message.

Extraction is single-flight per source. A process checks the cache, sends the
request, and the host checks the cache again before it runs. A second request
for the same file finds it done. A hosted extraction model takes no lock, so two
processes can extract one new file at once. They write the same answer, and the
extra call is the price of not locking.

Downloads are single-flight too. The library holds a download lock, so a second
`prepare` sees `downloading` and fetches nothing.

Nothing is dropped silently. Under a hook, each skip is reported once per
session. By hand, it is the report's `skipped` field and a line on stderr.

### Config

Before:

```yaml
tracevals:
  provider: anthropic                 # the judge for run, and fill's model
  model: <model id>
  judge:
    ensembleRuns: 3
    zones: { autoPass: 0.8, autoFail: 0.8 }
```

After. The top-level keys keep their names and gain duties. One section is
new, and its presence puts tracevals in play.

```yaml
tracevals:
  provider: anthropic                 # out of the loop: run, fill, extraction,
  model: claude-sonnet-5-5            #   prepare and check by hand
  judge:
    ensembleRuns: 3                   # also check by hand
    zones: { autoPass: 0.8, autoFail: 0.8 }   # autoFail is the block bar
  conformance:                        # new and optional. Present: in play
    hook:                             # the judge inside a hook
      provider: anthropic             # default: tracevals.provider
      model: claude-haiku-4-5         # default: tracevals.model
      runs: 1                         # default 1
    include: []                       # default []
    exclude: []                       # default []
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `provider`, `model` | string | none, so the provider chain and then `auto` | The out-of-loop model. It now also extracts rules, runs `prepare` and judges `check` by hand. |
| `conformance` | object | absent | Present, even as `{}`, puts tracevals in play under hooks. Absent, tracevals stays `not checked`. |
| `conformance.hook.provider` | string | `tracevals.provider` | The provider that judges inside a hook |
| `conformance.hook.model` | string | `tracevals.model` | The model that judges inside a hook |
| `conformance.hook.runs` | integer, at least 1 | 1 | Generative calls per turn inside a hook. A rule blocks only when every run names that same rule as violated, at the bar. Decision providers ignore it. |
| `conformance.include` | list of globs | `[]` | Files that govern agents beyond the known formats, such as a house style guide. Each applies to every turn. |
| `conformance.exclude` | list of globs | `[]` | Files never treated as rule sources, in any row. A product docs tree or a stale `.cursor/rules` are examples. |

Inside a hook, the provider comes from `conformance.hook`, then `tracevals`,
then `providers.provider`, then `auto`. Outside one, flags come first, then
the same chain as today.

These recipes are examples, not defaults. tracevals pins no model.

```yaml
# Hosted. Sonnet out of the loop, Haiku in it.
tracevals:
  provider: anthropic
  model: claude-sonnet-5-5
  conformance: { hook: { provider: anthropic, model: claude-haiku-4-5 } }

# Local, with a GPU. One model for both roles.
tracevals:
  provider: llama-cpp
  model: qwen3.5-4b
  conformance: {}

# Mixed. Sonnet extracts once per file version. Local Qwen judges each turn.
tracevals:
  provider: anthropic
  model: claude-sonnet-5-5
  conformance: { hook: { provider: llama-cpp, model: qwen3.5-4b } }

# Jev judges each turn. Sonnet extracts.
tracevals:
  provider: anthropic
  model: claude-sonnet-5-5
  conformance: { hook: { provider: jev, model: jev-latest } }
```

`jev` joins the family's provider kinds. It only decides, so it can judge
inside a hook but never serve as `tracevals.provider`. Every tool that
generates leaves it out of its provider list, and naming it there answers
`Provider "jev" answers decisions only, so it cannot generate.` with the list. Its connection settings
sit in the top-level `providers:` map, as every provider's do. `llama-cpp`
gains `keepAlive` there, because the host belongs to the shared inference
layer.

```yaml
providers:
  jev:
    apiKeyEnv: TYPESAFE_API_KEY       # default shown
    baseUrl: https://api.typesafe.ai  # default shown
  llama-cpp:
    keepAlive: 10m                    # default 10m. 0 unloads a model as soon
                                      # as no session holds it
```

`keepAlive` takes the duration format `--newer-than` takes, such as `30m` or
`24h`.

### `manni tracevals prepare`

It fetches what judging needs and warms the rules cache. The SessionStart hook
runs it, and a person or a CI runner can too.

1. For each role whose provider is `llama-cpp`, it makes sure the runtime and
   the model are on disk.
2. Under a SessionStart envelope with a local hook model, it takes the
   session's lease and loads the model. The first Stop finds it warm.
3. It extracts rules from every source whose trigger is "always", with the
   out-of-loop model. Cached sources are skipped.

| Option | Meaning |
|---|---|
| `--project <dir>` | Project root. Default: the envelope's `cwd`, else the current directory. |
| `--no-cache` | Extracts again, even from cached sources |
| `--offline` | As in `run`. It refuses network providers, so it only fetches local models. |
| `-f, --format <format>` | `pretty` (default) or `json` |
| `-c, --config <path>`, `--no-config` | As in every verb |

A hook envelope on stdin is detected, as `capture` detects it. With one,
`prepare` writes nothing to stdout.

```
$ manni tracevals prepare
qwen3.5-4b (llama-cpp) downloaded, 2.91 GB.
Extracted 23 rules from 4 files that apply to every session. 2 more were cached.

$ manni tracevals prepare
qwen3.5-4b (llama-cpp) is ready.
4 files that apply to every session are cached. Nothing to extract.

$ manni tracevals prepare --offline
$ manni tracevals prepare --project . -c manni.config.yaml --no-cache -f json
```

```json
{
  "models": [
    { "role": "hook", "provider": "llama-cpp", "model": "qwen3.5-4b",
      "state": "downloaded", "bytes": 3124000000 }
  ],
  "extraction": { "provider": "anthropic", "model": "claude-sonnet-5-5",
                  "extracted": 4, "cached": 2, "rules": 23 },
  "warnings": [],
  "exitCode": 0
}
```

A model's `state` is `downloaded`, `ready`, `loaded` or `hosted`, and a hosted
model's `bytes` is `null`. `extraction` is `null` under `--offline` with a hosted
extraction model. With `-f json`, the not-set-up message goes in `warnings`.

| Message | Stream | Exit |
|---|---|---|
| `tracevals conformance is not set up; nothing to prepare.` | stdout | 0 |
| `manni: could not download qwen3.5-4b: <first line of the error>` | stderr | 2 |
| `manni: could not extract rules from <path>: <first line of the error>` | stderr | 2 |

### `manni tracevals check <trace>`

It judges the last turn of one session against the rules that governed it. By
hand it uses the out-of-loop model and `judge.ensembleRuns`. It takes one
trace, because a turn belongs to one session.

| Option | Meaning |
|---|---|
| `<trace>` | One transcript file. Required. |
| `--project <dir>` | Project root for resolving sources. Default: the trace's recorded cwd. |
| `--provider <kind>` | Overrides the judge's provider |
| `--model <id>` | Overrides the judge's model |
| `--local` | Forces `llama-cpp`, as in `run` |
| `--runs <n>` | Overrides `judge.ensembleRuns` |
| `--no-cache` | Skips the rules cache and the verdict cache |
| `--offline` | As in `run` |
| `-f, --format <format>` | `pretty` (default) or `json` |
| `-o, --output <file>` | Writes the report to a file |
| `-c, --config <path>`, `--no-config` | As in every verb |

The flags override the judge only. Extraction always uses the out-of-loop
model, so `prepare`, the hook and `check` share one cache.

Exit 0 means no rule was broken, needs-review included. Exit 1 means at least
one rule was broken with a confident verdict. Exit 2 is an operational or usage
error.

```
$ manni tracevals check ~/.claude/projects/my-repo/3b265d00.jsonl
CLAUDE.md
  ✖ run-npm-ci-first  Run npm ci first when working in a worktree.
      Ran npm test in a fresh worktree with no npm ci before it. (0.91)
docs/content-strategy/design.md
  ? accent-not-red  The accent colour may not be red, green, yellow or cyan.
      Used #e5534b for a title band; unclear whether a band counts. (0.55)

Last turn of 3b265d00: 14 rules from 5 files. 1 broken, 1 needs review.
```

```
# Reproduce what the hook saw, with the hook's model
$ manni tracevals check s.jsonl --provider anthropic --model claude-haiku-4-5 --runs 1

# A local judge
$ manni tracevals check s.jsonl --local --model qwen3.5-4b

# The scripting form
$ manni tracevals check s.jsonl -f json -o turn.json

# Everything at once
$ manni tracevals check s.jsonl --project . -c manni.config.yaml \
    --provider llama-cpp --model qwen3.5-4b --runs 3 --no-cache -f json -o turn.json
```

The other closing lines are these.

- `Last turn of 3b265d00: 14 rules from 5 files. None broken.`
- `Last turn of 3b265d00: 14 rules from 5 files, none apply to this turn.`
- `Last turn of 3b265d00: no rule sources governed it.`
- `Last turn of 3b265d00: nothing happened after the last prompt.`

All four exit 0.

| Situation | Message on stderr, exit 2 |
|---|---|
| No trace | `manni: no trace given; pass a trace file or run manni tracevals list` |
| Two traces | `manni: tracevals check takes one trace, got 2` |
| A bad `--runs` | `manni: --runs must be a whole number of at least 1, got 0` |
| A missing trace | `manni: cannot read trace <path>: <reason>` |
| A local model not on disk | `manni: qwen3.5-4b is not downloaded; run manni tracevals prepare` |
| Jev out of the loop | `manni: jev answers decisions only, so it cannot extract rules or write verdicts. Use it as tracevals.conformance.hook.provider.` |
| No Jev key | `manni: jev needs an API key in TYPESAFE_API_KEY` |
| `--offline` with a hosted role | `manni: --offline runs no network provider, and the judge uses anthropic` (or `extraction uses`) |
| A provider failure | `manni: could not judge the last turn: <first line of the error>` |

The Jev message also answers `run` and `fill` given `--provider jev`.

```json
{
  "trace": "/abs/3b265d00.jsonl",
  "sessionId": "3b265d00",
  "agentId": null,
  "turn": { "from": 412, "to": 498 },
  "judge": { "provider": "anthropic", "model": "claude-sonnet-5-5",
             "mode": "generative", "runs": 3 },
  "extraction": { "provider": "anthropic", "model": "claude-sonnet-5-5" },
  "sources": [
    { "path": "CLAUDE.md", "format": "claude-md", "trigger": "always",
      "rules": 9, "origin": "extracted" },
    { "path": "src/api/AGENTS.md", "format": "agents-md",
      "trigger": "touched src/api/handler.ts", "rules": 4, "origin": "extracted" },
    { "path": ".cursor/rules/tests.mdc", "format": "cursor-rule",
      "trigger": "globs matched test/a.test.ts", "rules": 2, "origin": "extracted" },
    { "path": ".claude/skills/demo/references/style.md", "format": "skill",
      "skill": "demo", "trigger": "skill window", "rules": 3, "origin": "extracted" },
    { "path": ".claude/skills/demo/SKILL.md", "format": "skill",
      "skill": "demo", "trigger": "skill window", "rules": 2, "origin": "declared" }
  ],
  "findings": [
    { "source": "CLAUDE.md", "rule": "run-npm-ci-first",
      "text": "Run npm ci first when working in a worktree.",
      "outcome": "fail", "observed": "Ran npm test ... before it.",
      "confidence": 0.91 }
  ],
  "summary": { "sources": 5, "rules": 14, "notApplicable": 6,
               "fail": 1, "needsReview": 1 },
  "skipped": null,
  "warnings": [],
  "exitCode": 1
}
```

- `findings` lists only `fail` and `needs-review` outcomes.
- `origin` is `declared` for a file's own `ai` evals, and `extracted` otherwise.
- `format` names a row of the sources table. `trigger` says why the file was in
  scope.
- `judge.mode` is `decision` or `generative`. In decision mode, `confidence` is
  the option's probability and `runs` is 1.
- `judge` is `null` when no judge ran, and `extraction` is `null` when no
  source needed the model.
- `skipped` is `null`, `"empty-turn"`, `"no-sources"` or `"not-applicable"`.
  The other gates only act under a hook.

### `manni tracevals release`

It returns a session's lease on the model host. The SessionEnd hook runs it. A
person runs it with `--all` to free the memory now.

| Option | Meaning |
|---|---|
| `--all` | Drops every lease, unloads every model and stops the host |
| `-f, --format <format>` | `pretty` (default) or `json` |

Under a SessionEnd envelope, the session comes from `session_id`, and nothing
is written to stdout. By hand, without `--all`, there is no session to release.

```
$ manni tracevals release --all
Unloaded qwen3.5-4b and stopped the model host. 2 sessions held it.
```

```json
{ "released": ["3b265d00"], "unloaded": ["qwen3.5-4b"], "hostStopped": true, "exitCode": 0 }
```

| Message | Stream | Exit |
|---|---|---|
| `No model host is running.` | stdout | 0 |
| `manni: release needs a session from a SessionEnd hook, or --all` | stderr | 2 |

### Under the hooks

`plugin/manni/hooks/hooks.json` gains three entries. Stop is unchanged and
already runs `manni check`. Each entry runs through the plugin's launcher,
`hooks/manni.mjs`, which runs the first manni it finds.

| Event | Matcher | Command | Timeout (s) |
|---|---|---|---|
| SessionStart | `startup\|resume` | `manni tracevals prepare`, with `"async": true` | not enforced |
| SubagentStop | all | `manni check` | 600 |
| SessionEnd | all | `manni tracevals release` | 10 |

An async hook never blocks the session, and Claude Code does not enforce its
timeout. SessionEnd allows 1.5 seconds unless a hook sets more. `release` sets
10, because `npx` alone can take a second.

| Envelope | What runs when `conformance` exists |
|---|---|
| SessionStart | `tracevals prepare`, in the background |
| Stop | 0078's file checks, then a judgement of `transcript_path` with the hook model |
| SubagentStop | A judgement of `agent_transcript_path` alone, with the hook model |
| SessionEnd | `tracevals release` for the session |
| None | `manni check` does not run tracevals, because there is no session to judge. |

Every reply exits 0 and writes JSON to stdout.

| Situation | Reply |
|---|---|
| A broken rule, first stop | `{"decision":"block","reason":"This turn broke 1 rule from the files that governed it. Fix the work, or say why the rule does not apply here, then finish.\n\n<report>"}` |
| A broken rule after the repair pass | `{"systemMessage":"tracevals still finds broken rules after one repair pass. Run manni tracevals check <transcript_path> to see them."}` |
| Gate 5 | `{"systemMessage":"tracevals skipped this turn: qwen3.5-4b is still downloading."}` |
| Queued for 120 seconds | `{"systemMessage":"tracevals skipped this turn: qwen3.5-4b was busy with other judgements for 2 minutes."}` |
| Gate 7 | `{"systemMessage":"tracevals skipped this turn: qwen3.5-4b is not downloaded yet. Run manni tracevals prepare to fetch it."}` |
| Gate 8 | `{"systemMessage":"tracevals skipped this turn: qwen3.5-4b needs about 10 GB and 6 GB is free."}` |
| Needs-review, clean, or an operational failure | Nothing, as 0078's Stop failures are silent |

The report in a block is the pretty report with color off. When 0078's file
checks fail too, the reason carries their paragraph first. A skip message is
said once per session.

`manni status` names both models in the tracevals row, and the host when one
runs.

```
tracevals  judges each turn   hook: llama-cpp qwen3.5-4b · extraction: anthropic claude-sonnet-5-5
           model host         qwen3.5-4b loaded, 2 sessions, idle 3m
```

Without `conformance`, the row stays 0078's `not checked`.

### What the inference library adds

tracevals never constructs a provider itself. node-llama-cpp is already the
library's optional peer dependency, installed into its runtime directory. What
the library lacks is an API for option probabilities and a process that keeps
a model loaded. Those arrive in one minor release, each with its own ADR there.
manni moves its version range, and adds no dependency of its own.

| Addition | Shape | Used for |
|---|---|---|
| `decide` | Jev's request shape. A `state`, and `questions` keyed by id, each with a `type`, `instructions` and `criteria`. Each answer carries `choice`, `probabilities` and `confidence`. | The judge in decision mode |
| `canDecide` | A capability flag on each provider | Choosing the judge's mode |
| llama-cpp `decide` | Option probabilities from one forward pass. The state is evaluated once, and each question branches from a checkpoint. | Local decisions |
| `jev` | A decide-only provider. It posts to `/v1/systemone` with a bearer key from `TYPESAFE_API_KEY`. | Hosted decisions |
| `stateLimit` | The largest state a provider and model accept | Rendering the turn to fit. A cut is a visible marker and a warning, never silent. |
| `ensureModel` | Fetches the runtime and model without loading them, behind a download lock | `prepare` |
| `modelState` | `ready`, `downloading` or `missing`, read without loading | Gates 5 and 7 |
| `fits` | The memory probe `auto` tiering uses, for one named model | Gate 8 |
| Model host | The process, its queue, leases and `keepAlive` | Loading a model once, for every hook |

## Alternatives considered

### A Read hook

A PostToolUse hook on Read could extract each file the moment the agent reads
it. It is left out. The transcript already records every Read, so a Stop finds
the files itself. `prepare` warms the sources every session uses, and the cache
outlives the session. A Stop extracts only a file new at its current hash. A
PreToolUse hook would add nothing, since a Read is never worth stopping.

### Every Markdown file the agent read

An earlier draft treated any Markdown file the agent read as a rule source.
It is rejected, because most of what an agent reads describes systems, not
behavior. A product docs page full of "run this command" would fail turns that
never meant to run it.

### One generative call per rule

Asking about each rule separately is simpler to prompt. It is rejected,
because the turn dominates every prompt and would be encoded once per rule.
Decision mode encodes it once. Generative mode asks about every rule in one
call.

### A model load per hook

Without a host, each hook loads the model, a few seconds warm. Parallel
subagents would load parallel copies. A per-model lock fixes the copies, but
then parallel judgements load one after another. The host pays the load once.

### A Stop hook of tracevals' own

`manni tracevals check` could sit in its own Stop hook. It is rejected, because
0078 already runs `manni check` at Stop. Two Stop hooks would share one
`stop_hook_active` and race each other for the repair pass. One hook gives one
block, with every failing check in it.

## Stress test

1. **A confidently wrong small model.** The turn shows nothing about a rule,
   and the model says `violated` at 0.7. That is below the bar, so it becomes
   `needs-review` and blocks nothing. `unclear` gives it a better answer.
2. **The agent reads the product docs.** None of them is a source. A docs page
   named in `include` by mistake still yields only directives addressed to the
   agent.
3. **A skill reference that documents an API.** It is a source, as part of its
   skill, and extraction returns no rules from it.
4. **`CLAUDE.md` and `AGENTS.md` disagree.** The nearer file wins. When they
   sit side by side, the judge sees both and answers `unclear`, which never
   blocks.
5. **The user asks for what a file forbids.** The prompt overrides the file,
   so the turn did not violate it.
6. **A Cursor rule in a Claude Code session.** It applies by its own trigger.
   A repo that keeps a stale `.cursor/rules` excludes it.
7. **Qwen on a CPU.** Extraction is slow, but it happens once per file version,
   often at session start. The decision judge encodes the turn once. A machine
   too slow for that sets a hosted in-loop model.
8. **A Stop before `prepare` finishes.** If the model is still downloading, the
   Stop skips at gate 5. If `prepare` is extracting, the Stop queues behind it
   and finds the rules cached.
9. **Five subagents finish at once on one GPU.** Their SubagentStops queue in
   the host. One model is loaded, and each waits at most 120 seconds.
10. **Two sessions in two worktrees.** Both are clients of one host and one
    queue.
11. **The host dies mid-request.** The client starts a new host and retries
    once. A second failure skips the turn with a message.
12. **A session crashes before SessionEnd.** Its lease lapses after keep-alive,
    and the model unloads.
13. **A CI run.** It never starts a host, so it leaves no process behind.
14. **A `claude-cli` judge.** Its own session would fire this hook again. Gate
    2 sees `MANNI_TRACEVALS_JUDGE` and stays silent.
15. **An extracted `when` too narrow to fire.** The rule is never judged, and
    a real violation passes. The `when` is in the cache and in `--format json`,
    where a person can read it.
16. **The transcript lags.** `last_assistant_message` fills the gap for the
    final message. Tool calls are written as they run.
17. **0078's checks and a broken rule fail together.** One block carries both,
    and one repair pass covers both.
18. **A partial read of a long rules file.** The agent is held to the whole
    file. It read the file, so it knew the file existed.
19. **A rule from an earlier, unrelated task.** Its `when` usually keeps it
    out. If not, the judge answers `not_applicable`.
20. **Cost per turn on hosted models.** Extraction is per file version, not
    per turn. The in-loop judge is one Haiku call, or one Jev request.
21. **The turn leaves the machine under Jev.** It goes to TypeSafe, a third
    party beyond the agent's own provider. Redaction applies first, as it does
    for every judge.
22. **A turn longer than the state limit.** The render keeps its head and tail
    with a visible marker, and the report warns.
23. **By hand and in the hook disagree.** They use different models by design.
    Passing the hook's model to `check` reproduces the hook.
24. **A session later graded by `run`.** Its transcript holds the block
    reasons. That is an honest record of what the agent was told.

## Consequences

- An agent hears about a broken rule while it can still fix it, in the same
  block 0078 uses for file checks.
- A repo's rules count whichever agent wrote them, and a stale set can be
  excluded by glob.
- tracevals gains three verbs, a config section and one `when` condition.
- The inference library gains decisions, Jev, a model host and model helpers.
  docevals and graph can use them later. They are unchanged by this proposal.
- One background process per machine may hold a model in memory for up to
  `keepAlive` after the last use.

## Known limits

- The host is one process per machine. One slow request delays every
  session's judgement behind it.
- A partial read holds the agent to the whole file.
- Files the agent prints through Bash, as with `cat`, are not seen as reads.
- Gemini's configurable context file name is not read, so only `GEMINI.md`
  counts.
- Triggers mirror each agent's documentation. They are not observed from the
  agent.

## Open questions

- **Needs-review in a hook.** It is silent today. A `systemMessage` would tell
  the user, at the cost of noise on most turns.
- **Linked files.** An instruction file can link to a guide in prose without
  an `@` import. Whether that guide counts without being named in `include` is
  open.
- **`run` and the new sources.** Batch `run` could resolve the same sources. It
  would add implicit evals to existing CI runs.
- **`InstructionsLoaded`.** Claude Code's hook of that name records what
  loaded. `capture` could keep that record. It is not enough alone, because an
  `AGENTS.md` read natively never fires it.
- **Copilot and Windsurf.** Copilot's `.github/instructions/*.instructions.md`
  and Windsurf's rules have the same shape. They wait until someone asks.
- **Checking work against specs.** Spec Kit, Kiro and OpenSpec specs could
  ground a different check, of code against requirements. That needs a
  proposal of its own.
- **Clef.** Cloudflare's open-weight model is reported to accept Jev's request
  shape. Whether it works as `jev` with a `baseUrl` needs checking against its
  docs.
