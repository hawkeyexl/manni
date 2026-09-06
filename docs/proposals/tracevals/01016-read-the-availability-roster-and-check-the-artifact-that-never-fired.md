---
status: accepted
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
---

# Read the availability roster, and check the artifact that never fired

## Context and Problem Statement

Artifact resolution starts from what the trace *used*, which is `trace.skillInvocations` and
`trace.agentSpawns`. A skill that should have been invoked and was not resolves to nothing, is
planned for nothing, and appears nowhere in the report. The tool is blind to the dog that didn't
bark, and the blindness is silent. A session that ignored every skill it was given produces a
perfectly green report. Can that be fixed without a schema change, and without asking the user to
maintain a second inventory of what *should* have happened?

### What is knowable, verified against real sessions

The availability roster **is** in the transcript, stored as structured `attachment` records rather
than as the prose the model reads. A survey of the 281 session files in a real store settled the
shape. It also corrected three assumptions that would each have shipped a wrong answer.

| `attachment.type` | Records | Carries |
|---|---|---|
| `skill_listing` | 606, in 280 of 281 files | `names`, `skillCount`, `isInitial`, and `content`, which holds one `- name: description` line per skill, including scope notes like `from src/common/.claude/skills — applies when working on files under src/common/` |
| `agent_listing_delta` | 302 | `addedTypes`, `addedLines` (description plus tool grants), `removedTypes`, `isInitial` |
| `deferred_tools_delta` | 431 | `addedNames`, `removedNames`, `readdedNames`, `pendingMcpServers`, `needsAuthMcpServers`, `failedMcpServers` |

Availability is **time-varying, and the deltas capture it**. One session carries 52 `skill_listing`
records, and the common mid-session delta adds a directory-scoped skill when work moves into its
tree. Reconstructing availability at time *T* is initial-listing plus delta replay ordered by record
index, which is exactly what ADR 01013's ordinals provide. The adapter routed every one of these
records into `SESSION_META_TYPES` as an untyped `kind: "meta"` event and read nothing out of them.

**Three corrections the survey forced.**

1. **Splitting a listing line on its first colon truncates every plugin skill.** A plugin skill is
   named `plugin:skill`, so `- writing-toolkit:identify-ai-tells: Use when…` would parse as the
   name `writing-toolkit`. Matching each line against the `names` array (longest match wins)
   leaves **zero** of the corpus's 88,893 listing lines unjoined. `content` is the description
   source; `names` is the identity source, and it is the one that must not be inferred.
2. **A description is genuinely optional.** `content` is capped near 30,000 characters. Past the
   cap Claude Code emits bare `- name` lines with no description at all. One real record lists 527
   skills of which only 42 carry a description. So an absent description means *not recorded*, never
   "has none". A further 590 lines across the corpus are continuation lines of a description that
   wrapped. A naive line-per-skill parse would drop or misattribute them.
3. **The three record types do not share one delta convention.** `skill_listing` has no removal
   member at all and its `skillCount` counts *that record*, not the roster. `deferred_tools_delta`
   carries no `isInitial` whatsoever (0 of 431) and instead has `readdedNames`. Only
   `agent_listing_delta` has both `isInitial` and `removedTypes`. A single generic replay would be
   wrong for two of the three.

**Sidecar transcripts carry their own roster too**, and 401 of 401 checked do. It is a *different,
usually smaller* set than the parent's, which is a hazard rather than a bonus. Replaying a sidecar's
listing as the session's would withdraw everything the parent had, since a sidecar listing is
`isInitial` for that branch.

The roster still does not give artifact *bodies* or their hashes at session time, nor the git SHA
the session ran against. That residual is a hook's job and is deliberately not in this change.

## Decision Drivers

- The roster works **retroactively, on every session already on disk**, and travels inside the
  trace. No filesystem scan, no `MOOSE_TRACEVALS_HOME` pinning, no machine that has to match.
- `schemas/artifact-evals-1.0.0-proposal.1.json` is docmeta's, vendored byte-identical (ADR 01010),
  and `inlineEval` is `additionalProperties: false`. No eval field is available. Grader `options` is
  deliberately open. The schema says a grader validates its own options at run time, because a
  grader's options evolve on the grader's schedule. Anything expressed there is ours, and needs no
  upstream proposal.
- You cannot hang an eval on a skill that never loaded, because nothing resolves it. You *can* hang
  one on `CLAUDE.md`, which resolves for every session, and `skill-invoked` is already in
  `ALLOWED_GRADERS` for `project-rules`. The bootstrap problem dissolves.
- The existing invariant holds and has to extend again. An eval that could not be applied reports
  `skipped` with a reason, never a silent `pass` (ADR 01011, ADR 01015).
