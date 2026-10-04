/**
 * Terminal color, decided once for every tool under the umbrella.
 *
 * clig.dev: color only on a TTY, never under `NO_COLOR` or `--no-color`. Each
 * tool's reporters take the decision as a boolean and build a palette from it,
 * so no reporter ever consults the environment on its own.
 */
import pc from "picocolors";
import type { Command } from "commander";

export type Colors = ReturnType<typeof pc.createColors>;

/** Build a picocolors palette with color explicitly on or off. */
export function palette(enabled: boolean): Colors {
  return pc.createColors(enabled);
}

/**
 * Decide whether to emit ANSI color: off when `--no-color`/`NO_COLOR`, on only
 * for a TTY otherwise. `forced` (from `--color`) overrides detection.
 */
export function shouldColor(opts: {
  noColor?: boolean;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = opts.env ?? process.env;
  if (opts.noColor) return false;
  if (env.NO_COLOR != null && env.NO_COLOR !== "") return false;
  return Boolean(opts.isTTY);
}

/**
 * Whether `command`'s output gets colour: the domain's `--no-color` and
 * `NO_COLOR` turn it off, and otherwise only a TTY turns it on
 * (`shouldColor`). `isTTY` is passed uncoerced: Node leaves it undefined off
 * a terminal, never false, and `shouldColor` reads a missing one as "not a
 * terminal".
 */
export function colorFor(
  command: Command,
  isTTY: boolean | undefined,
  env?: NodeJS.ProcessEnv,
): boolean {
  // commander maps --no-color to opts.color === false, on the command that
  // declares it.
  const noColor = colorOwner(command).opts().color === false;
  return shouldColor({ noColor, isTTY, env });
}

/**
 * The nearest command, this one or an ancestor, that declares `--no-color`:
 * the domain's program, wherever it is mounted. Not the root: under the
 * umbrella that is `manni`, which has no `--no-color` of its own.
 */
function colorOwner(command: Command): Command {
  for (let c: Command | null = command; c !== null; c = c.parent) {
    if (c.options.some((o) => o.long === "--no-color")) return c;
  }
  return command;
}
