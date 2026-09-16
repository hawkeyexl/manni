import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTraceFile } from "../../../../src/tracevals/trace/claude.js";
import { windowFor } from "../../../../src/tracevals/graders/util.js";
import { makeArtifact, makePlan, makeTrace } from "../../helpers.js";

const sidecarFixture = fileURLToPath(
  new URL("../../fixtures/traces/claude-session-sidecar.jsonl", import.meta.url),
);

/**
 * One synthetic session covering every window shape at once:
 *
 *   0 user       "start"
 *   1 tool_call  Bash            <- before any skill; governed by nothing
 *   2 tool_call  Skill fix-bug   <- fix-bug's window opens here
 *   3 tool_call  Read src/app.ts
 *   4 tool_call  Bash
 *   5 tool_call  Agent Explore   (toolu_x)
 *   6 tool_call  Read  [branch toolu_x]
 *   7 assistant  "done"          <- main chain, inside the branch's bounds
 *   8 tool_call  Skill polish    <- fix-bug's window closes here
 *   9 tool_call  Write notes.md
 */
const trace = makeTrace({
  turnCount: 1,
  userMessages: ["start"],
  assistantTexts: ["done"],
  events: [
    { kind: "user", text: "start", raw: {}, index: 0 },
    { kind: "tool_call", toolName: "Bash", raw: {}, index: 1 },
    { kind: "tool_call", toolName: "Skill", raw: {}, index: 2 },
    { kind: "tool_call", toolName: "Read", raw: {}, index: 3 },
    { kind: "tool_call", toolName: "Bash", raw: {}, index: 4 },
    { kind: "tool_call", toolName: "Agent", raw: {}, index: 5 },
    {
      kind: "tool_call",
      toolName: "Read",
      sidechain: true,
      branchId: "toolu_x",
      raw: {},
      index: 6,
    },
    { kind: "assistant", text: "done", raw: {}, index: 7 },
    { kind: "tool_call", toolName: "Skill", raw: {}, index: 8 },
    { kind: "tool_call", toolName: "Write", raw: {}, index: 9 },
  ],
  toolCalls: [
    { name: "Bash", input: { command: "git status" }, sidechain: false, index: 1 },
    { name: "Skill", input: { skill: "fix-bug" }, sidechain: false, index: 2 },
    { name: "Read", input: { file_path: "src/app.ts" }, sidechain: false, index: 3 },
    { name: "Bash", input: { command: "npm test" }, sidechain: false, index: 4 },
    { name: "Agent", input: { subagent_type: "Explore" }, sidechain: false, index: 5 },
    {
      name: "Read",
      input: { file_path: "src/util.ts" },
      sidechain: true,
      branchId: "toolu_x",
      index: 6,
    },
    { name: "Skill", input: { skill: "polish" }, sidechain: false, index: 8 },
    { name: "Write", input: { file_path: "notes.md" }, sidechain: false, index: 9 },
  ],
  skillInvocations: [
    { name: "fix-bug", via: "skill-tool", index: 2, toolUseId: "toolu_s" },
    { name: "polish", via: "skill-tool", index: 8 },
  ],
  agentSpawns: [
    { subagentType: "Explore", index: 5, toolUseId: "toolu_x" },
    { subagentType: "doc-writer", index: 9 },
  ],
  subagentBranches: [
    {
      branchId: "toolu_x",
      agentType: "Explore",
      origin: "inline",
      spawnDepth: 1,
      spawnIndex: 5,
      // Deliberately a bounding range that encloses the main-chain event at 7,
      // which is what an inline branch's span looks like (ADR 01014).
      startIndex: 6,
      endIndex: 8,
    },
  ],
  fileAccesses: [
    { path: "src/app.ts", op: "read", index: 3 },
    { path: "src/util.ts", op: "read", index: 6 },
    { path: "notes.md", op: "write", index: 9 },
  ],
});

const planFor = (
  name: string,
  type: "skill" | "agent" | "project-rules" | "slash-command",
) => makePlan({ artifact: makeArtifact({ name, type }) });

