/**
 * Command-graded evals: run an executable over the trace and read its exit
 * code (ADR 01011).
 *
 * This grader executes a program named in an artifact's front matter, and
 * artifacts are resolved from the trace's own project tree — so running an
 * eval over someone else's trace can run code that repository declares. That
 * is the documented behavior, not an oversight. Two properties bound it:
 *
 *  - argv is passed as an array with `shell: false`, so nothing in an artifact
 *    is ever parsed as shell syntax — no pipes, redirects, or `$(...)`.
 *  - `timeout-ms` always has a finite value, so a hung check fails the eval
 *    rather than the run.
 *
 * `{trace}` is substituted in every argv element (the artifact-side analog of
 * the page side's `{file}`).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { GradeResult, TraceGrader, TraceGraderContext } from "./types.js";

/** Bounded by default: a check with no stated timeout still cannot hang. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * How long a timed-out child gets between SIGTERM and SIGKILL. It costs the run
 * nothing — the eval has already been settled as a timeout by then — so this is
 * purely the grace a well-behaved check script gets to clean up.
 */
const KILL_GRACE_MS = 2000;

/** Enough stderr to diagnose a failure without pasting a log into a report. */
const STDERR_LIMIT = 2000;

/**
 * Deliberately no `validateOptions`. This grader takes no `options`: its whole
 * configuration is the entry's own `command` family, whose shape and guard
 * rails the schema already pins. Omitting the hook is also what keeps `fill`
 * from ever proposing a command grader — "a kind without it cannot be
 * proposed" is the registry's existing contract (ADR 01004).
 */
export const commandGrader: TraceGrader = {
  kind: "command",

  async grade(ctx: TraceGraderContext): Promise<GradeResult> {
    const { plan, trace } = ctx;

    if (!plan.command || plan.command.length === 0) {
      // The schema permits `grader: command` with no command: it is the
      // generation contract's first state, where tooling is expected to write
      // a check script back. This tool generates nothing, and an eval that
      // cannot run must not read as a pass.
      return {
        findings: [],
        error:
          "command-graded eval has no `command`; add one (or remove the eval) — manni tracevals does not generate check scripts",
      };
    }

    if (plan.generatedAssertionHash !== undefined) {
      // A hash without an assertion is a half write-back: the hash exists to
      // detect that the assertion it was generated from has changed, and with
      // no assertion there is nothing it could be checked against. Reporting
      // it beats hashing the empty string and passing.
      if (plan.assertion === undefined) {
        return {
          findings: [],
          error:
            "generated-assertion-hash is present but the eval has no assertion, " +
            "so the hash cannot be checked against anything; remove the hash or restore the assertion",
        };
      }
      const actual = createHash("sha256").update(plan.assertion).digest("hex");
      if (actual !== plan.generatedAssertionHash) {
        return {
          findings: [],
          error:
            "assertion has changed since the command was generated " +
            `(generated-assertion-hash ${plan.generatedAssertionHash.slice(0, 12)}…, ` +
            `assertion now hashes to ${actual.slice(0, 12)}…); regenerate the command or update the hash`,
        };
      }
    }

    const argv = plan.command.map((part) => part.replaceAll("{trace}", trace.file));
    const [file, ...args] = argv as [string, ...string[]];
    const timeoutMs = plan.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const successCodes = plan.successExitCodes ?? [0];

    const run = await execute(file, args, ctx.projectRoot ?? trace.cwd, timeoutMs);

    if (run.timedOut) {
      return {
        findings: [],
        error: `command timed out after ${timeoutMs}ms: ${argv.join(" ")}`,
      };
    }
    if (run.spawnError !== undefined) {
      return { findings: [], error: `could not run command: ${run.spawnError}` };
    }
    if (run.code !== null && successCodes.includes(run.code)) {
      return { findings: [] };
    }

    const detail = run.stderr.trim();
    return {
      findings: [
        {
          evalName: plan.evalName,
          artifact: plan.artifact.path,
          severity: plan.severity,
          message:
            `command exited ${run.code ?? "on a signal"} ` +
            `(expected ${successCodes.join(" or ")})` +
            (detail ? `: ${detail.slice(0, STDERR_LIMIT)}` : ""),
        },
      ],
    };
  },
};

interface Execution {
  code: number | null;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

function execute(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<Execution> {
  return new Promise((resolve) => {
    // shell:false is the whole containment: argv reaches the OS as arguments,
    // never as a command line something else could reinterpret.
    //
    // stdout is discarded rather than piped. A piped stream nobody reads fills
    // the OS buffer at ~64KB and blocks the child mid-write forever, so a check
    // script that printed its reasoning would be reported as a timeout instead
    // of the verdict its exit code carries. Only the exit code and stderr are
    // ever used, so there is nothing to gain by keeping the pipe.
    const child = spawn(file, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const done = (result: Execution): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      // Ask, then insist. Both signals in one tick would make the SIGTERM dead
      // code — SIGKILL wins before SIGTERM can be delivered — so the escalation
      // gets its own timer, and a check script that cleans up after itself is
      // given the chance to.
      child.kill();
      hardKill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      // Settle on the timeout itself rather than waiting for `close`. A child
      // that traps SIGTERM never closes, and waiting for it would hang the
      // whole run — the opposite of what a timeout is for.
      done({ code: null, stderr, timedOut: true });
    }, timeoutMs);
    // Never hold the process open on this grader's account.
    timer.unref?.();

    child.stderr?.on("data", (chunk: Buffer) => {
      // Slice on append, not merely before it: a single oversized chunk would
      // otherwise be retained whole just because the buffer was empty.
      if (stderr.length < STDERR_LIMIT) {
        stderr = (stderr + chunk.toString()).slice(0, STDERR_LIMIT);
      }
    });
    // Clearing the escalation on exit matters: a SIGTERM the child honored
    // would otherwise leave a live 2s timer holding the process open.
    child.on("error", (err) => {
      if (hardKill) clearTimeout(hardKill);
      done({ code: null, stderr, timedOut, spawnError: err.message });
    });
    child.on("close", (code) => {
      if (hardKill) clearTimeout(hardKill);
      done({ code, stderr, timedOut });
    });
  });
}
