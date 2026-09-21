/**
 * What every `manni term` command core shares: resolve the run, load the set,
 * and say the readers' notices. Kept free of commander and of stdout, so a core
 * is called directly by its tests; the CLI reads stdin once and hands it in.
 */
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { valeConfigPath } from "../../shared/tools.js";
import { resolveTermRun } from "../core/config.js";
import { loadTermSet } from "../core/load-set.js";
import { TermError } from "../errors.js";
import type { TermReader, TermRun, TermSet } from "../types.js";

/** The inputs and flags `list`, `get`, `check`, `lint` and `write` share. */
export interface TermCommandOptions {
  /** Default `process.cwd()`. */
  cwd?: string;
  /** Positional `[paths...]`; `-` is stdin. Empty falls back to the collections. */
  inputs: string[];
  /** Stdin's content, read once by the CLI when `-` is among the inputs. */
  stdin?: string;
  /** `--as <format>`. */
  as?: string;
  /** `--exclude <glob>`, repeatable. */
  exclude?: string[];
  /** `--ext <list>`, already split. */
  exts?: string[];
  /** `--allow-empty`. */
  allowEmpty?: boolean;
  /** `--no-gitignore`. */
  noGitignore?: boolean;
  /** `--collection <name>`, repeatable. */
  collection?: string[];
  /** `-c, --config <path>`. */
  configPath?: string;
  /** Readers' notices and the loader's. */
  onNotice?: (message: string) => void;
  /** The readers to offer files to. Tests hand in their own. */
  readers?: readonly TermReader[];
}

export interface LoadedTerms {
  cwd: string;
  run: TermRun;
  set: TermSet;
}

export async function loadTerms(opts: TermCommandOptions): Promise<LoadedTerms> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const run = await resolveTermRun({
    cwd,
    inputs: opts.inputs,
    ...(opts.configPath === undefined ? {} : { configPath: opts.configPath }),
    ...(opts.collection === undefined ? {} : { collection: opts.collection }),
  });
  const set = await loadSet(run, opts);
  return { cwd, run, set };
}

async function loadSet(run: TermRun, opts: TermCommandOptions): Promise<TermSet> {
  // A collection's `exclude:` shapes the collection, so it applies when the
  // inputs came from the collections and never to a path the operator typed.
  const exclude = [
    ...new Set([
      ...(opts.exclude ?? []),
      ...(run.fromCollections ? run.collections.flatMap((c) => c.exclude) : []),
    ]),
  ];
  const set = await loadTermSet({
    run,
    exclude,
    ...(opts.exts === undefined ? {} : { exts: opts.exts }),
    ...(opts.allowEmpty === true ? { allowEmpty: true } : {}),
    ...(opts.noGitignore === true ? { noGitignore: true } : {}),
    ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
    ...(opts.as === undefined ? {} : { as: opts.as }),
    ...(opts.onNotice === undefined ? {} : { onNotice: opts.onNotice }),
    ...(opts.readers === undefined ? {} : { readers: opts.readers }),
  });
  for (const message of set.notices) opts.onNotice?.(message);
  return set;
}

/**
 * `value` when it is one of `allowed`, else the family's unknown-format
 * refusal, naming every value in declaration order.
 */
export function formatChoice<T extends string>(value: string, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new TermError(`unknown format "${value}". Expected ${allowed.join(" | ")}.`);
  }
  return found;
}

/** A path as a person standing in `cwd` would type it: relative, posix. An already-relative label is kept. */
export function displayPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const rel = relative(cwd, path);
  return (rel === "" ? "." : rel).replaceAll("\\", "/");
}

/**
 * Vale's config file for the run, absolute, or `undefined` when none is set
 * and Vale finds its own. A configured file that is not there is refused here,
 * before Vale reads it as a different complaint.
 */
export function valeConfigFor(run: TermRun): string | undefined {
  if (run.configDir === undefined) return undefined;
  const path = valeConfigPath(run.tools, run.configDir);
  if (path !== undefined && !existsSync(path)) {
    const source = run.configSource ?? "manni.config.yaml";
    throw new TermError(`${source}: tools.vale.config "${run.tools.vale?.config ?? path}" does not exist.`);
  }
  return path;
}

/** `1 term`, `2 terms`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}
