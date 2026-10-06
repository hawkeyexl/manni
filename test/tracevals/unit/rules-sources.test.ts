import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveAlwaysSources,
  resolveTurnSources,
  type RuleSource,
  type SourceOptions,
} from "../../../src/tracevals/rules/sources.js";
import type { FileAccess, SkillInvocation, TraceEvent } from "../../../src/tracevals/trace/types.js";
import { makeTrace } from "../helpers.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "rules");
const HOME = join(FIX, "home");
const ENV = { CLAUDE_CONFIG_DIR: join(HOME, ".claude"), HOME, USERPROFILE: HOME };

const repo = (name: string, over: Partial<SourceOptions> = {}): SourceOptions => ({
  projectDir: join(FIX, name),
  projectRoot: join(FIX, name),
  env: ENV,
  ...over,
});

type Step =
  | { read: string }
  | { write: string }
  | { edit: string }
  | { skill: string }
  | { command: string }
  | { say: string };

/** A trace of one event per step, in the named repo. */
function traceOf(name: string, steps: Step[]) {
  const root = join(FIX, name);
  const events: TraceEvent[] = [];
  const fileAccesses: FileAccess[] = [];
  const skillInvocations: SkillInvocation[] = [];
  steps.forEach((step, index) => {
    events.push({ kind: "say" in step ? "assistant" : "tool_call", index, raw: {} });
    if ("read" in step) fileAccesses.push({ path: join(root, step.read), op: "read", index });
    if ("write" in step) fileAccesses.push({ path: join(root, step.write), op: "write", index });
    if ("edit" in step) fileAccesses.push({ path: join(root, step.edit), op: "edit", index });
    if ("skill" in step) skillInvocations.push({ name: step.skill, via: "skill-tool", index });
    if ("command" in step) {
      skillInvocations.push({ name: step.command, via: "command-injection", index });
    }
  });
  return makeTrace({ cwd: root, events, fileAccesses, skillInvocations });
}

const whole = (steps: Step[]) => ({ from: 0, to: steps.length - 1 });

async function turnSources(name: string, steps: Step[], over: Partial<SourceOptions> = {}) {
  return resolveTurnSources(traceOf(name, steps), whole(steps), repo(name, over));
}

const byPath = (sources: RuleSource[]) =>
  new Map(sources.map((s) => [s.displayPath, s]));
const paths = (sources: RuleSource[]) => sources.map((s) => s.displayPath);

