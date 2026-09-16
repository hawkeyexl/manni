import { describe, expect, it } from "vitest";
import { graderFor } from "../../../../src/tracevals/graders/registry.js";
import { makeArtifact, makePlan, makeRulesPlan, makeTrace } from "../../helpers.js";

const grader = graderFor("skill-invoked")!;

const trace = makeTrace({
  skillInvocations: [
    { name: "fix-bug", via: "skill-tool", index: 0 },
    {
      name: "writing-toolkit:identify-ai-tells",
      via: "command-injection",
      index: 1,
    },
  ],
});

describe("skill-invoked grader", () => {
  it("passes when the skill was invoked (either via)", async () => {
    for (const skill of ["fix-bug", "writing-toolkit:identify-ai-tells"]) {
      const result = await grader.grade({
        trace,
        plan: makeRulesPlan({
          grader: "skill-invoked",
          options: { skill, expect: "used" },
        }),
      });
      expect(result.findings).toEqual([]);
    }
  });

  it("fails when an expected skill was never invoked", async () => {
    const result = await grader.grade({
      trace,
      plan: makeRulesPlan({
        grader: "skill-invoked",
        options: { skill: "ghost", expect: "used" },
      }),
    });
    expect(result.findings).toHaveLength(1);
  });

  it("fails when a forbidden skill was invoked", async () => {
    const result = await grader.grade({
      trace,
      plan: makeRulesPlan({
        grader: "skill-invoked",
        options: { skill: "fix-bug", expect: "not-used" },
      }),
    });
    expect(result.findings).toHaveLength(1);
  });
  it("skips, never passes, when the artifact governed nothing", async () => {
    const result = await grader.grade({
      trace,
      plan: makePlan({
        artifact: makeArtifact({ name: "doc-writer", type: "agent" }),
        grader: "skill-invoked",
        options: { skill: "fix-bug", expect: "not-used" },
      }),
    });
    expect(result.skipped).toContain("never spawned");
    expect(result.findings).toEqual([]);
  });
});
