import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import { buildProgram } from "../src/cli.js";
import { EDIT_TOOLS } from "../src/family/commands/check.js";
import { FIX_SKILL } from "../src/family/commands/status.js";
import { supportedExtensions } from "../src/meta/extractors/index.js";

const ROOT = resolve(import.meta.dirname, "..");
const LAUNCHER = "${CLAUDE_PLUGIN_ROOT}/hooks/manni.mjs";
const TRACEVALS = "${CLAUDE_PLUGIN_ROOT}/hooks/tracevals.mjs";
const PAGE_METADATA = "${CLAUDE_PLUGIN_ROOT}/hooks/page-metadata.mjs";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

interface Hook {
  type: string;
  command: string;
  args?: string[];
  timeout?: number;
  async?: boolean;
}
interface HookFile {
  hooks: Record<string, { matcher?: string; hooks: Hook[] }[]>;
}

/** The manni command a hook runs: the launcher's arguments after its path. */
const manniArgs = (hook: Hook): string => (hook.args ?? []).slice(1).join(" ");

/** Each group of `event` with its hooks narrowed to those running `script`. */
function groupsRunning(file: HookFile, event: string, script: string): { matcher?: string; hooks: Hook[] }[] {
  return (file.hooks[event] ?? [])
    .map((g) => ({ ...g, hooks: g.hooks.filter((h) => h.args?.[0] === script) }))
    .filter((g) => g.hooks.length > 0);
}

/** The hooks registered for `event` whose manni command is `command`, with their group's matcher. */
function hooksFor(file: HookFile, event: string, command: string): (Hook & { matcher?: string })[] {
  return (file.hooks[event] ?? []).flatMap((group) =>
    group.hooks
      .filter((h) => manniArgs(h) === command)
      .map((h) => ({ ...h, ...(group.matcher === undefined ? {} : { matcher: group.matcher }) })),
  );
}
interface Marketplace {
  name: string;
  owner: { name: string };
  plugins: { name: string; source: string }[];
}

const marketplace = readJson(".claude-plugin/marketplace.json") as Marketplace;
const entry = marketplace.plugins[0];
const pluginDir = join(ROOT, entry?.source ?? "missing");

/** Does `args` name a command the umbrella mounts, subcommand included? */
async function resolves(args: string[]): Promise<boolean> {
  let cmd: Command = await buildProgram();
  for (const arg of args) {
    // Words after a leaf command are its arguments, not more commands.
    if (arg.startsWith("-") || cmd.commands.length === 0) break;
    const next = cmd.commands.find((c) => c.name() === arg);
    if (next === undefined) return false;
    cmd = next;
  }
  return cmd.parent !== null;
}

