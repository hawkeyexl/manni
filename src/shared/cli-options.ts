/**
 * Option plumbing every tool's commander wrapper needs.
 *
 * These are the pieces of `src/meta/cli.ts` that had nothing to do with
 * metadata: how a repeatable flag accumulates, how a comma list splits, how
 * stdin is drained, how `-c`/`--no-config` share one attribute, and how a
 * `--no-<thing>` flag is kept from clobbering a config value it never meant to
 * touch. A sibling tool that re-derived any of these would get one of them
 * subtly different, and "commands must have parallel behaviors" is the rule
 * that says it must not.
 */
import { basename, relative } from "node:path";
import type { Command } from "commander";

/** Accumulate a repeatable option (`--exclude a --exclude b`). */
export function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

/**
 * The input flags of a verb that reads a document set, declared once so every
 * verb of `term` and `strategy` spells them alike. `nothing` names what an
 * empty set lacks in `--allow-empty`'s help: `"no terms"`, `"no records"`.
 */
export function withInputs(command: Command, nothing: string): Command {
  return command
    .option("--as <format>", "input format for stdin (-)")
    .option("--ext <list>", "comma-separated extensions for directory walks")
    .option("--exclude <glob>", "glob to exclude; repeatable", collect, [])
    .option("--collection <name>", "configured collection to read; repeatable", collect, [])
    .option("--allow-empty", `treat a missing path, no matched files or ${nothing} as success`)
    .option("--no-gitignore", "read files .gitignore covers")
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-color", "disable colored output");
}

/** Split a comma-separated option value, dropping blanks. */
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * What a run that reads `-` without `--as` is told. Stdin has no file name to
 * pick a parser by, so the user names the format. One sentence for every tool
 * that reads stdin, so the refusal reads the same wherever it is hit.
 */
export const STDIN_REQUIRES_AS =
  "Reading from stdin (`-`) requires --as <format> to choose an extractor.";

/** Drain stdin to a UTF-8 string. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Split the one commander attribute that `-c, --config <path>` and
 * `--no-config` share. Verified by experiment: `opts.config` is `undefined`
 * with neither flag, the string with `-c`, and `false` with `--no-config`.
 */
export function configOption(value: unknown): {
  configPath?: string;
  noConfig?: boolean;
} {
  if (value === false) return { noConfig: true };
  return typeof value === "string" ? { configPath: value } : {};
}

/**
 * A `--no-<thing>` flag for the core: only an explicit false travels.
 *
 * Commander gives `true` when the flag is absent, but that is its *default*,
 * not a choice the user made — passing it on would override the config's own
 * answer (`respectGitignore:`, say). Only the explicit `false` travels; absence
 * stays `undefined` so config still decides.
 */
export function explicitFalse(value: unknown): boolean | undefined {
  return value === false ? false : undefined;
}

/**
 * Say which config governed the run, and where it came from.
 *
 * Discovery walks up to the project boundary, so the answer is no longer
 * obvious from the working directory, and an unexpected ancestor config is the
 * difference between a five-minute diagnosis and an hour of confusion. Goes to
 * stderr for anything a machine reads, so structured output stays parseable.
 */
export function reportConfig(
  toStdout: boolean,
  cwd: string,
): (info: { path: string; dir: string }) => void {
  return (info) => {
    const where = (relative(cwd, info.dir) || ".").replace(/\\/g, "/");
    const line = `Using ${basename(info.path)} (${where})\n`;
    (toStdout ? process.stdout : process.stderr).write(line);
  };
}
