/**
 * The sources that say what the session was asked (proposal 0080): the typed
 * prompts, the approved plan, touched specs and `conformance.plans` files.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveAlwaysSources,
  resolveTurnSources,
  type RuleSource,
  type SourceOptions,
} from "../../../src/tracevals/rules/sources.js";
import type { FileAccess, ToolCall, TraceEvent } from "../../../src/tracevals/trace/types.js";
import { makeTrace } from "../helpers.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "conformance");
const ROOT = join(FIX, "requests");
const HOME = join(FIX, "home");
const CONFIG_DIR = join(HOME, ".claude");
const ENV = { CLAUDE_CONFIG_DIR: CONFIG_DIR, HOME, USERPROFILE: HOME };

const opts = (over: Partial<SourceOptions> = {}): SourceOptions => ({
  projectDir: ROOT,
  projectRoot: ROOT,
  env: ENV,
  plans: ["docs/plans/*.md"],
  exclude: ["specs/001-login/plan.md"],
  ...over,
});

type Step =
  | { prompt: string; sidechain?: true }
  | { read: string }
  | { edit: string }
  | { writeAbs: string }
  | { exitPlan: string; plan?: string }
  | { result: string; error?: true }
  | { say: string };

/** A trace of one event per step, in the requests project. */
function traceOf(steps: Step[]) {
  const events: TraceEvent[] = [];
  const fileAccesses: FileAccess[] = [];
  const toolCalls: ToolCall[] = [];
  steps.forEach((step, index) => {
    if ("prompt" in step) {
      events.push({
        kind: "user",
        index,
        text: step.prompt,
        ...(step.sidechain ? { sidechain: true } : {}),
        raw: { origin: { kind: "human" } },
      });
    } else if ("say" in step) {
      events.push({ kind: "assistant", index, text: step.say, raw: {} });
    } else if ("result" in step) {
      const block = { type: "tool_result", tool_use_id: step.result, content: "ok", ...(step.error ? { is_error: true } : {}) };
      events.push({ kind: "tool_result", index, raw: { message: { role: "user", content: [block] } } });
    } else if ("exitPlan" in step) {
      events.push({ kind: "tool_call", index, toolName: "ExitPlanMode", raw: { type: "tool_use", id: step.exitPlan } });
      toolCalls.push({
        name: "ExitPlanMode",
        input: step.plan === undefined ? {} : { plan: step.plan },
        index,
        sidechain: false,
      });
    } else {
      events.push({ kind: "tool_call", index, raw: {} });
      if ("read" in step) fileAccesses.push({ path: join(ROOT, step.read), op: "read", index });
      if ("edit" in step) fileAccesses.push({ path: join(ROOT, step.edit), op: "edit", index });
      if ("writeAbs" in step) fileAccesses.push({ path: step.writeAbs, op: "write", index });
    }
  });
  return makeTrace({ cwd: ROOT, events, fileAccesses, toolCalls });
}

async function sourcesOf(steps: Step[], over: Partial<SourceOptions> = {}, to = steps.length - 1) {
  const { sources } = await resolveTurnSources(traceOf(steps), { from: 0, to }, opts(over));
  return sources;
}

const byPath = (sources: RuleSource[]) => new Map(sources.map((s) => [s.displayPath, s]));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("the typed prompts", () => {
  it("are one numbered source, in order, up to the turn's end", async () => {
    const sources = await sourcesOf(
      [
        { prompt: "Add a reset link." },
        { say: "On it." },
        { prompt: "Do not edit `src/legacy.ts`." },
        { say: "Done." },
        { prompt: "Also add a test." },
      ],
      {},
      3,
    );
    const prompt = byPath(sources).get("prompt");
    const content = "1. Add a reset link.\n\n2. Do not edit `src/legacy.ts`.";
    expect(prompt).toEqual({
      path: "",
      displayPath: "prompt",
      format: "prompt",
      trigger: "typed prompts 1-2",
      content,
      sha256: sha(content),
      blocks: true,
    });
  });

  it("are absent when no prompt was typed", async () => {
    const sources = await sourcesOf([{ say: "Hello." }]);
    expect(sources.map((s) => s.format)).not.toContain("prompt");
  });

  it("leave out a subagent's task in a main session, and are the task in its own run", async () => {
    const main = await sourcesOf([{ prompt: "Add a reset link." }, { prompt: "Find the form.", sidechain: true }]);
    expect(byPath(main).get("prompt")?.trigger).toBe("typed prompts 1-1");
    const run = await sourcesOf([{ prompt: "Find the form.", sidechain: true }]);
    expect(byPath(run).get("prompt")?.content).toBe("1. Find the form.");
  });

  it("are removed by exclude only by their name, never by a glob for files (proposal 0081)", async () => {
    const kept = await sourcesOf([{ prompt: "Add a reset link." }], { exclude: ["**", "prompt*"] });
    expect(kept.map((s) => s.format)).toContain("prompt");
    const dropped = await sourcesOf([{ prompt: "Add a reset link." }], { exclude: ["prompt"] });
    expect(dropped.map((s) => s.format)).not.toContain("prompt");
  });

  it("are not known at session start, so prepare never sees them", async () => {
    const { sources } = await resolveAlwaysSources(opts());
    expect(sources.map((s) => s.format)).toEqual(["claude-md"]);
  });
});

