---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# Claude Code traces first, with an adapter seam and graceful degradation

## Context and Problem Statement

Agent session traces exist in multiple formats: Claude Code session files (`~/.claude/projects/<slug>/*.jsonl`), legacy `claude -p` stream-json, OpenAI Codex rollouts (`~/.codex/sessions/**/rollout-*.jsonl`), and others. Which formats does this release parse, and what happens when a trace references artifacts that cannot be resolved?

## Decision Drivers

- Claude Code sessions are the primary corpus and carry explicit `Skill`/`Agent` tool calls, making artifact lookup fully deterministic.
- Codex rollouts have no skill/agent concepts; supporting them well needs its own instruction semantics (AGENTS.md chain, inline `base_instructions`) and fixtures.
- Shipping one adapter well beats shipping two adapters shallowly.
- Traces routinely outlive their workspaces (deleted worktrees), so unresolvable artifacts are normal, not exceptional.

## Considered Options

- Claude Code only this release; `TraceSource` union + format detection as the seam for later adapters
- Claude Code and Codex in this release
- Claude Code only, with no structural provision for other formats

## Decision Outcome

Chosen option: "Claude Code only, with an adapter seam". `src/trace/detect.ts` sniffs the format from the first parseable line; `TraceSource` is a union type; the engine consumes only the normalized `Trace` model. Codex support is deferred, not rejected; a future adapter maps rollouts into the same model with its own instruction semantics. Degradation is a first-class behavior. Unresolved skill/agent refs and absent project rules become `warnings` plus entries in the report's artifact-coverage table, listing the paths tried. A trace that yields zero artifacts produces skipped evals and exit 0, never a crash. The `--project` flag overrides the trace's recorded cwd for artifact lookup when the original workspace is gone.

### Consequences

- Good, because the shipped adapter is grounded in verified real session files, including sidechains and `<command-name>` injections.
- Good, because adding a format later touches `trace/` only.
- Bad, because Codex users get nothing from this release.

### Confirmation

Adapter tests run against captured fixtures in `test/fixtures/traces/`. Degradation is pinned by tests asserting warnings and coverage entries for unresolvable refs, and exit 0 for zero-artifact traces. `detect.ts` rejects unknown formats with an operational error (exit 2) naming the supported formats.

## Pros and Cons of the Options

### Claude Code only + seam

- Good, because depth over breadth with a cheap extension path.
- Bad, because deferred Codex demand.

### Claude Code + Codex now

- Good, because broader coverage immediately.
- Bad, because Codex's instruction semantics (no skills, inline base instructions, shell-derived file accesses) would ship under-designed and under-fixtured.

### No structural provision

- Good, because marginally less abstraction.
- Bad, because a second format would force a restructuring later for trivial savings now.
