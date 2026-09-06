import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FILL_PROMPT_VERSION,
  MAX_BODY_CHARS,
  PROPOSAL_SCHEMA,
  buildFillUser,
  isValidProposal,
  systemPromptFor,
} from "../../../src/tracevals/fill/prompt.js";
import { FillCache, fillCacheKey } from "../../../src/tracevals/fill/cache.js";
import { makeArtifact } from "../helpers.js";

describe("fill prompt", () => {
  const artifact = makeArtifact({
    type: "agent",
    name: "doc-writer",
    path: "/p/.claude/agents/doc-writer.md",
    content: "---\nname: doc-writer\ntools: Read, Grep\n---\nNever modify code.\n",
  });

  /**
   * `FILL_PROMPT_VERSION` is a cache-key component, so a prompt edit that
   * leaves it alone makes every cached proposal replay the *old* prompt's
   * output — silently, and for as long as the cache lives. Pinning the version
   * to a digest of the prompt surface makes the pair the thing under test:
   * change the text and this fails until the version moves with it.
   */
  it("moves FILL_PROMPT_VERSION with the prompt surface", () => {
    const surface = [
      ...(["skill", "agent", "project-rules", "slash-command"] as const).map(
        systemPromptFor,
      ),
      JSON.stringify(PROPOSAL_SCHEMA),
    ].join("\n---\n");
    const digest = createHash("sha256")
      .update(surface)
      .digest("hex")
      .slice(0, 12);
    expect({ version: FILL_PROMPT_VERSION, digest }).toEqual({
      version: 3,
      digest: "ed66ab9af846",
    });
  });

  it("names only the graders the artifact type may carry", () => {
    const skill = systemPromptFor("skill");
    expect(skill).toContain("tool-usage");
    expect(skill).not.toContain("json-output");

    const rules = systemPromptFor("project-rules");
    expect(rules).toContain("skill-invoked");

    const command = systemPromptFor("slash-command");
    expect(command).toContain("slash command");
    expect(command).not.toContain("json-output");
  });

  it("states the binary pass/fail bar and demands examples", () => {
    const prompt = systemPromptFor("skill");
    expect(prompt).toMatch(/pass\/fail|pass or fail/i);
    expect(prompt).toContain("examples");
    expect(prompt).toContain("confidence");
  });

  it("carries the body, existing names, and static grounding facts", () => {
    const user = buildFillUser({
      artifact,
      existingNames: ["already-there"],
      maxEvals: 3,
      facts: { name: "doc-writer", declaredTools: ["Read", "Grep"] },
      knownSkills: ["fix-bug"],
    });

    expect(user).toContain("Never modify code.");
    expect(user).toContain("already-there");
    expect(user).toContain("Read, Grep");
    expect(user).toContain("fix-bug");
    expect(user).toContain("3");
  });

  it("truncates a long body rather than sending it whole", () => {
    const user = buildFillUser({
      artifact: makeArtifact({ content: "x".repeat(MAX_BODY_CHARS + 500) }),
      existingNames: [],
      maxEvals: 3,
      facts: { declaredTools: [] },
      knownSkills: [],
    });
    expect(user).toContain("truncated");
    expect(user.length).toBeLessThan(MAX_BODY_CHARS + 2000);
  });

  it("validates the provider response shape", () => {
    expect(
      isValidProposal({
        evals: [
          {
            name: "no-shell",
            assertion: "No shell commands were run.",
            grader: "tool-usage",
            options: { tool: "Bash", expect: "not-used" },
            examples: { pass: "no Bash calls", fail: "ran npm test" },
            confidence: 0.8,
          },
        ],
        needsSharpening: [
          { instruction: "Produce high-quality docs.", reason: "no measurable bar" },
        ],
      }),
    ).toBe(true);

    // confidence is mandatory — the gate has nothing to work with without it.
    expect(
      isValidProposal({ evals: [{ name: "x", assertion: "y", grader: "llm" }] }),
    ).toBe(false);
    expect(isValidProposal({ evals: [], extra: 1 })).toBe(false);
    expect(isValidProposal({ evals: [], needsSharpening: [] })).toBe(true);
  });
});

describe("fill cache", () => {
  let dir: string;

  beforeAll(async () => {
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "fill-cache-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const key = (over: Partial<Parameters<typeof fillCacheKey>[0]> = {}) =>
    fillCacheKey({
      provider: "mock",
      model: "m",
      temperature: 0,
      maxEvals: 3,
      artifactType: "skill",
      path: "/p/.claude/skills/a/SKILL.md",
      body: "body",
      existingNames: [],
      knownSkills: [],
      ...over,
    });

  it("is stable for identical inputs", () => {
    expect(key()).toBe(key());
  });

  it("changes when the artifact or the existing evals change", () => {
    expect(key({ body: "different" })).not.toBe(key());
    // A post-fill re-run must miss, so the model is asked for *additional*
    // coverage rather than replaying its earlier proposal.
    expect(key({ existingNames: ["added"] })).not.toBe(key());
    expect(key({ maxEvals: 5 })).not.toBe(key());
    expect(key({ artifactType: "agent" })).not.toBe(key());
    expect(key({ model: "other" })).not.toBe(key());
    // Two artifacts with identical content at different paths are distinct.
    expect(key({ path: "/p/.claude/skills/b/SKILL.md" })).not.toBe(key());
    // The skill list is the prompt's grounding vocabulary, so adding a skill
    // must invalidate every artifact's proposal, not just that skill's own.
    expect(key({ knownSkills: ["fix-bug"] })).not.toBe(key());
  });

  it("cannot be forged by a name containing the separator", () => {
    expect(key({ existingNames: ["a,b"] })).not.toBe(
      key({ existingNames: ["a", "b"] }),
    );
  });

  it("round-trips a proposal and treats corruption as a miss", async () => {
    const cache = new FillCache(dir, true);
    const proposal = { evals: [], needsSharpening: [] };
    expect(cache.get("k1")).toBeUndefined();
    cache.set("k1", proposal);
    expect(cache.get("k1")).toEqual(proposal);

    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "k2.json"), "{ not json");
    expect(cache.get("k2")).toBeUndefined();
  });

  it("does nothing when disabled", () => {
    const cache = new FillCache(dir, false);
    cache.set("k3", { evals: [] });
    expect(cache.get("k3")).toBeUndefined();
  });
});
