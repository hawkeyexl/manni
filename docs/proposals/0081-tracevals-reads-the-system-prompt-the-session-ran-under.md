# 0081: tracevals reads the system prompt the session ran under

- **Status:** Proposed
- **Serves:** Maya · M25, "Catch a broken rule before the agent hands back".
  It adds the instructions the agent gets before any file it reads.
- **Depends on:** [0079](0079-tracevals-checks-each-turn-against-the-rules-it-read.md)
  and [0080](0080-tracevals-holds-a-session-to-what-it-was-asked-and-the-procedures-it-ran.md),
  for the sources table, the judge and the session view.
- **Relates to:** [0049](0049-tracevals-domain.md), for the trace adapter.
- **Touches:** `src/tracevals/rules/sources.ts`, `src/tracevals/rules/judge-prompt.ts`,
  `src/tracevals/rules/judge.ts`, `src/tracevals/commands/check.ts`,
  `src/tracevals/reporters/conformance.ts`, `src/family/commands/check.ts`,
  `src/tracevals/core/config-schema.json`, `docs/src/content/docs/tracevals/`
- **Verdict:** The system prompt becomes a rule source, read from the snapshot
  Claude Code records in the transcript. Rules from Claude Code's own prompt are
  reported and never block. A prompt the user wrote blocks like any rule. That
  covers a replaced system prompt and a user output style.

## Problem

### Maya, with a custom system prompt

Maya runs her agents with an output style of her own. It says to cite a file
and line for every claim about the code. She also runs a CI job with
`claude -p --system-prompt-file review.md`, whose prompt says to never edit
files. tracevals checks the turn against `CLAUDE.md`, the skills and her
requests. It never reads either prompt. The agent edits a file in review mode,
and nothing catches it.

### What the transcript records

From Claude Code 2.1.260, the session file records the system prompt. A
`prompt_snapshot` attachment holds a `systemPrompt` array of text blocks.

- **When it is written.** Snapshots come in pairs, at session start, and again
  after a compaction or a resume.
- **How it reaches tracevals.** The trace adapter keeps attachments as `meta`
  events with the whole record, so the snapshot is already in the trace.
- **How much it changes.** Its blocks are byte-identical across sessions of one
  version. The Memory block alone differs, and only per project.

Five probe sessions showed how a custom prompt lands. Each ran `claude -p` on
2.1.292.

| Run | What the snapshot shows |
|---|---|
| Default | 12 blocks. Block 1 is Claude Code's `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` marker. |
| `--append-system-prompt "…"` | The default, plus the text as a last block. Nothing names the flag. |
| `--append-system-prompt-file probe.md` | The same, with the file's text as the last block. Nothing names the file. |
| `--system-prompt "…"` | 2 blocks: the text, then Claude Code's block on web search. The boundary marker is gone. |
| A project output style | No block holds its text. An `output_style_instructions` attachment carries `{name, prompt}`, and block 0 changes. |

So two kinds of custom prompt can be told apart from the default, and one
cannot.

- **A replaced prompt.** The boundary marker is missing.
- **A user output style.** The attachment names a style that a user file
  defines.
- **An appended prompt.** It is a last block with no name. The desktop app
  appends a block of its own the same way. So an appended block cannot be told
  from Claude Code's.

## Decision

### Two sources from the transcript

| Format | Content | In scope when | Blocks? |
|---|---|---|---|
| `system-prompt` | The `systemPrompt` blocks of the last `prompt_snapshot` at or before the turn, joined | Always, when the transcript records one | Only when it is custom, meaning its boundary marker is missing |
| `output-style` | The `prompt` of the last `output_style_instructions` at or before the turn | When it names a style a user file defines | Yes |

- **User style files.** A user output style is a file under the project's
  `.claude/output-styles/` or the user's `~/.claude/output-styles/`. Its
  frontmatter `name`, or its file name, matches the attachment's `name`. Claude
  Code's own styles have no such file. Their text joins the `system-prompt`
  source, as default.
- **Paths.** The `system-prompt` path is `system-prompt`. The `output-style`
  path is the style file's display path, and its content is the text the
  attachment recorded, which is what the agent saw.
- **Triggers.** `system-prompt` reads `recorded at turn <ordinal>, Claude Code
  <version>`, with `, custom` added when the marker is missing.
  `, Claude Code <version>` is left out when the snapshot record has no
  version. `output-style` reads `style <name>`.
- **No snapshot.** A session before 2.1.260, or from another agent, has none.
  Nothing is configured, because the source is detected.
- **Redaction and extraction.** The judge's redactor runs before extraction,
  because the Memory block names a path under the user's home. It scrubs an
  output style's text too. Extraction uses
  the rules prompt with no new version, since the system prompt governs the
  agent. It is cached by the sha256 of the redacted content, so one version in
  one project pays once.

