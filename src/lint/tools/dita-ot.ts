/**
 * The DITA Open Toolkit process seam: the only module that starts `dita`.
 *
 * Written in the shape `src/term/core/vale.ts` set, for the same reasons. The
 * launcher is started with an argv and never a shell string, the buffer is
 * raised because a build log is not small, and what comes back is validated
 * here, because it crosses a process boundary.
 *
 * **The test suite starts no DITA-OT, and needs no JVM.** Every unit test
 * injects a stub spawn. What the parser is fed is real output, though: the
 * logs under `test/lint/fixtures/dita-ot/logs/` are captures of DITA-OT 4.4.1
 * runs over the fixtures beside them, with only absolute paths rewritten.
 * Their README records what each one holds and where each field name comes
 * from.
 *
 * The verdict is the log, not the exit code: DITA-OT publishes no exit-code
 * contract, so a non-zero exit with a parseable log is findings, and only a
 * log that is missing or unreadable *and* a non-zero exit is a failure to run.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Severity } from "../../shared/severity.js";
import { ditaOtHome } from "../../shared/tools.js";
import { LintError } from "../types.js";
// Type-only, and erased at runtime: `./index.js` imports this module to put the
// descriptor in its initial map, so a value import here would be a cycle.
import type { FormatInfo } from "../commands/tools.js";
import type { StructureToolDescriptor, ToolProbe, ToolProbeContext } from "./index.js";

/** What the launcher did. `code` is null when a signal ended it. */
export interface DitaOtProcessResult {
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
 * Start `launcher` with `args` and wait for it. Resolves for any exit; rejects
 * when the process could not start, with an error whose `code` is `ENOENT`
 * when there is no such launcher. Tests inject a stub.
 */
export type DitaOtSpawn = (
  launcher: string,
  args: string[],
  opts: { cwd?: string },
) => Promise<DitaOtProcessResult>;

const MAX_BUFFER = 64 * 1024 * 1024;

/** The two refusals a user reads, worded once. */
const NOT_ON_PATH =
  "dita is not on PATH. Install DITA Open Toolkit to lint structure, or set tools.dita-ot.home.";

const noLauncher = (home: string): string =>
  `no DITA Open Toolkit at "${home}". tools.dita-ot.home must be a DITA-OT installation directory.`;

/**
 * `<home>/bin/dita`, or the bare name for the one on PATH. Windows has its own
 * launcher, `dita.bat`, which is what makes `ditaOtCommandLine` necessary.
 *
 * `platform` is a parameter so the mapping can be tested on either host.
 */
export function ditaOtLauncher(
  home: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  const name = platform === "win32" ? "dita.bat" : "dita";
  return home === undefined ? name : join(home, "bin", name);
}

/** How a launcher is actually started. */
export interface DitaOtCommandLine {
  command: string;
  argv: string[];
  /** Windows: the argv is already one quoted string and must not be re-quoted. */
  verbatim: boolean;
}

function isBatch(launcher: string): boolean {
  const lower = launcher.toLowerCase();
  return lower.endsWith(".bat") || lower.endsWith(".cmd");
}

/**
 * Quote one token for `cmd.exe`. A `"` inside a Windows path is impossible -
 * the character is not legal in a filename - so a value carrying one is a
 * shape this cannot quote safely, and it is refused rather than passed on.
 */
function quoteForCmd(value: string): string {
  if (value.includes('"')) {
    throw new LintError(
      `DITA Open Toolkit cannot be given an argument containing a quote: ${value}`,
    );
  }
  return `"${value}"`;
}

/**
 * How to start `launcher`, given what it is.
 *
 * Node refuses to `execFile` a `.bat` or `.cmd` without a shell, and
 * `shell: true` joins the argv into one string **with no quoting at all**. Our
 * argv carries user-supplied paths, so that is a command-injection hole, not a
 * convenience. The documented alternative is this one: run `cmd.exe` directly,
 * do the quoting here, and pass the whole command as one verbatim argument.
 * `/s` then strips exactly the outer pair of quotes, which is why the string
 * is wrapped a second time. The next reader will find `shell: true` simpler;
 * it is also the version with the hole in it.
 */
export function ditaOtCommandLine(
  launcher: string,
  args: string[],
): DitaOtCommandLine {
  if (!isBatch(launcher)) {
    return { command: launcher, argv: args, verbatim: false };
  }
  const line = [launcher, ...args].map(quoteForCmd).join(" ");
  return {
    command: process.env["COMSPEC"] ?? "cmd.exe",
    argv: ["/d", "/s", "/c", `"${line}"`],
    verbatim: true,
  };
}

export const spawnDitaOt: DitaOtSpawn = (launcher, args, opts) =>
  new Promise((settle, reject) => {
    const line = ditaOtCommandLine(launcher, args);
    execFile(
      line.command,
      line.argv,
      {
        cwd: opts.cwd,
        windowsHide: true,
        windowsVerbatimArguments: line.verbatim,
        maxBuffer: MAX_BUFFER,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (!error) {
          settle({ code: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === "number") {
          settle({ code: error.code, stdout, stderr });
          return;
        }
        // Killed by a signal. Node reports the exit code as **null** here, not
        // as undefined, so testing for undefined never matched and a killed
        // run rejected as though the launcher had failed to start. The log is
        // still read: a run cut short may have written findings before it died.
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
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "ENOENT"
  );
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether a bare launcher name resolves to a file on `PATH`.
 *
 * Asked only after a failure, and only to choose the message. On Windows the
 * launcher is a `.bat` started through `cmd.exe`, so a missing one comes back
 * as cmd's own non-zero exit rather than as an `ENOENT` - and the advice a
 * reader needs is "install DITA-OT", not cmd's sentence about a command it did
 * not recognize.
 */
async function isOnPath(name: string): Promise<boolean> {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    if (await isFile(join(dir, name))) return true;
  }
  return false;
}

/**
 * DITA-OT's `MessageBean.Type` onto the family's three-value scale, as
 * `foldValeSeverity` does for Vale's.
 *
 * `null` is "not a finding": `DEBUG` and `TRACE` are build chatter even when
 * they carry a code, and a level this does not know is dropped rather than
 * promoted to something it might not be.
 */
export function foldDitaOtSeverity(level: string): Severity | null {
  switch (level.toUpperCase()) {
    case "FATAL":
    case "ERROR":
      return "error";
    case "WARN":
      return "warning";
    case "INFO":
      return "notice";
    default:
      return null;
  }
}

/** One diagnostic DITA-OT reported, in the vocabulary the lint branch reads. */
export interface DitaOtMessage {
  /** DITA-OT's own message id, e.g. `DOTX010E`. Becomes the finding's `type`. */
  code: string;
  severity: Severity;
  message: string;
  /** The path its `location` URI named, absent when it named none. */
  file?: string;
  line?: number;
  /** The **column**. See `readMessage` for why the log calls it `row`. */
  column?: number;
}

/**
 * The path a `location` names.
 *
 * DITA-OT writes `file:/x`, one slash and no authority. `new URL` normalizes
 * that to the three-slash form, so the quirk costs nothing. What does cost
 * something is a POSIX-rooted URI read on Windows: `fileURLToPath` refuses
 * `file:///repo/a.dita` outright there, with `ERR_INVALID_FILE_URL_PATH`, and
 * a log written on a Linux CI runner is full of exactly those. The decoded
 * pathname is the answer in that case.
 */
function pathFromFileUri(location: string): string {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    // Not a URI at all: DITA-OT named a bare path, so it is the path.
    return location;
  }
  if (url.protocol !== "file:") return location;
  try {
    return fileURLToPath(url);
  } catch {
    return decodeURIComponent(url.pathname);
  }
}

/**
 * One log object as a finding, or `null` when it is not one.
 *
 * `code` is the marker. DITA-OT writes hundreds of `INFO` lines that are
 * progress rather than diagnostics, and it is its own account of which is
 * which, so an object without a code is chatter whatever its level.
 */
function readMessage(raw: unknown): DitaOtMessage | null {
  if (!isMapping(raw)) return null;
  const code = raw["code"];
  if (typeof code !== "string" || code === "") return null;
  const level = raw["level"];
  const severity =
    typeof level === "string" ? foldDitaOtSeverity(level) : null;
  if (severity === null) return null;

  const msg = raw["msg"];
  const location = raw["location"];
  const line = raw["line"];
  // `row` is the column. The name is the logger's: its regex takes group 2 as
  // the line and group 3 as the column, then writes the column out under this
  // name. Read as a row it puts every finding on the wrong line, so do not
  // "fix" it to `line`.
  const row = raw["row"];

  return {
    code,
    severity,
    // A coded message with no text is still a finding; the code says what it is.
    message: typeof msg === "string" && msg !== "" ? msg : code,
    ...(typeof location === "string" && location !== ""
      ? { file: pathFromFileUri(location) }
      : {}),
    ...(typeof line === "number" ? { line } : {}),
    ...(typeof row === "number" ? { column: row } : {}),
  };
}

/**
 * The findings in a `--logger=json` log, or `null` when the text is not one.
 *
 * Null rather than an empty list, because the caller treats the two
 * differently: no findings is a clean target, while no log at all is only a
 * failure when the launcher also exited non-zero.
 */
export function parseDitaOtLog(text: string): DitaOtMessage[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const messages: DitaOtMessage[] = [];
  for (const raw of parsed as unknown[]) {
    const message = readMessage(raw);
    if (message !== null) messages.push(message);
  }
  return messages;
}

/** The first version-shaped number in what the launcher printed. */
export function parseDitaOtVersion(output: string): string | null {
  const match = /\b(\d+(?:\.\d+)+(?:[-.][0-9A-Za-z]+)*)/.exec(output);
  return match?.[1] ?? null;
}

/** What one invocation of DITA-OT had to say about one target. */
export interface DitaOtTargetResult {
  /** The absolute path this invocation was given as `--input`. */
  target: string;
  messages: DitaOtMessage[];
}

export interface DitaOtRunOptions {
  /** Absolute paths. One invocation each: DITA-OT takes one `--input`. */
  targets: string[];
  /** The directory the run resolves from, and where the launcher is started. */
  cwd: string;
  /** `tools.dita-ot.home`, already resolved to an absolute directory. */
  home?: string;
  spawn?: DitaOtSpawn;
}

/** The message a failure to run reports, which is the launcher's own. */
function failureText(result: DitaOtProcessResult): string {
  const stderr = result.stderr.trim();
  if (stderr !== "") return stderr;
  // "exit code null" says nothing a reader can act on, and a signal is the one
  // ending that reliably leaves no message behind.
  if (result.signal != null) return `killed by ${result.signal}`;
  return `exit code ${String(result.code)}`;
}

async function readLog(path: string): Promise<DitaOtMessage[] | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return parseDitaOtLog(text);
}

/**
 * DITA-OT over each target, and what its log said.
 *
 * ## Why this is not `dita validate`
 *
 * Because `dita validate` does not answer the question this tool exists for.
 * Run against a map whose topic conrefs an id that is not there, it exits 0 and
 * prints nothing. It parses and checks grammar, and it resolves no references.
 * Its own `--help` lists neither `--logger` nor `--logfile` nor `--temp`, so
 * the obvious invocation is silently accepted and silently useless.
 *
 * `--format=dita` is the DITA-to-DITA transformation. It runs the whole
 * preprocessing chain, which is where conref, keyref and link resolution
 * happen, and it reports what those stages find. Measured against the fixtures
 * beside this file, it catches everything `validate` catches and the references
 * as well: a grammar error is `DOTJ088E` with a line and a column, a missing
 * conref target is `DOTX010E`, an unreadable link target is `DOTX008E`.
 *
 * The cost is that a transformation writes output. It goes to the scratch
 * directory with the logs and the temp trees, and the whole scratch is removed
 * however the run ends, so nothing of ours lands in the user's tree.
 *
 * ## Why verbose
 *
 * Because DITA-OT reports an undefined key reference (`DOTJ047I`) at `INFO`,
 * and the default verbosity drops it. Verbose turns one run of a four-file map
 * into roughly 135 log entries, of which one carries a `code`. That is what
 * makes the `code` filter in `parseDitaOtLog` load-bearing rather than tidy.
 */
export async function runDitaOtValidate(
  opts: DitaOtRunOptions,
): Promise<DitaOtTargetResult[]> {
  const spawn = opts.spawn ?? spawnDitaOt;
  const launcher = ditaOtLauncher(opts.home);
  // A home that holds no launcher is a configuration mistake, and saying so
  // before anything is started names the thing the user can fix.
  if (opts.home !== undefined && !(await isFile(launcher))) {
    throw new LintError(noLauncher(opts.home));
  }

  const scratch = await mkdtemp(join(tmpdir(), "manni-dita-ot-"));
  try {
    const results: DitaOtTargetResult[] = [];
    for (const [index, target] of opts.targets.entries()) {
      const logfile = join(scratch, `${String(index)}.json`);
      const args = [
        `--input=${target}`,
        "--format=dita",
        `--output=${join(scratch, `out-${String(index)}`)}`,
        `--temp=${join(scratch, `temp-${String(index)}`)}`,
        "--logger=json",
        `--logfile=${logfile}`,
        "--verbose",
      ];

      let result: DitaOtProcessResult;
      try {
        result = await spawn(launcher, args, { cwd: opts.cwd });
      } catch (err) {
        if (isEnoent(err)) {
          throw new LintError(
            opts.home === undefined ? NOT_ON_PATH : noLauncher(opts.home),
          );
        }
        throw err;
      }

      const messages = await readLog(logfile);

      /**
       * A non-zero exit has to be accounted for by something we are going to
       * report. Otherwise the run failed for a reason this log does not hold,
       * and saying "no findings" would be inventing a clean bill of health.
       *
       * The asymmetry is DITA-OT's. It exits **0** while logging `DOTX010E`
       * for a broken conref, so a zero exit proves nothing and the log is the
       * verdict. It also exits **1** on a map that is not well-formed, having
       * already written a perfectly readable log whose only coded entries are
       * `DOTJ030I` at `INFO`, with the fatal parse error in neither the log
       * nor stdout nor stderr. Trusting the parse of that log reported the
       * file as passing, which is the false green this guard exists for.
       */
      // Only an `error` accounts for it. A warning or a notice is something
      // DITA-OT says while finishing the job, and it exits 0 having said it,
      // so a non-zero exit alongside nothing worse than `DOTJ047I` is still a
      // failure this log does not explain.
      const explained =
        messages !== null && messages.some((m) => m.severity === "error");

      if (result.code !== 0 && !explained) {
        if (opts.home === undefined && !(await isOnPath(launcher))) {
          throw new LintError(NOT_ON_PATH);
        }
        throw new LintError(
          `DITA Open Toolkit failed on ${target}: ${failureText(result)}. ` +
            `Run it directly on that file to see why.`,
        );
      }

      results.push({ target, messages: messages ?? [] });
    }
    return results;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Whether DITA-OT can run here, and at what version.
 *
 * Never throws: reporting what cannot run is `manni lint tools`' job, and a
 * probe that threw would take the whole table down with it. So a launcher
 * that fails to start for any reason (`ENOENT`, but also `EACCES` or `EPERM`)
 * is unavailable. A non-zero exit counts as unavailable too, because on
 * Windows a missing `dita.bat` is cmd.exe's exit code rather than an `ENOENT`.
 */
export async function probeDitaOt(
  ctx: ToolProbeContext,
  spawn: DitaOtSpawn = spawnDitaOt,
): Promise<ToolProbe> {
  const home =
    ctx.tools === undefined
      ? undefined
      : ditaOtHome(ctx.tools, ctx.configDir ?? ctx.cwd);
  const launcher = ditaOtLauncher(home);
  if (home !== undefined && !(await isFile(launcher))) {
    return { available: false, version: null };
  }

  let result: DitaOtProcessResult;
  try {
    result = await spawn(launcher, ["--version"], { cwd: ctx.cwd });
  } catch {
    return { available: false, version: null };
  }
  if (result.code !== 0) return { available: false, version: null };
  return {
    available: true,
    // Both channels, because which one carries the banner is not fixed: the
    // shell launcher prints it on stdout, and the Windows `.bat` run through
    // `cmd.exe` has been seen to put it on stderr. Reading one would report a
    // toolkit that is plainly there as versionless on the other platform.
    version: parseDitaOtVersion(`${result.stdout}\n${result.stderr}`),
  };
}

/**
 * DITA's one format row.
 *
 * `kinds` is empty and that is correct: DITA-OT does not parse into manni's
 * content model, and the column exists to say what a template rule can ask
 * about. `.xml` is listed because a DITA topic is often named that way; the
 * walk set is narrower on purpose - see `walkExtensions`.
 */
const DITA_FORMAT: FormatInfo = {
  name: "dita",
  label: "DITA",
  extensions: [".ditamap", ".dita", ".xml"],
  kinds: [],
};

export const ditaOt: StructureToolDescriptor = {
  name: "dita-ot",
  label: "DITA Open Toolkit",
  formats: () => [{ ...DITA_FORMAT }],
  // Maps only. DITA-OT takes one `--input` per invocation, so walking
  // every topic in a docset would pay a JVM start per topic. Naming a `.dita`
  // explicitly still works: a named file bypasses the extension filter.
  walkExtensions: () => [".ditamap"],
  probe: (ctx) => probeDitaOt(ctx),
  // None. Every option manni owns is refused under this tool, stdin included.
  ownedOptions: [],
};
