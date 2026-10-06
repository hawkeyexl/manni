# 0078: Two family verbs, `check` and `status`, and a Claude Code plugin

- **Status:** Superseded in part by [0079](0079-tracevals-checks-each-turn-against-the-rules-it-read.md)
- **Serves:** Devin · D16, "Gate every check a repo has set up, with one
  command". Maya · M24, "Let an agent keep the docs green while it writes
  them", which cross-references D14, M17 and M23.
- **Depends on:** [0033](0033-manni-monorepo.md), the umbrella both verbs
  mount on. [0045](0045-family-encryption-key.md), which made `key` the first
  family resource and `key rotate` the first command to orchestrate other
  domains. [0041](0041-collections.md), for what it means to be a member of a
  collection.
- **Relates to:** [0049](0049-tracevals-domain.md), whose SessionStart hook
  the plugin absorbs. [0005](0005-command-parity.md), for the flag names both
  verbs reuse.
- **Supersedes, in part:** [0034](0034-command-grammar.md), for one rule. The
  umbrella owns no verbs, and there are no top-level verbs. Two top-level
  verbs now exist, `check` and `status`. Its Status line is the only edit.
  Every other rule in 0034 stands.
- **Touches:** `src/cli.ts`, `src/family/` (new), `plugin/manni/` (renamed
  from `plugin/tracevals/`), `.claude-plugin/marketplace.json` (new),
  `CLAUDE.md`, `docs/src/content/docs/family/` (new), `docs/content-strategy/`
- **Verdict:** `manni check` runs every check a repo has set up, and `manni
  status` says which those are. They are the only two top-level verbs and
  own no checks. A domain counts as set up only when its own config or content
  says so. A Claude Code hook envelope on stdin changes where output
  goes and which files are checked. It never changes what is checked. One plugin,
  `manni`, wires both verbs into a session.

## Problem

### Devin, with a gate nobody can read off the repo

No command runs "every check this repo has set up". Each repo assembles its
gate by hand, one workflow step per domain, and this repo does too. When a
domain gets set up, someone has to edit the gate, and if they forget it never
runs. Nothing fails. The check is silently absent.

### Maya, with an agent writing her pages

The agent edits a page and stops. CI then fails on the pull request. Maya
pastes the log into a new session and waits for a second round. Three
agent-side steps are also manual.

- `plugin/tracevals` ships in the package with no marketplace entry and no
  install docs. Users wire `settings.json` by hand.
- `MANNI_GENERATED_BY` is one line in a repository's agent instructions, and
  has to be remembered.
- Every project sets up a different subset of manni. Anything that runs all of
  manni blocks on domains nobody set up. Meta's default schemas would fail a
  page in a repo that only uses docevals.

The outcome both want is one command, the same for a person, CI and an agent.
It runs what is set up and nothing else. An agent gets findings at the edit
that caused them. It cannot finish with an error outstanding in a domain the
project set up. A domain the project did not set up never blocks it.

## Decision

### Two family verbs

`manni check` and `manni status` are verbs of the umbrella. They are the only
two. They call other domains' command cores in-process and own no checks of
their own, the way `key rotate` calls meta and cite.

0034 said the umbrella owns no verbs. That rule existed so that two branches
adding domains would not each invent a top-level shortcut. The reason still
holds, and these two verbs are not shortcuts. `manni validate` is a name for
one domain's command. `manni check` belongs to no domain, because it spans all
of them. It has no domain to live under.

What stays from 0034, in full:

- Every domain's verbs are subcommands of that domain.
- There are no domain-less aliases. `manni validate` still answers with where
  the command went.
- `manni meta docs/` stays the one grandfathered default subcommand.
- One separator per list, and a plan shows its full interface and a ladder.

A third top-level verb needs a proposal that supersedes this one.

### What "in play" means

A domain is in play when its own config section exists, or when the content
carries its declarations. Nothing manni would apply by default counts as set
up. This is detection, not a switch, so there is no config key.

| Domain | In play when | Per-file checks | Set-wide checks |
|---|---|---|---|
| meta | `meta:` exists, or the page names its own `$schema`. A file covered only by built-in default schemas is skipped. | `meta validate` | |
| cite | The page carries citations, as markers or a `citations` manifest | `cite check` on the page | `cite check` over every page with citations. A source edit can drift any of them. |
| lint | `lint:` exists | `lint check` | |
| docevals | `docevals:` exists, or the page declares evals. "No evals resolved" counts as not in play. | `docevals run --deterministic-only --no-generate --no-execution` | |
| term | The collections hold at least one term. "No terms found" means not in play. | | `term check`. At a stop, only when a collection document changed. |
| graph | `graph:` exists | | `graph build` in memory, writing no file, then `graph check`. At a stop, only when a collection document changed. |
| a11y, tracevals | Never. They need a browser, a running site, recorded sessions or an LLM. | | |

