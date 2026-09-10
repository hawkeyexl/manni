/**
 * The one adapter between `derive:` as the config file spells it and the
 * derive context as the sources want it.
 *
 * The config is a user-facing document, so it says `timeout: 30`, in whole
 * seconds. Every source downstream measures in milliseconds, because that is
 * what `child_process` takes. Exactly one place should know both, and this is
 * it. It lived in `table.ts` first, which made the SQL projection the owner
 * of a unit conversion four commands need and only one of them is about
 * tables.
 */
import type { DeriveConfig } from "../config.js";
import type { DeriveCommand } from "./types.js";

/** How long a configured command may run when its entry says nothing: 60 s. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/**
 * The `command` source's table as the derive context wants it, from the
 * config's spelling: `timeout` is in seconds there and `timeoutMs` here.
 * Undefined when the config configures no command, so a context built from
 * it consults the source for nothing.
 */
export function commandsOf(
  config?: DeriveConfig,
): Readonly<Record<string, DeriveCommand>> | undefined {
  if (config?.commands === undefined) return undefined;
  const out: Record<string, DeriveCommand> = {};
  for (const [field, c] of Object.entries(config.commands)) {
    out[field] = {
      run: c.run,
      timeoutMs:
        c.timeout === undefined ? DEFAULT_COMMAND_TIMEOUT_MS : Math.round(c.timeout * 1000),
    };
  }
  return out;
}