describe("windowFor", () => {
  it("gives project rules the whole session", () => {
    const window = windowFor(trace, planFor("CLAUDE.md", "project-rules"));
    expect(window.scope).toBe("session");
    expect(window.empty).toBe(false);
    expect(window.toolCalls).toHaveLength(trace.toolCalls.length);
    expect(window.events).toHaveLength(trace.events.length);
    expect(window.turnCount).toBe(trace.turnCount);
    expect(window.userMessages).toEqual(trace.userMessages);
    expect(window.assistantTexts).toEqual(trace.assistantTexts);
  });

  it("runs a skill's window from its invocation to the next skill's", () => {
    const window = windowFor(trace, planFor("fix-bug", "skill"));
    expect(window.scope).toBe("skill");
    expect(window.empty).toBe(false);
    expect(window.events.map((e) => e.index)).toEqual([2, 3, 4, 5, 6, 7]);
    // The Bash at index 1 ran before the skill was invoked; the one at 4 did not.
    const bash = window.toolCalls.filter((c) => c.name === "Bash");
    expect(bash).toHaveLength(1);
    expect(bash[0]?.input).toEqual({ command: "npm test" });
    // Write at index 9 belongs to the next skill's window, not this one.
    expect(window.toolCalls.some((c) => c.name === "Write")).toBe(false);
    expect(window.fileAccesses.map((a) => a.path)).toEqual([
      "src/app.ts",
      "src/util.ts",
    ]);
  });

  it("runs the last skill's window to the end of the session", () => {
    const window = windowFor(trace, planFor("polish", "skill"));
    expect(window.events.map((e) => e.index)).toEqual([8, 9]);
    expect(window.toolCalls.map((c) => c.name)).toEqual(["Skill", "Write"]);
  });

  it("windows an agent to its own branch, not the parent session", () => {
    const window = windowFor(trace, planFor("Explore", "agent"));
    expect(window.scope).toBe("agent");
    expect(window.empty).toBe(false);
    // Only the branch's own record: the main-chain assistant turn at index 7
    // sits inside the inline bounding range and must not be attributed here.
    expect(window.events.map((e) => e.index)).toEqual([6]);
    expect(window.toolCalls.map((c) => c.name)).toEqual(["Read"]);
    expect(window.fileAccesses.map((a) => a.path)).toEqual(["src/util.ts"]);
  });

  // A slash command injects instructions at a point in the session and is
  // superseded by the next injection, which is the skill rule exactly
  // (ADR 01023).
  it("runs a slash command's window from its injection to the next", () => {
    const injected = makeTrace({
      ...trace,
      skillInvocations: [
        { name: "ship-it", via: "command-injection", index: 1 },
        { name: "fix-bug", via: "skill-tool", index: 2 },
        { name: "polish", via: "skill-tool", index: 8 },
      ],
    });
    const window = windowFor(injected, planFor("ship-it", "slash-command"));
    expect(window.scope).toBe("slash-command");
    expect(window.empty).toBe(false);
    expect(window.label).toContain("/ship-it");
    // Closed by the skill invoked right after it.
    expect(window.events.map((e) => e.index)).toEqual([1]);
    expect(window.toolCalls.map((c) => c.name)).toEqual(["Bash"]);
  });

  // A `Skill` tool call is not the slash-command mechanism, so it can never
  // open a slash command's window — only close it.
  it("opens a slash command's window only on a command injection", () => {
    const shadowed = makeTrace({
      ...trace,
      skillInvocations: [{ name: "ship-it", via: "skill-tool", index: 2 }],
    });
    const window = windowFor(shadowed, planFor("ship-it", "slash-command"));
    expect(window.empty).toBe(true);
    expect(window.reason).toContain("/ship-it");
    expect(window.reason).toContain("never invoked");
  });

  it("reports an empty window when a resolved skill was never invoked", () => {
    const window = windowFor(trace, planFor("ghost-skill", "skill"));
    expect(window.empty).toBe(true);
    expect(window.reason).toContain("ghost-skill");
    expect(window.reason).toContain("never invoked");
    expect(window.toolCalls).toEqual([]);
    expect(window.events).toEqual([]);
  });

  it("reports an empty window when an agent spawned no branch", () => {
    const window = windowFor(trace, planFor("doc-writer", "agent"));
    expect(window.empty).toBe(true);
    expect(window.reason).toContain("doc-writer");
    expect(window.reason).toContain("no subagent turns");
    expect(window.toolCalls).toEqual([]);
  });

  it("reports an empty window when an agent was never spawned at all", () => {
    const window = windowFor(trace, planFor("ghost-agent", "agent"));
    expect(window.empty).toBe(true);
    expect(window.reason).toContain("never spawned");
  });

  it("unions every invocation when a skill was invoked more than once", () => {
    const twice = makeTrace({
      ...trace,
      skillInvocations: [
        { name: "fix-bug", via: "skill-tool", index: 2 },
        { name: "polish", via: "skill-tool", index: 8 },
        { name: "fix-bug", via: "command-injection", index: 9 },
      ],
    });
    const window = windowFor(twice, planFor("fix-bug", "skill"));
    expect(window.events.map((e) => e.index)).toEqual([2, 3, 4, 5, 6, 7, 9]);
  });

  it("includes a nested branch in its parent agent's window", () => {
    const nested = makeTrace({
      ...trace,
      subagentBranches: [
        {
          branchId: "toolu_x",
          agentType: "Explore",
          origin: "sidecar",
          spawnDepth: 1,
          spawnIndex: 5,
          startIndex: 6,
          endIndex: 8,
        },
        {
          branchId: "toolu_y",
          agentType: "general-purpose",
          origin: "sidecar",
          spawnDepth: 2,
          spawnIndex: 6,
          startIndex: 7,
          endIndex: 8,
        },
      ],
      events: trace.events.map((e) =>
        e.index === 7
          ? { ...e, sidechain: true, branchId: "toolu_y" }
          : e,
      ),
    });
    const window = windowFor(nested, planFor("Explore", "agent"));
    expect(window.events.map((e) => e.index)).toEqual([6, 7]);
    // And the nested agent's own window is just its own turns.
    const inner = windowFor(nested, planFor("general-purpose", "agent"));
    expect(inner.events.map((e) => e.index)).toEqual([7]);
  });

  it("derives window turn counts and text from the windowed events", () => {
    const window = windowFor(trace, planFor("fix-bug", "skill"));
    // No user prompt inside [2, 8); the one at index 0 predates the skill.
    expect(window.turnCount).toBe(0);
    expect(window.userMessages).toEqual([]);
    expect(window.assistantTexts).toEqual(["done"]);
  });
  it("windows a sidecar branch the same way it windows an inline one", async () => {
    // Origin is invisible here by design (ADR 01014): the branch list covers
    // both shapes, so this exercises the sidecar half of the same code path.
    const parsed = await parseTraceFile(sidecarFixture);
    const window = windowFor(parsed, planFor("Explore", "agent"));
    expect(window.empty).toBe(false);
    // The parent session's own Bash is outside the branch; the branch's Read
    // and the depth-2 subagent's Grep are inside it.
    const names = window.toolCalls.map((c) => c.name);
    expect(names).toContain("Read");
    expect(names).toContain("Grep");
    expect(names).not.toContain("Bash");
    // Contiguous, as ADR 01014 promises, so the window really is a slice.
    const ordinals = window.events.map((e) => e.index);
    expect(ordinals).toEqual(
      Array.from({ length: ordinals.length }, (_, i) => ordinals[0]! + i),
    );
    // The nested agent's own brief is not one of Explore's turns.
    expect(window.userMessages).toEqual(["Survey the trace parser."]);
  });

  it("does not let a subagent's Skill call close the main chain's window", () => {
    // ADR 01015 defines the closing boundary as the next invocation *on the
    // same chain*. Boundaries drawn from every invocation let a subagent that
    // loaded its own skill truncate the parent's window, so a `not-used` eval
    // passes on turns it never saw.
    //
    //   0 tool_call Bash
    //   1 tool_call Skill alpha    <- alpha's window opens
    //   2 tool_call Agent          (toolu_a)
    //   3 assistant [branch]
    //   4 tool_call Skill beta     [branch]  <- a different chain
    //   5 tool_call Bash                     <- main chain again
    //   6 tool_call Write
    const branched = makeTrace({
      events: [
        { kind: "tool_call", toolName: "Bash", raw: {}, index: 0 },
        { kind: "tool_call", toolName: "Skill", raw: {}, index: 1 },
        { kind: "tool_call", toolName: "Agent", raw: {}, index: 2 },
        {
          kind: "assistant",
          text: "looking",
          sidechain: true,
          branchId: "toolu_a",
          raw: {},
          index: 3,
        },
        {
          kind: "tool_call",
          toolName: "Skill",
          sidechain: true,
          branchId: "toolu_a",
          raw: {},
          index: 4,
        },
        { kind: "tool_call", toolName: "Bash", raw: {}, index: 5 },
        { kind: "tool_call", toolName: "Write", raw: {}, index: 6 },
      ],
      toolCalls: [
        { name: "Bash", input: {}, sidechain: false, index: 0 },
        { name: "Skill", input: { skill: "alpha" }, sidechain: false, index: 1 },
        { name: "Agent", input: {}, sidechain: false, index: 2 },
        {
          name: "Skill",
          input: { skill: "beta" },
          sidechain: true,
          branchId: "toolu_a",
          index: 4,
        },
        { name: "Bash", input: {}, sidechain: false, index: 5 },
        { name: "Write", input: {}, sidechain: false, index: 6 },
      ],
      skillInvocations: [
        { name: "alpha", via: "skill-tool", index: 1 },
        // The chain is read off the event at this ordinal, which is the
        // subagent's.
        { name: "beta", via: "skill-tool", index: 4 },
      ],
      agentSpawns: [{ subagentType: "Explore", index: 2, toolUseId: "toolu_a" }],
      subagentBranches: [
        {
          branchId: "toolu_a",
          agentType: "Explore",
          origin: "inline",
          spawnDepth: 1,
          spawnIndex: 2,
          startIndex: 3,
          endIndex: 5,
        },
      ],
    });
    const window = windowFor(branched, planFor("alpha", "skill"));
    // alpha governs to the end: nothing on the main chain took over from it.
    expect(window.events.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(window.toolCalls.map((c) => c.name)).toContain("Write");
  });
});
