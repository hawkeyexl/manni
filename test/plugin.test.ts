import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { buildProgram } from "../src/cli.js";
import { EDIT_TOOLS } from "../src/family/commands/check.js";
import { FIX_SKILL } from "../src/family/commands/status.js";

const ROOT = resolve(import.meta.dirname, "..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

interface HookFile {
  hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; args?: string[] }[] }[]>;
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
    const matchers = (hooks.hooks.PostToolUse ?? []).map((h) => h.matcher ?? "");
    expect(matchers.length).toBeGreaterThan(0);
    for (const matcher of matchers) {
      expect(matcher.split("|").sort()).toEqual([...EDIT_TOOLS].sort());
    }
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
  // launcher that finds the project's own manni.
  it("every hook runs the launcher on a command the manni umbrella mounts", async () => {
    const { hooks } = readJson(
      `${entry?.source.replace(/^\.\//, "") ?? ""}/hooks/hooks.json`,
    ) as HookFile;
    const all = Object.values(hooks)
      .flat()
      .flatMap((g) => g.hooks);
    expect(all.length).toBeGreaterThan(0);
    for (const hook of all) {
      expect(hook.command).toBe("node");
      const [launcher, ...args] = hook.args ?? [];
      expect(launcher).toBe("${CLAUDE_PLUGIN_ROOT}/hooks/manni.mjs");
      expect(await resolves(args), args.join(" ")).toBe(true);
    }
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
