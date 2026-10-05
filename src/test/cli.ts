/**
 * The `test` domain's commander program. Mounted by `src/cli.ts` under
 * `manni test`; no entry point of its own. One verb, `run`, spelled out as
 * every domain spells its verbs.
 *
 * The job is testing the docs' procedures, and Doc Detective is the tool that
 * runs them. manni starts it, reads its results file, and reports in the
 * family contract: exit `0` no step failed, `1` one did, `2` operational or
 * usage. Doc Detective's own log is a diagnostic, so it goes to stderr.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { collect } from "../shared/cli-options.js";
import { colorFor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { runTest } from "./commands/run.js";
import { TestError } from "./errors.js";
import { renderGithub } from "./reporters/github.js";
import { renderJson } from "./reporters/json.js";
import { renderPretty } from "./reporters/pretty.js";

const FORMATS = ["pretty", "json", "github"] as const;
type Format = (typeof FORMATS)[number];
const FORMAT_LIST = FORMATS.join(" | ");

function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

/** What commander hands `run`'s action. */
interface RunCliOptions {
  /** `--collection <name>`, repeatable; commander's default value is `[]`. */
  collection: string[];
  config?: string;
  /** Always a string: the declaration has a default. */
  format: string;
  allowEmpty?: boolean;
  /** `--progress` → true, `--no-progress` → false, neither → undefined (auto). */
  progress?: boolean;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("test")
    .description("Run the docs' procedure tests with Doc Detective")
    .version(pkg.version, "-V, --version")
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` call below, which copies the exit
    // callback by value. See the same note in ../key/cli.ts.
    .exitOverride();

  program
    .command("run")
    .description("Run the Doc Detective tests in paths, or in Doc Detective's configured input.")
    .argument(
      "[paths...]",
      "files, directories and globs; Doc Detective's config `input` when omitted",
    )
    .option("--collection <name>", "configured collection to test; repeatable", collect, [])
    .option("-c, --config <path>", "path to a manni config file")
    .option("-f, --format <format>", `output: ${FORMAT_LIST}`, "pretty")
    .option("--allow-empty", "treat finding no tests as success")
    // `--progress` first, so adding `--no-progress` leaves the default
    // undefined rather than true.
    .option("--progress", "stream Doc Detective's log to stderr (default: only on a terminal)")
    .option("--no-progress", "never stream Doc Detective's log")
    .option("--no-color", "disable colored output")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni test run docs/guide.md               # one page",
        "  manni test run                             # Doc Detective's config input",
        "  manni test run --collection site           # a configured collection",
        "  manni test run -f github --progress        # in CI",
      ].join("\n"),
    )
    .action(async (paths: string[], options: RunCliOptions, command: Command) => {
      try {
        const format = options.format;
        if (!isFormat(format)) {
          throw new TestError(`Unknown --format "${format}". Use ${FORMAT_LIST}.`);
        }
        const result = await runTest({
          paths,
          collection: options.collection,
          configPath: options.config,
          allowEmpty: options.allowEmpty === true,
          progress: options.progress ?? process.stderr.isTTY,
        });
        const out =
          format === "json"
            ? renderJson(result)
            : format === "github"
              ? renderGithub(result)
              : renderPretty(result, { color: colorFor(command, process.stdout.isTTY) });
        process.stdout.write(`${out}\n`);
        process.exitCode = result.exitCode;
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
