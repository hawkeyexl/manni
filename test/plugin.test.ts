import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { buildProgram } from "../src/cli.js";

const ROOT = resolve(import.meta.dirname, "..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

interface HookFile {
  hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
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
function resolves(args: string[]): boolean {
  let cmd: Command = buildProgram();
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

  it("every hook runs a command the manni umbrella mounts", () => {
    const { hooks } = readJson(
      `${entry?.source.replace(/^\.\//, "") ?? ""}/hooks/hooks.json`,
    ) as HookFile;
    const commands = Object.values(hooks)
      .flat()
      .flatMap((g) => g.hooks)
      .map((h) => h.command);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const prefix = "npx --no @hawkeyexl/manni ";
      expect(command.startsWith(prefix), command).toBe(true);
      const args = command.slice(prefix.length).split(/\s+/).filter(Boolean);
      expect(resolves(args), command).toBe(true);
    }
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
