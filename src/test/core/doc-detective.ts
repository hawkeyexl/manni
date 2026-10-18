/**
 * The Doc Detective process seam: the only module that starts `doc-detective`.
 * Unit tests inject a `DocDetectiveSpawn`; the real one is `realSpawn`.
 *
 * On Windows an npm global install puts a `.cmd` shim on PATH, and `cmd.exe`
 * caps the command line it runs at 8191 characters, which a collection of a
 * few hundred pages passes. So the bin script the shim points at is run with
 * node directly. Only when no script sits beside the shim does the shim run,
 * through `realExec`, which knows how to start one without a shell.
 */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { ExecResult } from "@hawkeyexl/inference";
import { realExec } from "../../shared/exec.js";
import { TestError } from "../errors.js";

/**
 * Start Doc Detective with `args` (its own flags, no program name) and wait
 * for it. `progress` streams its output to stderr as it runs; the output is
 * captured either way.
 */
export type DocDetectiveSpawn = (
  args: string[],
  opts: { cwd: string; progress: boolean },
) => Promise<ExecResult>;

/** How Doc Detective is started on this host. */
export interface Launch {
  command: string;
  args: string[];
  /** Started through a Windows `.cmd` shim, so `cmd.exe`'s cap applies. */
  viaShim: boolean;
}

export const NOT_ON_PATH =
  "doc-detective is not on PATH. Install Doc Detective (npm install -g doc-detective) to run doc tests.";

const COMMAND_LINE_LIMIT =
  "the selected inputs exceed the command-line limit. Narrow the collection, or set input in the Doc Detective config.";

/** No timeout: a docs suite runs as long as its tests do. */
const NO_TIMEOUT = 2 ** 31 - 1;

export function launchFor(
  args: string[],
  host: { platform: NodeJS.Platform; path: string; isFile: (path: string) => boolean },
): Launch {
  if (host.platform !== "win32") return { command: "doc-detective", args, viaShim: false };
  // Windows lets a PATH entry be quoted, as in "C:\Program Files\nodejs".
  for (const entry of host.path.split(";")) {
    const dir = entry.replace(/^"(.*)"$/, "$1");
    if (dir === "" || !host.isFile(join(dir, "doc-detective.cmd"))) continue;
    const script = join(dir, "node_modules", "doc-detective", "bin", "doc-detective.js");
    if (host.isFile(script)) {
      return { command: process.execPath, args: [script, ...args], viaShim: false };
    }
    break;
  }
  return { command: "doc-detective", args, viaShim: true };
}

/**
 * Refuse a command line Windows would truncate or reject.
 *
 * ponytail: Windows caps a command line at 32,767 characters, and at 8,191
 * through a `.cmd` shim. Past the cap the run is refused. The upgrade path is
 * running the inputs in batches and merging the results files.
 */
export function assertFitsCommandLine(launch: Launch, platform: NodeJS.Platform): void {
  if (platform !== "win32") return;
  // Each argument costs its quotes and the space before it.
  const length = [launch.command, ...launch.args].reduce((n, arg) => n + arg.length + 3, 0);
  if (length > (launch.viaShim ? 8_191 : 32_767)) throw new TestError(COMMAND_LINE_LIMIT);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function streamed(launch: Launch, opts: { cwd: string; progress: boolean }): Promise<ExecResult> {
  return new Promise((settle) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(launch.command, launch.args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (opts.progress) process.stderr.write(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (opts.progress) process.stderr.write(chunk);
    });
    child.on("error", (err) => {
      settle({ code: null, stdout, stderr, timedOut: false, spawnError: err.message });
    });
    child.on("close", (code) => {
      settle({ code, stdout, stderr, timedOut: false });
    });
  });
}

export const realSpawn: DocDetectiveSpawn = async (args, opts) => {
  const launch = launchFor(args, {
    platform: process.platform,
    path: process.env["PATH"] ?? "",
    isFile,
  });
  assertFitsCommandLine(launch, process.platform);
  if (!launch.viaShim) return streamed(launch, opts);
  // ponytail: the shim path captures and replays rather than streaming live.
  // It runs only when a shim has no bin script beside it.
  const result = await realExec([launch.command, ...launch.args], {
    cwd: opts.cwd,
    timeoutMs: NO_TIMEOUT,
  });
  if (opts.progress) process.stderr.write(result.stdout + result.stderr);
  return result;
};