describe("sources that always apply", () => {
  it("reads every claude-md file for cwd, .claude/ and the user, with its format", async () => {
    const { sources } = await resolveAlwaysSources(repo("claude"));
    const map = byPath(sources);
    for (const p of ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", "~/.claude/CLAUDE.md"]) {
      expect(map.get(p)?.format, p).toBe("claude-md");
      expect(map.get(p)?.trigger, p).toBe("always");
    }
  });

  it("gives every source an absolute path, its content and the content's sha256", async () => {
    const { sources } = await resolveAlwaysSources(repo("claude"));
    const root = byPath(sources).get("CLAUDE.md");
    expect(root?.path).toBe(join(FIX, "claude", "CLAUDE.md"));
    expect(root?.content).toContain("Run npm ci first");
    expect(root?.sha256).toBe(
      createHash("sha256").update(root?.content ?? "").digest("hex"),
    );
  });

  it("takes path-free claude rules and leaves path-scoped ones for the turn", async () => {
    const { sources } = await resolveAlwaysSources(repo("claude"));
    const map = byPath(sources);
    expect(map.get(".claude/rules/always.md")?.format).toBe("claude-rule");
    expect(map.get("~/.claude/rules/user.md")?.format).toBe("claude-rule");
    expect(map.has(".claude/rules/api.md")).toBe(false);
    expect(map.has(".claude/rules/tests.md")).toBe(false);
  });

  it("follows @path imports up to four hops, relative to the importing file", async () => {
    const { sources } = await resolveAlwaysSources(repo("claude"));
    const map = byPath(sources);
    for (const p of ["docs/style.md", "docs/more/a.md", "docs/more/b.md", "docs/more/c.md"]) {
      expect(map.get(p)?.format, p).toBe("import");
    }
    expect(map.get("docs/style.md")?.trigger).toBe("imported by CLAUDE.md");
    expect(map.has("docs/more/d.md")).toBe(false);
    // An `@` inside a code fence or a code span is not an import.
    expect(map.has("docs/never.md")).toBe(false);
  });

  it("reads user-level Gemini and Kiro files through the home seam", async () => {
    const { sources } = await resolveAlwaysSources(repo("claude"));
    const map = byPath(sources);
    expect(map.get("~/.gemini/GEMINI.md")?.format).toBe("gemini-md");
    expect(map.get("~/.kiro/steering/user.md")?.format).toBe("kiro-steering");
  });

  it("never takes a subdirectory's file without a touch, nor a README", async () => {
    const { sources } = await resolveAlwaysSources(repo("claude"));
    expect(paths(sources)).not.toContain("src/api/CLAUDE.md");
    expect(paths(sources)).not.toContain("README.md");
  });

  it("warns on malformed frontmatter and reads the file as having none", async () => {
    const { sources, warnings } = await resolveAlwaysSources(repo("claude"));
    expect(byPath(sources).get(".claude/rules/broken.md")?.trigger).toBe("always");
    expect(warnings.some((w) => w.includes(".claude/rules/broken.md"))).toBe(true);
  });

  it("carries the ai evals a source declares as its rules", async () => {
    const { sources } = await resolveAlwaysSources(repo("claude"));
    const declared = byPath(sources).get(".claude/rules/declared.md")?.declaredRules;
    expect(declared).toEqual([
      { id: "eval-1", text: "The agent ran npm ci before npm test." },
      {
        id: "no-force-push",
        text: "The agent never force-pushed.",
        when: { "command-matches": "\\bgit push\\b" },
      },
    ]);
    expect(byPath(sources).get("CLAUDE.md")?.declaredRules).toBeUndefined();
  });

  it("reads AGENTS.md at cwd and in .claude/", async () => {
    const { sources } = await resolveAlwaysSources(repo("agents"));
    const map = byPath(sources);
    expect(map.get("AGENTS.md")?.format).toBe("agents-md");
    expect(map.get(".claude/AGENTS.md")?.format).toBe("agents-md");
    expect(map.has("packages/core/AGENTS.md")).toBe(false);
  });

  it("reads GEMINI.md and its imports", async () => {
    const { sources } = await resolveAlwaysSources(repo("gemini"));
    const map = byPath(sources);
    expect(map.get("GEMINI.md")?.format).toBe("gemini-md");
    expect(map.get("rules/extra.md")?.format).toBe("import");
  });

  it("takes Cursor rules with alwaysApply, in .mdc or frontmattered .md", async () => {
    const { sources } = await resolveAlwaysSources(repo("cursor"));
    const cursor = sources.filter((s) => s.format === "cursor-rule").map((s) => s.displayPath);
    expect(cursor.sort()).toEqual([".cursor/rules/always.mdc", ".cursor/rules/fm.md"]);
  });

  it("takes Kiro steering with inclusion always or no frontmatter", async () => {
    const { sources } = await resolveAlwaysSources(repo("kiro"));
    const kiro = sources
      .filter((s) => s.format === "kiro-steering" && !s.displayPath.startsWith("~"))
      .map((s) => s.displayPath);
    expect(kiro.sort()).toEqual([".kiro/steering/product.md", ".kiro/steering/tech.md"]);
  });

  it("takes the Spec Kit constitution, and no spec", async () => {
    const { sources } = await resolveAlwaysSources(repo("speckit"));
    const map = byPath(sources);
    expect(map.get(".specify/memory/constitution.md")?.format).toBe("speckit-constitution");
    expect(paths(sources).some((p) => p.startsWith("specs/"))).toBe(false);
  });

  it("leaves OpenSpec's project.md for a read", async () => {
    const { sources } = await resolveAlwaysSources(repo("openspec"));
    expect(paths(sources)).not.toContain("openspec/project.md");
  });

  it("drops what exclude names, from every row", async () => {
    const { sources } = await resolveAlwaysSources(
      repo("claude", { exclude: ["CLAUDE.local.md", ".claude/rules/stale.md", "docs/more/**"] }),
    );
    const list = paths(sources);
    expect(list).not.toContain("CLAUDE.local.md");
    expect(list).not.toContain(".claude/rules/stale.md");
    expect(list).not.toContain("docs/more/a.md");
    expect(list).toContain("docs/style.md");
  });
});

