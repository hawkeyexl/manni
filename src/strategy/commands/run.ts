/**
 * What every `manni strategy` command core shares: resolve the run and load
 * the set. Kept free of commander and of stdout, so a core is called directly
 * by its tests; the CLI reads stdin once and hands it in.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadConfig } from "../../graph/core/config.js";
import { routesFrom } from "../../graph/core/discover.js";
import { resolveStrategyRun } from "../core/config.js";
import { loadStrategySet } from "../core/load-set.js";
import { resolveSteps, stepsNeedRoutes, type StepMap } from "../core/steps.js";
import { StrategyError } from "../errors.js";
import type { StrategyRun, StrategySet } from "../types.js";

/** The inputs and flags `list`, `get` and `check` share. */
export interface StrategyCommandOptions {
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
  onNotice?: (message: string) => void;
}

export interface LoadedStrategy {
  cwd: string;
  run: StrategyRun;
  set: StrategySet;
  /** Each journey's steps, resolved against the run's pages. */
  steps: StepMap;
  /** Whether the run owns a file it read. One it does not own is borrowed. */
  owns: (file: string) => boolean;
}

/**
 * Whether a label sits inside one of `dirs`, the run's directory: the config
 * file's, else the working directory. A file outside, above it or on another
 * drive, is borrowed (proposal 0112), the boundary `isMember` draws.
 */
export function ownedIn(dirs: readonly string[], base: string): (file: string) => boolean {
  return (file) => {
    if (file.startsWith("<")) return true;
    return dirs.some((dir) => {
      const rel = relative(dir, resolve(base, file));
      return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
    });
  };
}

export async function loadStrategy(opts: StrategyCommandOptions): Promise<LoadedStrategy> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const run = await resolveStrategyRun({
    cwd,
    inputs: opts.inputs,
    ...(opts.configPath === undefined ? {} : { configPath: opts.configPath }),
    ...(opts.collection === undefined ? {} : { collection: opts.collection }),
  });
  // A collection's `exclude:` shapes the collection, so it applies when the
  // inputs came from the collections and never to a path the operator typed.
  const exclude = [
    ...new Set([...(opts.exclude ?? []), ...(run.fromCollections ? run.collections.flatMap((c) => c.exclude) : [])]),
  ];
  const set = await loadStrategySet({
    run,
    exclude,
    ...(opts.exts === undefined ? {} : { exts: opts.exts }),
    ...(opts.allowEmpty === true ? { allowEmpty: true } : {}),
    ...(opts.noGitignore === true ? { noGitignore: true } : {}),
    ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
    ...(opts.as === undefined ? {} : { as: opts.as }),
    ...(opts.onNotice === undefined ? {} : { onNotice: opts.onNotice }),
  });
  // `graph:` is read only when a step names a `/` route, and through graph's own loader.
  const routes = stepsNeedRoutes(set) && run.configPath !== undefined ? routesFrom(loadConfig(run.configPath, cwd), run.base) : [];
  // A path the operator typed resolves from the working directory, so a typed
  // run owns that directory too, as it did when `-c` names a config elsewhere.
  const owns = ownedIn(run.fromCollections ? [run.configDir ?? cwd] : [run.configDir ?? cwd, cwd], run.base);
  const steps = resolveSteps(set, { routes, from: run.configDir ?? cwd, base: run.base, owns });
  return { cwd, run, set, steps, owns };
}

/** `value` when it is one of `allowed`, else the family's unknown-format refusal. */
export function formatChoice<T extends string>(value: string, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new StrategyError(`unknown format "${value}". Expected ${allowed.join(" | ")}.`);
  return found;
}

/**
 * A path as a person standing in `cwd` would type it: relative, posix. A
 * label is relative to the run's base, which is the config directory for a
 * collection run, so it is resolved from there first.
 */
export function displayPath(path: string, cwd: string, base = cwd): string {
  if (path.startsWith("<")) return path;
  const rel = relative(cwd, isAbsolute(path) ? path : resolve(base, path));
  return (rel === "" ? "." : rel).replaceAll("\\", "/");
}

/** `1 record`, `2 records`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}