describe("manni plugin", () => {
  // The hook fires on the matcher's tools, and `manni check` answers only
  // EDIT_TOOLS: one list, kept in two places.
  it("the PostToolUse matcher names exactly the tools manni check answers", () => {
    const hooks = JSON.parse(readFileSync(join(pluginDir, "hooks/hooks.json"), "utf8")) as HookFile;
    const matchers = groupsRunning(hooks, "PostToolUse", LAUNCHER).map((h) => h.matcher ?? "");
    expect(matchers.length).toBeGreaterThan(0);
    for (const matcher of matchers) {
      expect(matcher.split("|").sort()).toEqual([...EDIT_TOOLS].sort());
    }
  });

  // Proposal 0079, "Under the hooks": tracevals prepares in the background,
  // judges each subagent's run, and returns its lease when the session ends.
  it("prepares tracevals at session start and resume, in the background", () => {
    const hooks = JSON.parse(readFileSync(join(pluginDir, "hooks/hooks.json"), "utf8")) as HookFile;
    const [prepare, ...more] = hooksFor(hooks, "SessionStart", "tracevals prepare");
    expect(more).toEqual([]);
    expect(prepare).toMatchObject({ type: "command", matcher: "startup|resume", async: true });
    // 0078's session-start hooks run first, in their order. Capture and
    // prepare exist only for tracevals, so they run behind its gate.
    const commands = (file: HookFile) =>
      (file.hooks.SessionStart ?? []).flatMap((g) =>
        g.hooks.filter((h) => h.args?.[0] !== PAGE_METADATA).map((h) => `${h.args?.[0] ?? ""} ${manniArgs(h)}`),
      );
    expect(commands(hooks)).toEqual([
      `${TRACEVALS} tracevals capture`,
      `${LAUNCHER} status`,
      `${TRACEVALS} tracevals prepare`,
    ]);
  });

  // Proposal 0113: the hooks that exist only for tracevals run behind the
  // gate, and Stop keeps the launcher, since its file checks are for everyone.
  it("checks each subagent's run, and releases the model host at session end", () => {
    const hooks = JSON.parse(readFileSync(join(pluginDir, "hooks/hooks.json"), "utf8")) as HookFile;
    const [subagent] = hooksFor(hooks, "SubagentStop", "check");
    expect(subagent).toMatchObject({ timeout: 600 });
    expect(subagent?.args?.[0]).toBe(TRACEVALS);
    expect(subagent?.matcher).toBeUndefined();
    const [release] = hooksFor(hooks, "SessionEnd", "tracevals release");
    expect(release).toMatchObject({ timeout: 10 });
    expect(release?.args?.[0]).toBe(TRACEVALS);
    expect(release?.matcher).toBeUndefined();
    const stop = hooksFor(hooks, "Stop", "check");
    expect(stop).toHaveLength(1);
    expect(stop[0]?.args?.[0]).toBe(LAUNCHER);
  });

  // Claude Code stores the answer in user settings only, so a repository
  // cannot turn tracevals on for someone who opens it.
  it("declares the tracevals option, a boolean that is off by default", () => {
    const plugin = JSON.parse(readFileSync(join(pluginDir, ".claude-plugin/plugin.json"), "utf8")) as {
      userConfig?: Record<string, { type: string; default: unknown; title: unknown; description: unknown }>;
    };
    const option = plugin.userConfig?.tracevals;
    expect(option).toMatchObject({ type: "boolean", default: false });
    expect(option?.title).toEqual(expect.any(String));
    expect(option?.description).toEqual(expect.any(String));
    expect(existsSync(join(pluginDir, "hooks/tracevals.mjs"))).toBe(true);
  });

  it("the marketplace entry points at a plugin directory with a manifest", () => {
    expect(entry).toBeDefined();
    expect(statSync(pluginDir).isDirectory()).toBe(true);
    expect(existsSync(join(pluginDir, ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("the marketplace entry and the manifest agree on the name", () => {
    const manifest = readJson(
      `${entry?.source.replace(/^\.\//, "") ?? ""}/.claude-plugin/plugin.json`,
    ) as { name: string };
    expect(manifest.name).toBe(entry?.name);
  });

  // Exec form, so no shell parses the command on any platform, through the
  // launcher that finds the project's own manni, or through its tracevals gate.
  it("every hook runs the launcher on a command the manni umbrella mounts, or the Read hook", async () => {
    const { hooks } = readJson(
      `${entry?.source.replace(/^\.\//, "") ?? ""}/hooks/hooks.json`,
    ) as HookFile;
    const all = Object.values(hooks)
      .flat()
      .flatMap((g) => g.hooks);
    expect(all.length).toBeGreaterThan(0);
    for (const hook of all) {
      expect(hook.command).toBe("node");
      const [script, ...args] = hook.args ?? [];
      if (script === PAGE_METADATA) {
        expect(args).toEqual([]);
        continue;
      }
      expect([LAUNCHER, TRACEVALS]).toContain(script);
      expect(await resolves(args), args.join(" ")).toBe(true);
    }
  });

  // A read of a collection page hands the agent its metadata, and a
  // compaction forgets what the session was given.
  it("runs the Read hook after each Read and after a compaction", async () => {
    const hooks = JSON.parse(readFileSync(join(pluginDir, "hooks/hooks.json"), "utf8")) as HookFile;
    const post = groupsRunning(hooks, "PostToolUse", PAGE_METADATA);
    expect(post.map((g) => g.matcher)).toEqual(["Read"]);
    expect(post[0]?.hooks).toEqual([{ type: "command", command: "node", args: [PAGE_METADATA], timeout: 30 }]);
    const start = groupsRunning(hooks, "SessionStart", PAGE_METADATA);
    expect(start.map((g) => g.matcher)).toEqual(["compact"]);
    const script = join(pluginDir, "hooks/page-metadata.mjs");
    expect(existsSync(script)).toBe(true);
    const { EXTENSIONS } = (await import(pathToFileURL(script).href)) as { EXTENSIONS: string[] };
    const norm = (list: readonly string[]) => [...new Set(list.map((e) => e.toLowerCase()))].sort();
    expect(norm(EXTENSIONS)).toEqual(norm(supportedExtensions()));
  });

  // The graph server reads the project and keeps a published graph in the
  // plugin's data directory, so both variables reach it.
  it("registers the graph MCP server, run by node from the plugin's hooks", () => {
    const { mcpServers } = JSON.parse(readFileSync(join(pluginDir, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    expect(Object.keys(mcpServers)).toEqual(["graph"]);
    const graph = mcpServers.graph;
    expect(graph?.command).toBe("node");
    expect(graph?.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/hooks/graph-server.mjs"]);
    expect(existsSync(join(pluginDir, "hooks/graph-server.mjs"))).toBe(true);
    expect(graph?.env).toEqual({
      CLAUDE_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}",
      CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}",
    });
  });

  // The session briefing names a skill by `<plugin>:<skill>`; both halves
  // are names the plugin owns, so the reference is checked against them.
  it("the skill the session briefing names exists in the plugin", () => {
    const plugin = JSON.parse(readFileSync(join(pluginDir, ".claude-plugin/plugin.json"), "utf8")) as { name: string };
    const [prefix, skill] = FIX_SKILL.split(":");
    expect(prefix).toBe(plugin.name);
    expect(existsSync(join(pluginDir, "skills", skill ?? "", "SKILL.md"))).toBe(true);
  });

  it("every skill has a SKILL.md with a name and a description", () => {
    const skillsDir = join(pluginDir, "skills");
    const dirs = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const text = readFileSync(join(skillsDir, dir, "SKILL.md"), "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
      expect(front, dir).toMatch(/^name: \S+/m);
      expect(front, dir).toMatch(/^description: \S+/m);
      expect(/^name: (\S+)/m.exec(front)?.[1], dir).toBe(dir);
    }
  });
});
