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

/**
 * How much of a child's output is kept, per stream. `gh` and `glab` answer
 * in JSON a page at a time, and a configured command reports one field's
 * value, so a stream past this is a program doing something else — `cat` on
 * the wrong file — and reading it to the end would trade the run's memory
 * for output nobody wants. The git walk caps itself the same way.
 */
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface Run {
  /** Exit code; `null` when a signal ended the child. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** A stream passed `MAX_OUTPUT_BYTES` and the child was killed. */
  tooLarge: boolean;
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
    let tooLarge = false;

    /**
     * Stop the child for good. `kill()` is SIGTERM, which a program may
     * trap, and `close` waits for the stdio streams as well as the exit —
     * a grandchild holding stdout keeps it pending. So the promise settles
     * here rather than waiting, and SIGKILL follows shortly after.
     *
     * `timer` is cleared here rather than left to `close`, for the same
     * reason: `close` is exactly the event this function refuses to wait
     * for. `clearTimeout` is idempotent, so the `close` handler may still
     * call it. The SIGKILL timer is deliberately not cleared — it is the
     * escalation, and it has to fire.
     *
     * `timer` is declared below this closure, so every caller must reach
     * `stop` from an async handler, as all of them do. Calling it straight
     * from the spawn path would hit the temporal dead zone.
     */
    const stop = (r: Omit<Run, "code">): void => {
      clearTimeout(timer);
      child.kill();
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
      finish({ code: null, ...r });
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        tooLarge = true;
        stop({ stdout, stderr, timedOut, tooLarge });
      }
    });
    // Drained *and* kept: a chatty CLI must not stall the pipe, and its last
    // line is what names the failure to the user.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT_BYTES) {
        tooLarge = true;
        stop({ stdout, stderr, timedOut, tooLarge });
      }
    });
    child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      stop({ stdout, stderr, timedOut, tooLarge });
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    // No binary on PATH lands here rather than throwing from spawn().
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      fail(err.code === "ENOENT" ? new BinMissing(err.message) : err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr, timedOut, tooLarge });
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