A file is checked only if it is a member of a declared collection. Other files
pass silently. Only error-level findings fail, as each domain defines them.
That is the same rule as each domain's own exit 1. Warnings and notices never
fail.

### Scope by input

| Input | What is checked |
|---|---|
| nothing | Every in-play check over every collection, per-file and set-wide. This is the CI gate. |
| paths | The per-file checks on those files |
| a `PostToolUse` envelope for `Edit`, `Write`, `MultiEdit` or `NotebookEdit` | The per-file checks on `tool_input.file_path`, or `notebook_path` |
| a `Stop` envelope | The per-file checks on the working tree's changes against `HEAD`, plus `cite check` over every page with citations. `term check` and the graph run too when a collection document changed or was removed, since they read nothing else. A clean tree runs nothing. |

Positional paths win over an envelope. Unlike `meta validate`, `-` is not
read, because stdin carries the envelope and the checks read files on disk.

### Hook-envelope detection

A hook envelope is a JSON object on stdin with a `hook_event_name`. Detection
is by content, not by flag. When stdin is a terminal, or holds no such object,
`check` behaves as it does for a person. When it holds one, the envelope does
two things. It narrows the scope as the table above says, and it switches the
output to the Claude Code hook protocol.

The protocol matters because exit 2 means "block" to a hook. Operational
errors must never use it.

| Situation | Exit | Output |
|---|---|---|
| After an edit, errors | 2 | stderr, `manni found errors in docs/limits.md. Fix them before you continue.`, then the failing checks' pretty reports with color off |
| After an edit, a check could not run | 0 | stdout, a `hookSpecificOutput` object with `additionalContext` naming the check and its first error line |
| Before stopping, errors, `stop_hook_active` false | 0 | stdout, `{"decision":"block","reason":"..."}` with the report |
| Before stopping, errors, `stop_hook_active` true | 0 | stdout, a `systemMessage` saying errors remain after one repair pass. The agent stops and the user sees it. |
| Clean, not a member, no config, nothing set up | 0 | nothing |

One repair pass bounds the loop. `stop_hook_active` is true on the second
stop, so a failure that predates the session cannot hold an agent forever.

### `manni check` outside a hook

| Option | Meaning |
|---|---|
| `[paths...]` | Files, directories and globs. The per-file checks run on the collection members among them. |
| `-c, --config <path>` | Config file, instead of discovery |
| `-f, --format <format>` | `pretty` (default), `json` or `github`. Not read under an envelope. |
| `--no-color` | As in every domain, and `NO_COLOR` |

Exit 0 means clean, 1 means errors, 2 means an operational error. The report
goes to stdout and notices go to stderr.

```
meta validate
docs/limits.md
  ✖ /description  must have required property 'description'

cite check
docs/limits.md
  ✖ source-changed  line 14 cites src/limits.ts#L8-L12, which changed since a1b2c3d

skipped  lint check   no lint: section
skipped  term check   no terms in any collection

4 checks over 142 files: 2 failed, 2 skipped
```

`-f github` is each domain's own `github` output, concatenated. `-f json`
prints one object, and each `report` is that domain's own JSON, unchanged.

```json
{
  "status": "fail",
  "files": ["docs/limits.md"],
  "checks": [
    { "command": "meta validate", "status": "fail", "report": {} },
    { "command": "cite check", "status": "pass", "report": {} },
    { "command": "lint check", "status": "skipped", "message": "no lint: section" }
  ]
}
```

A check's `status` is `pass`, `fail`, `error` or `skipped`. The last two carry
`message` in place of `report`. The top-level `status` is `pass` or `fail`,
and any `error` makes the exit code 2.

| Message (stderr) | Exit |
|---|---|
| `Skipped 1 file outside every collection: README.md` (a notice, and the run continues) | unchanged |
| `No manni.config.yaml found from <cwd> up to the repository root. manni check runs the checks it sets up.` | 2 |
| `Nothing is set up to check in manni.config.yaml. manni status says what each domain needs.` | 2 |
| `manni lint check could not run: <its error>` (that check becomes `error`, the others still run) | 2 |
| `error: option '-f, --format <format>' argument 'sarif' is invalid. Allowed choices are pretty, json, github.` | 2 |

### `manni status`

It says what is set up, and so what `check` will run.

| Option | Meaning |
|---|---|
| `-c, --config <path>` | Config file, instead of discovery |
| `-f, --format <format>` | `pretty` (default) or `json` |

It always exits 0, except with no config, which exits 2 with the message
`check` uses.

```
manni 4.4.0   config manni.config.yaml   collection site (142 files)

meta       in play       meta: section
cite       in play       12 pages carry citations
lint       not set up    no lint: section
docevals   in play       docevals: section
term       in play       38 terms
graph      in play       graph: section
a11y       not checked   run manni a11y check against a running site
tracevals  not checked   run manni tracevals run over sessions
```

