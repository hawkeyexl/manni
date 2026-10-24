# 0113: The plugin's tracevals hooks are each user's to turn on

- **Status:** Implemented (#248)
- **Serves:**
  - Maya · M25, "Catch a broken rule before the agent hands back". Her turns
    are judged because she chose it, and turning it off for herself leaves
    everyone else's choice alone.
  - Theo, the contributor who opens a repository to fix one red check. A
    repository he cloned runs no judge he never chose.
- **Depends on:** Three earlier proposals.
  - [0078](0078-family-check-status-and-claude-code-plugin.md) is the plugin,
    its launcher, envelope detection and the Stop protocol.
  - [0079](0079-tracevals-checks-each-turn-against-the-rules-it-read.md) is
    runtime evals, their Stop gates, `prepare`, `release` and the model host.
  - [0083](0083-runtime-evals-the-rename.md) named the section
    `tracevals.runtime`.
- **Supersedes in part:** [0078](0078-family-check-status-and-claude-code-plugin.md)
  and [0079](0079-tracevals-checks-each-turn-against-the-rules-it-read.md).
  [What this supersedes](#what-this-supersedes) names the passages.
- **Relates to:** [0103](0103-the-plugin-serves-the-graph-and-keeps-page-metadata-current.md),
  which superseded another clause of the same 0078 sentence. Tracevals ADR
  [01024](tracevals/01024-capture-a-session-manifest-so-staleness-is-exact.md),
  which made `capture` a `SessionStart` hook.
- **Touches:** `plugin/manni/.claude-plugin/plugin.json`,
  `plugin/manni/hooks/manni.mjs`, a new `plugin/manni/hooks/tracevals.mjs`,
  `plugin/manni/hooks/hooks.json`, `src/family/core/in-play.ts`,
  `src/family/commands/status.ts`, `src/family/commands/check.ts`,
  `src/tracevals/core/config-schema.json`, and the plugin, runtime, family and
  coverage pages.

## Problem

Theo opens a repository to fix one red check. Its `.claude/settings.json`
offers the `manni` plugin. Its `manni.config.yaml` carries `tracevals.runtime`,
because Maya wanted every turn of her own sessions judged.

Today that committed section is the only switch. So Theo's first session start
fetches a local judge model he never chose. Every Stop and SubagentStop then
runs a judge on his machine. `tracevals capture` also writes a session manifest
at every startup, wherever any manni is found, with or without a config. Nobody
asked him.

The cost lands on the person with the least context. Theo has low context on
manni and no wish to learn it. He finds out when his laptop fans spin up, or
when a turn waits on a judge.

The only off switch is deleting the section, and that turns it off for Maya
too. A committed file cannot say what one person wants on their own machine.

## Outcome

A committed config says tracevals can judge turns here. Each user decides
whether it does on their machine. Off is the default, and off means the plugin
runs no tracevals at all.

## Worked example

This repository enables `manni@manni` in `.claude/settings.json` and has no
`tracevals:` section.

1. Maya adds runtime evals and commits them.

   ```yaml
   tracevals:
     runtime: {}
   ```

2. Theo starts a session. Nothing fetches and nothing records. The briefing
   the agent reads holds this row.

   ```text
   tracevals  not checked   runtime evals are set up, and turned off here
   ```

   At Stop, `manni check` runs the file checks alone and never reads the
   transcript.

3. Maya turns the option on for herself, in a session.

   ```text
   /plugin configure manni@manni
   ```

   She checks **Judge each turn with tracevals** and restarts Claude Code.
   Claude Code writes the answer to her user settings.

   ```json
   { "pluginConfigs": { "manni@manni": { "options": { "tracevals": true } } } }
   ```

4. Her next session records `.manni/tracevals/sessions/<id>.json` and prepares
   the hook model in the background. Her briefing holds this row.

   ```text
   tracevals  judges each turn   hook: <provider> <model> · extraction: <provider> <model>
   ```

   Her Stop is judged. Theo's never is.

5. In her own terminal, `manni status` reads her shell. So it still says
   `turned off here`, with the next step under it.
   `MANNI_TRACEVALS_HOOKS=1 manni status` shows the row her sessions see.

Maya's turns are judged, and Theo's machine runs nothing he did not choose.

## Decision

### 1. The plugin declares one per-user option

`plugin.json` gains a `userConfig` block with one boolean, `tracevals`,
defaulting to `false`. Claude Code stores a plugin option's answer in the
user's own settings. It ignores the same key in project and local settings. So
a cloned repository can offer the plugin, and it still cannot turn this option
on for anyone.

### 2. manni reads `MANNI_TRACEVALS_HOOKS`

The plugin's launcher maps the option onto one variable, `MANNI_TRACEVALS_HOOKS=1`.
It sets the variable for every manni it starts. manni reads the variable, never
Claude Code's own name for the option.

Only `1` is on. Unset or empty is off. Any other value is off too, and manni
warns once on stderr, so a `true` or a `yes` is never silently ignored.

### 3. The plugin gates four hooks, and manni gates the turn

Four hooks exist only for tracevals. They are `capture`, `prepare`, the
SubagentStop check and `release`. Each now runs a gate script,
`hooks/tracevals.mjs`, in place of `hooks/manni.mjs`. Off, the script exits `0`
before any manni starts. On, it runs manni exactly as `manni.mjs` does.

The Stop hook cannot be skipped, because it also runs the file checks 0078
promised. So manni itself gates the turn. Under a Stop or SubagentStop, the
turn check returns at once when the variable is not `1`, before tracevals loads.

### 4. `status` says when runtime evals are set up and turned off

With `tracevals.runtime` present and the variable not `1`, the `tracevals` row
is `not checked`, with a reason and a next step of its own. Without the
section, the row is unchanged.

### 5. Nothing else moves

No `manni.config.yaml` key is added, renamed or removed. `tracevals.runtime` is
still required for runtime evals. It is no longer sufficient on its own. No CLI
flag, argument or command changes.

## Interface

### The plugin's option

Before, `plugin.json` has no `userConfig`. After, it has this block.

```json
"userConfig": {
  "tracevals": {
    "type": "boolean",
    "title": "Judge each turn with tracevals",
    "description": "Run manni's tracevals hooks for you. They record each session's manifest, fetch the judge model and judge each turn where the repository sets tracevals.runtime. Off unless you turn it on.",
    "default": false
  }
}
```

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `tracevals` | boolean | `false` | no | Runs the plugin's four tracevals hooks for this user. It reaches hooks as `CLAUDE_PLUGIN_OPTION_TRACEVALS`. |

A user sets it in three places. The first is `/plugin`, under **Installed**,
**manni** and **Configure options**. The second is `/plugin configure manni@manni`
in a session. The third is a shell.

```sh
claude plugin install manni@manni --config tracevals=true
```

Claude Code says to restart after. The manifest's `description` gains "for a
user who turns tracevals on" after "records the session manifest tracevals
reads".

### The variable

| `MANNI_TRACEVALS_HOOKS` | Effect |
|---|---|
| `1` | The tracevals hooks run. The plugin runs them, and `manni check` under a Stop or SubagentStop judges the turn where `tracevals.runtime` exists. `manni status` reports tracevals in play. |
| unset or empty | Off. |
| anything else | Off, and one warning on stderr. |

The plugin sets it to `1` for every manni it starts when its option is on. A
user without the plugin sets it themselves. The `env` block of their own
`~/.claude/settings.json` is one place for it.

### Hooks

| Event | Before | After |
|---|---|---|
| SessionStart `startup` | `manni.mjs tracevals capture` | `tracevals.mjs tracevals capture` |
| SessionStart `startup\|resume`, async | `manni.mjs tracevals prepare` | `tracevals.mjs tracevals prepare` |
| SubagentStop | `manni.mjs check` | `tracevals.mjs check` |
| SessionEnd | `manni.mjs tracevals release` | `tracevals.mjs tracevals release` |
| Stop | `manni.mjs check` | unchanged. The file checks always run, and the turn only when on. |

### What runs, by setup

| `tracevals.runtime` | Turned on | capture | prepare | Stop | SubagentStop | release | Briefing row |
|---|---|---|---|---|---|---|---|
| absent | no | none | none | file checks | none | none | `not checked  judges recorded sessions with a model` |
| absent | yes | writes manifest | prints its `not set up` line to stderr | file checks | silent | runs | same as above |
| present | no | none | none | file checks | none | none | `not checked  runtime evals are set up, and turned off here` |
| present | yes | writes manifest | fetches, warms | file checks and the turn | the turn | runs | `judges each turn  hook: … · extraction: …` |

### Messages

| Where | Text | Exit |
|---|---|---|
| `manni status` row, `runtime` present and hooks off, reason | `runtime evals are set up, and turned off here` | `0` |
| The same row, next step. It prints by hand only, since the briefing omits next steps. | `Turn on the manni plugin's tracevals option, or set MANNI_TRACEVALS_HOOKS=1.` | `0` |
| stderr, once per process, when the variable holds another value | `manni: MANNI_TRACEVALS_HOOKS is "true"; only 1 turns the tracevals hooks on.` | unchanged |

### Output shape

`manni status -f json` gains one possible `tracevals` row. The row's shape is
unchanged.

```json
{ "name": "tracevals", "status": "not-checked", "reason": "runtime evals are set up, and turned off here", "next": "Turn on the manni plugin's tracevals option, or set MANNI_TRACEVALS_HOOKS=1." }
```

Hook replies keep their shapes. Off, a Stop reply carries 0078's file findings
alone.

### Ladder

Each command runs in a repository with `tracevals: { runtime: {} }`.

```text
$ manni status                                   # off. Row "not checked … turned off here" and the next line; exit 0
$ MANNI_TRACEVALS_HOOKS=1 manni status           # on. Row "judges each turn  hook: … · extraction: …"; exit 0
$ manni status -f json                           # the JSON row above; exit 0
$ echo '<Stop envelope>' | manni check           # file checks only, transcript never read; exit 0
$ echo '<Stop envelope>' | MANNI_TRACEVALS_HOOKS=1 manni check   # file checks and the turn; exit 0
$ echo '<SessionStart envelope>' | node plugin/manni/hooks/tracevals.mjs tracevals capture
                                                 # off. No output and no manifest; exit 0
$ echo '<SessionStart envelope>' | CLAUDE_PLUGIN_OPTION_TRACEVALS=true node plugin/manni/hooks/tracevals.mjs tracevals capture
                                                 # on. A manifest under .manni/tracevals/sessions/; exit 0
$ MANNI_TRACEVALS_HOOKS=true manni status        # stderr: manni: MANNI_TRACEVALS_HOOKS is "true"; only 1 turns the tracevals hooks on.
                                                 # the row stays "turned off here"; exit 0
```

### Programmatic API

None. `src/index.ts` exports nothing new.

## Why a plugin option, not a config key

The switch has to belong to one person. Claude Code already keeps one store
that does. It writes a plugin option's answer to user settings and ignores
`pluginConfigs` in project and local settings. A repository someone cloned
therefore cannot turn the option on.

A key in `manni.config.yaml` would repeat the problem. That file is committed,
so whoever writes the key writes it for everyone. manni has no user-level
config file, and adding one for a single boolean would be a second config
system.

## Why manni reads its own variable

The plugin is one way to run manni's hooks, not the only one. A user can wire
`manni check` into hooks of their own, as the tracevals reference shows for
`capture`. Claude Code's `CLAUDE_PLUGIN_OPTION_TRACEVALS` exists only when the
plugin starts the hook. A variable of manni's own works without the plugin, and
in a shell.

It also keeps one spelling. The string form Claude Code gives a boolean option
is not documented. A probe on Claude Code 2.1.309 found `true` for an option
set on and `false` for one set off. An option never set arrives as no variable
at all, even with `default: false`. The launcher absorbs that, and manni sees
`1` or nothing.

The same probe found that a hook naming `${user_config.tracevals}` in its
arguments does not run while the option is unset. So the plugin reads the
variable and never substitutes the option.

## Why the gate is split

The four tracevals-only hooks are gated in the plugin. A project's installed
manni may be older than the plugin, and an older manni knows nothing of the
variable. A gate in the plugin holds whatever manni runs. It also starts no
process at all. A repository with no installed manni never waits on an `npx`
download for a hook that would do nothing.

The Stop hook cannot be gated there, because it also runs the file checks. So
its turn judgement is gated in manni, where the turn check starts.

## Version skew

- **An older installed manni with this plugin.** It ignores
  `MANNI_TRACEVALS_HOOKS`. So its Stop still judges where `runtime` exists, and
  its `status` still reports `judges each turn`. The four other hooks stay off,
  because the plugin gates them. Upgrading the project's manni closes the gap.
- **This manni with an older plugin.** The older plugin runs `capture`,
  `prepare` and `release` for everyone and never sets the variable. So no turn
  is judged, but `prepare` still fetches the model where `runtime` exists. The
  plugin updates from the marketplace, which closes this one.

## Stress test

### 1. Theo clones a repository with `runtime` and the plugin offered

He never opens `/plugin`. No manifest is written, no model is fetched, and his
Stop runs the file checks alone. His briefing says runtime evals are set up and
turned off here, which tells his agent why tracevals is quiet.

### 2. Maya turns it on where `runtime` is absent

`capture` writes the manifest, so post-hoc runs get exact staleness. `prepare`
prints its one `not set up` line to stderr and does nothing else. SubagentStop
judges nothing. `release` runs and finds no lease. The briefing row is the one
a repository without `runtime` always shows.

### 3. A repository commits the option

A `pluginConfigs` entry in a committed `.claude/settings.json` sets `tracevals`
to `true`. Claude Code ignores it at project scope, so the option stays off for
every contributor. This is the case the option exists for.

### 4. A repository commits the variable

A committed `.claude/settings.json` can also carry
`"env": { "MANNI_TRACEVALS_HOOKS": "1" }`. Where Claude Code passes a project's
`env` to its hooks, that turns the hooks on for every contributor. manni cannot
tell a project's variable from a user's.

It is a deliberate line in a reviewed file, with the same reach as a hook the
repository commits itself. The option still cannot be committed. The open
questions carry whether manni should warn.

### 5. A user sets `MANNI_TRACEVALS_HOOKS=true`

manni warns once with the exact line above and stays off. The plugin never
produces that value, so the warning reaches only someone who set it by hand.

### 6. The terminal and the session disagree

The session briefing reads the plugin's option, through the variable the
launcher sets. A `manni status` typed in a terminal reads that shell, so it
shows `turned off here` for a user who turned the option on. Its next step
names both ways to turn it on, and the plugin page says why the two differ.

### 7. A judge's own session

A `claude-cli` judge runs with `MANNI_TRACEVALS_JUDGE` set, and 0079's gate 2
still stops it. The new gate runs first, and either gate alone keeps a judge
from judging itself.

### 8. A resumed session

`prepare` runs on `startup` and `resume`, and the gate holds for both. `capture`
still runs on `startup` only, as ADR 01024 decided.

## Rejected

- **A config key such as `tracevals.runtime.hooks`.** It is committed, so it
  turns the judge on or off for everyone at once.
- **On by default, with an opt-out.** The cost lands on the person with the
  least context, which is the problem this proposal solves.
- **manni reads `CLAUDE_PLUGIN_OPTION_TRACEVALS`.** It ties manni to the
  plugin's naming, and it does nothing without the plugin or in a shell.
- **Every gate in manni.** An older installed manni would still run `capture`
  and `prepare`. And a hook that does nothing would still start a manni, which
  may mean an `npx` download.
- **Gate the Stop hook in the plugin.** The file checks run there, so the
  plugin cannot skip it.

## Open questions

- Should a terminal's `manni status` read the plugin's stored answer from user
  settings, so the terminal and the session agree?
- Should manni warn when `MANNI_TRACEVALS_HOOKS` comes from a project's
  committed `env` block? manni cannot see where a variable came from, so this
  would need Claude Code's help.
- Should `capture` get an option of its own? A manifest is cheap, and someone
  may want exact staleness without a judge.

## What this supersedes

- In 0078's plugin section, the `SessionStart` `startup` row that runs
  `tracevals capture` for every user. It now runs only for a user who turned
  tracevals on.
- In 0078, "The plugin has no subagents, no MCP server and no `userConfig`."
  The plugin now declares one `userConfig` option, `tracevals`. 0103 already
  superseded the clause about the MCP server.
- In 0079's Stop gates, gate 1, "Not in play" when there is no
  `tracevals.conformance` section. 0083 renamed the section `tracevals.runtime`.
  The section alone no longer puts tracevals in play under hooks. A new first
  gate stops the run when `MANNI_TRACEVALS_HOOKS` is not `1`.
- In 0079's config table, "Present, even as `{}`, puts tracevals in play under
  hooks." Present, the section allows the judge, and each user turns it on.

## Verification

- `test/family/status.test.ts` pins the new row with `runtime` present and the
  hooks off, the in-play row with the variable at `1`, and the warning on
  `"true"`.
- `test/family/turn.test.ts` pins that, off, the turn check returns at once and
  the judge is never called.
- `test/plugin-launcher.test.ts` pins that `tracevals.mjs` off starts nothing
  and prints nothing. On, it passes the arguments and `MANNI_TRACEVALS_HOOKS=1`.
- `test/plugin.test.ts` pins the four hooks on `tracevals.mjs`, and the option
  in `plugin.json` as a boolean defaulting to `false`.
- Dogfood on this repository, with a copy of its config plus
  `tracevals: { runtime: {} }`. `status` shows the off row, and with the
  variable at `1` it shows `judges each turn`. `tracevals.mjs tracevals capture`
  writes no manifest off and one manifest on. A Stop envelope off replies with
  no tracevals part.