describe("sources a turn brings into scope", () => {
  it("adds a subdirectory's CLAUDE.md once a file under it is touched", async () => {
    const { sources } = await turnSources("claude", [{ read: "src/api/handler.ts" }]);
    const nested = byPath(sources).get("src/api/CLAUDE.md");
    expect(nested?.format).toBe("claude-md");
    expect(nested?.trigger).toBe("touched src/api/handler.ts");
    expect(paths(sources)).not.toContain("src/web/CLAUDE.md");
  });

  it("puts a nearer AGENTS.md after the farther ones, so the nearest reads last", async () => {
    const { sources } = await turnSources("agents", [{ edit: "packages/core/src/index.ts" }]);
    const list = paths(sources);
    expect(list).toContain("packages/core/AGENTS.md");
    expect(list.indexOf("packages/core/AGENTS.md")).toBeGreaterThan(list.indexOf("AGENTS.md"));
  });

  it("matches a claude rule's paths: list against touched files", async () => {
    const { sources } = await turnSources("claude", [{ write: "src/api/new.ts" }]);
    const rule = byPath(sources).get(".claude/rules/api.md");
    expect(rule?.format).toBe("claude-rule");
    expect(rule?.trigger).toBe("paths matched src/api/new.ts");
  });

  it("matches a comma-separated paths: string, braces included", async () => {
    const one = await turnSources("claude", [{ write: "test/unit/a.test.ts" }]);
    expect(paths(one.sources)).toContain(".claude/rules/tests.md");
    const two = await turnSources("claude", [{ edit: "lib/x.spec.js" }]);
    expect(paths(two.sources)).toContain(".claude/rules/tests.md");
    const none = await turnSources("claude", [{ edit: "lib/x.ts" }]);
    expect(paths(none.sources)).not.toContain(".claude/rules/tests.md");
  });

  it("ignores a touch after the turn's end", async () => {
    const steps: Step[] = [{ say: "hi" }, { read: "src/api/handler.ts" }];
    const { sources } = await resolveTurnSources(
      traceOf("claude", steps),
      { from: 0, to: 0 },
      repo("claude"),
    );
    expect(paths(sources)).not.toContain("src/api/CLAUDE.md");
  });

  it("never makes a merely-read file a source", async () => {
    const { sources } = await turnSources("claude", [
      { read: "README.md" },
      { read: "docs/guide/getting-started.md" },
    ]);
    expect(paths(sources)).not.toContain("README.md");
    expect(paths(sources)).not.toContain("docs/guide/getting-started.md");
  });

  it("applies an included file to every turn, read or not, and exclude still wins", async () => {
    const include = ["docs/content-strategy/**"];
    const unread = await turnSources("claude", [{ say: "hi" }], { include });
    const designated = byPath(unread.sources).get("docs/content-strategy/personas.md");
    expect(designated?.format).toBe("designated");
    expect(designated?.trigger).toBe("always");

    const always = await resolveAlwaysSources({ ...repo("claude"), include });
    expect(paths(always.sources)).toContain("docs/content-strategy/personas.md");

    const excluded = await turnSources(
      "claude",
      [{ read: "docs/content-strategy/personas.md" }],
      { include, exclude: ["docs/content-strategy/**"] },
    );
    expect(paths(excluded.sources)).not.toContain("docs/content-strategy/personas.md");
  });

  it("lists a file once, however many rows reach it", async () => {
    const { sources } = await turnSources("claude", [{ read: "CLAUDE.md" }], { include: ["*.md"] });
    expect(paths(sources).filter((p) => p === "CLAUDE.md")).toHaveLength(1);
    expect(byPath(sources).get("CLAUDE.md")?.format).toBe("claude-md");
  });

  it("adds an invoked skill and every file read under its directory", async () => {
    const { sources } = await turnSources("claude", [
      { skill: "demo" },
      { read: ".claude/skills/demo/references/api.md" },
    ]);
    const map = byPath(sources);
    expect(map.get(".claude/skills/demo/SKILL.md")).toMatchObject({
      format: "skill",
      trigger: "skill window",
      skill: "demo",
    });
    expect(map.get(".claude/skills/demo/references/api.md")).toMatchObject({
      format: "skill",
      skill: "demo",
    });
    expect(map.has(".claude/skills/demo/references/unread.md")).toBe(false);
  });

  it("adds a skill invoked in an earlier turn whose window runs into this one", async () => {
    const steps: Step[] = [{ skill: "demo" }, { say: "a" }, { say: "b" }];
    const { sources } = await resolveTurnSources(traceOf("claude", steps), { from: 2, to: 2 }, repo("claude"));
    expect(paths(sources)).toContain(".claude/skills/demo/SKILL.md");
  });

  it("keeps a skill in scope to the end of the session, past a later command", async () => {
    // Proposal 0080: a skill's procedure spans the session, so the skills and
    // commands it runs partway through do not end its window.
    const steps: Step[] = [{ skill: "demo" }, { command: "ship" }, { say: "b" }];
    const { sources } = await resolveTurnSources(traceOf("claude", steps), { from: 2, to: 2 }, repo("claude"));
    expect(paths(sources)).toContain(".claude/skills/demo/SKILL.md");
    expect(byPath(sources).get(".claude/commands/ship.md")?.format).toBe("slash-command");
  });

  it("leaves out a skill first invoked after the turn", async () => {
    const steps: Step[] = [{ say: "a" }, { skill: "demo" }];
    const { sources } = await resolveTurnSources(traceOf("claude", steps), { from: 0, to: 0 }, repo("claude"));
    expect(paths(sources)).not.toContain(".claude/skills/demo/SKILL.md");
  });

  it("adds the agent definition under a subagent run", async () => {
    const steps: Step[] = [{ say: "review" }];
    const { sources } = await turnSources("claude", steps, { agentType: "reviewer" });
    expect(byPath(sources).get(".claude/agents/reviewer.md")).toMatchObject({
      format: "agent",
      trigger: "subagent run",
    });
    const main = await turnSources("claude", steps);
    expect(paths(main.sources)).not.toContain(".claude/agents/reviewer.md");
  });

  it("follows Cursor globs, list or comma string, and description-only rules once read", async () => {
    const touched = await turnSources("cursor", [{ edit: "src/App.tsx" }, { write: "test/a.ts" }]);
    const map = byPath(touched.sources);
    expect(map.get(".cursor/rules/react.mdc")?.trigger).toBe("globs matched src/App.tsx");
    expect(map.get(".cursor/rules/list.mdc")?.trigger).toBe("globs matched test/a.ts");
    expect(map.has(".cursor/rules/agent-requested.mdc")).toBe(false);
    expect(map.has(".cursor/rules/notes.md")).toBe(false);

    const read = await turnSources("cursor", [{ read: ".cursor/rules/agent-requested.mdc" }]);
    expect(byPath(read.sources).get(".cursor/rules/agent-requested.mdc")?.trigger).toBe("read");
    const notes = await turnSources("cursor", [{ read: ".cursor/rules/notes.md" }]);
    expect(paths(notes.sources)).not.toContain(".cursor/rules/notes.md");
  });

  it("reads Cursor's unquoted globs, which are not valid YAML, without a warning", async () => {
    const touched = await turnSources("cursor", [{ edit: "lib/b.ts" }]);
    expect(byPath(touched.sources).get(".cursor/rules/unquoted.mdc")?.trigger).toBe(
      "globs matched lib/b.ts",
    );
    expect(touched.warnings.some((w) => w.includes("unquoted.mdc"))).toBe(false);
  });

  it("follows Kiro fileMatchPattern, and manual steering once read", async () => {
    const touched = await turnSources("kiro", [{ edit: "src/api/routes.ts" }]);
    expect(byPath(touched.sources).get(".kiro/steering/api.md")?.trigger).toBe(
      "fileMatchPattern matched src/api/routes.ts",
    );
    expect(paths(touched.sources)).not.toContain(".kiro/steering/manual.md");

    const read = await turnSources("kiro", [
      { read: ".kiro/steering/manual.md" },
      { read: ".kiro/specs/feature/requirements.md" },
    ]);
    expect(paths(read.sources)).toContain(".kiro/steering/manual.md");
    expect(paths(read.sources)).not.toContain(".kiro/specs/feature/requirements.md");
  });

  it("takes OpenSpec's project.md once read, and never its specs", async () => {
    const { sources } = await turnSources("openspec", [
      { read: "openspec/project.md" },
      { read: "openspec/specs/auth/spec.md" },
    ]);
    expect(byPath(sources).get("openspec/project.md")?.format).toBe("openspec-project");
    expect(paths(sources)).not.toContain("openspec/specs/auth/spec.md");
  });

  it("includes every source that always applies", async () => {
    const { sources } = await turnSources("claude", [{ say: "hi" }]);
    expect(paths(sources)).toContain("CLAUDE.md");
    expect(paths(sources)).toContain("docs/style.md");
  });
});
