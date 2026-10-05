---
status: accepted
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
---

# Merge sidecar subagent transcripts into the trace, spliced at the spawn

## Context and Problem Statement

ADR 01013 resolved subagent branches by walking `parentUuid` back to the spawning `Agent` call. That technique only reaches sidechains recorded *inline*, and 01013 closed by noting that current Claude Code writes them somewhere else. That note understates the damage. On a modern trace, subagent work is not partially visible; it is **entirely** invisible. `tool-usage` with `includeSidechains: true` counts nothing, and an agent definition's evals judge only the parent transcript. Phase 2's agent window would hit the empty-window path on every recent session. Where do subagent turns live now? How does a single-file trace model absorb a multi-file one without double-counting anything, or breaking the shape that already works?

## Decision Drivers

- The gap is a correctness bug today, not a missing feature. Evals silently grade a fraction of the session, and report a confident verdict on it.
- `index` is defined as the ordinal in `trace.events`, and scoped grading will slice windows on it. Wherever subagent events land has to keep that ordinal gap-free and meaningful.
- Old session files still carry inline `isSidechain: true` records; both shapes must work, and downstream should not be able to tell them apart.
- `usage` and `turnCount` deliberately count main-chain records only. Subagent tokens dwarf the parent's, with one real branch carrying 5,000 input tokens against the parent's 260. Any leak is therefore a large, silent lie.
- ADR 01003's rule holds: a missing or malformed sidecar degrades to a warning, never a crash and never a thrown error.

## Considered Options

Where subagent events land in `trace.events`:

- Splice each branch immediately after the `Agent` call that spawned it, depth-first
- Append every branch after the whole main chain
- Merge all transcripts globally by timestamp

Where branch identity lives:

- One `SubagentBranch` list describing inline and sidecar branches alike
- A sidecar-only list, leaving inline branches described by nothing

## Decision Outcome

The chosen option is to **splice at the spawn, depth-first, with one branch list covering both shapes.**

A survey of the 562 sidecar metadata files in a real store settled the mechanics:

- The layout is `<dir>/<session-id>/subagents/agent-<id>.jsonl` beside an `agent-<id>.meta.json`, derived from the trace file's own path. It resolves for any trace the user names, not only ones still in the session store.
- `meta.toolUseId` is the `tool_use` id of the spawning `Agent` call and `meta.agentType` is its `subagent_type`. The join is exact; **no heuristic is involved.**
- **Nesting is real and deep.** 511 metas are `spawnDepth: 1`, 42 are `2`, 2 are `3`, and 7 record no depth at all. All of them live flat in one `subagents/` directory regardless of depth, and 38 carry a `parentAgentId`.
- A nested branch's `toolUseId` names an `Agent` call that exists **only inside the parent's sidecar**, never in the session file. That was checked directly. The session file's occurrences of one such id are `queue-operation` and `attachment` bookkeeping, not a `tool_use`. So the join is resolved in ascending `spawnDepth`, each depth registering its own spawns as anchors for the next.
- Metadata is not guaranteed. 6 metas carry no `toolUseId` whatsoever, and others carry members the model has no use for (`model`, `worktreePath`, `worktreeBranch`, `spawnedWithWorktree`, `stoppedByUser`). Every member is therefore treated as optional.

**The ordering rule is this. A branch's events are spliced into `trace.events` immediately after the event of the `Agent` call that spawned it, preserving each transcript's internal order. Nested branches are spliced the same way inside their parent.** `index` is then renumbered once over the assembled list. Every derived record is remapped and re-sorted, meaning `toolCalls`, `fileAccesses`, `skillInvocations`, and `agentSpawns`, so ordinals stay gap-free and ascending. The consequence that matters downstream is that **a branch and its whole subtree are contiguous**. An agent's window is therefore a plain slice rather than a filter. It also puts a sidecar branch exactly where an inline one already sat, which is what makes the two shapes indistinguishable.

`Trace` gains `subagentBranches: SubagentBranch[]`, describing branches of **both** origins. Each carries `branchId`, `agentType`, `spawnDepth`, `spawnIndex`, and the `[startIndex, endIndex)` span, plus `agentId`, `parentAgentId`, and `file` for sidecar branches. Inline branches are derived from the branch identity ADR 01013 already resolves, so scoped grading gets one code path instead of two. Their span is a bounding range that can enclose interleaved main-chain events, which sidecar spans cannot. The field documents that difference rather than papering over it.

**One hazard is worth naming, because it is not obvious and it produced a wrong answer before it was caught.** Inside a sidecar, `isSidechain` is uniformly `true`, so it carries no information. ADR 01013's inline resolver, applied there, hands an agent's own turns after a nested spawn to the *nested* branch. Those records are in another file entirely. Every record in one sidecar shares a single `agentId`, so the file itself is the branch. That file-level fact overrides anything inferred inside it.

