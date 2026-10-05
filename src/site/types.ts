/** The three jobs `manni site` runs. */
export type Verb = "start" | "build" | "preview";

/**
 * One thing the runner does. `exec` spawns argv directly, `shell` runs a
 * user-written command line through the shell, and `static` serves a
 * directory with the built-in server until the process is stopped.
 */
export type Step =
  | { kind: "exec"; argv: string[]; cwd: string }
  | { kind: "shell"; command: string; cwd: string }
  | { kind: "static"; root: string; host: string; port: number; base: string };

/**
 * A resolved step plus the stderr line announcing it, e.g.
 * `Starlight in docs/. Running npm run dev -- --port 4321`.
 * `announce` is printed without the program-name prefix; the runner adds it.
 */
export interface PlannedStep {
  announce: string;
  /** What "exited with code N" names, e.g. `npm run build`. */
  display: string;
  /**
   * The whole message when an `exec` step's binary is not on PATH, e.g.
   * `mint not found on PATH. Install Mintlify's CLI, or set site.commands.start.`
   */
  notFound: string;
  step: Step;
}

/** What a verb resolves to: its steps in order (`preview` is build, then serve). */
export interface Plan {
  steps: PlannedStep[];
}
