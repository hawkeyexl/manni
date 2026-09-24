/**
 * The Vale process seam (proposal 0052 § 6). The only module that starts Vale.
 *
 * manni asks Vale rather than reading its files: `vale --output=JSON` for the
 * alerts, `vale ls-config` for the resolved configuration. Vale is started with
 * an argv, never a shell string, and what it prints is validated here, because
 * it crosses a process boundary.
 */
import { execFile } from "node:child_process";
import type { ValeSeverity } from "../types.js";
import { TermError } from "../errors.js";

/** One alert, as `vale --output=JSON` prints it, trimmed to the fields manni reads. */
export interface ValeAlert {
  Check: string;
  Message: string;
  Line: number;
  Span: [number, number];
  Severity: ValeSeverity;
}

/** `vale --output=JSON`: the path Vale printed for each file, to its alerts. */
export type ValeAlerts = Record<string, ValeAlert[]>;

/** What `vale ls-config` resolved. */
export interface ValeResolvedConfig {
  /** The project's styles directory: the last entry of Vale's `Paths`. */
  stylesPath: string;
  /** The config file Vale resolved. */
  rootIni: string;
  /** Each section glob to its `BasedOnStyles`. */
  baseStyles: Record<string, string[]>;
}

export interface ValeProcessResult {
  /** Vale's exit code; `null` when a signal ended it. */
  code: number | null;
  /**
   * The signal that ended it, when one did, and `code` is then null. Optional
   * because absent means what it says: the run was not killed.
   */
  signal?: string | null;
  stdout: string;
  stderr: string;
}

/**
 * Start `vale` with `args` and wait for it. Resolves for any exit; rejects when
 * the process could not start, with an error whose `code` is `ENOENT` when
 * there is no `vale` on PATH. Tests inject a stub.
 */
export type ValeSpawn = (args: string[], opts: { cwd?: string }) => Promise<ValeProcessResult>;

const MAX_BUFFER = 64 * 1024 * 1024;

const SEVERITIES: readonly ValeSeverity[] = ["error", "warning", "suggestion"];

export const spawnVale: ValeSpawn = (args, opts) =>
  new Promise((settle, reject) => {
    execFile(
      "vale",
      args,
      { cwd: opts.cwd, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) {
          settle({ code: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === "number") {
          settle({ code: error.code, stdout, stderr });
          return;
        }
        // Killed by a signal. Node reports the exit code as **null** here,
        // not as undefined, so testing for undefined never matched: a killed
        // run fell through to `reject` and surfaced as though Vale could not
        // start. Settling instead keeps whatever Vale managed to write, which
        // is the part a reader can act on.
        if (error.code == null && typeof error.signal === "string") {
          settle({ code: null, signal: error.signal, stdout, stderr });
          return;
        }
        // A start failure (ENOENT) or an output over the buffer.
        const failure: Error = error;
        reject(failure);
      },
    );
  });

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

async function start(
  spawn: ValeSpawn,
  args: string[],
  cwd: string | undefined,
  missing: string,
): Promise<ValeProcessResult> {
  try {
    return await spawn(args, { cwd });
  } catch (err) {
    if (isEnoent(err)) throw new TermError(missing);
    throw err;
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Vale's own account of a failure. Under `--output=JSON` it prints its error
 * as a JSON object whose `Text` is the message; otherwise the stderr is the
 * message.
 */
function failureText(result: ValeProcessResult): string {
  const stderr = result.stderr.trim();
  try {
    const parsed: unknown = JSON.parse(stderr);
    if (isMapping(parsed) && typeof parsed["Text"] === "string") return parsed["Text"].trim();
  } catch {
    // Not JSON: the stderr is the message.
  }
  if (stderr !== "") return stderr;
  // Vale said nothing, so the ending is the only account there is. A signal
  // leaves no message behind, and "exit code null" names nothing a reader can
  // act on.
  if (result.signal != null) return `killed by ${result.signal}`;
  return `exit code ${String(result.code)}`;
}

function parseJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new TermError(`vale printed ${what} that is not JSON: ${stdout.trim().slice(0, 200)}`);
  }
}

function parseAlert(raw: unknown, path: string): ValeAlert {
  const unreadable = (): TermError =>
    new TermError(`vale printed an alert for ${path} that manni cannot read: ${JSON.stringify(raw)}`);
  if (!isMapping(raw)) throw unreadable();
  const { Check, Message, Line, Span, Severity } = raw;
  if (typeof Check !== "string" || typeof Message !== "string" || typeof Line !== "number") throw unreadable();
  if (!Array.isArray(Span) || Span.length !== 2) throw unreadable();
  const span: unknown[] = Span;
  const [from, to] = span;
  if (typeof from !== "number" || typeof to !== "number") throw unreadable();
  const severity = SEVERITIES.find((s) => s === Severity);
  if (severity === undefined) throw unreadable();
  return { Check, Message, Line, Span: [from, to], Severity: severity };
}

function parseAlerts(stdout: string): ValeAlerts {
  const parsed = parseJson(stdout, "alerts");
  if (!isMapping(parsed)) throw new TermError("vale printed alerts that are not a JSON object.");
  const alerts: ValeAlerts = {};
  for (const [path, list] of Object.entries(parsed)) {
    if (!Array.isArray(list)) throw new TermError(`vale printed alerts for ${path} that are not a list.`);
    alerts[path] = list.map((raw: unknown) => parseAlert(raw, path));
  }
  return alerts;
}

/**
 * `vale --output=JSON [--config <config>] <files...>`. Exit 0 (no error-level
 * alert) and exit 1 (at least one) both carry alerts; any other exit means
 * Vale could not run.
 */
export async function runValeJson(
  files: string[],
  opts: { config?: string; cwd?: string },
  spawn: ValeSpawn = spawnVale,
): Promise<ValeAlerts> {
  const args = ["--output=JSON", ...(opts.config === undefined ? [] : ["--config", opts.config]), ...files];
  const result = await start(spawn, args, opts.cwd, "vale is not on PATH. Install Vale to lint definitions.");
  if (result.code !== 0 && result.code !== 1) {
    throw new TermError(`vale could not lint definitions: ${failureText(result)}`);
  }
  return parseAlerts(result.stdout);
}

const NO_CONFIG = /no config file found|\.vale\.ini not found/i;

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string") return undefined;
    list.push(item);
  }
  return list;
}