**Nothing is merged that cannot be joined.** Four shapes each produce a `trace.warnings` entry and merge nothing. Those are a meta whose `toolUseId` matches no spawn, and a meta that is unreadable or not an object. They also include a transcript with no meta beside it, and an unreadable `subagents/` directory. An absent directory is the ordinary case for older sessions and stream transcripts and says nothing at all.

### Consequences

- Good, because subagent work is visible for the first time on traces recorded today. On one real session whose session file holds zero `isSidechain` records, the merge surfaces 125 subagent tool calls across 4 branches. On another it surfaces 762 across 20 branches nested to depth 3.
- Good, because the join is deterministic filesystem-plus-id lookup, keeping ADR 01003's promise that artifact and branch resolution never involve LLM guessing.
- Good, because `usage` and `turnCount` cannot inflate. Sidecar records are all `isSidechain: true`, and both counters already skip those, so the exclusion is structural rather than a rule someone must remember.
- Good, because a subagent's skill invocations and file accesses now reach artifact resolution. The fixture's nested `general-purpose` agent appears in the coverage table only because its spawn came from inside a sidecar.
- Good, because scoped grading inherits contiguous spans and one branch model for both shapes, so Phase 2 does not have to know sidecars exist.
- Bad, because `trace.events` is no longer wall-clock ordered when a background agent ran concurrently with the main chain. The branch is placed where it was commissioned, not where its turns interleaved. Timestamps are still on every event for anyone who needs the real chronology.
- Bad, because `subagentBranches` is required, so every synthetic `Trace` literal in the suite had to grow a field.
- Neutral, because `startedAt`/`endedAt` stay main-chain bounds. A background agent finishing after the last parent record does not extend them, which is a deliberate limit rather than an oversight.
- Neutral, because the judge digest changed shape again. No `PROMPT_VERSION` bump is needed for the same reason as ADR 01013: `sha256(renderedTrace)` is a cache-key component, so the new rendering invalidates its own entries.

### Confirmation

`test/fixtures/traces/claude-session-sidecar.jsonl` and its `claude-session-sidecar/subagents/` directory cover every distinct shape in one corpus. Those are a depth-1 branch, and a depth-2 branch whose spawn lives inside that depth-1 sidecar. They also include a meta whose `toolUseId` joins nothing, and a meta that is not valid JSON. `test/unit/trace-claude.test.ts` pins the splice position against the spawn ordinal, the contiguity of a branch's span, and gap-free renumbering across every derived list. It pins the nested span sitting inside its parent's, and the attribution of a parent's post-spawn turns to the parent. It pins both degradation warnings. The invariant most worth guarding is pinned too: the sidecars' 15,000 input tokens leave `usage` at the main chain's 260. The inline path is pinned in the same file against the unchanged `claude-session.jsonl`, including that a sidecar-free trace warns about nothing. `test/unit/render.test.ts` pins that a sidecar branch renders through the same labelled-block path, named from its meta's `agentType`. The CI dogfood gate asserts the existing corpus's eval outcomes, which are byte-identical across this change.

## Pros and Cons of the Options

### Splice at the spawn, depth-first

- Good, because a branch and its subtree are contiguous, so a window is a slice.
- Good, because it puts sidecar branches exactly where inline ones already were, which is what makes the two indistinguishable downstream.
- Good, because the transcript reads in the order a person would reconstruct it: the delegated work appears where it was delegated.
- Bad, because every ordinal after a splice point shifts, so the whole model has to be renumbered in one pass rather than parsed straight through.

### Append every branch after the main chain

- Good, because nothing is renumbered.
- Bad, because the judge's head/tail truncation window would keep the last branch and drop the rest, which is arbitrary.
- Bad, because an agent window becomes a lookup rather than a slice, and the transcript no longer reads as a sequence of anything.

### Merge globally by timestamp

- Good, because it is the true chronology.
- Bad, because branches would interleave with the parent, and `render.ts` opens a labelled block per `branchId` change. A concurrent agent would shred the digest into one block per line.
- Bad, because it depends on clock agreement across processes, and on timestamps that not every record carries. Ties would resolve arbitrarily, and the model would stop being deterministic.

### One branch list for both origins

- Good, because scoped grading gets one path, and a consumer never has to ask which shape recorded a session.
- Bad, because `startIndex`/`endIndex` mean subtly different things for the two origins. They are exact for sidecar, and a bounding range for inline. That difference has to be documented rather than assumed away.

### A sidecar-only list

- Good, because every field would be populated and none would need a caveat.
- Bad, because inline branches would stay describable only by scanning events for a `branchId`. Phase 2 would carry two implementations of the same idea, and the older shape would be the one that rots.
