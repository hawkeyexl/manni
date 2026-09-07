/**
 * The `cite` domain's commander program. Mounted by `src/cli.ts` under
 * `manni cite`; no entry point of its own. Grammar per proposal 0034: verbs are
 * `check`, `add`, `update`; there is no default subcommand.
 */
import { Command } from "commander";
import { notImplemented } from "./core/not-implemented.js";

export function buildProgram(): Command {
  return notImplemented("buildProgram");
}
