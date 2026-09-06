import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill } from "../../../src/tracevals/commands/fill.js";
import { extractEvals } from "../../../src/tracevals/evals/extract.js";
import { planEvals } from "../../../src/tracevals/core/plan.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

const fixtureProject = fileURLToPath(
  new URL("../fixtures/project", import.meta.url),
);

/** One well-formed proposal, reused across cases. */
function proposal(over: Record<string, unknown> = {}) {
  return {
    json: {
      evals: [
        {
          name: "no-shell",
          assertion: "The session never ran shell commands.",
          grader: "tool-usage",
          options: { tool: "Bash", expect: "not-used" },
          examples: { pass: "no Bash calls", fail: "ran npm test" },
          confidence: 0.9,
        },
      ],
      needsSharpening: [
        { instruction: "Produce high-quality output.", reason: "no measurable bar" },
      ],
      ...over,
    },
  };
}

describe("runFill", () => {
  let dir: string;
  let project: string;

  beforeEach(async () => {
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "fill-"));
    project = join(dir, "project");
    await cp(fixtureProject, project, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = (over: Parameters<typeof runFill>[0] = {}) =>
    runFill({
      project,
      configDir: dir,
      cwd: dir,
      providerInstance: new MockProvider([proposal()]),
      ...over,
    });

  it("writes accepted criteria into skill and agent frontmatter", async () => {
    const { report } = await run();
    const skill = report.results.find((r) => r.type === "skill");

    expect(skill?.status).toBe("filled");
    expect(skill?.written.map((c) => c.name)).toEqual(["no-shell"]);

    const updated = await readFile(
      join(project, ".claude", "skills", "fix-bug", "SKILL.md"),
      "utf-8",
    );
    expect(updated).toContain("no-shell");
    // Pre-existing criteria are untouched.
    expect(updated).toContain("used-read");
    expect(updated).toContain("forbidden-tool");
  });

  it("never writes project rules, but still reports the proposal", async () => {
    const before = await readFile(join(project, "CLAUDE.md"), "utf-8");
    const { report } = await run();

    const rules = report.results.filter((r) => r.type === "project-rules");
    expect(rules.length).toBeGreaterThan(0);
    for (const result of rules) {
      expect(result.status).toBe("propose-only");
      expect(result.written.length).toBeGreaterThan(0);
    }
    expect(await readFile(join(project, "CLAUDE.md"), "utf-8")).toBe(before);
  });

  // A slash command's frontmatter is consumed by the harness and only its body
  // is injected, so an eval block there never reaches the agent under test —
  // the hazard that keeps project rules propose-only (ADR 01023).
  it("writes into a slash command like a skill, not propose-only", async () => {
    const { report } = await run();
    const command = report.results.find((r) => r.type === "slash-command");

    expect(command?.status).toBe("filled");
    const updated = await readFile(
      join(project, ".claude", "commands", "ship-it.md"),
      "utf-8",
    );
    expect(updated).toContain("no-shell");
    expect(updated).toContain("eval-provenance");
    // Pre-existing evals are untouched.
    expect(updated).toContain("no-shell-during-release");
  });

  it("writes nothing in a dry run", async () => {
    const before = await readFile(
      join(project, ".claude", "skills", "fix-bug", "SKILL.md"),
      "utf-8",
    );
    const { report } = await run({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.results.find((r) => r.type === "skill")?.status).toBe("proposed");
    expect(
      await readFile(join(project, ".claude", "skills", "fix-bug", "SKILL.md"), "utf-8"),
    ).toBe(before);
  });

  it("surfaces untestable instructions instead of inventing criteria for them", async () => {
    const { report } = await run();
    const notes = report.results.flatMap((r) => r.needsSharpening);
    expect(notes[0]?.instruction).toBe("Produce high-quality output.");
    expect(notes[0]?.reason).toContain("measurable");
  });

  it("reports rejections with a machine-readable reason", async () => {
    const provider = new MockProvider([
      proposal({
        evals: [
          {
            name: "ghost-tool",
            assertion: "The FileEditor tool was used.",
            grader: "tool-usage",
            options: { tool: "FileEditor" },
            examples: { pass: "used", fail: "not used" },
            confidence: 0.99,
          },
          {
            name: "unsure",
            assertion: "Something might have happened.",
            grader: "ai",
            examples: { pass: "yes", fail: "no" },
            confidence: 0.2,
          },
        ],
      }),
    ]);
    const { report } = await run({ providerInstance: provider });
    const reasons = report.results.flatMap((r) =>
      r.rejected.map((entry) => entry.reason),
    );
    expect(reasons).toContain("ungrounded-target");
    expect(reasons).toContain("low-confidence");
    expect(report.exitCode).toBe(0);
  });

  it("asks the provider once per artifact and reuses the cache on re-run", async () => {
    const first = new MockProvider([proposal()]);
    await runFill({
      project,
      configDir: dir,
      cwd: dir,
      dryRun: true,
      providerInstance: first,
    });
    const asked = first.requests.length;
    expect(asked).toBeGreaterThan(0);

    const second = new MockProvider([proposal()]);
    const { report } = await runFill({
      project,
      configDir: dir,
      cwd: dir,
      dryRun: true,
      providerInstance: second,
    });
    expect(second.requests).toHaveLength(0);
    expect(report.results.every((r) => r.cached || r.status !== "proposed")).toBe(true);
  });

  it("re-gates from cache when only the threshold changes", async () => {
    const first = new MockProvider([proposal()]);
    await run({ providerInstance: first, dryRun: true });

    const second = new MockProvider([proposal()]);
    const { report } = await run({
      providerInstance: second,
      dryRun: true,
      confidence: 0.95,
    });
    // No new API calls, but the 0.90 proposal now falls below the bar.
    expect(second.requests).toHaveLength(0);
    expect(
      report.results.flatMap((r) => r.rejected.map((x) => x.reason)),
    ).toContain("low-confidence");
  });

  it("contains a provider failure to the artifact that caused it", async () => {
    const provider = new MockProvider([{ error: "boom" }, proposal()]);
    const { report } = await run({ providerInstance: provider, noCache: true });

    expect(report.results.some((r) => r.status === "error")).toBe(true);
    expect(report.results.some((r) => r.written.length > 0)).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("stops proposing once the cost budget is spent", async () => {
    // A budget can only bind against a model with known pricing, so this
    // stub names one. MockProvider reports no usage and an unpriced model.
    let calls = 0;
    const pricey = {
      provider: () => "anthropic",
      modelName: () => "claude-opus-4-8",
      completeJSON: async () => {
        calls += 1;
        return {
          json: proposal().json,
          usage: { inputTokens: 400_000, outputTokens: 100_000 },
        };
      },
    };
    const { report } = await run({
      providerInstance: pricey,
      maxCostUsd: 0.01,
      noCache: true,
      dryRun: true,
    });

    // The first artifact blows the budget; the rest are skipped, not proposed.
    expect(calls).toBeLessThan(report.results.length);
    expect(
      report.results.some((r) => r.error === "cost budget exhausted"),
    ).toBe(true);
  });

  it("lets an operational provider failure out so the CLI can exit 2", async () => {
    // A missing API key would repeat for every artifact; reporting it once as
    // operational beats N identical per-artifact errors and an exit 1.
    await expect(
      runFill({
        project,
        configDir: dir,
        cwd: dir,
        noCache: true,
        provider: "no-such-provider",
      }),
    ).rejects.toThrow(TracevalsError);
  });

  it("counts existing evals against the per-artifact cap", async () => {
    // fix-bug already declares 5 evals; a cap of 5 leaves no room.
    const { report } = await run({ maxEvals: 5, dryRun: true, noCache: true });
    const skill = report.results.find((r) => r.type === "skill");
    expect(skill?.written).toEqual([]);
    expect(skill?.capped.length).toBeGreaterThan(0);
  });

  it("skips an artifact that opts out with metadata.eval-skip", async () => {
    const target = join(project, ".claude", "agents", "doc-writer.md");
    await writeFile(
      target,
      "---\nname: doc-writer\nmetadata:\n  eval-skip: true\n---\nbody\n",
    );
    const provider = new MockProvider([proposal()]);
    const { report } = await run({ providerInstance: provider, noCache: true });

    const agent = report.results.find((r) =>
      r.artifact.endsWith("doc-writer.md"),
    );
    expect(agent?.status).toBe("skipped");
    expect(agent?.written).toEqual([]);
    // Skipped artifacts cost nothing.
    expect(provider.requests.length).toBeLessThan(report.results.length);
  });

  it("produces frontmatter the real reader and planner accept", async () => {
    await run();
    const path = join(project, ".claude", "skills", "fix-bug", "SKILL.md");
    const content = await readFile(path, "utf-8");

    const extracted = await extractEvals({
      name: "fix-bug",
      type: "skill",
      path,
      content,
      origin: "project",
    });
    expect(extracted.errors).toEqual([]);
    expect(extracted.evals.map((e) => e.id)).toContain("no-shell");

    const plans = await planEvals([
      { name: "fix-bug", type: "skill", path, content, origin: "project" },
    ]);
    expect(plans.some((p) => p.evalName === "no-shell")).toBe(true);
    expect(plans.every((p) => p.error === undefined)).toBe(true);
  });
});