### Reported, not blocking

A finding gains `severity`, from the family's scale in `src/shared/severity.ts`.

- A rule from a source that blocks is `error`. That is every source 0079 and
  0080 read, a custom `system-prompt`, and an `output-style`.
- A rule from the default `system-prompt` is `warning`. Its break is reported,
  and never blocks.
- `--format json` carries `severity` on every finding, and `summary` gains
  `reported`, the count of `warning` breaks. `summary.fail` counts `error`
  breaks only. `needsReview` counts the unsettled rules of both severities.

The pretty report marks a warning `!` where a break is `✖`.

```
system-prompt
  ! keep-responses-brief  Keep responses short and direct.
      not-followed 84, followed 10, not-applicable 4. The reply ran to forty lines of tables. (0.84)
```

The closing line counts warnings apart, after the needs-review count.

- `Last turn of 3b265d00: 64 rules from 7 sources. 1 broken, 1 reported.`
- `Last turn of 3b265d00: 64 rules from 7 sources. None broken, 2 reported.`

Exit 1 still means an `error` break with a confident verdict. A warning alone
exits 0. The Stop hook blocks on `error` findings only. The report its reason
embeds still shows a warning, marked `!`. The count sentence and the
repair-pass message count errors only. The ledger records a warning's verdicts
as it does any rule's.

### The judge

The system prompt gains one sentence, after the one on the user's prompts.

```text
A rule from the system prompt is a default. An instruction file, or a prompt the user typed, overrides it.
```

`TURN_JUDGE_PROMPT_VERSION` goes to 8, so no older verdict replays.

### Turning a source off

`conformance.exclude` keeps its type, a list of globs. It now also matches a
synthetic source by its exact name, never as a glob, so `**` keeps it. So
`exclude: [system-prompt]` drops the system prompt, and the names `prompt` and `plan` drop 0080's request sources. That
answers 0080's open question about an off switch.

Before:

```yaml
tracevals:
  conformance:
    exclude: []        # globs of files never treated as sources
```

After:

```yaml
tracevals:
  conformance:
    exclude: [system-prompt]   # also matches prompt, plan and system-prompt
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `conformance.exclude` | list of globs | `[]` | Files never treated as sources, in any row. It also matches the sources `prompt`, `plan` and `system-prompt` by exact name, never as a glob. |

There are no new keys, flags or exit codes.

### What does not change

The hooks, the gates, `prepare`, `release` and the ledger shape all stay as
they are. So do 0080's sources and wording.

## Alternatives considered

### Every snapshot rule blocks

Claude Code's default prompt is not the user's. It holds style rules, such as
keeping replies short, that would block turns the user never cared about. They
are worth seeing, so they are reported.

### Comparing against Claude Code's default text

tracevals could ship the default prompt and call any other block custom. That
copies text manni does not own, and it changes with every Claude Code release.

### Calling an appended block custom

The desktop app appends a block of its own, so position alone would call
Claude Code's text custom. The append flags leave no other trace.

### Every injected instruction

Hook context, MCP server instructions and auto-memory are injected into the
session too. They are left out for now. Each would raise the rule count on
every turn, and none was asked for.

## Stress test

1. **A compaction mid-session.** A new snapshot is written, and the last one at
   or before the turn is read.
2. **A resume on a newer version.** The new snapshot's blocks differ, so they
   are extracted once.
3. **A session before 2.1.260.** No snapshot, no source, no change.
4. **A `CLAUDE.md` rule that contradicts a default.** The judge's new sentence
   says the file wins, and the default's rule would only be reported anyway.
5. **A style rule broken on a chat turn.** It is reported with `!`, and the turn
   goes on.
6. **`--system-prompt-file review.md` in CI.** The marker is missing, so the
   prompt is custom, and a break blocks or fails `check`.
7. **A built-in output style.** No user file defines it, so its text is default.
8. **An excluded `system-prompt`.** It is never resolved and never extracted.
9. **Jev as the judge.** It gets the same state and options, so nothing changes.

## Consequences

- Rules the agent runs under before reading any file are now checked.
- A custom system prompt or output style is held to like any instruction file.
- Each turn judges more rules. The default prompt yields dozens.

## Known limits

- An appended system prompt counts as default, inline or from a file. It is
  reported and never blocks.
- A replaced prompt keeps Claude Code's web search block. Its rules then count
  as custom too.
- The default prompt adds many rules with no `when`. Each costs a judge call per
  Stop on a hosted model.
- The Memory block differs per project, so each project extracts it once.

## Open questions

- **Hook context and MCP instructions.** Both are injected the same way, and
  both could be sources.
- **A severity for each source.** A repo might want some file sources reported
  rather than blocking, as the default prompt is.
