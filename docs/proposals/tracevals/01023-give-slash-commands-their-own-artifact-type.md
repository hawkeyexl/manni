---
status: accepted
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
---

# Give slash commands their own artifact type, and let the filesystem say what a `/name` is

## Context and Problem Statement

`.claude/commands/*.md` are frontmattered markdown whose body Claude Code injects as a prompt. That
is the same shape as a skill, and exactly what this tool exists to check. They were invisible:
`ArtifactType` was `"skill" | "agent" | "project-rules"`, so a command declaring `metadata.evals` was never
discovered, never resolved, and never graded.

The blindness was not merely an absence. The adapter turns **every** `<command-name>` injection into
a `skillInvocation`, so resolution looked for a `SKILL.md` and, finding none, reported a warning and
a `not-offered` **skill** row. ADR 01016 recorded this as a known limitation. On a real session
`/model` and `/code-review` read as skills that were never on the roster. That is a confident
accusation of a configuration bug that does not exist. It also rejected the obvious patch, a
hard-coded list of built-in command names, because that list goes stale with every Claude Code
release. So what *is* a `/name`, and who is allowed to decide?

### What is knowable, verified against real sessions

A survey of the 74 project stores on a real machine settled the shape.

- **The transcript records the name and nothing else.** Every injection is the three tags
  `<command-name>`, `<command-message>`, and `<command-args>`. Never the command's body, never its
  frontmatter, never a path. So the adapter cannot classify; only a filesystem lookup can.
- **All three cases occur in the wild, in one corpus.** `/monitor-pr`, `/x`, `/update-template`,
  `/synthesize-feedback` are project command files; `/writing-toolkit:identify-ai-tells` and
  `/doc-detective:doc-detective-init` are plugin **skills** typed in their slash form; `/model`,
  `/compact`, `/install-github-app` are built-ins with no file anywhere.
- **The names collide with the skill namespace deliberately.** A skill is offered as a slash command
  by Claude Code itself, so `/name` resolving to a `SKILL.md` is the ordinary case, not an edge one.
- **`plugin:command` is the plugin namespace, and subdirectories are not a namespace.** Of the 43
  command files in the plugin store, none nests. Claude Code's own convention is that
  `commands/release/tag.md` is still invoked as `/tag`, the subdirectory organizing rather than
  renaming. Both shapes are therefore handled, and neither is inferred from the other.
- **A command's frontmatter is consumed by the CLI itself.** `description`, `argument-hint`,
  `allowed-tools`, and `disable-model-invocation` appear on 43 of 43 files and are acted on by
  Claude Code. The transcript shows the *body* arriving as the prompt and the frontmatter nowhere.
  That single fact decides how `fill` may treat these files.

There is no roster of slash commands in the transcript at all. `skill_listing`, `agent_listing_delta`,
and `deferred_tools_delta` (ADR 01016) have no counterpart for commands.

## Decision Drivers

- The trace adapter must stay a pure parse of trace content (ADR 01003). Anything that needs the
  filesystem belongs in resolution, where the search is recorded and degradation is already the rule.
- A stale answer is worse than an absent one. Any rule that needs a maintained list of Claude Code's
  built-ins is wrong on the day Claude Code ships a new one.
- The report must not manufacture a configuration accusation out of evidence that was never
  collected. This is the same principle that makes `recorded: false` mean *unknown* rather than
  *zero* in ADR 01016.
- No verdict on the fixture corpus may move except the ones that were wrong.
  `schemas/artifact-evals-1.0.0-proposal.1.json` is docmeta's, vendored byte-identical (ADR 01010),
  so nothing here may add an eval field. Nothing here needs to.
- `ALLOWED_GRADERS` and `TYPE_GUIDANCE` are `Record<ArtifactType, …>`, so widening the union makes
  the compiler name every decision that has to be taken rather than letting one be forgotten.
- `fill` writes by default (ADR 01005), so any convention it recognizes must be narrow. It cannot be
  allowed to edit prose that merely lives in a directory called `commands`.

## Considered Options

Who decides what a `/name` is:

- The filesystem, in resolution, trying commands then skills then concluding built-in
- The adapter, from the shape of the name
- A maintained list of Claude Code's built-in command names

What the eval window is:

