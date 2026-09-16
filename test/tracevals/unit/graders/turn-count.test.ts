import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { makeArtifact, makePlan, makeRulesPlan, makeTrace } from "../../helpers.js";

const grader = graderFor("turn-count")!;

describe("turn-count grader", () => {
  it("passes within bounds", async () => {
    const result = await grader.grade({
      trace: makeTrace({ turnCount: 5 }),
      plan: makeRulesPlan({ grader: "turn-count", options: { min: 1, max: 10 } }),
    });
    expect(result.findings).toEqual([]);
  });

  it("fails above max and below min", async () => {
    const over = await grader.grade({
      trace: makeTrace({ turnCount: 20 }),
      plan: makeRulesPlan({ grader: "turn-count", options: { max: 10 } }),
    });
    expect(over.findings).toHaveLength(1);

    const under = await grader.grade({
      trace: makeTrace({ turnCount: 0 }),
      plan: makeRulesPlan({ grader: "turn-count", options: { min: 1 } }),
    });
    expect(under.findings).toHaveLength(1);
  });
  it("counts only the turns inside the artifact's window", async () => {
    const windowed = makeTrace({
      turnCount: 3,
      skillInvocations: [{ name: "demo-skill", via: "skill-tool", index: 1 }],
      events: [
        { kind: "user", text: "before", raw: {}, index: 0 },
        { kind: "tool_call", toolName: "Skill", raw: {}, index: 1 },
        { kind: "user", text: "during", raw: {}, index: 2 },
        { kind: "user", text: "also during", raw: {}, index: 3 },
      ],
      userMessages: ["before", "during", "also during"],
    });
    const result = await grader.grade({
      trace: windowed,
      plan: makePlan({ grader: "turn-count", options: { max: 2 } }),
    });
    // Three prompts in the session, two under this skill.
    expect(result.findings).toEqual([]);
  });

  it("skips, never passes, when the window is empty", async () => {
    const result = await grader.grade({
      trace: makeTrace({ turnCount: 20 }),
      plan: makePlan({
        artifact: makeArtifact({ name: "ghost-skill", type: "skill" }),
        grader: "turn-count",
        options: { max: 10 },
      }),
    });
    expect(result.skipped).toContain("never invoked");
    expect(result.findings).toEqual([]);
  });
});