- A real roster is 274 skills. Anything that lists it by default buries the evals above it.
- ADR 01003's rule holds. A trace with no listing records is the ordinary case for older sessions
  and for stream transcripts. It must degrade to *unknown* rather than to a confident zero.

## Considered Options

Where the roster comes from:

- Parse the transcript's own `attachment` listing records
- Scan the filesystem for installed skills and agents at report time
- Ask the user to declare the expected inventory

How a conditional check is expressed:

- A `when` object inside the grader's `options`
- A new `when` member on `inlineEval`, proposed upstream to docmeta
- A new grader kind whose whole job is the conditional form

What an unmatched trigger produces:

- `skipped`, with the unmet condition named
- `pass`, nothing was violated
- `fail`, the condition is the point

What happens to a subagent's own roster:

- Fold in only the names the session never saw elsewhere, tagged with the branch
- Replay it as if it were the main chain's
- Drop it

How the three coverage states are shown:

- All three in the coverage table, with the unused ones summarised unless asked for
- A separate section for the unused ones
- One boolean per row

## Decision Outcome

The chosen option has five parts. **Parse the roster out of the transcript. Express the condition
in grader `options`. Skip an unmatched trigger. Fold a branch's roster in name-wise. Carry all three
coverage states in one table, with the unused ones behind a flag.**

### The roster is a first-class view on `Trace`

`trace.availability` holds `skills`, `agents`, `tools`, and `mcpServers`, plus `recorded`. Each entry
is **one stretch of availability**: `name`, an optional `description`, `offeredAt`, and an optional
`withdrawnAt`, both ordinals in `trace.events`. A name that is withdrawn and later re-offered
becomes two entries rather than one entry with a hole. An interval is therefore always answerable by
comparison rather than by replay, and `availableAt(entries, index)` is a filter. Per-index history is
kept because the question a later phase asks is "available when this window opened", not "available
at some point". MCP servers carry a `status` (`pending`, `needs-auth`, `failed`); tools carry no
description, because `addedLines` there repeats the tool's own name.

**`recorded: false` means unknown, not empty.** It is the load-bearing distinction. An old trace
carries no roster, and reporting "0 skills offered" would turn a missing answer into a wrong one.

Ordinals are remapped through ADR 01014's splice. That splice renumbers `index` over the merged
list, so a parse-time ordinal would otherwise point at the wrong event.

### `when` lives in grader `options`, and an unmatched trigger is `skipped`

```yaml
# on CLAUDE.md, which always resolves — so the eval is always planned
- id: docs-work-uses-the-writing-skill
  assertion: A session that edits documentation invokes the writing skill.
  grader: skill-invoked
  options:
    skill: writing-toolkit:technical-writer
    expect: used
    when:
      file-access: "docs/**"
```

| Trigger | Skill invoked | Outcome |
|---|---|---|
| not matched | n/a | `skipped`, reason names the unmet condition |
| matched | no | `fail` |
| matched | yes | `pass` |

**An unmatched trigger is never a pass**, and this is the single way the feature could have been
shipped hollow. A check that never armed has not been satisfied. A `pass` there would manufacture
green from an eval that did not run. Worse, it would do that on exactly the sessions the eval was
written to stay quiet about. The report would then look like coverage in proportion to how little
it checked.