describe("the approved plan", () => {
  it("is the plan input of the last approved ExitPlanMode, from the approval on", async () => {
    const steps: Step[] = [
      { prompt: "Plan the reset flow." },
      { exitPlan: "p1", plan: "- Add a reset page." },
      { result: "p1", error: true },
      { exitPlan: "p2", plan: "- Add the reset link to the login form." },
      { result: "p2" },
      { say: "Done." },
    ];
    const plan = byPath(await sourcesOf(steps)).get("plan");
    expect(plan).toMatchObject({
      path: "",
      displayPath: "plan",
      format: "plan",
      trigger: "approved at turn 3",
      content: "- Add the reset link to the login form.",
    });
    // Before the approval there is no plan, and a rejection is none.
    expect(byPath(await sourcesOf(steps, {}, 3)).has("plan")).toBe(false);
  });

  it("is the plan file the session last wrote before the call, when the input holds none", async () => {
    const file = join(CONFIG_DIR, "plans", "bright-otter.md");
    const sources = await sourcesOf([
      { prompt: "Plan the reset flow." },
      { writeAbs: join(CONFIG_DIR, "plans", "old.md") },
      { writeAbs: file },
      { exitPlan: "p1" },
      { result: "p1" },
    ]);
    const plan = sources.find((s) => s.format === "plan");
    expect(plan?.path).toBe(file);
    expect(plan?.displayPath).toBe("~/.claude/plans/bright-otter.md");
    expect(plan?.trigger).toBe("approved at turn 3");
    expect(plan?.content).toContain("Add the reset link under the password field.");
    expect(plan?.declaredRules).toBeUndefined();
  });

  it("is removed by exclude when it came from a file", async () => {
    const sources = await sourcesOf(
      [{ prompt: "Plan it." }, { writeAbs: join(CONFIG_DIR, "plans", "bright-otter.md") }, { exitPlan: "p1" }, { result: "p1" }],
      { exclude: ["~/.claude/plans/**"] },
    );
    expect(sources.map((s) => s.format)).not.toContain("plan");
  });

  it("is removed by the name plan too, when it came from a file (proposal 0081)", async () => {
    const sources = await sourcesOf(
      [{ prompt: "Plan it." }, { writeAbs: join(CONFIG_DIR, "plans", "bright-otter.md") }, { exitPlan: "p1" }, { result: "p1" }],
      { exclude: ["plan"] },
    );
    expect(sources.map((s) => s.format)).not.toContain("plan");
  });
});

describe("touched specs and plans files", () => {
  const touched = [
    { prompt: "Build the reset flow." },
    { read: "specs/001-login/spec.md" },
    { edit: "specs/001-login/tasks.md" },
    { read: ".kiro/specs/reset-password/tasks.md" },
    { read: "openspec/changes/add-reset/proposal.md" },
    { read: "openspec/changes/archive/2026-09-01-add-login/proposal.md" },
    { read: "docs/plans/reset.md" },
  ] satisfies Step[];

  it("brings in a touched feature, a Kiro spec, a live OpenSpec change and a plans file", async () => {
    const rows = (await sourcesOf(touched))
      .filter((s) => s.format !== "claude-md" && s.format !== "prompt")
      .map((s) => [s.displayPath, s.format, s.trigger]);
    expect(rows).toEqual([
      ["specs/001-login/spec.md", "speckit-spec", "touched specs/001-login/spec.md"],
      ["specs/001-login/tasks.md", "speckit-spec", "touched specs/001-login/spec.md"],
      [".kiro/specs/reset-password/requirements.md", "kiro-spec", "touched .kiro/specs/reset-password/tasks.md"],
      [".kiro/specs/reset-password/tasks.md", "kiro-spec", "touched .kiro/specs/reset-password/tasks.md"],
      ["openspec/changes/add-reset/proposal.md", "openspec-change", "touched openspec/changes/add-reset/proposal.md"],
      ["openspec/changes/add-reset/specs/auth/spec.md", "openspec-change", "touched openspec/changes/add-reset/proposal.md"],
      ["docs/plans/reset.md", "plans", "touched docs/plans/reset.md"],
    ]);
  });

  it("leaves out an untouched feature, an archived change, an untouched plan and an excluded file", async () => {
    const paths = (await sourcesOf(touched)).map((s) => s.displayPath);
    expect(paths).not.toContain("specs/002-signup/spec.md");
    expect(paths).not.toContain("specs/001-login/plan.md");
    expect(paths).not.toContain("openspec/changes/archive/2026-09-01-add-login/proposal.md");
    expect(paths).not.toContain("docs/plans/other.md");
  });

  it("brings in nothing before the touch, and no plans file without plans globs", async () => {
    const early = await sourcesOf(touched, {}, 0);
    expect(early.map((s) => s.format)).toEqual(["claude-md", "prompt"]);
    const noPlans = await sourcesOf(touched, { plans: [] });
    expect(noPlans.map((s) => s.format)).not.toContain("plans");
  });

  it("lists a file once, when include already named it", async () => {
    const sources = await sourcesOf(touched, { include: ["specs/001-login/tasks.md"] });
    expect(sources.filter((s) => s.displayPath === "specs/001-login/tasks.md").map((s) => s.format)).toEqual([
      "designated",
    ]);
  });
});
