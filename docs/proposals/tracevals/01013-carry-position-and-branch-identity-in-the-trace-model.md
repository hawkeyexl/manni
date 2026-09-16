---
status: accepted
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
---

# Carry position and branch identity in the normalized trace model

## Context and Problem Statement

`Trace` records *what* a session did but not *when* or *where*. `ToolCall`, `FileAccess`, `SkillInvocation`, and `AgentSpawn` carry no ordinal, and subagent activity is flattened to a bare `sidechain: boolean`. Nothing downstream can ask "did this `Bash` call happen after the skill was invoked?" or "which of the two subagents ran it?". Every eval is therefore forced to grade the whole session. The raw Claude Code records hold `uuid`/`parentUuid` and `tool_use` ids, and the adapter discards all of them. A related question falls out of the same gap. When a trace file is only part of a longer conversation, grading it as a whole session is a false verdict. What does the adapter do about that?

## Decision Drivers

- Scoped grading (the next change) slices a trace to the window an artifact governed; a slice is meaningless without positions that survive it.
- `src/trace/types.ts` is re-exported wholesale by `src/index.ts`, so the shape is a public contract and widening it is a decision, not a mechanical edit.
- `sidechain` is already read by `src/graders/tool-usage.ts` and `src/judge/render.ts`; the cheap boolean check must keep working unchanged.
- A judge shown two concurrent subagents under one flat `:sidechain` tag cannot attribute anything to either.
- ADR 01003's rule holds: the adapter is grounded in verified real session files, and degradation is reported, never silent.

## Considered Options

Model shape:

- Ordinals plus a branch id on every derived record, `sidechain` kept as-is
- A parallel index (`Map<ToolCall, number>`) built by consumers that need it
- Replace `sidechain` with `branchId` alone

Fragment handling:

- Follow the continuation chain, reading the leading `summary` record's `leafUuid`, finding the ancestor session file, parsing it, and prepending its events
- Warn on `trace.warnings` that the trace is a fragment, and grade what is present
- Leave it silent

## Decision Outcome

The chosen option is **ordinals plus a branch id, with `sidechain` untouched, warning rather than chasing the chain.**

`index: number` is now required on `ToolCall`, `FileAccess`, `SkillInvocation`, `AgentSpawn`, and `TraceEvent`. It is always the ordinal of the record's own event in `trace.events`, so a list detached from the trace still knows where it came from. `SkillInvocation` and `AgentSpawn` gain `toolUseId`, the `tool_use` block id (absent for `<command-name>` injections, which are user turns and have none). `ToolCall` and `TraceEvent` gain `branchId`, resolved deterministically by walking each record's `parentUuid` chain back to the `Agent` call that opened the branch. Where one assistant turn spawns several subagents at once, the sidechain root's message is the `Agent`'s own `prompt` verbatim, and disambiguates them.

**Fragments are reported, not reconstructed.** A survey of the 281 session files in a real store settled this:

- Not one file contains a `type: "summary"` record at all. `leafUuid` appears only on `last-prompt` records, which bookmark a prompt *within* the same session.
- Not one file's `sessionId` differs from its filename, so no file is a fork of another.
- 89 files span multi-day internal gaps (up to 456 hours between consecutive records) under a single `sessionId`. `--resume` and `--continue` append **in place**. There is no chain to follow.
- What does truncate the agent's view is compaction: 14 `system` records with `subtype: "compact_boundary"` across 10 files, each followed by a `user` record with `isCompactSummary: true`. The pre-boundary records stay on disk; it is the agent that stopped seeing them.

So the adapter warns in both cases. A **leading** `summary` whose `leafUuid` does not resolve to any `uuid` in this file names the missing pointer, and says the trace is a fragment. That is the legacy resumed-session shape, still the only continuation pointer the format has ever carried. A compaction boundary says the agent stopped seeing the turns before it. A pointer that *does* resolve in-file is this session's own summary, and is silent.

`src/judge/render.ts` consumes the new identity. Each subagent branch becomes a labelled block naming its `subagent_type`, and every line inside keeps a short `:<type>` tag. Attribution therefore survives the head/tail truncation window. Sidechain events whose branch cannot be resolved keep the old flat `:sidechain` tag.

### Consequences

- Good, because "when" and "in which branch" are now trace facts, which is the whole prerequisite for scoped grading.
- Good, because no verdict changes: the graders read the same fields they read before, and the fixture corpus produces byte-identical eval outcomes.
- Good, because a fragment is loud instead of silently mis-graded. The honest answer ("this is a fragment") is available on every session already on disk.
- Good, because `renderTrace`'s tool lookup is now keyed by event index rather than a parallel counter. That counter would silently desync if a `tool_call` event were ever pushed without a matching `ToolCall`.
- Bad, because `index` is required, so every synthetic `Trace` literal in the suite had to be numbered.
- Bad, because branch attribution only reaches sidechains recorded **inline**. Current Claude Code writes subagent records to a separate `<session-id>/subagents/agent-*.jsonl` file and leaves zero `isSidechain: true` records in the session file; those sessions simply carry no branches. Reading the sidecar files is a multi-file adapter question, deliberately left to its own change.
- Neutral, because the judge digest changed shape. No `PROMPT_VERSION` bump is needed: `sha256(renderedTrace)` is already a cache-key component (`src/judge/cache.ts`), so the new rendering invalidates its own entries.

### Confirmation

`test/unit/trace-claude.test.ts` pins ordinals against `trace.events` positions rather than hard-coded numbers. It pins `toolUseId` on both invocation paths, branch attribution on the fixture session, and the two-subagents-in-one-turn tiebreak. Fragment detection is pinned in both directions. A dangling `leafUuid` warns (`test/fixtures/traces/claude-session-resumed.jsonl`), and one that resolves in-file does not. Compaction is pinned separately. `test/unit/render.test.ts` pins the labelled blocks and the per-line tags alongside the existing truncation tests. The CI dogfood gate asserts the fixture corpus's eval outcomes, so a regression that shifted a verdict would fail there.

## Pros and Cons of the Options

### Ordinals plus branch id, `sidechain` kept

- Good, because every consumer gets position without building anything.
- Good, because the cheap boolean check stays cheap and its two call sites are untouched.
- Bad, because two fields describe overlapping facts, and `sidechain === true` with `branchId === undefined` is a state consumers must expect.

### A parallel index built by consumers

- Good, because the public model does not change.
- Bad, because every consumer rebuilds it. An index keyed by object identity breaks the moment a list is copied, which is exactly what windowing does.

### Replace `sidechain` with `branchId` alone

- Good, because one field, no overlap.
- Bad, because it breaks two working call sites to express something they do not ask. Unresolvable branches would silently read as main-chain, turning a degradation into a wrong answer.

### Follow the continuation chain

- Good, because a resumed session would be graded whole.
- Bad, because `leafUuid` names a record, not a session, so resolving it means scanning a whole project directory. That works only on the machine that recorded it, which ADR 01003 already says is not the norm.
- Bad, because zero of 281 real session files carry the marker. The code would be unfixturable against reality and unverifiable, the exact trap ADR 01003 refused for Codex.
- Bad, because current `--resume` appends in place, so it would fix nothing for traces recorded today.

### Leave it silent

- Good, because nothing to build.
- Bad, because a fragment graded as a whole session produces a confident false verdict, which is the one failure mode this tool exists to avoid.
