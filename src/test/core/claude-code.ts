/**
 * The Claude Code process seam: the only module that starts `claude`. Unit
 * tests inject a `ClaudeCodeSpawn`; the real one is `realClaudeCodeSpawn`.
 *
 * The argv is the one the build's spike settled (plan §4.5): stream-json out,
 * no session saved, none of the user's settings, plugins, hooks or MCP
 * servers, a fixed tool set, and permission to use exactly that set without
 * asking. Whether a run produced a result is read from its final `result`
 * event, never from the exit code, which is 1 both at the turn limit and
 * when Claude Code is signed out.
 */
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExecResult } from "@hawkeyexl/inference";
import { outputTail, realExec } from "../../shared/exec.js";
import { TestError } from "../errors.js";

/**
 * Start Claude Code with `args` (its own flags, no program name), feed it
 * `stdin`, and wait. Each stdout chunk is handed to `onStdout` as it arrives;
 * the output is also returned whole.
 */
export type ClaudeCodeSpawn = (
  args: string[],
  opts: {
    cwd: string;
    stdin: string;
    env: Record<string, string | undefined>;
    onStdout: (chunk: string) => void;
  },
) => Promise<ExecResult>;

export const CLAUDE_CODE_NOT_ON_PATH =
  "Claude Code is not on PATH. Install it with npm install -g @anthropic-ai/claude-code, sign in, and run again.";

/** The tools the synthetic user gets. `Bash` and no `PowerShell`, so a golden eval naming `Bash` holds on Windows. */
export const TASK_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch"] as const;

/** No timeout: the turn limit bounds a run. */
const NO_TIMEOUT = 2 ** 31 - 1;

export interface ClaudeCodeArgs {
  roleFile: string;
  maxTurns: number;
  model?: string;
  /** Absolute. */
  mcpConfig?: string;
  /** The server names in `mcpConfig`, each allowed as `mcp__<name>`. */
  mcpServers: string[];
  /** The docs copy, for a path start. */
  docsDir: string | null;
}

export function claudeCodeArgs(opts: ClaudeCodeArgs): string[] {
  const tools = TASK_TOOLS.join(",");
  const allowed = [...TASK_TOOLS, ...opts.mcpServers.map((name) => `mcp__${name}`)].join(",");
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    ...(opts.mcpConfig === undefined ? [] : ["--mcp-config", opts.mcpConfig]),
    "--tools",
    tools,
    "--allowedTools",
    allowed,
    "--permission-mode",
    "dontAsk",
    "--append-system-prompt-file",
    opts.roleFile,
    "--max-turns",
    String(opts.maxTurns),
    ...(opts.model === undefined ? [] : ["--model", opts.model]),
    ...(opts.docsDir === null ? [] : ["--add-dir", opts.docsDir]),
  ];
}

/** The `mcpServers` names in an MCP config file. */
export function mcpServerNames(path: string, label: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new TestError(`${label} is not a JSON file Claude Code can read.`);
  }
  const servers =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["mcpServers"] : undefined;
  return typeof servers === "object" && servers !== null && !Array.isArray(servers) ? Object.keys(servers) : [];
}

/**
 * The environment Claude Code runs in: the caller's, with the npm global
 * prefix moved into the run, and that prefix's bin first on PATH, so a
 * global install the docs ask for lands in the run and goes with it.
 */
export function claudeCodeEnv(
  globalDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  // Windows keeps the variable as `Path`; a second `PATH` beside it is ambiguous.
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const bin = platform === "win32" ? globalDir : join(globalDir, "bin");
  const current = env[pathKey];
  const sepr = platform === "win32" ? ";" : ":";
  return {
    ...env,
    NPM_CONFIG_PREFIX: globalDir,
    [pathKey]: current === undefined || current === "" ? bin : `${bin}${sepr}${current}`,
  };
}

/** One line per tool call, for `--progress`. */
export function progressLine(who: string, tool: string, input: Record<string, unknown>, workspaceDir: string): string {
  const main =
    ["file_path", "path", "command", "pattern", "url", "query"].map((k) => input[k]).find((v) => typeof v === "string") ??
    Object.values(input).find((v) => typeof v === "string");
  let shown = typeof main === "string" ? main.replace(/\s+/g, " ").trim() : "";
  if (isAbsolute(shown) && !/\s/.test(shown)) {
    shown = relative(workspaceDir, shown).split(sep).join("/");
  }
  return `  ${who} › ${tool}${shown === "" ? "" : ` ${shown.slice(0, 80)}`}`;
}