In JSON the shape is `version`, `config`, `collections` as `{ name, files }`
objects, and `domains` as `{ name, status, reason }` objects. A domain's
`status` is `in-play`, `not-set-up`, `not-checked` or `unknown`. A domain
that cannot read its own setup is `unknown`.

Under a `SessionStart` envelope, stdout becomes the agent's context. With no
config it prints nothing. Otherwise it prints the table, then three lines that
say when `check` runs and which skill repairs a finding. It also appends
`export MANNI_GENERATED_BY=<model>` to `$CLAUDE_ENV_FILE`, only when the
envelope carries `model`, `CLAUDE_ENV_FILE` is set, and `MANNI_GENERATED_BY`
is not already set.

### The plugin, `plugin/manni/`

The plugin replaces `plugin/tracevals/`, and its name changes from
`manni-tracevals-capture` to `manni`. It had no marketplace entry and no
install docs, so no one installed it by name. The rename breaks nobody.

```sh
claude plugin marketplace add hawkeyexl/manni
claude plugin install manni@manni
```

A project offers it to contributors from `.claude/settings.json`, with
`extraKnownMarketplaces.manni` pointing at GitHub `hawkeyexl/manni` and
`enabledPlugins["manni@manni"]` set to true. The hooks call `npx --no
@hawkeyexl/manni`. Where manni is not installed they fail fast and print
nothing.

| Event | Matcher | Command | Timeout (s) |
|---|---|---|---|
| SessionStart | `startup` | `npx --no @hawkeyexl/manni tracevals capture` | 60 |
| SessionStart | all | `npx --no @hawkeyexl/manni status` | 30 |
| PostToolUse | `Edit\|Write\|MultiEdit\|NotebookEdit` | `npx --no @hawkeyexl/manni check` | 120 |
| Stop | all | `npx --no @hawkeyexl/manni check` | 600 |

| Skill | Job |
|---|---|
| `setup` | Install `@hawkeyexl/manni` as a dev dependency. Write `manni.config.yaml` with a `collections:` entry for the docs it finds. Ask which domains to set up. End with `manni status` and `manni check`. |
| `check` | Run `manni check` and walk the findings |
| `fix` | Map each finding to its repair. Never loosen a schema, config or eval to pass, and never `--accept` a citation unread. |
| `evals` | Author evals with `docevals generate`, `fill` and `promote`, and `tracevals fill` for agent artifacts. Show the diff for review. |

The plugin has no subagents, no MCP server and no `userConfig`. The root
`.claude-plugin/marketplace.json` names the marketplace `manni` and lists one
entry, `{ "name": "manni", "source": "./plugin/manni" }`, with no version.
`plugin.json` keeps the version, which `docs:sync-versions` already syncs.

## Alternatives considered

### A script in the plugin

A plugin-side script could loop over the domains and call each. It is
rejected because only manni knows two things. It knows whether a file belongs
to a collection. It knows where a page's schema came from, so it can tell a
default from a declared one. A script would guess at both, and a wrong guess
blocks an agent on a file the project never meant to check. It would also be
a second implementation of the gate, reachable by agents alone.

### An `agent` domain

`manni agent check` would keep the umbrella clean. It is rejected because
humans and CI need the same command. A person who runs `manni check` and an
agent whose hook runs it must reach the same verdict. A second command for
agents invites two verdicts. The agent-specific part is only the hook
protocol, and it is detected rather than switched.

### Blocking on every domain

Running every domain by default would need no in-play rule. It is rejected
because defaults would block unset-up repos. Meta's built-in schemas would
fail pages in a repo that only uses docevals. A tool that blocks an agent on
checks nobody chose teaches users to disable the plugin.

## Stress test

1. **A repo with only `docevals:`.** An untyped page with no description
   passes, because meta is not in play. Status shows meta as not set up.
2. **An edit to `CLAUDE.md`.** It is not a collection member, so nothing runs
   and nothing is printed.
3. **A Stop with a clean tree.** No per-file check runs. Set-wide checks
   still run, because a source edit made earlier can drift a citation.
4. **A failure that predates the session.** The agent is blocked once. On the
   second stop `stop_hook_active` is true, and the user sees a message.
5. **A check that cannot run.** Under a hook the agent gets context and is not
   blocked, because exit 2 would block it for manni's own fault. By hand the
   run exits 2.
6. **`manni validate`.** It still answers with where the command went. A
   top-level `check` does not reopen that door.
7. **Positional paths under an envelope.** Paths win, so a script that pipes
   an envelope and names files gets the files it named.

## Open questions

- **The docs section name `family/`.** The alternative is to place the pages
  under Get started. The section name follows `key/`, the first family
  resource, and can change before the pages publish.
- **Swapping this repo's `docs.yml` for `manni check`.** That follows once a
  parity run shows the same verdict. This repo's graph step also asserts
  manifests, which `check` does not.
- **Dogfooding the plugin in this repo.** It needs a built `dist/` for `npx
  --no` to find, so it waits on a decision about how the repo runs its own
  build.
