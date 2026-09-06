import { describe, expect, it } from "vitest";
import { planEvals } from "../../../src/tracevals/core/plan.js";
import type { ResolvedArtifact } from "../../../src/tracevals/artifacts/types.js";

function artifact(
  name: string,
  content: string,
  type: ResolvedArtifact["type"] = "skill",
): ResolvedArtifact {
  return { name, type, path: `C:\\work\\${name}.md`, content, origin: "project" };
}

describe("planEvals", () => {
  it("plans one eval per declared entry", async () => {
    const plans = await planEvals([
      artifact(
        "fix-bug",
        [
          "---",
          "metadata:",
          "  evals:",
          "    - id: used-read",
          "      assertion: Read a file.",
          "      grader: tool-usage",
          "      options: { tool: Read, expect: used }",
          "    - Reproduce the bug first.",
          "---",
          "# Fix Bug",
        ].join("\n"),
      ),
    ]);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({
      evalName: "used-read",
      grader: "tool-usage",
      implicit: false,
    });
    // The string shorthand is id-less, so its name is positional.
    expect(plans[1]).toMatchObject({
      evalName: "eval-2",
      grader: "ai",
      implicit: false,
    });
  });

  it("carries the command family and provider onto the plan", async () => {
    const plans = await planEvals([
      artifact(
        "fix-bug",
        [
          "---",
          "metadata:",
          "  evals:",
          "    - id: no-force-push",
          "      assertion: The trace contains no force push.",
          "      grader: command",
          '      command: ["node", "check.mjs", "{trace}"]',
          "      success-exit-codes: [0, 3]",
          "      timeout-ms: 5000",
          "    - id: judged-elsewhere",
          "      assertion: Something.",
          "      grader: ai",
          "      provider: claude-cli",
          "---",
        ].join("\n"),
      ),
    ]);
    expect(plans[0]).toMatchObject({
      grader: "command",
      command: ["node", "check.mjs", "{trace}"],
      successExitCodes: [0, 3],
      timeoutMs: 5000,
    });
    expect(plans[1]?.provider).toBe("claude-cli");
  });

  it("plans one implicit whole-artifact eval when nothing is declared", async () => {
    const plans = await planEvals([
      artifact("CLAUDE.md", "# Rules\n- Run tests.", "project-rules"),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      evalName: "adheres-to-artifact",
      grader: "ai",
      implicit: true,
    });
    expect(plans[0]?.assertion).toContain("adhered to the instructions");
  });

  it("plans an error eval for an invalid evals block", async () => {
    const plans = await planEvals([
      artifact(
        "broken",
        "---\nmetadata:\n  evals:\n    - grader: ai\n---\n",
      ),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.error).toBeDefined();
    expect(plans[0]?.evalName).toBe("evals-block-valid");
  });

  it("plans an error eval for the artifact-evals-0.2 criteria envelope", async () => {
    // The migration case: the old container must fail loudly, with a pointer,
    // rather than read as an artifact that declares nothing.
    const plans = await planEvals([
      artifact(
        "stale",
        "---\nmetadata:\n  evals:\n    criteria:\n      - Something.\n---\n",
      ),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.evalName).toBe("evals-block-valid");
    expect(plans[0]?.error).toContain("invalid metadata.evals block");
  });

  it("skips an artifact marked metadata.eval-skip", async () => {
    const plans = await planEvals([
      artifact("skipped", "---\nmetadata:\n  eval-skip: true\n---\n"),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.skipped).toBe(true);
    expect(plans[0]?.skipReason).toContain("metadata.eval-skip");
  });

  it("skips a single entry that opts out on its own", async () => {
    const plans = await planEvals([
      artifact(
        "partly",
        [
          "---",
          "metadata:",
          "  evals:",
          "    - id: paused",
          "      assertion: Something.",
          "      skip: true",
          "    - id: live",
          "      assertion: Something else.",
          "---",
        ].join("\n"),
      ),
    ]);
    expect(plans).toHaveLength(2);
    expect(plans[0]?.skipped).toBe(true);
    expect(plans[1]?.skipped).toBeUndefined();
  });
});
