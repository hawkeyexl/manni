/**
 * The `command` source: a field derived by running whatever `derive.commands`
 * names for it. The value is the program's stdout — JSON when it parses as
 * JSON, the trimmed text otherwise, `null` when there is none.
 *
 * A command is spawned once per run, and its value copied into every
 * document's record, unless its argv carries `{path}`, in which case it is
 * spawned once per document with the document's label in place. The argv is
 * never handed to a shell: what the config lists is what runs.
 *
 * The first failure ends the source for the whole run, with nothing further
 * spawned: a program that is not on PATH, a timeout, a non-zero exit. A
 * half-derived field would read as "the command said nothing" for the
 * documents it never reached, which is the false green the whole channel
 * refuses. Availability is reported, never thrown, as the other sources do.
 */
import { BinMissing, lastLine, run, type Run, type SpawnOptions } from "./spawn.js";
import type { DerivedValue, DeriveCommand, DeriveInput, SourceStatus } from "./types.js";

/** The argv token a per-file command carries where the document's label goes. */
export const PATH_PLACEHOLDER = "{path}";

export interface CommandSourceOptions {
  /** Where the commands run: the config directory, else the run cwd. */
  cwd: string;
  /** Test seam: `bin` and `prefixArgs` replace the configured program. */
  spawn?: Partial<SpawnOptions>;
}

export interface CommandSourceResult {
  status: SourceStatus;
  /** By label; every input present when available, keyed by field within. */
  records: Map<string, Record<string, DerivedValue | null>>;
}

/** Whether any argv element carries `{path}`, so the command runs once per document. */
export function isPerFile(command: DeriveCommand): boolean {
  return command.run.some((arg) => arg.includes(PATH_PLACEHOLDER));
}

/** The argv with every `{path}` replaced by the label, forward slashes as the run spells it. */
export function argvFor(command: DeriveCommand, label: string): string[] {
  return command.run.map((arg) => arg.split(PATH_PLACEHOLDER).join(label));
}

/**
 * What a command's stdout means: nothing when blank, the parsed value when it
 * is JSON of any type, the trimmed text otherwise. A date or a version string
 * stays a string; a list or an object arrives as one.
 */
export function valueOf(stdout: string): unknown {
  const text = stdout.trim();
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function deriveFromCommands(
  inputs: readonly DeriveInput[],
  commands: Readonly<Record<string, DeriveCommand>>,
  opts: CommandSourceOptions,
): Promise<CommandSourceResult> {
  const records = new Map<string, Record<string, DerivedValue | null>>();
  const fields = Object.keys(commands);
  if (fields.length === 0 || inputs.length === 0) {
    return { status: { available: true }, records };
  }
  for (const input of inputs) records.set(input.label, {});

  for (const field of fields) {
    const command = commands[field];
    if (command === undefined) continue;
    if (isPerFile(command)) {
      for (const [label, record] of records) {
        const outcome = await runOne(field, argvFor(command, label), command.timeoutMs, opts);
        if ("reason" in outcome) return unavailable(outcome.reason);
        record[field] = outcome.value;
      }
    } else {
      const outcome = await runOne(field, command.run, command.timeoutMs, opts);
      if ("reason" in outcome) return unavailable(outcome.reason);
      for (const record of records.values()) record[field] = outcome.value;
    }
  }
  return { status: { available: true }, records };
}

function unavailable(reason: string): CommandSourceResult {
  return { status: { available: false, reason }, records: new Map() };
}

type Outcome = { value: DerivedValue | null } | { reason: string };

/** One spawn, with every failure turned into the reason the status carries. */
async function runOne(
  field: string,
  argv: readonly string[],
  timeoutMs: number,
  opts: CommandSourceOptions,
): Promise<Outcome> {
  const [program, ...args] = argv;
  const where = `(derive.commands.${field})`;
  if (program === undefined) {
    return { reason: `no program to run ${where}` };
  }
  const line = argv.join(" ");
  let result: Run;
  try {
    result = await run(opts.spawn?.bin ?? program, args, {
      ...opts.spawn,
      cwd: opts.spawn?.cwd ?? opts.cwd,
      timeoutMs,
    });
  } catch (err) {
    if (err instanceof BinMissing) {
      return { reason: `\`${program}\` is not on PATH ${where}` };
    }
    return { reason: `\`${line}\` could not be run: ${err instanceof Error ? err.message : String(err)} ${where}` };
  }
  if (result.timedOut) {
    return { reason: `\`${line}\` timed out after ${String(timeoutMs / 1000)}s ${where}` };
  }
  if (result.code !== 0) {
    const last = lastLine(result.stderr);
    const detail = last === "" ? "no output on stderr" : last;
    const exit = result.code === null ? "killed by a signal" : `exit ${String(result.code)}`;
    return { reason: `\`${line}\` failed (${exit}): ${detail} ${where}` };
  }
  const value = valueOf(result.stdout);
  return { value: value === null ? null : { value, source: "command", evidence: line } };
}
