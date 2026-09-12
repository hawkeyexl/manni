/**
 * The `key` domain's commander program. Mounted by `src/cli.ts` under
 * `manni key`; no entry point of its own. Proposal 0045 extends 0034's
 * grammar: a domain is a tool, or a family resource with verbs. `key` is the
 * second kind, with two verbs, `set` and `rotate`, and no default subcommand.
 *
 * clig.dev as every tool has it: the report to stdout, diagnostics to stderr,
 * colour only on a TTY and never under `NO_COLOR`/`--no-color`, exit `0` done,
 * `1` a value that could not be re-encrypted, `2` operational/usage. Nothing
 * this program prints is ever a key.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { collect, explicitFalse, splitList } from "../shared/cli-options.js";
import { shouldColor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { notice } from "../shared/warn.js";
import { COMMON_FORMAT_LIST } from "../meta/internal.js";
import { runKeyRotate } from "./commands/rotate.js";
import { runKeySet } from "./commands/set.js";
import { KeyError } from "./errors.js";
import { renderRotateJson } from "./reporters/json.js";
import { BASELINE_NOTICE, renderRotatePretty, setMessage } from "./reporters/pretty.js";

const ROTATE_FORMATS = ["pretty", "json"] as const;
type RotateFormat = (typeof ROTATE_FORMATS)[number];

function isRotateFormat(value: string): value is RotateFormat {
  return (ROTATE_FORMATS as readonly string[]).includes(value);
}

/** What commander hands `set`'s action. */
interface SetCliOptions {
  /** `-c, --config <path>`. */
  config?: string;
  dryRun?: boolean;
}

/**
 * What commander hands `rotate`'s action. The `--no-<thing>` flags are
 * `boolean` and never `undefined`: commander supplies `true` when the flag is
 * absent, so only the explicit `false` travels to the core (`explicitFalse`).
 */
interface RotateCliOptions {
  to?: string;
  /** `--collection <name>`, repeatable; commander's default value is `[]`. */
  collection: string[];
  /** `--ext <list>`; the command splits it. */
  ext?: string;
  /** `--exclude <glob>`, repeatable; commander's default value is `[]`. */
  exclude: string[];
  as?: string;
  config?: string;
  allowEmpty?: boolean;
  /** `--no-gitignore`. */
  gitignore: boolean;
  root?: string;
  dryRun?: boolean;
  /** `-f, --format <format>`. Always a string: the declaration has a default. */
  format: string;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("key")
    .description("Set and rotate the family key that encrypted values are encrypted with.")
    .version(pkg.version, "-V, --version")
    .option("--no-color", "disable colored output")
    // A pointer, not the whole help screen: the message that precedes it
    // already names the offending flag.
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` calls below. `copyInheritedSettings`
    // copies `_exitCallback` by value at subcommand-creation time, so an
    // `exitOverride()` installed afterwards leaves every subcommand still
    // calling `process.exit(1)`.
    .exitOverride();

  /** This domain's `--no-color`, wherever the domain is mounted. */
  const color = (): boolean =>
    shouldColor({ noColor: program.opts().color === false, isTTY: process.stdout.isTTY });

  program
    .command("set")
    .description("Write the family encryption key to manni.config.yaml; generate one when no value is given")
    .argument("[value]", "the key, at least 32 hex or base64url characters (default: 64 random hex)")
    .option(
      "-c, --config <path>",
      "the config file to write (default: the nearest manni.config.yaml, else a new one at the git root)",
    )
    .option("--dry-run", "say what would be written; write nothing")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni key set                          # generate 256 bits into manni.config.yaml",
        "  manni key set --dry-run                # name the file, write nothing",
        "  manni key set -c ops/manni.config.yaml 0123456789abcdef0123456789abcdef",
      ].join("\n"),
    )
    .action(async (value: string | undefined, options: SetCliOptions) => {
      try {
        const result = await runKeySet({
          value,
          configPath: options.config,
          dryRun: Boolean(options.dryRun),
          onNotice: notice,
        });
        process.stdout.write(`${setMessage(result)}\n`);
        process.exitCode = 0;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("rotate")
    .description("Re-encrypt every encrypted value under a new key, then write the key")
    .argument("[paths...]", "files, directories, or globs (default: every collection)")
    .option(
      "--to <value>",
      "the new key (default: 64 random hex); required for a narrowed run and a key from MANNI_ENCRYPTION_KEY",
    )
    .option("--collection <name>", "configured collection to run over; repeatable", collect, [])
    .option("--ext <list>", "comma-separated extensions for directory walks")
    .option("--exclude <glob>", "glob to exclude; repeatable", collect, [])
    .option("--as <format>", "force an input format for every input")
    .option("-c, --config <path>", "path to a manni config file")
    .option("--allow-empty", "treat zero matched files as success")
    .option("--no-gitignore", "include files .gitignore covers")
    .option(
      "--root <dir>",
      "directory cited sources resolve from (default: cite.root from config, else the git root)",
    )
    .option("--dry-run", "print what would change; write nothing")
    .option("-f, --format <format>", `output: ${ROTATE_FORMATS.join(" | ")}`, "pretty")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni key rotate                                   # every collection, then the key",
        "  manni key rotate --dry-run                         # see every change first",
        '  manni key rotate --collection site --to "$NEW_KEY" # part of the family',
        '  MANNI_ENCRYPTION_KEY=… manni key rotate --to "$NEW_KEY"',
      ].join("\n"),
    )
    .action(async (paths: string[], options: RotateCliOptions) => {
      try {
        const format = options.format;
        if (!isRotateFormat(format)) {
          throw new KeyError(`Unknown --format "${format}". Use ${COMMON_FORMAT_LIST}.`);
        }
        const result = await runKeyRotate({
          inputs: paths,
          collection: options.collection,
          to: options.to,
          exts: options.ext ? splitList(options.ext) : undefined,
          exclude: options.exclude,
          as: options.as,
          configPath: options.config,
          // `undefined` rather than `false` when absent.
          allowEmpty: options.allowEmpty ? true : undefined,
          respectGitignore: explicitFalse(options.gitignore),
          root: options.root,
          dryRun: Boolean(options.dryRun),
          onNotice: notice,
        });
        if (format === "json") {
          process.stdout.write(`${renderRotateJson(result)}\n`);
          // stdout is the JSON's; the notice is a diagnostic.
          if (result.baselineStale) notice(BASELINE_NOTICE);
        } else {
          process.stdout.write(`${renderRotatePretty(result, { color: color() })}\n`);
        }
        process.exitCode = result.exitCode;
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
