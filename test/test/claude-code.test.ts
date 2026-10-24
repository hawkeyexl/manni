/**
 * The Claude Code seam: the argv the spike settled, the environment that
 * keeps a global npm install in the run, how `claude` is found on Windows,
 * the progress lines, and how a run's end is read from its `result` event.
 * Nothing here starts a real `claude`.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecResult } from "@hawkeyexl/inference";
import {
  claudeCodeArgs,
  claudeCodeEnv,
  claudeLaunchFor,
  classifyRun,
  lineSplitter,
  progressLine,
  toolUses,
} from "../../src/test/core/claude-code.js";
import { TestError } from "../../src/test/errors.js";
import { recordedStream } from "./task-run.js";

const run = (stdout: string, extra: Partial<ExecResult> = {}): ExecResult => ({
  code: 1,
  stdout,
  stderr: "",
  timedOut: false,
  ...extra,
});

describe("claudeCodeArgs", () => {
  it("is the spike's argv, each flag its own element", () => {
    expect(
      claudeCodeArgs({ roleFile: "/run/role.md", maxTurns: 50, mcpServers: [], docsDir: null }),
    ).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--tools",
      "Read,Write,Edit,Glob,Grep,Bash,WebFetch",
      "--allowedTools",
      "Read,Write,Edit,Glob,Grep,Bash,WebFetch",
      "--permission-mode",
      "dontAsk",
      "--append-system-prompt-file",
      "/run/role.md",
      "--max-turns",
      "50",
    ]);
  });

  it("adds the MCP config, allows each of its servers, and passes the model and the docs copy", () => {
    const args = claudeCodeArgs({
      roleFile: "/run/role.md",
      maxTurns: 10,
      model: "sonnet",
      mcpConfig: "/repo/.mcp.tasks.json",
      mcpServers: ["playwright", "fs"],
      docsDir: "/run/docs",
    });
    expect(args.slice(args.indexOf("--mcp-config"), args.indexOf("--mcp-config") + 2)).toEqual([
      "--mcp-config",
      "/repo/.mcp.tasks.json",
    ]);
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(
      "Read,Write,Edit,Glob,Grep,Bash,WebFetch,mcp__playwright,mcp__fs",
    );
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Write,Edit,Glob,Grep,Bash,WebFetch");
    expect(args.slice(-6)).toEqual(["--max-turns", "10", "--model", "sonnet", "--add-dir", "/run/docs"]);
    expect(args).not.toContain("--disallowedTools");
  });
});

describe("claudeCodeEnv", () => {
  it("moves the npm global prefix into the run and puts its bin first on PATH", () => {
    const env = claudeCodeEnv("/run/global", { PATH: "/usr/bin", HOME: "/home/x" }, "linux");
    expect(env["NPM_CONFIG_PREFIX"]).toBe("/run/global");
    expect(env["PATH"]).toBe(`${join("/run/global", "bin")}:/usr/bin`);
    expect(env["HOME"]).toBe("/home/x");
  });

  it("on Windows uses the prefix itself and keeps the variable's own spelling", () => {
    const env = claudeCodeEnv("C:\\run\\global", { Path: "C:\\Windows" }, "win32");
    expect(env["Path"]).toBe("C:\\run\\global;C:\\Windows");
    expect(Object.keys(env)).not.toContain("PATH");
  });
});

describe("claudeLaunchFor", () => {
  const host = (files: Record<string, string>) => ({
    platform: "win32" as const,
    path: "C:\\tools;C:\\npm",
    isFile: (p: string) => Object.hasOwn(files, p),
    read: (p: string) => files[p] ?? "",
  });

  it("runs claude by name off Windows", () => {
    expect(claudeLaunchFor(["-p"], { ...host({}), platform: "linux" })).toEqual({
      command: "claude",
      args: ["-p"],
      viaShim: false,
    });
  });

  it("runs a claude.exe on PATH directly", () => {
    expect(claudeLaunchFor(["-p"], host({ [join("C:\\tools", "claude.exe")]: "" })).command).toBe(
      join("C:\\tools", "claude.exe"),
    );
  });

  it("runs the script an npm shim points at with node", () => {
    const shim = join("C:\\npm", "claude.cmd");
    const script = join("C:\\npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    const launch = claudeLaunchFor(
      ["-p"],
      host({ [shim]: '"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*', [script]: "" }),
    );
    expect(launch).toEqual({ command: process.execPath, args: [script, "-p"], viaShim: false });
  });

  it("falls back to the shim when it names nothing runnable", () => {
    expect(claudeLaunchFor(["-p"], host({ [join("C:\\npm", "claude.cmd")]: "@echo off" })).viaShim).toBe(true);
  });
});

describe("progress", () => {
  it("names the tool and its main input, relative to the workspace when it is a path", () => {
    const workspace = join("/run", "workspace");
    expect(progressLine("theo", "Read", { file_path: join("/run", "docs", "fix.md") }, workspace)).toBe(
      "  theo › Read ../docs/fix.md",
    );
    expect(progressLine("newcomer", "Bash", { command: "npm  install\n -g x" }, workspace)).toBe(
      "  newcomer › Bash npm install -g x",
    );
    expect(progressLine("theo", "Bash", { command: "x".repeat(100) }, workspace)).toHaveLength(
      "  theo › Bash ".length + 80,
    );
  });

  it("reads every tool_use block of an assistant line", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading." },
          { type: "tool_use", name: "Read", input: { file_path: "a.md" } },
          { type: "tool_use", name: "Glob", input: { pattern: "**/*" } },
        ],
      },
    });
    expect(toolUses(line).map((u) => u.name)).toEqual(["Read", "Glob"]);
    expect(toolUses('{"type":"user"}')).toEqual([]);
    expect(toolUses("not json")).toEqual([]);
  });

  it("splits a stream into lines across chunk boundaries", () => {
    const lines: string[] = [];
    const split = lineSplitter((l) => lines.push(l));
    split.push('{"a":');
    split.push('1}\n{"b":2}\n{"c"');
    split.push(":3}");
    split.end();
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

describe("classifyRun", () => {
  const root = join("/tmp", "manni-task-x");

  it("reads a finished run as a normal end with its duration", () => {
    expect(classifyRun(run(recordedStream("stream-pass.jsonl", root), { code: 0 }), "task as newcomer")).toEqual({
      stoppedAtLimit: false,
      durationMs: 28426,
    });
  });

  it("reads the turn limit as a normal end that stopped there, whatever the exit code", () => {
    expect(classifyRun(run(recordedStream("stream-max-turns.jsonl", root)), "t1 as theo")).toEqual({
      stoppedAtLimit: true,
      durationMs: 10749,
    });
  });

  it("refuses a signed-out run with its own result text", () => {
    expect(() => classifyRun(run(recordedStream("stream-signed-out.jsonl", root)), "t1 as theo")).toThrow(
      new TestError("Claude Code stopped without a result for t1 as theo: Not logged in · Please run /login"),
    );
  });

  it("refuses a run with no result event, quoting its stderr", () => {
    expect(() => classifyRun(run('{"type":"system"}\n', { stderr: "boom\nAPI error 500" }), "task as newcomer")).toThrow(
      "Claude Code stopped without a result for task as newcomer: boom\nAPI error 500",
    );
  });

  it("says Claude Code is missing when it could not start", () => {
    expect(() => classifyRun(run("", { code: null, spawnError: "spawn claude ENOENT" }), "task as newcomer")).toThrow(
      "Claude Code is not on PATH. Install it with npm install -g @anthropic-ai/claude-code, sign in, and run again.",
    );
  });
});
