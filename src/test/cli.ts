/**
 * The `test` domain's commander program. Mounted by `src/cli.ts` under
 * `manni test`; no entry point of its own. Two verbs, `procedures` and
 * `tasks`, spelled out as every domain spells its verbs.
 *
 * The job is testing the docs' procedures, and Doc Detective is the tool that
 * runs them. manni starts it, reads its results file, and reports in the
 * family contract: exit `0` no step failed, `1` one did, `2` operational or
 * usage. Doc Detective's own log is a diagnostic, so it goes to stderr.
 */
import { Command, Option } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { collect } from "../shared/cli-options.js";
import { colorFor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { runProcedures } from "./commands/procedures.js";
import { runTasks } from "./commands/tasks.js";
import { TestError } from "./errors.js";
import { renderGithub } from "./reporters/github.js";
import { renderJson } from "./reporters/json.js";
import { renderPretty } from "./reporters/pretty.js";
import { renderTasks } from "./reporters/tasks.js";

const FORMATS = ["pretty", "json", "github"] as const;
type Format = (typeof FORMATS)[number];
const FORMAT_LIST = FORMATS.join(" | ");

function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

/** What commander hands `procedures`'s action. */
interface ProceduresCliOptions {
  /** `--collection <name>`, repeatable; commander's default value is `[]`. */
  collection: string[];
  config?: string;
  /** Always a string: the declaration has a default. */
  format: string;
  allowEmpty?: boolean;
  /** `--progress` → true, `--no-progress` → false, neither → undefined (auto). */
  progress?: boolean;
}

/** What commander hands `tasks`'s action. */
interface TasksCliOptions {
  task?: string;
  /** `--journey <id>`, repeatable; commander's default value is `[]`. */
  journey: string[];
  /** `--persona <id>`, repeatable; commander's default value is `[]`. */
  persona: string[];
  workspace?: string;
  config?: string;
  format: string;
  provider?: string;
  model?: string;
  keep?: boolean;
  allowEmpty?: boolean;
  progress?: boolean;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("test")
    .description("Run the docs' procedure tests, and have synthetic users attempt tasks in them")
    .version(pkg.version, "-V, --version")
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` call below, which copies the exit
    // callback by value. See the same note in ../key/cli.ts.
    .exitOverride();

  program
    .command("procedures")
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
        "  manni test procedures docs/guide.md                 # one page",
        "  manni test procedures                               # Doc Detective's config input",
        "  manni test procedures --collection site             # a configured collection",
        "  manni test procedures -f github --progress          # in CI",
      ].join("\n"),
    )
    .action(async (paths: string[], options: ProceduresCliOptions, command: Command) => {
      try {
        const format = options.format;
        if (!isFormat(format)) {
          throw new TestError(`Unknown --format "${format}". Use ${FORMAT_LIST}.`);
        }
        const result = await runProcedures({
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

  program
    .command("tasks")
    .description(
      "Have a synthetic user attempt a task from a page or a journey, then judge its trace and workspace against the docs.",
    )
    .argument("[targets...]", "page paths and http(s):// URLs to start from; each journey's entry-point when omitted")
    .option("--task <text>", "the task in plain text, in the reader's words; needs a target")
    .addOption(
      new Option("--journey <id>", "a journey record as the task; repeatable")
        .argParser(collect)
        .default([], "every journey that declares evals:"),
    )
    .addOption(
      new Option("--persona <id>", "a persona record the synthetic user plays; repeatable")
        .argParser(collect)
        .default([], "the journey's personas"),
    )
    .option("--workspace <dir>", "directory copied fresh for each run (default: the journey's workspace:, else empty)")
    .option("-c, --config <path>", "path to a manni config file")
    .option("-f, --format <format>", `output: ${FORMAT_LIST}`, "pretty")
    .option("--provider <name>", "the judge's provider")
    .option("--model <id>", "the judge's model")
    .option("--keep", "keep each run's workspace and name its path on stderr")
    .option("--allow-empty", "treat an empty golden set as success")
    .option("--progress", "stream each action the synthetic user takes to stderr (default: only on a terminal)")
    .option("--no-progress", "never stream the synthetic user's actions")
    .option("--no-color", "disable colored output")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        '  manni test tasks docs/get-started.md --task "Install it and print its version"',
        "  manni test tasks https://example.com/docs/ --task \"Install it\" --persona theo",
        "  manni test tasks --journey t1                       # a journey record is the task",
        "  manni test tasks                                    # every journey that declares evals:",
        "  manni test tasks -f github --no-progress            # in CI",
      ].join("\n"),
    )
    .action(async (targets: string[], options: TasksCliOptions, command: Command) => {
      try {
        const format = options.format;
        if (!isFormat(format)) {
          throw new TestError(`Unknown --format "${format}". Use ${FORMAT_LIST}.`);
        }
        const report = await runTasks({
          targets,
          ...(options.task === undefined ? {} : { task: options.task }),
          journeys: options.journey,
          personas: options.persona,
          ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
          ...(options.config === undefined ? {} : { configPath: options.config }),
          ...(options.provider === undefined ? {} : { provider: options.provider }),
          ...(options.model === undefined ? {} : { model: options.model }),
          keep: options.keep === true,
          allowEmpty: options.allowEmpty === true,
          progress: options.progress ?? process.stderr.isTTY,
        });
        const out = renderTasks(report, format, { color: colorFor(command, process.stdout.isTTY) });
        process.stdout.write(`${out}\n`);
        process.exitCode = report.exitCode;
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
