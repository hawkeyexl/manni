import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { makeArtifact, makePlan, makeRulesPlan, makeTrace } from "../../helpers.js";

const grader = graderFor("regex")!;

const trace = makeTrace({
  assistantTexts: ["Fixed the crash.", "All tests pass."],
  userMessages: ["Fix the crash please"],
});

describe("regex grader", () => {
  it("matches against assistant text by default", async () => {
    const result = await grader.grade({
      trace,
      plan: makeRulesPlan({
        grader: "regex",
        options: { pattern: "tests pass", expect: "match" },
      }),
    });
    expect(result.findings).toEqual([]);
  });

  it("fails when a required pattern is missing", async () => {
    const result = await grader.grade({
      trace,
      plan: makeRulesPlan({
        grader: "regex",
        options: { pattern: "deployed to prod", expect: "match" },
      }),
    });
    expect(result.findings).toHaveLength(1);
  });

  it("supports no-match expectations and flags", async () => {
    const result = await grader.grade({
      trace,
      plan: makeRulesPlan({
        grader: "regex",
        options: { pattern: "FIXED THE CRASH", flags: "i", expect: "no-match" },
      }),
    });
    expect(result.findings).toHaveLength(1);
  });

  it("errors on an invalid pattern", async () => {
    const result = await grader.grade({
      trace,
      plan: makeRulesPlan({
        grader: "regex",
        options: { pattern: "(", expect: "match" },
      }),
    });
    expect(result.error).toBeDefined();
  });
  it("reads only the text inside the artifact's window", async () => {
    const windowed = makeTrace({
      skillInvocations: [{ name: "demo-skill", via: "skill-tool", index: 1 }],
      events: [
        { kind: "assistant", text: "Deployed to prod.", raw: {}, index: 0 },
        { kind: "tool_call", toolName: "Skill", raw: {}, index: 1 },
        { kind: "assistant", text: "Fixed the crash.", raw: {}, index: 2 },
      ],
      assistantTexts: ["Deployed to prod.", "Fixed the crash."],
    });
    const outside = await grader.grade({
      trace: windowed,
      plan: makePlan({
        grader: "regex",
        options: { pattern: "Deployed to prod", expect: "no-match" },
      }),
    });
    expect(outside.findings).toEqual([]);

    const inside = await grader.grade({
      trace: windowed,
      plan: makePlan({
        grader: "regex",
        options: { pattern: "Fixed the crash", expect: "no-match" },
      }),
    });
    expect(inside.findings).toHaveLength(1);
  });

  it("skips, never passes, when the window is empty", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        artifact: makeArtifact({ name: "ghost-skill", type: "skill" }),
        grader: "regex",
        options: { pattern: "deployed to prod", expect: "no-match" },
      }),
    });
    expect(result.skipped).toContain("never invoked");
    expect(result.findings).toEqual([]);
  });
});
