/**
 * One child process, run to completion: stdout collected, stderr drained and
 * kept for the message, a timer that kills it. The review sources reach `gh`
 * and `glab` through this, and the `command` source reaches whatever the
 * config names; neither holds a token or opens a socket of its own.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** How a client reaches the binary; tests point `bin` at node and a fake script. */
export interface SpawnOptions {
  /** Defaults to `gh` / `glab`, resolved on PATH. */
  bin?: string;
  /** Arguments placed before the command's own, such as a script for `node`. */
  prefixArgs?: string[];
  cwd: string;
  /** Kill the child after this long. Default 30 s. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface Run {
  /** Exit code; `null` when a signal ended the child. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** The binary could not be started at all: nothing on PATH by that name. */
export class BinMissing extends Error {}

/** One child, stdout collected, stderr drained and kept for the message. */
export function run(bin: string, args: string[], opts: SpawnOptions): Promise<Run> {
  return new Promise((settle, reject) => {
    let done = false;
    const finish = (r: Run): void => {
      if (done) return;
      done = true;
      settle(r);
    };
    const fail = (err: Error): void => {
      if (done) return;
      done = true;
      reject(err);
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, [...(opts.prefixArgs ?? []), ...args], {
        cwd: opts.cwd,
        windowsHide: true,
      });
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    // Drained *and* kept: a chatty CLI must not stall the pipe, and its last
    // line is what names the failure to the user.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    // No binary on PATH lands here rather than throwing from spawn().
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      fail(err.code === "ENOENT" ? new BinMissing(err.message) : err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr, timedOut });
    });
  });
}

/** `gh api --hostname h repos/…`: the command as the user would type it. */
export function commandLine(bin: string, args: readonly string[]): string {
  return [bin, ...args].join(" ");
}

export function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.at(-1) ?? "";
}