/** The `tool_use` blocks in one stream-json line. */
export function toolUses(line: string): { name: string; input: Record<string, unknown> }[] {
  const rec = parseLine(line);
  if (rec?.["type"] !== "assistant") return [];
  const message = rec["message"];
  const content =
    typeof message === "object" && message !== null ? (message as Record<string, unknown>)["content"] : undefined;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: unknown) => {
    if (typeof block !== "object" || block === null) return [];
    const b = block as Record<string, unknown>;
    if (b["type"] !== "tool_use" || typeof b["name"] !== "string") return [];
    const input = typeof b["input"] === "object" && b["input"] !== null ? (b["input"] as Record<string, unknown>) : {};
    return [{ name: b["name"], input }];
  });
}

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    const rec: unknown = JSON.parse(line);
    return typeof rec === "object" && rec !== null && !Array.isArray(rec) ? (rec as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Calls `onLine` with each complete line of a stream fed in chunks. */
export function lineSplitter(onLine: (line: string) => void): { push(chunk: string): void; end(): void } {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      let at = buffer.indexOf("\n");
      while (at !== -1) {
        onLine(buffer.slice(0, at).trim());
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf("\n");
      }
    },
    end() {
      if (buffer.trim() !== "") onLine(buffer.trim());
      buffer = "";
    },
  };
}

export interface RunOutcome {
  stoppedAtLimit: boolean;
  durationMs: number;
}

/**
 * Read the run's final `result` event. The turn limit is a normal end; an
 * error result, or none at all, means Claude Code never did the task.
 */
export function classifyRun(result: ExecResult, label: string): RunOutcome {
  if (result.spawnError !== undefined) throw new TestError(CLAUDE_CODE_NOT_ON_PATH);
  let last: Record<string, unknown> | undefined;
  for (const line of result.stdout.split("\n")) {
    const rec = parseLine(line.trim());
    if (rec?.["type"] === "result") last = rec;
  }
  const durationMs = typeof last?.["duration_ms"] === "number" ? last["duration_ms"] : 0;
  if (last?.["subtype"] === "error_max_turns") return { stoppedAtLimit: true, durationMs };
  if (last !== undefined && last["is_error"] !== true) return { stoppedAtLimit: false, durationMs };
  const said = typeof last?.["result"] === "string" && last["result"].trim() !== "" ? last["result"].trim() : undefined;
  const why = said ?? (outputTail(result) || `exit ${String(result.code)}`);
  throw new TestError(`Claude Code stopped without a result for ${label}: ${why}`);
}

/** How Claude Code is started on this host. */
export interface ClaudeLaunch {
  command: string;
  args: string[];
  /** Only a `.cmd` shim with no script to run directly: started through `realExec`, without streaming. */
  viaShim: boolean;
}

/**
 * On Windows, Node starts a `.exe` on PATH but not a `.cmd` shim. An npm
 * global install puts a shim there, so the program it points at is run
 * directly: a script with node, an executable as is.
 */
export function claudeLaunchFor(
  args: string[],
  host: { platform: NodeJS.Platform; path: string; isFile: (path: string) => boolean; read: (path: string) => string },
): ClaudeLaunch {
  if (host.platform !== "win32") return { command: "claude", args, viaShim: false };
  for (const entry of host.path.split(";")) {
    const dir = entry.replace(/^"(.*)"$/, "$1");
    if (dir === "") continue;
    const exe = join(dir, "claude.exe");
    if (host.isFile(exe)) return { command: exe, args, viaShim: false };
    const shim = join(dir, "claude.cmd");
    if (!host.isFile(shim)) continue;
    const target = /"%~?dp0%?\\([^"]+)"/.exec(host.read(shim))?.[1];
    const abs = target === undefined ? undefined : resolve(dirname(shim), target);
    if (abs !== undefined && host.isFile(abs)) {
      const ext = extname(abs).toLowerCase();
      if (ext === ".js" || ext === ".cjs" || ext === ".mjs") {
        return { command: process.execPath, args: [abs, ...args], viaShim: false };
      }
      if (ext === ".exe") return { command: abs, args, viaShim: false };
    }
    break;
  }
  return { command: "claude", args, viaShim: true };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export const realClaudeCodeSpawn: ClaudeCodeSpawn = async (args, opts) => {
  const launch = claudeLaunchFor(args, {
    platform: process.platform,
    path: process.env["PATH"] ?? "",
    isFile,
    read: (path) => readFileSync(path, "utf8"),
  });
  if (launch.viaShim) {
    // ponytail: a shim with no script beside it is captured and replayed
    // rather than streamed live.
    const result = await realExec([launch.command, ...launch.args], {
      cwd: opts.cwd,
      env: opts.env,
      input: opts.stdin,
      timeoutMs: NO_TIMEOUT,
    });
    opts.onStdout(result.stdout);
    return result;
  }
  return new Promise((settle) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(launch.command, launch.args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.stdin);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      opts.onStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      settle({ code: null, stdout, stderr, timedOut: false, spawnError: err.message });
    });
    child.on("close", (code) => {
      settle({ code, stdout, stderr, timedOut: false });
    });
  });
};
