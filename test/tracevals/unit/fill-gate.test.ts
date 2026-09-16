import { describe, expect, it } from "vitest";
import {
  ALLOWED_GRADERS,
  gateProposals,
  type ProposedEval,
} from "../../../src/tracevals/fill/gate.js";
import { artifactFacts } from "../../../src/tracevals/fill/facts.js";
import { makeArtifact } from "../helpers.js";

function proposal(over: Partial<ProposedEval> = {}): ProposedEval {
  return {
    name: "reads-first",
    assertion: "The session read a file before editing.",
    grader: "tool-usage",
    options: { tool: "Read", expect: "used" },
    examples: { pass: "Read then Edit", fail: "Edit with no Read" },
    confidence: 0.9,
    ...over,
  };
}

const base = {
  artifactType: "skill" as const,
  threshold: 0.7,
  existingNames: [] as string[],
  maxEvals: 8,
  vocabulary: { tools: new Set(["Read", "Edit", "Bash"]), skills: new Set(["fix-bug"]) },
};

const reasons = (r: ReturnType<typeof gateProposals>) =>
  r.rejected.map((entry) => entry.reason);

describe("gateProposals", () => {
  it("accepts a well-grounded, confident proposal", () => {
    const result = gateProposals([proposal()], base);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it("rejects proposals below the confidence threshold", () => {
    const result = gateProposals([proposal({ confidence: 0.69 })], base);
    expect(reasons(result)).toEqual(["low-confidence"]);
    expect(gateProposals([proposal({ confidence: 0.7 })], base).accepted).toHaveLength(1);
  });

  it("rejects a grader the artifact type may not carry", () => {
    // cost/turn-count/json-output are whole-session graders: wrong scope for a
    // evalEntry that lives in one artifact among many.
    for (const grader of ["cost", "turn-count", "json-output"]) {
      const result = gateProposals([proposal({ grader, options: { maxUsd: 1 } })], base);
      expect(reasons(result), grader).toEqual(["grader-not-allowed"]);
    }
    // skill-invoked is meaningless inside the skill it names, but fine in rules.
    expect(
      reasons(gateProposals([proposal({ grader: "skill-invoked", options: { skill: "fix-bug" } })], base)),
    ).toEqual(["grader-not-allowed"]);
    expect(
      gateProposals([proposal({ grader: "skill-invoked", options: { skill: "fix-bug" } })], {
        ...base,
        artifactType: "project-rules",
      }).accepted,
    ).toHaveLength(1);
  });

  it("rejects options the grader itself refuses", () => {
    const result = gateProposals(
      [proposal({ options: { tool: "Read", expect: "typo" } })],
      base,
    );
    expect(reasons(result)).toEqual(["invalid-options"]);
    expect(result.rejected[0]?.detail).toContain("expect");
  });

  it("rejects targets that do not exist in the project", () => {
    // A hallucinated tool name would produce a evalEntry that can never pass,
    // regardless of how confident the model claims to be.
    expect(
      reasons(gateProposals([proposal({ options: { tool: "FileEditor" }, confidence: 0.99 })], base)),
    ).toEqual(["ungrounded-target"]);

    expect(
      reasons(
        gateProposals(
          [proposal({ grader: "file-access", options: { path: "C:\\work\\x.ts" } })],
          base,
        ),
      ),
    ).toEqual(["ungrounded-target"]);

    expect(
      reasons(
        gateProposals(
          [proposal({ grader: "skill-invoked", options: { skill: "no-such-skill" } })],
          { ...base, artifactType: "project-rules" },
        ),
      ),
    ).toEqual(["ungrounded-target"]);
  });

  it("accepts MCP tools, which cannot be enumerated ahead of a session", () => {
    const result = gateProposals(
      [proposal({ options: { tool: "mcp__github__create_issue" } })],
      base,
    );
    expect(result.accepted).toHaveLength(1);
  });

  it("rejects names that already exist, and duplicates within one batch", () => {
    expect(
      reasons(gateProposals([proposal()], { ...base, existingNames: ["reads-first"] })),
    ).toEqual(["duplicate-name"]);

    const twice = gateProposals([proposal(), proposal()], base);
    expect(twice.accepted).toHaveLength(1);
    expect(reasons(twice)).toEqual(["duplicate-name"]);
  });

  it("forces includeSidechains for agent definitions", () => {
    // A evalEntry in an agent definition describes what the subagent did, and
    // subagent tool calls are exactly the sidechain ones.
    const result = gateProposals([proposal()], { ...base, artifactType: "agent" });
    expect(result.accepted[0]?.options).toMatchObject({
      tool: "Read",
      includeSidechains: true,
    });
    // Skills keep the grader's default (main-thread only).
    expect(
      gateProposals([proposal()], base).accepted[0]?.options,
    ).not.toHaveProperty("includeSidechains");
  });

  it("keeps the most confident survivors when over the per-artifact cap", () => {
    const many = [0.95, 0.75, 0.85].map((confidence, i) =>
      proposal({ name: `c-${i}`, confidence }),
    );
    const result = gateProposals(many, { ...base, maxEvals: 2 });
    expect(result.accepted.map((c) => c.confidence)).toEqual([0.95, 0.85]);
    expect(result.capped.map((c) => c.confidence)).toEqual([0.75]);
  });

  it("reports low confidence separately from being capped", () => {
    const result = gateProposals(
      [proposal({ name: "a", confidence: 0.9 }), proposal({ name: "b", confidence: 0.2 })],
      { ...base, maxEvals: 1 },
    );
    expect(result.accepted.map((c) => c.name)).toEqual(["a"]);
    expect(reasons(result)).toEqual(["low-confidence"]);
    expect(result.capped).toEqual([]);
  });

  it("exposes the allowlist it enforces", () => {
    expect(ALLOWED_GRADERS.skill).toContain("ai");
    expect(ALLOWED_GRADERS.skill).not.toContain("cost");
    expect(ALLOWED_GRADERS["project-rules"]).toContain("skill-invoked");
    // A slash command is an injected procedure with a window, exactly like a
    // skill, so it carries the skill allowlist (ADR 01023).
    expect(ALLOWED_GRADERS["slash-command"]).toEqual(ALLOWED_GRADERS.skill);
  });

  it("rejects a whole-session grader proposed on a slash command", () => {
    const result = gateProposals([proposal({ grader: "cost" })], {
      ...base,
      artifactType: "slash-command",
    });
    expect(result.accepted).toEqual([]);
    expect(reasons(result)).toEqual(["grader-not-allowed"]);
  });

  it("accepts ai-graded proposals without options", () => {
    const result = gateProposals(
      [proposal({ grader: "ai", options: undefined })],
      base,
    );
    expect(result.accepted).toHaveLength(1);
  });
});

describe("artifactFacts", () => {
  it("reads an agent definition's declared tools, comma-separated or list", () => {
    const commas = artifactFacts(
      makeArtifact({
        type: "agent",
        content: "---\nname: doc-writer\ntools: Read, Grep, Glob\n---\nbody\n",
      }),
    );
    expect(commas.declaredTools).toEqual(["Read", "Grep", "Glob"]);
    expect(commas.name).toBe("doc-writer");

    const list = artifactFacts(
      makeArtifact({
        type: "agent",
        content: "---\nname: a\ntools:\n  - Read\n  - Bash\n---\nx\n",
      }),
    );
    expect(list.declaredTools).toEqual(["Read", "Bash"]);
  });

  it("reads a skill's description and survives absent frontmatter", () => {
    const skill = artifactFacts(
      makeArtifact({
        type: "skill",
        content: "---\nname: fix-bug\ndescription: Fix a bug.\n---\nbody\n",
      }),
    );
    expect(skill.description).toBe("Fix a bug.");

    const bare = artifactFacts(makeArtifact({ content: "# Rules\n" }));
    expect(bare.declaredTools).toEqual([]);
    expect(bare.name).toBeUndefined();
  });

  it("returns empty facts rather than throwing on malformed frontmatter", () => {
    const broken = artifactFacts(
      makeArtifact({ content: "---\nname: [unclosed\n---\nbody\n" }),
    );
    expect(broken.declaredTools).toEqual([]);
  });
});