/**
 * `vale [--config <config>] ls-config`, run in `cwd`. `null` when Vale finds no
 * config file, which is a state the caller reports, not a failure to run.
 */
export async function valeLsConfig(
  opts: { config?: string; cwd: string },
  spawn: ValeSpawn = spawnVale,
): Promise<ValeResolvedConfig | null> {
  const args = [...(opts.config === undefined ? [] : ["--config", opts.config]), "ls-config"];
  const result = await start(
    spawn,
    args,
    opts.cwd,
    "vale is not on PATH. Install Vale, or pass -o <styles directory>.",
  );
  if (result.code !== 0) {
    const text = failureText(result);
    if (NO_CONFIG.test(text)) return null;
    throw new TermError(`vale could not resolve its configuration: ${text}`);
  }

  const parsed = parseJson(result.stdout, "a configuration");
  if (!isMapping(parsed)) throw new TermError("vale printed a configuration that is not a JSON object.");

  const paths = stringList(parsed["Paths"]);
  const stylesPath = paths?.[paths.length - 1];
  if (stylesPath === undefined || stylesPath === "") {
    throw new TermError(
      "vale's configuration names no styles directory. Set StylesPath in it, or pass -o <styles directory>.",
    );
  }

  // Under --config, Vale 3.20.0 leaves RootINI empty and names the file in ConfigFiles.
  const root = parsed["RootINI"];
  const configFiles = stringList(parsed["ConfigFiles"]);
  const rootIni =
    typeof root === "string" && root !== "" ? root : (configFiles?.[configFiles.length - 1] ?? opts.config ?? "");

  const baseStyles: Record<string, string[]> = {};
  const sections = parsed["SBaseStyles"];
  if (sections !== null && sections !== undefined) {
    if (!isMapping(sections)) throw new TermError("vale printed SBaseStyles that is not a JSON object.");
    for (const [glob, styles] of Object.entries(sections)) {
      const list = stringList(styles);
      if (list === undefined) throw new TermError(`vale printed styles for ${glob} that are not a list of names.`);
      baseStyles[glob] = list;
    }
  }

  return { stylesPath, rootIni, baseStyles };
}
