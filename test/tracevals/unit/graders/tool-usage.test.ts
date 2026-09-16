import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { makeArtifact, makePlan, makeTrace } from "../../helpers.js";

const grader = graderFor("tool-usage")!;

const trace = makeTrace({
  // The default plan's artifact is the skill `demo-skill`; invoking it at the
  // first ordinal opens a window over the whole list, so these cases are about
  // counting rather than about scoping.
  skillInvocations: [{ name: "demo-skill", via: "skill-tool", index: 0 }],
  toolCalls: [
    { name: "Read", input: {}, sidechain: false, index: 0 },
    { name: "Read", input: {}, sidechain: false, index: 1 },
    { name: "Bash", input: {}, sidechain: false, index: 2 },
    { name: "WebSearch", input: {}, sidechain: true, index: 3 },
  ],
});

describe("tool-usage grader", () => {
  it("passes when an expected tool was used", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        grader: "tool-usage",
        options: { tool: "Read", expect: "used" },
      }),
    });
    expect(result.findings).toEqual([]);
  });

  it("fails when a forbidden tool was used", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        grader: "tool-usage",
        options: { tool: "Bash", expect: "not-used" },
      }),
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe("error");
    expect(result.findings[0]?.message).toContain("Bash");
  });

  it("ignores sidechain calls by default but counts them on request", async () => {
    const scoped = await grader.grade({
      trace,
      plan: makePlan({
        grader: "tool-usage",
        options: { tool: "WebSearch", expect: "used" },
      }),
    });
    expect(scoped.findings).toHaveLength(1);

    const included = await grader.grade({
      trace,
      plan: makePlan({
        grader: "tool-usage",
        options: { tool: "WebSearch", expect: "used", includeSidechains: true },
      }),
    });
    expect(included.findings).toEqual([]);
  });

  it("enforces min/max call counts", async () => {
    const tooMany = await grader.grade({
      trace,
      plan: makePlan({
        grader: "tool-usage",
        options: { tool: "Read", max: 1 },
      }),
    });
    expect(tooMany.findings).toHaveLength(1);

    const enough = await grader.grade({
      trace,
      plan: makePlan({
        grader: "tool-usage",
        options: { tool: "Read", min: 2 },
      }),
    });
    expect(enough.findings).toEqual([]);
  });

  it("counts only calls inside the artifact's window", async () => {
    // Bash ran once before the skill was invoked and once after. Only the
    // second one was under this skill's instructions.
    const windowed = makeTrace({
      skillInvocations: [{ name: "demo-skill", via: "skill-tool", index: 1 }],
      toolCalls: [
        { name: "Bash", input: { command: "git status" }, sidechain: false, index: 0 },
        { name: "Skill", input: { skill: "demo-skill" }, sidechain: false, index: 1 },
        { name: "Bash", input: { command: "npm test" }, sidechain: false, index: 2 },
      ],
    });
    const result = await grader.grade({
      trace: windowed,
      plan: makePlan({
        grader: "tool-usage",
        options: { tool: "Bash", expect: "not-used" },
      }),
    });
    expect(result.findings).toHaveLength(1);
    // The count is the assertion that separates windowing from not windowing:
    // the whole session used Bash twice.
    expect(result.findings[0]?.message).toContain("used 1 time(s)");
  });

  it("skips, never passes, when the skill was never invoked", async () => {
    const plan = (options: Record<string, unknown>) =>
      makePlan({
        artifact: makeArtifact({ name: "ghost-skill", type: "skill" }),
        grader: "tool-usage",
        options,
      });

    // The forbidding direction must not report a vacuous pass...
    const forbidden = await grader.grade({
      trace,
      plan: plan({ tool: "Bash", expect: "not-used" }),
    });
    expect(forbidden.skipped).toContain("never invoked");
    expect(forbidden.findings).toEqual([]);

    // ...and the requiring direction must not report a spurious fail.
    const required = await grader.grade({
      trace,
      plan: plan({ tool: "Read", expect: "used" }),
    });
    expect(required.skipped).toContain("never invoked");
    expect(required.findings).toEqual([]);
  });

  it("grades an agent artifact against its own branch", async () => {
    const branched = makeTrace({
      agentSpawns: [{ subagentType: "Explore", index: 0, toolUseId: "toolu_x" }],
      subagentBranches: [
        {
          branchId: "toolu_x",
          agentType: "Explore",
          origin: "sidecar",
          spawnDepth: 1,
          spawnIndex: 0,
          startIndex: 1,
          endIndex: 2,
        },
      ],
      toolCalls: [
        { name: "Agent", input: {}, sidechain: false, index: 0 },
        { name: "Read", input: {}, sidechain: true, branchId: "toolu_x", index: 1 },
        { name: "Edit", input: {}, sidechain: false, index: 2 },
      ],
    });
    const agentPlan = (options: Record<string, unknown>) =>
      makePlan({
        artifact: makeArtifact({ name: "Explore", type: "agent" }),
        grader: "tool-usage",
        options,
      });

    // The parent session edited a file; the Explore branch did not.
    const readOnly = await grader.grade({
      trace: branched,
      plan: agentPlan({ tool: "Edit", expect: "not-used", includeSidechains: true }),
    });
    expect(readOnly.findings).toEqual([]);

    const read = await grader.grade({
      trace: branched,
      plan: agentPlan({ tool: "Read", expect: "used", includeSidechains: true }),
    });
    expect(read.findings).toEqual([]);
  });

  it("counts an agent's own calls without asking for includeSidechains", async () => {
    // Every call inside an agent branch is `sidechain: true`, so the default
    // `includeSidechains: false` emptied the window and made an agent-artifact
    // eval structurally unable to fail. The window *is* the branch here, so
    // sidechain calls are the subject, not noise from someone else's turns.
    const branched = makeTrace({
      agentSpawns: [{ subagentType: "reviewer", index: 0, toolUseId: "toolu_r" }],
      subagentBranches: [
        {
          branchId: "toolu_r",
          agentType: "reviewer",
          origin: "sidecar",
          spawnDepth: 1,
          spawnIndex: 0,
          startIndex: 1,
          endIndex: 3,
        },
      ],
      toolCalls: [
        { name: "Agent", input: {}, sidechain: false, index: 0 },
        { name: "Edit", input: {}, sidechain: true, branchId: "toolu_r", index: 1 },
        { name: "Read", input: {}, sidechain: true, branchId: "toolu_r", index: 2 },
      ],
    });
    const result = await grader.grade({
      trace: branched,
      plan: makePlan({
        artifact: makeArtifact({ name: "reviewer", type: "agent" }),
        grader: "tool-usage",
        options: { tool: "Edit", expect: "not-used" },
      }),
    });
    expect(result.skipped).toBeUndefined();
    expect(result.findings, "the reviewer edited and still passed").toHaveLength(
      1,
    );
  });

  it("skips an agent that spawned no branch instead of passing it", async () => {
    const spawnOnly = makeTrace({
      agentSpawns: [{ subagentType: "doc-writer", index: 0 }],
      toolCalls: [{ name: "Edit", input: {}, sidechain: false, index: 1 }],
    });
    const result = await grader.grade({
      trace: spawnOnly,
      plan: makePlan({
        artifact: makeArtifact({ name: "doc-writer", type: "agent" }),
        grader: "tool-usage",
        options: { tool: "Edit", expect: "not-used" },
      }),
    });
    expect(result.skipped).toContain("no subagent turns");
    expect(result.findings).toEqual([]);
  });

  it("errors on missing options", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({ grader: "tool-usage" }),
    });
    expect(result.error).toContain("tool");
  });

  it("reports at the plan's severity", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        grader: "tool-usage",
        severity: "warning",
        options: { tool: "Bash", expect: "not-used" },
      }),
    });
    expect(result.findings[0]?.severity).toBe("warning");
  });
});
