/**
 * The runner: carries out a `Plan` step by step, with the child's stdio
 * inherited so the framework's own output is the output. No timeout, because
 * the last step of `start` and `preview` is a server that runs until Ctrl-C.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { launcherCommandLine } from "../../shared/batch-launcher.js";
import { notice } from "../../shared/warn.js";
import { SiteError } from "../errors.js";
import type { Plan, PlannedStep, Step } from "../types.js";
import { serveStatic } from "./static-server.js";

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where `name` resolves, the way the OS would find it: a name with a separator
 * against `cwd`, a bare one along PATH. On Windows a name without one of
 * PATHEXT's extensions is tried with each in turn, so `npm` finds `npm.cmd`.
 */
function findOnPath(name: string, cwd: string): string | undefined {
  const win = process.platform === "win32";
  const exts = win
    ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e !== "")
    : [];
  const lower = name.toLowerCase();
  const names =
    win && !exts.some((e) => lower.endsWith(e.toLowerCase())) ? exts.map((e) => name + e) : [name];
  const dirs = /[\\/]/.test(name)
    ? [cwd]
    : (process.env["PATH"] ?? "").split(delimiter).filter((d) => d !== "");
  for (const dir of dirs) {
    for (const candidate of names) {
      const path = resolve(dir, candidate);
      if (isExecutable(path)) return path;
    }
  }
  return undefined;
}

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
      reject(err.code === "ENOENT" ? new SiteError(planned.notFound) : err);
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