Four predicates, all pure trace facts, all evaluated over the artifact's window (ADR 01015) and
conjoined: `file-access` (glob), `tool-used`, `prompt-matches` (regex over the window's prompts), and
`turn-count-above`. `validateOptions()` checks them without a trace, so `fill` can ground-check a
proposal (ADR 01004). **An unrecognised condition is an error rather than a silent drop.** A
tolerated `file-acess` would leave the eval armed on every session, which is the failure this grader
exists to make impossible. The same reasoning already governs the reserved `metadata.eval*` prefix in
`src/evals/extract.ts`. An empty `when: {}` is rejected for the same reason `requireOneOf` exists: it
arms always while reading as a scoped check.

The glob is ~40 lines in `src/graders/glob.ts` rather than a dependency. It needs `**`, `*`, and `?`
over already-normalized paths. It matches at a path-segment boundary the way `file-access`'s suffix
compare already does, so `docs/**` means the same thing wherever the checkout lives.

### A subagent's roster is folded in by name, never replayed

Only names the session never saw elsewhere are added, anchored at the spawn, tagged with `branchId`,
and never withdrawn. That keeps the main chain's intervals exact. It also lets "was this ever on
the menu?", the only question coverage asks, answer correctly for a skill offered to a subagent
alone.
Without it, a skill a subagent invoked would be reported as *not offered*, which is a confident
accusation of a configuration bug that isn't there.

### Three coverage states, in one table, and never an eval outcome

| State | Meaning | Shown |
|---|---|---|
| `offered-and-used` | The ordinary case. | Unlabelled row |
| `offered-not-used` | A judgement call for a person. | Counted; listed with `--report-unused-artifacts` |
| `not-offered` | Referenced but never on the roster. | Labelled row |

`not-offered` is the state that is invisible today and the one that wastes an afternoon. It is a
**configuration** bug, not an adherence failure. A reader who cannot tell it from "offered and
ignored" goes looking in the wrong file. `offered-not-used` is summarised by default, because 274
rows would bury the evals. The flag flows through the resolved config as
`tracevals.reportUnusedArtifacts`, per CLAUDE.md's config↔CLI pattern.

An offered-but-unused row reports `resolved: false` with `tried: []` and renders as `n/a`, not
"not found". Nothing was ever looked for on disk, so claiming a failed search would be a claim about
something that never happened. Its note carries the roster **description**, which is the point. That
description is the criterion Claude Code itself uses to decide whether to invoke.

**None of this is an eval outcome and none of it moves the exit code.** It is not in `summary`, and
the report is byte-identical in `exitCode` and `summary` with and without the flag.

**The opt-in `skill-considered` judged eval is deliberately left out.** Handing a judge the
descriptions of every offered-and-unused skill is the one place an LLM would genuinely beat a rule.
It is also the eval most likely to be noisy, and it costs inference proportional to roster size.
It belongs in its own change, once there is a calibration corpus to measure its noise against.

`discoverArtifacts` stays out of this path: it is deliberately project-scoped for authoring, and the
roster makes a filesystem scan unnecessary here anyway.

### Consequences

- Good, because the negative space is checkable for the first time. That needs no new field, no
  upstream proposal, and no second inventory for anyone to maintain.
- Good, because it works on every session already recorded. The evidence travels inside the trace, so
  a run on another machine gets the same answer.
- Good, because "skill X was available, described as *Y*, and was never invoked" is now a **trace
  fact** rather than an inference. That is what makes it safe to report.
- Good, because the roster surfaces MCP servers that were pending, unauthorized, or failed. A
  session that could not reach a tool no longer looks like a session that chose not to.
- Bad, because the roster is only as good as what Claude Code recorded. Its listing text is
  budget-truncated, so on a large roster most descriptions are simply absent. The report then says
  "offered, never used" with nothing after it.
- Bad, because `trace.availability` is required, so every synthetic `Trace` literal in the suite grew
  a field. That is the third time an ADR in this stack has widened the model (01013, 01014, and now
  this).
- Bad, because a conditional eval hung on `CLAUDE.md` is graded against the whole session. Its
  trigger cannot distinguish "the docs edit happened while the writing skill was loaded" from "both
  happened in this session". A tighter answer needs the window to be declarable, which ADR 01015
  deliberately refused.
- Bad, because `not-offered` fires on a name mismatch as loudly as on a real misconfiguration. An
  agent renamed between the session and now reads as "never on the menu".
- Bad, because a **built-in slash command reads as a not-offered skill.** The adapter turns every
  `<command-name>` injection into a `skillInvocation`, so `/model` and `/code-review` on a real
  session are reported as skills that were never on the roster. It is not *wrong*. They are not
  skills and the roster correctly does not list them. The row already carries "not found (5
  location(s) tried)" beside it. The pair therefore reads as "this reference is not a skill" rather
  than as a misconfiguration. Fixing it properly means giving slash commands their own
  `ArtifactType`, which is a separate change. A hard-coded list of built-in command names would go
  stale with every Claude Code release. **Closed by [ADR 01023](01023-give-slash-commands-their-own-artifact-type.md):** a
  `<command-name>` injection now resolves to a command file, a skill, or a built-in by looking for
  the file. A `slash-command` row carries no roster state at all, because the transcript keeps no
  roster of commands for it to be missing from.
- Neutral, because `deferred_tools_delta` carries no descriptions, so the tool roster is names only.
  That is enough for availability, and not enough to judge whether a tool *should* have been used.
- Neutral, because the judge digest is unchanged: the roster is not rendered into the prompt, so no
  cache entry moves and no `PROMPT_VERSION` bump is needed.

### Confirmation

`test/unit/trace-availability.test.ts` pins the parse against each real record shape. That is the
`plugin:skill` join, a wrapped description, an absent one, delta-versus-initial replay, and an agent
removal. It also covers a tool removed and readded producing two intervals, MCP status, and a
malformed record parsing to nothing rather than throwing. The invariant that matters most is a trace
with no listing records reporting `recorded: false` rather than zero.

`test/unit/graders/when.test.ts` pins all three trigger states explicitly. That covers an unmatched
trigger returning `skipped` and neither `pass` nor `fail`, and the empty-window reason outranking
the trigger reason. It also covers each predicate in both directions, conjunction, and every
validation rejection, including the unknown-condition one. `globToRegExp` is pinned against
segment-boundary matching, `docsite/` not matching `docs/**`, and regex metacharacters staying
literal.

