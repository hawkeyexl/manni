/**
 * Command grader: runs a user-supplied (or manni docevals-generated) CLI command per
 * page. Exit code membership in `successExitCodes` (default [0]) decides
 * pass/fail; the output tail becomes the finding message.
 *
 * Working directory: page-sourced commands run from the page's directory (so
 * generated script paths like "manni-docevals/page.eval.mjs" resolve naturally);
 * config-sourced commands run from the config file's directory.
 */
import { dirname } from "node:path";
import type { Finding } from "../types.js";
import { outputTail } from "../../shared/exec.js";
import type { Grader, GraderContext, GraderTarget } from "./types.js";

function substitute(cmd: string[], file: string): string[] {
  return cmd.map((part) => part.replaceAll("{file}", file));
}

async function gradeOne(
  ctx: GraderContext,
  target: GraderTarget,
): Promise<Finding[]> {
  const { plan, eval: ev } = target;
  if (!ev.command) {
    return [
      {
        evalName: ev.name,
        file: plan.page.file,
        message:
          "No command to run, because the script is not generated. " +
          "Run manni docevals generate, or manni docevals run with a provider configured.",
        severity: ev.severity,
        diagnostic: true,
      },
    ];
  }
  const cwd =
    ev.source === "page" ? dirname(plan.page.absPath) : ctx.config.configDir;
  const result = await ctx.exec(substitute(ev.command, plan.page.absPath), {
    cwd,
    timeoutMs: ev.timeoutMs ?? ctx.config.scripts.timeoutMs,
    env: { MANNI_DOCEVALS_FILE: plan.page.absPath },
  });

  if (result.spawnError) {
    return [
      {
        evalName: ev.name,
        file: plan.page.file,
        message: `Failed to run command "${ev.command[0] ?? "(empty)"}": ${result.spawnError}. Fix the eval's command.`,
        severity: ev.severity,
        diagnostic: true,
      },
    ];
  }
  if (result.timedOut) {
    return [
      {
        evalName: ev.name,
        file: plan.page.file,
        message:
          `Command timed out after ${ev.timeoutMs ?? ctx.config.scripts.timeoutMs}ms. ` +
          "Fix the command, or raise the eval's timeout-ms if the check is slow by design.",
        severity: ev.severity,
        diagnostic: true,
      },
    ];
  }
  if (result.code != null && ev.successExitCodes.includes(result.code)) {
    return [];
  }
  const tail = outputTail(result);
  return [
    {
      evalName: ev.name,
      file: plan.page.file,
      // "Exit code N" is the message users and docs already know; only the
      // null case — killed by a signal, which is what a timeout produces —
      // needs different words, because "Exit code null" describes nothing.
      // The output comes last, so the direction is never cut off by it.
      message:
        (result.code === null ? "Killed before exiting." : `Exit code ${result.code}.`) +
        " Edit the page until the command passes, or fix the command if it is broken." +
        (tail ? ` Output: ${tail}` : ""),
      severity: ev.severity,
    },
  ];
}

export const commandGrader: Grader = {
  kind: "command",
  mode: "per-file",
  async grade(ctx) {
    const findings: Finding[] = [];
    for (const target of ctx.targets) {
      findings.push(...(await gradeOne(ctx, target)));
    }
    return findings;
  },
};
