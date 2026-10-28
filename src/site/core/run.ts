/**
 * The runner: carries out a `Plan` step by step, with the child's stdio
 * inherited so the framework's own output is the output. No timeout, because
 * the last step of `start` and `preview` is a server that runs until Ctrl-C.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { launcherCommandLine } from "../../shared/batch-launcher.js";
import { findOnPath } from "../../shared/find-on-path.js";
import { notice } from "../../shared/warn.js";
import { renderAnnotate, runAnnotate } from "../commands/annotate.js";
import { SiteError } from "../errors.js";
import type { Plan, PlannedStep, Step } from "../types.js";
import { serveStatic } from "./static-server.js";

function startExec(planned: PlannedStep, step: Extract<Step, { kind: "exec" }>): ChildProcess {
  const [name, ...args] = step.argv;
  const binary = name === undefined ? undefined : findOnPath(name, step.cwd);
  if (binary === undefined) throw new SiteError(planned.notFound);
  const line = launcherCommandLine(
    binary,
    args,
    (value) => new SiteError(`${planned.display} cannot be given an argument containing a quote: ${value}`),
  );
  return spawn(line.command, line.argv, {
    cwd: step.cwd,
    stdio: "inherit",
    windowsVerbatimArguments: line.verbatim,
  });
}

function exitOf(
  planned: PlannedStep,
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((settle, reject) => {
    child.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "ENOENT"
          ? new SiteError(planned.notFound)
          : new SiteError(`${planned.display} could not start: ${err.message}`),
      );
    });
    child.once("exit", (code, signal) => {
      settle({ code, signal });
    });
  });
}

/**
 * One step; resolves true when the user stopped it. While any step runs this
 * process ignores SIGINT itself (the terminal delivers Ctrl-C to the whole
 * process group, child included) and forwards SIGTERM, which reaches this
 * process alone, so a cancelled build is not left running. An exit after
 * either is a stop the user asked for, so it is not a failure whatever code
 * the child chose. Otherwise the step must exit 0.
 */
async function runStep(planned: PlannedStep): Promise<boolean> {
  const { step } = planned;
  if (step.kind === "static") {
    await serveStatic(step);
    return true;
  }
  if (step.kind === "annotate") {
    const { cwd, dir, configPath } = step;
    const report = runAnnotate({ cwd, dir, ...(configPath === undefined ? {} : { configPath }) });
    process.stdout.write(`${renderAnnotate(report, "pretty")}
`);
    return false;
  }
  const child =
    step.kind === "exec"
      ? startExec(planned, step)
      : spawn(step.command, { cwd: step.cwd, stdio: "inherit", shell: true });
  // An object, not a `let`: TypeScript cannot see the handlers assign it.
  const signal = { received: false };
  const onInt = (): void => {
    signal.received = true;
  };
  const onTerm = (): void => {
    signal.received = true;
    child.kill("SIGTERM");
  };
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    const exit = await exitOf(planned, child);
    if (signal.received) return true;
    if (exit.code === 0) return false;
    throw new SiteError(
      exit.code === null
        ? `${planned.display} was stopped by ${String(exit.signal)}.`
        : `${planned.display} exited with code ${String(exit.code)}.`,
    );
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
}

/** Run every step in order. Resolves the exit code, 0; a failure throws `SiteError`. */
export async function runPlan(plan: Plan): Promise<number> {
  for (const planned of plan.steps) {
    if (planned.announce !== "") notice(planned.announce);
    // A stop during the build ends the run there: nothing is served.
    if (await runStep(planned)) break;
  }
  return 0;
}