`test/unit/artifact-availability.test.ts` pins the three states, the summary counts, dedupe across
re-offered names, and the unknown case. `test/unit/reporters.test.ts` pins that an unused row never
says "not found", and that the summary reads "unknown" rather than "0 offered". It also pins that
the markdown table keeps its column count.

The committed corpus proves it end to end, and the CI dogfood gate asserts it.
`test/fixtures/traces/claude-session.jsonl` now carries an initial `skill_listing`,
`agent_listing_delta`, and `deferred_tools_delta` before the first prompt. It adds a mid-session
`skill_listing` delta adding a directory-scoped skill. The roster deliberately **omits `doc-writer`**,
which the session spawns anyway, so the fixture exercises all three coverage states at once. The
workflow asserts the armed trigger passing and the unarmed one skipping with a trigger-not-met
reason. It asserts `fix-bug` as `offered-and-used`, `doc-writer` as `not-offered`, and the counts.
It asserts that unused artifacts are summarised by default. A step of its own asserts that
`--report-unused-artifacts` lists exactly the four expected refs with their descriptions, and
without claiming a filesystem search. That step leaves the exit code alone.
`claude-session-sidecar.jsonl` carries a main-chain listing after the splice
point and a branch-only skill inside a sidecar, pinning both the ordinal remap and the fold.

## Pros and Cons of the Options

### Parse the transcript's own listing records

- Good, because it is deterministic, needs no environment access, and is retroactive to every session
  already on disk.
- Good, because it records what the session was *actually* offered, including scope-conditional
  skills that a filesystem scan would either miss or wrongly include.
- Bad, because it is an undocumented internal format that can change, and a change would be silent.
  The roster would simply stop being recorded, which reads as an old trace.

### Scan the filesystem for installed artifacts

- Good, because it needs nothing from the trace.
- Bad, because it answers a different question: what is installed *now* on *this* machine, not what
  the session was offered then. Directory-scoped skills make the two genuinely different sets.
- Bad, because it makes the report machine-dependent, which is the trap ADR 01003 already refused.

### Ask the user to declare the expected inventory

- Good, because intent is explicit.
- Bad, because it is a second inventory to maintain and it goes stale silently. The interesting
  case, a skill nobody remembered to expect, is exactly the one it cannot catch.

### `when` inside grader `options`

- Good, because `options` is open by schema decree, so it costs no schema change and no upstream
  proposal. ADR 01010 just stopped this repo forking the vocabulary.
- Good, because it is validated where it is consumed, so `fill` ground-checks it through the path
  ADR 01004 already built.
- Bad, because it reaches only graders that implement it: an `ai` eval takes no `options` and
  therefore cannot be conditioned at all.
- Bad, because two graders could implement `when` inconsistently. Sharing `src/graders/when.ts` makes
  that a choice rather than an accident, but nothing enforces it.

### A `when` member on `inlineEval`, proposed upstream

- Good, because it would reach every grader, `ai` included.
- Bad, because `inlineEval` is `additionalProperties: false` in a byte-identical vendored copy, so it
  cannot ship here at all until docmeta accepts it. This repo would then be blocked on another
  repo's review for a feature whose value is entirely local.

### A dedicated conditional grader kind

- Good, because the semantics live in one obvious place.
- Bad, because the condition is orthogonal to the check. It would have to be re-invented per grader,
  or become a grader that takes another grader as an option.

### An unmatched trigger passes

- Good, because nothing was observed to be violated.
- Bad, because it is the hollow-feature failure. It goes green in exact proportion to how rarely
  the eval armed. In the report it reads like a check that ran and succeeded.

### An unmatched trigger fails

- Good, because it is loud.
- Bad, because it inverts the author's intent. `when` exists to make an eval quiet on sessions it is
  not about; failing there makes it noisiest exactly then.

### Replay a subagent's roster as the main chain's

- Good, because one code path.
- Bad, because a sidecar's listing is `isInitial` for its own branch. Replaying it would withdraw
  the parent's entire roster mid-session and re-offer a subset. That fabricated churn would make
  `availableAt` wrong for every later ordinal.

### Drop a subagent's roster

- Good, because simplest, and the main chain's intervals stay exact.
- Bad, because a skill invoked inside a subagent but offered only there would be reported
  `not-offered`. That is a confident accusation of a configuration bug that does not exist.

### A separate section for the offered-but-unused list

- Good, because the coverage table keeps its current meaning exactly, and `resolved` stays a claim
  about a search that really ran.
- Bad, because it splits one question across two places, and the three states are only comparable
  when they sit in one column.

### One boolean per coverage row

- Good, because smallest change.
- Bad, because two booleans' worth of information does not fit in one. Whichever pair it collapsed
  would be the pair a reader most needs separated.
