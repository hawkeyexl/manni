/**
 * Running a commander program as a bin.
 *
 * Every entry point (`manni`, and `docmeta` for existing scripts) is the same
 * three lines: build the program, parse, and turn what escapes into an exit
 * code. Keeping that here means the exit-code contract (0 ok, 1 findings, 2
 * operational/usage) is written once, and the stderr prefix follows the bin
 * that was actually run.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CommanderError, type Command } from "commander";
import { ToolError } from "./errors.js";
import { programName, setProgramName } from "./program-name.js";

/** Report an operational error on stderr and exit 2. */
export function fail(err: unknown): never {
  const msg =
    err instanceof ToolError
      ? err.message
      : `Unexpected error: ${(err as Error).message}`;
  process.stderr.write(`${programName()}: ${msg}\n`);
  process.exit(2);
}

export async function runProgram(
  program: Command,
  argv: string[] = process.argv,
): Promise<void> {
  setProgramName(program.name());
  try {
    await program.parseAsync(argv);
  } catch (err) {
    // `exitOverride()` makes commander throw on every terminating condition,
    // including the successful ones. Branch on `err.exitCode`, not on a list of
    // code strings: `--help` is `commander.helpDisplayed`, `-V` is
    // `commander.version`, and `help get` is a third code, `commander.help` —
    // all carrying exitCode 0, and a hand-written list would eventually miss
    // one and turn a success into a usage error.
    if (err instanceof CommanderError) {
      // Say nothing. `Command.error()` has already written the message and the
      // after-error hint; `fail()` would add "Unexpected error: …" on top,
      // because a CommanderError is not a ToolError.
      //
      // `process.exitCode`, not `process.exit()`: Node does not flush queued
      // async stderr writes on `process.exit`, which truncates the very message
      // the user needs.
      process.exitCode = err.exitCode === 0 ? 0 : 2;
      return;
    }
    throw err;
  }
}

/**
 * Whether `moduleUrl` is the file Node was asked to run.
 *
 * Pass the entry file's own `import.meta.url`. After bundling, shared code
 * lands in a chunk whose URL is never argv[1], so this cannot read
 * `import.meta.url` itself.
 */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

/** Run `build()` as a bin when `moduleUrl` is the entry, and not when imported. */
export function runIfMain(moduleUrl: string, build: () => Command): void {
  if (!isMainModule(moduleUrl)) return;
  runProgram(build()).catch(fail);
}