- The injection's own span, up to the next injection, which is the skill rule
- The whole session
- A per-eval declaration

How `fill` treats a command file:

- Writable, like a skill and an agent
- Propose-only, like project rules

What an unresolvable `/name` reports:

- A `slash-command` coverage row with a note, and no warning
- A `slash-command` coverage row with a warning, as skills get
- Nothing at all

Whether the trace model gains a `slashCommands` list:

- No, because `SkillInvocation.via` already carries the distinction
- Yes, a parallel list on `Trace`

## Decision Outcome

The chosen option has six parts. **Add `"slash-command"` to `ArtifactType`. Let resolution decide
which of three things a `/name` is by looking for the file. Window it exactly as a skill. Make it
writable by `fill`. Report an unresolvable one as a built-in without a warning. Add no field to
`Trace`.**

### Three cases, told apart by a search rather than by a list

`resolveArtifacts` splits on `SkillInvocation.via`, which the model has carried since the adapter was
written and which nothing downstream had ever read. A `skill-tool` entry is a `Skill` tool call and
is unambiguously a skill. A `command-injection` entry is a **slash command**, and is resolved:

| Step | Looked for | Outcome |
|---|---|---|
| 1 | `<project>/.claude/commands/<name>.md`, then `<home>/.claude/commands/<name>.md` | a `slash-command` artifact |
| 2 | the same two directories, searched recursively | a `slash-command` artifact, since an organizing subdirectory does not rename the command |
| 3 | the full skill order (ADR 01003's five locations) | a **`skill`** artifact, deduplicated against any `Skill` tool call of the same name |
| 4 | nothing left | a `slash-command` coverage row noted as built-in |

A `plugin:command` name skips steps 1–2 and searches `~/.claude/plugins/**/commands/<name>.md`,
filtered on a `commands` path segment and the plugin name, which is the rule `resolveSkill` already
uses for `plugin:skill`. Project and user directories are not consulted for a namespaced name,
because a namespace is not something a local file can claim.

**Step 4 is an inference from absence, and that is the point.** Claude Code's built-ins have no
definition file by design. So "we looked everywhere a command or a skill could live and found
nothing" is the strongest true statement available. The note says
`built-in slash command, or not installed here (no definition file)` rather than asserting only the
first half. The row keeps its full `tried` list, so a command that genuinely *is* missing on this
machine stays diagnosable. It emits **no warning**: a built-in is the expected outcome, and warning
on `/model` in every session is precisely the noise this change removes.

**No roster state is attached.** `coverAvailability` now skips `slash-command` rows the way it skips
`project-rules` rows. There are no listing records for commands, so `not-offered` would be a claim
about evidence that was never collected. Making that claim anyway *was* the defect ADR 01016
recorded. This closes it.

### The window is the skill window, because the mechanism is the same

A slash command injects an instruction set at a point in the session and is superseded when the next
one takes over. That is ADR 01015's skill rule verbatim, so `skillWindow` and `slashCommandWindow`
are one function differing only in what opens the window:

| Artifact type | Window |
|---|---|
| skill | each invocation (`Skill` tool call **or** slash form) to the next injection, or end of session |
| slash-command | each `<command-name>` injection to the next injection, or end of session |

The boundary set is the union of both, which is what it already was, so **no skill window moves**. A
`Skill` tool call can close a command's window but never opens one. The tool is not the
slash-command mechanism, and letting it open the window would grade a command against turns nobody
ran it for.

ADR 01015's invariant carries over unchanged: an empty window is `skipped` with its reason, never a
pass. The reason names the command with its slash, so a reader is not left wondering which namespace
it came from.

### `fill` writes them, and the distinction is frontmatter, not readership

ADR 01005 keeps project rules propose-only because "criteria inside a file the agent reads before
acting are teaching to the test". More decisively, a rules file's **frontmatter is injected
verbatim**. A skill's is not: Claude Code parses it and surfaces only `name` and `description`,
which is why skills have always been writable.

A slash command sits on the skill side of that line, and the transcript proves it. The injected user
record carries the three command tags and nothing else, while `allowed-tools` is *enforced* rather
than shown. The CLI consumes the frontmatter; only the body becomes the prompt. So a
`metadata.evals` block in a command file cannot reach the session under test. `fill` treats these
files exactly as it treats skills, appending an `eval-provenance` entry naming the model and its
confidence.

`ALLOWED_GRADERS["slash-command"]` is the skill list unchanged: `ai`, `tool-usage`, `file-access`,
`regex`. The reasoning transfers whole. `cost` and `json-output` are whole-session graders whose
numbers are not attributable to a slice. `turn-count` stayed out of every allowlist as its own
decision. `skill-invoked` is excluded on the same ground it is excluded from skills. An artifact
asserting that it was itself invoked can only be graded in sessions that invoked it, so it is
permanently green. `skill-invoked` also cannot name a command at all, which would make the trap
quieter rather than louder.

Discovery is deliberately narrower than classification. `classify()` treats any `.md` under a
`commands` directory as a *candidate*; `isRecognizedSlashCommand()` then requires the `.claude/commands`
prefix relative to the scanned anchor. That is the same two-step `isRecognizedAgent` uses, for the
same reason. `fill` writes by default, and matching every directory named `commands` would edit a
docs page about a CLI. `nameFor()` returns the filename stem, so a discovered command and a resolved
one are the same string and `aggregate`'s `type:name` key lines up across runs.

### `Trace` gains nothing

`SkillInvocation.via` already distinguishes the two mechanisms exactly. A parallel `trace.slashCommands`
list would duplicate the same records. It would force every synthetic `Trace` literal in the suite
to grow a field. That would be the fourth time in this stack (ADR 01013, 01014, 01016). And it would
buy nothing that a one-field filter does not. The type's doc comment now says what `via` means for
consumers, which is the change that was actually missing.

`PROMPT_VERSION` and `FILL_PROMPT_VERSION` are both unchanged. The judge prompt is untouched, and the
fill prompt is byte-identical for every pre-existing artifact type. A slash command is a new value
of `artifactType`, which is already a cache-key component. Its entries are new keys rather than
stale ones.

### Consequences

- Good, because the blind spot is closed in both directions at once. A command's declared evals are
  now graded, and a built-in stops being reported as a missing skill. The fix is structural, so it
  cannot go stale the way a list of built-in names would.
- Good, because it is retroactive. Every session already on disk gets the better answer. The real
  session that motivated ADR 01016's limitation now reports `/model` and `/code-review` as
  `slash-command` rows with **zero warnings**. It previously produced two "no SKILL.md was found"
  warnings and two `not-offered` skill rows.
- Good, because no skill or agent verdict on the fixture corpus moved. The boundary set that closes a
  skill's window is what it always was, and `forbidden-tool` still reports `used 1 time(s)`.
- Good, because the compiler named every site: `ALLOWED_GRADERS`, `TYPE_GUIDANCE`, and `windowFor`'s
  dispatch each had to be decided rather than defaulted. `windowFor` in particular would otherwise
  have fallen through to the whole session, which is the false-pass shape ADR 01015 exists to prevent.
- Bad, because "built-in" is an inference from absence. A *project* command that exists on another
  machine reads as a built-in here rather than as a gap. The note names both possibilities and the
  `tried` list is intact, but the loud signal a missing skill gets is gone. That is the price of not
  maintaining a list, and it is the cheaper error. The old behavior was wrong on every session that
  used `/model`. This one is imprecise only on a session run against a checkout that is missing
  a command file.
- Bad, because a `/name` that is *both* a project command and a skill resolves to the command, and
  nothing warns about the shadowing. Claude Code's own precedence here is not documented, and guessing
  it would be worse than picking the directory the mechanism owns.
- Bad, because a command invoked only inside a subagent branch is windowed to that branch's chain,
  which is correct. But a command whose work is *delegated* immediately contributes its subagent's
  tool calls without its turns. That is inherited from ADR 01015 rather than introduced here.
- Neutral, because output styles were considered alongside commands and left out. They are not
  injected as instructions at a point in the session, so the window rule would not transfer. Hooks
  stay out on the ground the roadmap gives: JSON configuration, not instruction prose.

### Confirmation

`test/unit/artifacts.test.ts` pins all four resolution branches against the committed corpus. Those
are a project command from `.claude/commands`, and a plugin command from the store. The third is a
`/name` that resolves to a `SKILL.md` and stays a **skill** row. The fourth is a built-in producing a
`slash-command` row with a note, no skill row, and no warning.

`test/unit/graders/window.test.ts` pins the window in both directions. It is closed by the next
injection, and *not* opened by a `Skill` tool call of the same name. That call is the one way a
command could be graded against turns nobody ran it for.
`test/unit/artifact-availability.test.ts` pins that no
slash-command row ever carries a roster state and that none of them move the counts.
`test/unit/discover-artifacts.test.ts` pins `.claude/commands` at any depth, the bare name of a
nested command, and that prose under `docs/commands/` stays out of a tree `fill` would write to.
`test/unit/fill.test.ts` pins that a command is filled rather than propose-only, provenance included.

The corpus proves it end to end. `test/fixtures/project/.claude/commands/ship-it.md` declares evals
and `test/fixtures/traces/claude-session.jsonl` invokes it. The invocation comes after two `Bash`
calls that both fall outside its window. So `no-shell-during-release` passing is the windowing
assertion rather than an accident. The same trace invokes `/model`, which resolves to nothing, and
`/writing-toolkit:identify-ai-tells`, which resolves to a plugin `SKILL.md`: all three cases in one
session. `.github/workflows/ci.yml` asserts each row's `kind`, the built-in's absent `availability`
and absent warning, and both windowed verdicts. On the `fill` steps it asserts that the command is
discovered and written while project rules stay propose-only.

## Pros and Cons of the Options

### The filesystem decides, in resolution

- Good, because it is deterministic, recorded (`tried`), and degrades to a coverage note rather than
  a crash. That is the contract ADR 01003 already set for every other reference.
- Good, because it handles the case nobody would have hard-coded. A skill invoked by typing its slash
  form is how Claude Code surfaces skills, and therefore common.
- Bad, because the answer depends on the machine running the evaluation. A project command missing
  from this checkout is indistinguishable from a built-in.

### The adapter decides from the shape of the name

- Good, because it needs no filesystem access and would work identically everywhere.
- Bad, because the shape carries no such information. `plugin:x` is a plugin skill *and* a plugin
  command; a bare name is a project command *and* a skill *and* a built-in. There is nothing to read.

### A list of built-in command names

- Good, because it names the built-ins precisely and could warn confidently on everything else.
- Bad, because it is wrong the day Claude Code adds a command, and wrong silently. A new built-in
  would surface as a missing artifact, which is the failure this change removes. ADR 01016 rejected
  it on the same ground before the type existed.

### The whole session as a slash command's window

- Good, because it needs no new branch in `windowFor`.
- Bad, because it is the exact false pass ADR 01015 was written to eliminate. A command that ran at
  the end of a session would be certified by everything that happened before it. And a `not-used`
  eval would fail on a tool call from an hour earlier.

### A per-eval declared window

- Good, because an author could scope a command's eval unusually.
- Bad, because `inlineEval` is `additionalProperties: false` in a vendored copy of docmeta's schema.
  The field does not exist, and could not ship here without an upstream proposal. The type
  already answers the question, as ADR 01015 argued.

### Propose-only, like project rules

- Good, because it is the conservative default, and a command file is closer to a prompt than a skill
  is.
- Bad, because it would misread ADR 01005's actual reason. The hazard there is frontmatter injected
  *verbatim* into the model's context. A command's frontmatter is consumed by the CLI, so the
  rubric never reaches the session. Commands are short and procedural, so they are the artifact type
  whose evals people most want bulk-authored. Refusing to write would leave them permanently manual,
  for a risk that the transcript shows does not exist.

### A warning on an unresolvable slash command

- Good, because a genuinely missing project command would be loud.
- Bad, because built-ins are common and files are not, so the warning would fire mostly on correct
  sessions. A signal that is wrong most of the time trains readers to ignore it, which costs more
  than the case it catches.

### A `slashCommands` list on `Trace`

- Good, because a consumer would not have to know that `via` is the discriminator.
- Bad, because it duplicates records already in `skillInvocations`, and the window rule needs the two
  interleaved anyway to compute boundaries. The list would have to be re-merged at every use.
- Bad, because `Trace` is a public contract via `src/index.ts` and every synthetic literal in the
  suite would grow a field, for the fourth time in this stack.
