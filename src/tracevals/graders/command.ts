/**
 * Command-graded evals: run an executable over the trace and read its exit
 * code (ADR 01011).
 *
 * This grader executes a program named in an artifact's front matter, and
 * artifacts are resolved from the trace's own project tree — so running an
 * eval over someone else's trace can run code that repository declares. That
 * is the documented behavior, not an oversight. The engine runs it only under
 * the `frontmatter-commands` execution grant, which every run holds unless the
 * operator narrows it (proposal 0075). Two properties bound it:
 *
 *  - argv is passed as an array with `shell: false`, so nothing in an artifact
 *    is ever parsed as shell syntax — no pipes, redirects, or `$(...)`.
 *  - `timeout-ms` always has a finite value, so a hung check fails the eval
 *    rather than the run.
 *
 * `{trace}` is substituted in every argv element (the artifact-side analog of
 * the page side's `{file}`).
 */
import { createHash } from "node:crypto";
import { realExec } from "../../shared/exec.js";
import type { GradeResult, TraceGrader, TraceGraderContext } from "./types.js";

/** Bounded by default: a check with no stated timeout still cannot hang. */
export const DEFAULT_TIMEOUT_MS = 30_000;

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
    const timeoutMs = plan.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const successCodes = plan.successExitCodes ?? [0];

    const run = await execute(argv, ctx.projectRoot ?? trace.cwd, timeoutMs);

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

/**
 * One run of the check, through the family's exec wrapper (`src/shared/exec.ts`),
 * the one `manni docevals` runs its command evals through. It spawns argv as
 * an array without a shell, resolves npm `.cmd` shims on Windows, and settles
 * on the timeout itself rather than waiting for a child that ignores it.
 */
async function execute(
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<Execution> {
  const result = await realExec(argv, { cwd, timeoutMs });
  return {
    code: result.code,
    // Capped here, not merely when printed: a check script can write far more
    // to stderr than a report should carry.
    stderr: result.stderr.slice(0, STDERR_LIMIT),
    timedOut: result.timedOut,
    ...(result.spawnError === undefined ? {} : { spawnError: result.spawnError }),
  };
}

interface Execution {
  code: number | null;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}
